'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const Accounting=require('./accounting-store.js');
const Admin=require('./accounting-admin.js');
const OpeningMigration=require('./opening-migration-preview.js');
const {readJson,securityHeaders}=require('./app.js');
const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));
function routeError(message,code='ACCOUNTING_ROUTE_ERROR',statusCode=400){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function send(res,status,body){if(res.writableEnded)return;res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}
function createAccountingAdminRouter(options){
 const db=options?.db;if(!db)throw new Error('Databas krävs.');Admin.initializeAccountingAdmin(db);const accessModel=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
 function session(req){const token=Auth.parseCookies(req.headers.cookie).rollands_session;if(!token)return null;const s=Db.sessionByTokenHash(db,Auth.hashToken(token));if(!s||s.disabled)return null;s.actor={id:s.userId,name:s.displayName,companyId:s.companyId,authenticated:true,membershipActive:true,disabled:Boolean(s.disabled)};return s}
 function requireSession(req){const s=session(req);if(!s)throw routeError('Personlig inloggning krävs.','AUTH_REQUIRED',401);return s}
 function csrf(req,s){const supplied=String(req.headers['x-csrf-token']||'');if(!supplied||!Auth.safeEqualText(Auth.hashToken(supplied),s.csrfHash))throw routeError('Säkerhetskontrollen misslyckades.','CSRF_FAILED',403)}
 function permission(s,id){const d=Access.authorize(accessModel,s.actor,id);if(!d.allowed)throw routeError('Du saknar behörighet för åtgärden.','ACCESS_DENIED',403)}
 async function handle(req,res){
  let url;try{url=new URL(req.url,'http://localhost')}catch{return false}if(!url.pathname.startsWith('/api/v1/accounting/'))return false;
  try{const s=requireSession(req);if(req.method!=='GET')csrf(req,s);
   if(url.pathname==='/api/v1/accounting/entries'&&req.method==='GET'){permission(s,'accounting.view');return send(res,200,{entries:Accounting.listEntries(db,s.companyId,{limit:url.searchParams.get('limit')||200}),corrections:Admin.listCorrections(db,s.companyId)}),true}
   const entry=url.pathname.match(/^\/api\/v1\/accounting\/entries\/([^/]+)$/);if(entry&&req.method==='GET'){permission(s,'accounting.view');const value=Admin.entryById(db,s.companyId,entry[1]);if(!value)throw routeError('Verifikationen hittades inte.','ENTRY_NOT_FOUND',404);return send(res,200,{entry:value,correction:Admin.correctionByOriginal(db,s.companyId,value.id),correctionPolicy:Admin.correctionPolicy(db,s.companyId,value.id)}),true}
   const correction=url.pathname.match(/^\/api\/v1\/accounting\/entries\/([^/]+)\/correct$/);if(correction&&req.method==='POST'){permission(s,'accounting.correct');const body=await readJson(req,res);if(!body)return true;const result=Db.transaction(db,()=>{const value=Admin.correctEntry(db,{companyId:s.companyId,entryId:correction[1],postingDate:body.postingDate,reason:body.reason,replacementLines:body.replacementLines,createdBy:s.userId});return value});return send(res,201,result),true}
   if(url.pathname==='/api/v1/accounting/opening-migration/preview'&&req.method==='POST'){permission(s,'accounting.view');const body=await readJson(req,res);if(!body)return true;const preview=OpeningMigration.previewOpeningMigration(db,{companyId:s.companyId,year:body.year,postingDate:body.postingDate,lines:body.lines,receivables:body.receivables,payables:body.payables});return send(res,200,{preview}),true}
   const opening=url.pathname.match(/^\/api\/v1\/accounting\/opening-balances\/((?:19|20|21)\d{2})$/);
   if(opening&&req.method==='GET'){permission(s,'accounting.view');const entry=Admin.openingBalanceByYear(db,s.companyId,opening[1]);if(!entry)throw routeError('Ingående balans hittades inte.','OPENING_BALANCE_NOT_FOUND',404);return send(res,200,{entry}),true}
   if(opening&&req.method==='POST'){permission(s,'accounting.correct');const body=await readJson(req,res);if(!body)return true;const result=Db.transaction(db,()=>{const value=Admin.importOpeningBalance(db,{companyId:s.companyId,year:opening[1],postingDate:body.postingDate,lines:body.lines,createdBy:s.userId});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'OPENING_BALANCE_IMPORTED',entityType:'accounting-entry',entityId:value.entry.id,details:{year:opening[1],journalNumber:value.entry.number,debitOre:value.entry.lines.reduce((sum,line)=>sum+line.debitOre,0)}});return value});return send(res,result.duplicate?200:201,result),true}
   if(url.pathname==='/api/v1/accounting/periods'&&req.method==='GET'){permission(s,'accounting.view');return send(res,200,{periods:Admin.listPeriods(db,s.companyId,{year:String(url.searchParams.get('year')||'')})}),true}
   const lock=url.pathname.match(/^\/api\/v1\/accounting\/periods\/(\d{4}-\d{2})\/lock$/);if(lock&&req.method==='POST'){permission(s,'period.lock');const result=Db.transaction(db,()=>{const value=Admin.lockPeriodIdempotent(db,{companyId:s.companyId,period:lock[1],lockedBy:s.userId});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'ACCOUNTING_PERIOD_LOCKED',entityType:'accounting-period',entityId:value.period.period,details:{status:value.period.status}});return value});return send(res,200,result),true}
   const request=url.pathname.match(/^\/api\/v1\/accounting\/periods\/(\d{4}-\d{2})\/unlock-request$/);if(request&&req.method==='POST'){permission(s,'accounting.correct');const body=await readJson(req,res);if(!body)return true;const result=Db.transaction(db,()=>{const value=Admin.requestUnlockIdempotent(db,{companyId:s.companyId,period:request[1],reason:body.reason,requestedBy:s.userId});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'ACCOUNTING_PERIOD_UNLOCK_REQUESTED',entityType:'accounting-period',entityId:value.request.period,details:{requestId:value.request.id,reason:value.request.reason}});return value});return send(res,result.duplicate?200:201,result),true}
   if(url.pathname==='/api/v1/accounting/unlock-requests'&&req.method==='GET'){permission(s,'accounting.view');return send(res,200,{requests:Admin.listUnlockRequests(db,s.companyId,{status:String(url.searchParams.get('status')||'all')})}),true}
   const decide=url.pathname.match(/^\/api\/v1\/accounting\/unlock-requests\/([^/]+)\/(approve|reject)$/);if(decide&&req.method==='POST'){permission(s,'period.unlock');const current=Admin.unlockRequestById(db,s.companyId,decide[1]);if(!current)throw routeError('Upplåsningsbegäran hittades inte.','UNLOCK_REQUEST_NOT_FOUND',404);const workflow=Access.evaluateWorkflowAction(accessModel,s.actor,'period-unlock',{requestedBy:current.requestedBy,unlockedBy:s.userId});if(!workflow.allowed)throw routeError(workflow.reason,workflow.code,409);const body=await readJson(req,res);if(!body)return true;const result=Db.transaction(db,()=>{const value=Admin.decideUnlock(db,{companyId:s.companyId,requestId:current.id,decidedBy:s.userId,decision:decide[2]==='approve'?'approved':'rejected',decisionReason:body.reason||''});Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:decide[2]==='approve'?'ACCOUNTING_PERIOD_UNLOCKED':'ACCOUNTING_PERIOD_UNLOCK_REJECTED',entityType:'accounting-period',entityId:current.period,details:{requestId:current.id,decision:value.request.status}});return value});return send(res,200,result),true}
   send(res,404,{error:'Hittades inte.',code:'NOT_FOUND'});return true;
  }catch(error){const status=Number(error.statusCode||500);if(status>=500)console.error(error);send(res,status,{error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Begäran misslyckades.'),code:error.code||'INTERNAL_ERROR'});return true}
 }
 return Object.freeze({handle,accessModel});
}
module.exports=Object.freeze({createAccountingAdminRouter});
