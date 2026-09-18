'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const Reports=require('./reports.js');
const Accounting=require('./accounting-store.js');
const Payables=require('./payables.js');
const {securityHeaders}=require('./app.js');

const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));
function routeError(message,code='REPORT_ROUTE_ERROR',statusCode=400){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function send(res,status,body){if(res.writableEnded)return;res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}
function createReportsRouter(options){
  const db=options?.db;if(!db)throw new Error('Databas krävs.');Accounting.initializeAccountingStore(db);Payables.initializePayables(db);
  const accessModel=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
  function session(req){const token=Auth.parseCookies(req.headers.cookie).rollands_session;if(!token)return null;const s=Db.sessionByTokenHash(db,Auth.hashToken(token));if(!s||s.disabled)return null;s.actor={id:s.userId,name:s.displayName,roles:s.roles,disabled:Boolean(s.disabled)};return s}
  function requireSession(req){const s=session(req);if(!s)throw routeError('Personlig inloggning krävs.','AUTH_REQUIRED',401);return s}
  function permission(s,id){const d=Access.authorize(accessModel,s.actor,id);if(!d.allowed)throw routeError('Du saknar behörighet för rapporten.','ACCESS_DENIED',403)}
  async function handle(req,res){
    let url;try{url=new URL(req.url,'http://localhost')}catch{return false}
    if(!url.pathname.startsWith('/api/v1/reports/'))return false;
    try{
      const s=requireSession(req);permission(s,'reports.view');
      if(req.method!=='GET')throw routeError('Rapport-API:t är skrivskyddat.','METHOD_NOT_ALLOWED',405);
      const from=String(url.searchParams.get('from')||''),to=String(url.searchParams.get('to')||''),period=String(url.searchParams.get('period')||'');
      if(url.pathname==='/api/v1/reports/trial-balance')return send(res,200,Reports.trialBalance(db,s.companyId,{from,to})),true;
      if(url.pathname==='/api/v1/reports/general-ledger')return send(res,200,Reports.generalLedger(db,s.companyId,{from,to,account:String(url.searchParams.get('account')||'')})),true;
      if(url.pathname==='/api/v1/reports/profit-loss')return send(res,200,Reports.profitLoss(db,s.companyId,{from,to})),true;
      if(url.pathname==='/api/v1/reports/vat-control')return send(res,200,Reports.vatControl(db,s.companyId,{period})),true;
      if(url.pathname==='/api/v1/reports/receivables-control')return send(res,200,Reports.receivablesControl(db,s.companyId)),true;
      if(url.pathname==='/api/v1/reports/payables-control')return send(res,200,Reports.payablesControl(db,s.companyId)),true;
      send(res,404,{error:'Hittades inte.',code:'NOT_FOUND'});return true;
    }catch(error){const status=Number(error.statusCode||500);if(status>=500)console.error(error);send(res,status,{error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Begäran misslyckades.'),code:error.code||'INTERNAL_ERROR'});return true}
  }
  return Object.freeze({handle,accessModel});
}
module.exports=Object.freeze({createReportsRouter});
