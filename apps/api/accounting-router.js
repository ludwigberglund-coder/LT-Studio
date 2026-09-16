'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const Accounting=require('./accounting-store.js');
const Reports=require('./accounting-reports.js');
const {securityHeaders}=require('./app.js');

const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));
function routeError(message,code='ACCOUNTING_ROUTE_ERROR',statusCode=400){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function send(res,status,body){if(res.writableEnded)return;res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}
function createAccountingRouter(options){
  const db=options?.db;if(!db)throw new Error('Databas krävs.');Accounting.initializeAccountingStore(db);
  const accessModel=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
  function session(req){const token=Auth.parseCookies(req.headers.cookie).rollands_session;if(!token)return null;const s=Db.sessionByTokenHash(db,Auth.hashToken(token));if(!s||s.disabled)return null;s.actor={id:s.userId,name:s.displayName,roles:s.roles,disabled:Boolean(s.disabled)};return s}
  function requireSession(req){const s=session(req);if(!s)throw routeError('Personlig inloggning krävs.','AUTH_REQUIRED',401);return s}
  function permission(s,id){const d=Access.authorize(accessModel,s.actor,id);if(!d.allowed)throw routeError('Du saknar behörighet för åtgärden.','ACCESS_DENIED',403)}
  async function handle(req,res){
    let url;try{url=new URL(req.url,'http://localhost')}catch{return false}
    if(!url.pathname.startsWith('/api/v1/accounting'))return false;
    try{
      const s=requireSession(req);
      const from=String(url.searchParams.get('from')||''),to=String(url.searchParams.get('to')||'');
      if(req.method==='GET'&&url.pathname==='/api/v1/accounting/entries'){permission(s,'accounting.view');const limit=Number(url.searchParams.get('limit')||500);return send(res,200,{entries:Reports.entries(db,s.companyId,{from,to,limit})}),true}
      if(req.method==='GET'&&url.pathname==='/api/v1/accounting/periods'){permission(s,'accounting.view');return send(res,200,{periods:Reports.periods(db,s.companyId)}),true}
      if(req.method==='GET'&&url.pathname==='/api/v1/accounting/reports/overview'){permission(s,'reports.view');return send(res,200,{report:Reports.overview(db,s.companyId,{from,to})}),true}
      if(req.method==='GET'&&url.pathname==='/api/v1/accounting/reports/trial-balance'){permission(s,'reports.view');const source=Reports.rows(db,s.companyId,{from,to});return send(res,200,{range:Reports.validateRange(from,to),accounts:Reports.trialBalance(source)}),true}
      if(req.method==='GET'&&url.pathname==='/api/v1/accounting/reports/income-statement'){permission(s,'reports.view');const source=Reports.rows(db,s.companyId,{from,to});return send(res,200,{range:Reports.validateRange(from,to),report:Reports.incomeStatement(source)}),true}
      if(req.method==='GET'&&url.pathname==='/api/v1/accounting/reports/balance-sheet'){permission(s,'reports.view');const source=Reports.rows(db,s.companyId,{from,to});return send(res,200,{range:Reports.validateRange(from,to),report:Reports.balanceSheet(source)}),true}
      if(req.method==='GET'&&url.pathname==='/api/v1/accounting/reports/vat-summary'){permission(s,'reports.view');const source=Reports.rows(db,s.companyId,{from,to});return send(res,200,{range:Reports.validateRange(from,to),report:Reports.vatSummary(source),notice:'Momsöversikten är kontobaserad och är inte en färdig momsdeklaration.'}),true}
      send(res,404,{error:'Hittades inte.',code:'NOT_FOUND'});return true;
    }catch(error){const status=Number(error.statusCode||500);if(status>=500)console.error(error);send(res,status,{error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Begäran misslyckades.'),code:error.code||'INTERNAL_ERROR'});return true}
  }
  return Object.freeze({handle,accessModel});
}
module.exports=Object.freeze({createAccountingRouter});
