'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const Confirmation=require('./payment-confirmation.js');
const {readJson,securityHeaders}=require('./app.js');

const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));
function routeError(message,code='PAYMENT_CONFIRMATION_ROUTE_ERROR',statusCode=400){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function send(res,status,body){if(res.writableEnded)return;res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}
function createPaymentConfirmationRouter(options){
  const db=options?.db;if(!db)throw new Error('Databas krävs.');Confirmation.initializePaymentConfirmation(db);
  const model=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
  function session(req){const token=Auth.parseCookies(req.headers.cookie).rollands_session;if(!token)return null;const s=Db.sessionByTokenHash(db,Auth.hashToken(token));if(!s||s.disabled)return null;s.actor={id:s.userId,name:s.displayName,companyId:s.companyId,authenticated:true,membershipActive:true,disabled:Boolean(s.disabled),role:s.role};return s}
  function requireSession(req){const s=session(req);if(!s)throw routeError('Personlig inloggning krävs.','AUTH_REQUIRED',401);return s}
  function csrf(req,s){const supplied=String(req.headers['x-csrf-token']||'');if(!supplied||!Auth.safeEqualText(Auth.hashToken(supplied),s.csrfHash))throw routeError('Säkerhetskontrollen misslyckades.','CSRF_FAILED',403)}
  function permission(s,id){const d=Access.authorize(model,s.actor,id);if(!d.allowed)throw routeError('Du saknar behörighet för åtgärden.','ACCESS_DENIED',403)}
  async function handle(req,res){
    let url;try{url=new URL(req.url,'http://localhost')}catch{return false}
    const confirm=url.pathname.match(/^\/api\/v1\/payables\/payments\/([^/]+)\/confirm-post$/);
    const correction=url.pathname.match(/^\/api\/v1\/payables\/payments\/([^/]+)\/correct$/);
    if(!confirm&&!correction)return false;
    try{
      if(req.method!=='POST'){send(res,405,{error:'Metoden stöds inte.',code:'METHOD_NOT_ALLOWED'});return true}
      const s=requireSession(req);csrf(req,s);
      const payload=await readJson(req,res);if(!payload)return true;
      if(confirm){
        permission(s,'bank.reconcile');permission(s,'accounting.post');
        const result=Confirmation.confirmAndPost(db,{companyId:s.companyId,paymentId:confirm[1],confirmationReference:payload.confirmationReference,postingDate:payload.postingDate,actorId:s.userId});
        send(res,200,{...result,message:result.duplicate?`Betalningen var redan bokförd som ${result.entry.number}.`:`Betalningen är bekräftad och bokförd som ${result.entry.number}.`});return true;
      }
      permission(s,'bank.reconcile');permission(s,'accounting.correct');
      const result=Confirmation.correctAndReopen(db,{companyId:s.companyId,paymentId:correction[1],requestId:payload.requestId,correctionDate:payload.correctionDate,reason:payload.reason,actorId:s.userId});
      send(res,result.duplicate?200:201,{...result,message:result.duplicate?'Rättelsen var redan bokförd.':'Betalningen har rättats, leverantörsskulden är åter öppen och originalhistoriken är bevarad.'});return true;
    }catch(error){const status=Number(error.statusCode||500);if(status>=500)console.error(error);send(res,status,{error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Begäran misslyckades.'),code:error.code||'INTERNAL_ERROR'});return true}
  }
  return Object.freeze({handle,accessModel:model});
}
module.exports=Object.freeze({createPaymentConfirmationRouter});
