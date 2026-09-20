'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const Release=require('./payment-release.js');
const {securityHeaders}=require('./app.js');

const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));
function err(message,code='PAYMENT_RELEASE_ROUTE_ERROR',statusCode=400){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function send(res,status,body){if(res.writableEnded)return;res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}
function createPaymentReleaseRouter(options){
  const db=options?.db;if(!db)throw new Error('Databas krävs.');
  const model=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
  function session(req){const token=Auth.parseCookies(req.headers.cookie).rollands_session;if(!token)return null;const s=Db.sessionByTokenHash(db,Auth.hashToken(token));if(!s||s.disabled)return null;s.actor={id:s.userId,name:s.displayName,companyId:s.companyId,authenticated:true,membershipActive:true,disabled:Boolean(s.disabled)};return s}
  function requireSession(req){const s=session(req);if(!s)throw err('Personlig inloggning krävs.','AUTH_REQUIRED',401);return s}
  function csrf(req,s){const supplied=String(req.headers['x-csrf-token']||'');if(!supplied||!Auth.safeEqualText(Auth.hashToken(supplied),s.csrfHash))throw err('Säkerhetskontrollen misslyckades.','CSRF_FAILED',403)}
  function permission(s,id){const d=Access.authorize(model,s.actor,id);if(!d.allowed)throw err('Du saknar behörighet för åtgärden.','ACCESS_DENIED',403)}
  async function handle(req,res){
    let url;try{url=new URL(req.url,'http://localhost')}catch{return false}
    const match=url.pathname.match(/^\/api\/v1\/payables\/payments\/([^/]+)\/release$/);
    if(!match)return false;
    try{
      if(req.method!=='POST'){send(res,405,{error:'Metoden stöds inte.',code:'METHOD_NOT_ALLOWED'});return true}
      const s=requireSession(req);csrf(req,s);permission(s,'payment.release');
      const payment=Release.paymentById(db,s.companyId,match[1]);
      if(!payment)throw err('Betalningen hittades inte.','PAYMENT_NOT_FOUND',404);
      const workflow=Access.evaluateWorkflowAction(model,s.actor,'payment-release',{preparedBy:payment.preparedBy,releasedBy:s.userId});
      if(!workflow.allowed)throw err(workflow.reason,workflow.code,409);
      const released=Db.transaction(db,()=>{const value=Release.releasePayment(db,{companyId:s.companyId,paymentId:payment.id,releasedBy:s.userId});Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'SUPPLIER_PAYMENT_RELEASED',entityType:'supplier-payment',entityId:value.id,details:{invoiceId:value.supplierInvoiceId,amountOre:value.amountOre,paymentDate:value.paymentDate,bankExecutionStatus:'not-sent'}});return value});
      send(res,200,{payment:released,bankExecutionStatus:'not-sent',message:'Betalningen är frisläppt för ett senare banksteg men har inte skickats till banken.'});return true;
    }catch(error){const status=Number(error.statusCode||500);if(status>=500)console.error(error);send(res,status,{error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Begäran misslyckades.'),code:error.code||'INTERNAL_ERROR'});return true}
  }
  return Object.freeze({handle,accessModel:model});
}
module.exports=Object.freeze({createPaymentReleaseRouter});
