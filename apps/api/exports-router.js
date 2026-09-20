'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const Exports=require('./exports.js');
const {securityHeaders}=require('./app.js');

const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));

function routeError(message,code='EXPORT_ROUTE_ERROR',statusCode=400){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function createExportsRouter(options){
  const db=options?.db;if(!db)throw new Error('Databas krävs.');
  const accessModel=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
  function session(req){const token=Auth.parseCookies(req.headers.cookie).rollands_session;if(!token)return null;const s=Db.sessionByTokenHash(db,Auth.hashToken(token));if(!s||s.disabled)return null;s.actor={id:s.userId,name:s.displayName,companyId:s.companyId,authenticated:true,membershipActive:true,disabled:Boolean(s.disabled)};return s}
  function requireSession(req){const s=session(req);if(!s)throw routeError('Personlig inloggning krävs.','AUTH_REQUIRED',401);return s}
  function permission(s){const d=Access.authorize(accessModel,s.actor,'reports.view');if(!d.allowed)throw routeError('Du saknar behörighet för export.','ACCESS_DENIED',403)}
  async function handle(req,res){
    let url;try{url=new URL(req.url,'http://localhost')}catch{return false}
    const match=url.pathname.match(/^\/api\/v1\/exports\/([a-z-]+)$/);
    if(!match)return false;
    try{
      if(req.method!=='GET')throw routeError('Export-API:t är skrivskyddat.','METHOD_NOT_ALLOWED',405);
      const s=requireSession(req);permission(s);
      const filters={
        from:String(url.searchParams.get('from')||''),
        to:String(url.searchParams.get('to')||''),
        status:String(url.searchParams.get('status')||''),
        account:String(url.searchParams.get('account')||''),
        period:String(url.searchParams.get('period')||'')
      };
      const dataset=Exports.select(db,s.companyId,match[1],filters);
      const body=Buffer.from(Exports.buildCsv(dataset),'utf8');
      res.writeHead(200,{...securityHeaders(),'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${dataset.filename}"`,'Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(body);return true;
    }catch(error){
      const status=Number(error.statusCode||500);
      if(status>=500)console.error(error);
      if(res.writableEnded)return true;
      res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Exporten misslyckades.'),code:error.code||'INTERNAL_ERROR'}));
      return true;
    }
  }
  return Object.freeze({handle,accessModel});
}
module.exports=Object.freeze({createExportsRouter});
