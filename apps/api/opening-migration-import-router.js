'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const OpeningMigration=require('./opening-migration-import.js');
const {readJson,securityHeaders}=require('./app.js');

const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));
function routeError(message,code='OPENING_MIGRATION_ROUTE_ERROR',statusCode=400){const error=new Error(message);error.code=code;error.statusCode=statusCode;return error}
function send(res,status,body){if(res.writableEnded)return;res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}

function createOpeningMigrationImportRouter(options){
  const db=options?.db;if(!db)throw new Error('Databas krävs.');
  OpeningMigration.initializeOpeningMigrationImport(db);
  const accessModel=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
  function session(req){const token=Auth.parseCookies(req.headers.cookie).rollands_session;if(!token)return null;const s=Db.sessionByTokenHash(db,Auth.hashToken(token));if(!s||s.disabled)return null;s.actor={id:s.userId,name:s.displayName,companyId:s.companyId,authenticated:true,membershipActive:true,disabled:Boolean(s.disabled)};return s}
  function requireSession(req){const s=session(req);if(!s)throw routeError('Personlig inloggning krävs.','AUTH_REQUIRED',401);return s}
  function csrf(req,s){const supplied=String(req.headers['x-csrf-token']||'');if(!supplied||!Auth.safeEqualText(Auth.hashToken(supplied),s.csrfHash))throw routeError('Säkerhetskontrollen misslyckades.','CSRF_FAILED',403)}
  function permission(s,id){const d=Access.authorize(accessModel,s.actor,id);if(!d.allowed)throw routeError('Du saknar behörighet för åtgärden.','ACCESS_DENIED',403)}

  async function handle(req,res){
    let url;try{url=new URL(req.url,'http://localhost')}catch{return false}
    const read=url.pathname.match(/^\/api\/v1\/accounting\/opening-migration\/imports\/((?:19|20|21)\d{2})$/);
    const importing=url.pathname==='/api/v1/accounting/opening-migration/import';
    if(!read&&!importing)return false;
    try{
      const s=requireSession(req);
      if(read&&req.method==='GET'){
        permission(s,'accounting.view');
        const result=OpeningMigration.verifyImportIntegrity(db,s.companyId,read[1]);
        if(!result)throw routeError('Systembytesimporten hittades inte.','OPENING_MIGRATION_NOT_FOUND',404);
        return send(res,200,result),true;
      }
      if(importing&&req.method==='POST'){
        csrf(req,s);permission(s,'accounting.correct');
        const body=await readJson(req,res);if(!body)return true;
        if(body.confirmImport!==true)throw routeError('Systembytesimport kräver en uttrycklig bekräftelse. Ingen data importerades.','OPENING_MIGRATION_CONFIRMATION_REQUIRED',422);
        const result=OpeningMigration.importOpeningMigration(db,{
          companyId:s.companyId,createdBy:s.userId,year:body.year,postingDate:body.postingDate,
          lines:body.lines,receivables:body.receivables,payables:body.payables
        });
        return send(res,result.duplicate?200:201,result),true;
      }
      send(res,404,{error:'Hittades inte.',code:'NOT_FOUND'});return true;
    }catch(error){
      const status=Number(error.statusCode||500);
      if(status>=500)console.error(error);
      const body={error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Begäran misslyckades.'),code:error.code||'INTERNAL_ERROR'};
      if(status<500&&error.details)body.details=error.details;
      send(res,status,body);return true;
    }
  }
  return Object.freeze({handle,accessModel});
}
module.exports=Object.freeze({createOpeningMigrationImportRouter});
