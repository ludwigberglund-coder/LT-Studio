'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const Payroll=require('./payroll.js');
const {readJson,securityHeaders}=require('./app.js');

const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));
function routeError(message,code='PAYROLL_ROUTE_ERROR',statusCode=400){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function send(res,status,body){if(res.writableEnded)return;res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}

function createPayrollRouter(options){
  const db=options?.db;if(!db)throw new Error('Databas krävs.');Payroll.initializePayroll(db);
  const accessModel=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
  function session(req){const token=Auth.parseCookies(req.headers.cookie).rollands_session;if(!token)return null;const s=Db.sessionByTokenHash(db,Auth.hashToken(token));if(!s||s.disabled)return null;s.actor={id:s.userId,name:s.displayName,companyId:s.companyId,authenticated:true,membershipActive:true,disabled:Boolean(s.disabled)};return s}
  function requireSession(req){const s=session(req);if(!s)throw routeError('Personlig inloggning krävs.','AUTH_REQUIRED',401);return s}
  function csrf(req,s){const supplied=String(req.headers['x-csrf-token']||'');if(!supplied||!Auth.safeEqualText(Auth.hashToken(supplied),s.csrfHash))throw routeError('Säkerhetskontrollen misslyckades.','CSRF_FAILED',403)}
  function permission(s,id){const d=Access.authorize(accessModel,s.actor,id);if(!d.allowed)throw routeError('Du saknar behörighet för åtgärden.','ACCESS_DENIED',403)}

  async function handle(req,res){
    let url;try{url=new URL(req.url,'http://localhost')}catch{return false}
    if(!url.pathname.startsWith('/api/v1/payroll/'))return false;
    try{
      const s=requireSession(req);if(req.method!=='GET')csrf(req,s);
      if(url.pathname==='/api/v1/payroll/runs'&&req.method==='GET'){permission(s,'payroll.view');const period=String(url.searchParams.get('period')||'');return send(res,200,{runs:Payroll.listRuns(db,s.companyId,{period})}),true}
      if(url.pathname==='/api/v1/payroll/runs'&&req.method==='POST'){permission(s,'payroll.import');const body=await readJson(req,res);if(!body)return true;const result=Db.transaction(db,()=>{const value=Payroll.importRunIdempotent(db,{...body,companyId:s.companyId,importedBy:s.userId});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'PAYROLL_JOURNAL_IMPORTED',entityType:'payroll-run',entityId:value.run.id,details:{period:value.run.period,sourceName:value.run.sourceName,journalSha256:value.run.journalSha256}});return value});return send(res,result.duplicate?200:201,result),true}
      const postMatch=url.pathname.match(/^\/api\/v1\/payroll\/runs\/([^/]+)\/post$/);
      if(postMatch&&req.method==='POST'){permission(s,'payroll.import');const result=Db.transaction(db,()=>{const value=Payroll.postRunIdempotent(db,{companyId:s.companyId,runId:postMatch[1],postedBy:s.userId});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'PAYROLL_JOURNAL_POSTED',entityType:'payroll-run',entityId:value.run.id,details:{period:value.run.period,entryId:value.entry.id,entryNumber:value.entry.number}});return value});return send(res,200,result),true}
      send(res,404,{error:'Hittades inte.',code:'NOT_FOUND'});return true;
    }catch(error){const status=Number(error.statusCode||500);if(status>=500)console.error(error);send(res,status,{error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Begäran misslyckades.'),code:error.code||'INTERNAL_ERROR'});return true}
  }
  return Object.freeze({handle,accessModel});
}
module.exports=Object.freeze({createPayrollRouter});
