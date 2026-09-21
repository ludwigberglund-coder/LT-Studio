'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const Payables=require('./payables.js');
const Master=require('./supplier-masterdata.js');
const {readJson,securityHeaders}=require('./app.js');

const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));
function routeError(message,code='SUPPLIER_MASTERDATA_ROUTE_ERROR',statusCode=400){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function send(res,status,body){if(res.writableEnded)return;res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}
function createSupplierMasterdataRouter(options){
  const db=options?.db;if(!db)throw new Error('Databas krävs.');Master.initializeSupplierMasterdata(db);
  const accessModel=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
  function session(req){const token=Auth.parseCookies(req.headers.cookie).rollands_session;if(!token)return null;const s=Db.sessionByTokenHash(db,Auth.hashToken(token));if(!s||s.disabled)return null;s.actor={id:s.userId,name:s.displayName,companyId:s.companyId,authenticated:true,membershipActive:true,disabled:Boolean(s.disabled)};return s}
  function requireSession(req){const s=session(req);if(!s)throw routeError('Personlig inloggning krävs.','AUTH_REQUIRED',401);return s}
  function csrf(req,s){const supplied=String(req.headers['x-csrf-token']||'');if(!supplied||!Auth.safeEqualText(Auth.hashToken(supplied),s.csrfHash))throw routeError('Säkerhetskontrollen misslyckades.','CSRF_FAILED',403)}
  function permission(s,id){const d=Access.authorize(accessModel,s.actor,id);if(!d.allowed)throw routeError('Du saknar behörighet för åtgärden.','ACCESS_DENIED',403)}
  async function handle(req,res){
    let url;try{url=new URL(req.url,'http://localhost')}catch{return false}
    if(!url.pathname.startsWith('/api/v1/suppliers'))return false;
    try{
      const s=requireSession(req);if(req.method!=='GET')csrf(req,s);
      if(req.method==='GET'&&url.pathname==='/api/v1/suppliers'){permission(s,'supplier.view');return send(res,200,{suppliers:Payables.listSuppliers(db,s.companyId)}),true}
      if(req.method==='GET'&&url.pathname==='/api/v1/suppliers/pending-changes'){permission(s,'supplier.view');return send(res,200,{changes:Master.listPending(db,s.companyId)}),true}
      const historyMatch=url.pathname.match(/^\/api\/v1\/suppliers\/([^/]+)\/history$/);
      if(historyMatch&&req.method==='GET'){permission(s,'supplier.view');return send(res,200,{history:Master.history(db,s.companyId,historyMatch[1])}),true}
      const profileMatch=url.pathname.match(/^\/api\/v1\/suppliers\/([^/]+)\/profile$/);
      if(profileMatch&&req.method==='PUT'){permission(s,'supplier.manage');const payload=await readJson(req,res);if(!payload)return true;const result=Db.transaction(db,()=>{const value=Master.requestChangeIdempotent(db,{companyId:s.companyId,supplierId:profileMatch[1],kind:'profile',changes:payload,requestedBy:s.userId,requestKey:payload.requestId});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'SUPPLIER_PROFILE_UPDATED',entityType:'supplier',entityId:profileMatch[1],details:{requestId:value.request.id,requestKey:payload.requestId}});return value});return send(res,200,result),true}
      const bankMatch=url.pathname.match(/^\/api\/v1\/suppliers\/([^/]+)\/payment-details$/);
      if(bankMatch&&req.method==='POST'){permission(s,'supplier.manage');const payload=await readJson(req,res);if(!payload)return true;const result=Db.transaction(db,()=>{const value=Master.requestChangeIdempotent(db,{companyId:s.companyId,supplierId:bankMatch[1],kind:'payment-details',changes:payload,requestedBy:s.userId,requestKey:payload.requestId});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'SUPPLIER_PAYMENT_DETAILS_REQUESTED',entityType:'supplier',entityId:bankMatch[1],details:{requestId:value.request.id,requestKey:payload.requestId}});return value});return send(res,result.duplicate?200:202,{...result,message:'Ändringen väntar på separat godkännande.'}),true}
      const approveMatch=url.pathname.match(/^\/api\/v1\/suppliers\/changes\/([^/]+)\/approve$/);
      if(approveMatch&&req.method==='POST'){permission(s,'supplier.bank-account.approve');const pending=Master.changeRequestById(db,s.companyId,approveMatch[1]);if(!pending)throw routeError('Ändringsbegäran hittades inte.','CHANGE_NOT_FOUND',404);const workflow=Access.evaluateWorkflowAction(accessModel,s.actor,'supplier-bank-change',{requestedBy:pending.requestedBy,approvedBy:s.userId});if(!workflow.allowed)throw routeError(workflow.reason,workflow.code,409);const result=Db.transaction(db,()=>{const value=Master.approvePaymentChange(db,{companyId:s.companyId,requestId:pending.id,approvedBy:s.userId});Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'SUPPLIER_PAYMENT_DETAILS_APPROVED',entityType:'supplier',entityId:value.supplier.id,details:{requestId:pending.id}});return value});return send(res,200,result),true}
      const rejectMatch=url.pathname.match(/^\/api\/v1\/suppliers\/changes\/([^/]+)\/reject$/);
      if(rejectMatch&&req.method==='POST'){permission(s,'supplier.bank-account.approve');const payload=await readJson(req,res);if(!payload)return true;const request=Db.transaction(db,()=>{const value=Master.rejectPaymentChange(db,{companyId:s.companyId,requestId:rejectMatch[1],rejectedBy:s.userId,reason:payload.reason});Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'SUPPLIER_PAYMENT_DETAILS_REJECTED',entityType:'supplier-change',entityId:value.id,details:{reason:value.decisionReason}});return value});return send(res,200,{request}),true}
      send(res,404,{error:'Hittades inte.',code:'NOT_FOUND'});return true;
    }catch(error){const status=Number(error.statusCode||500);if(status>=500)console.error(error);send(res,status,{error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Begäran misslyckades.'),code:error.code||'INTERNAL_ERROR',details:error.details||null});return true}
  }
  return Object.freeze({handle,accessModel});
}
module.exports=Object.freeze({createSupplierMasterdataRouter});
