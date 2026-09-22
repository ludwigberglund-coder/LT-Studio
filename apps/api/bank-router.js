'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Matcher=require('../../packages/automation/bank-payment-matcher.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const Bank=require('./bank-payments.js');
const Queues=require('./queues.js');
const {readJson,securityHeaders}=require('./app.js');

const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));
function routeError(message,code='BANK_ROUTE_ERROR',statusCode=400){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function send(res,status,body){if(res.writableEnded)return;res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}

function createBankRouter(options){
  const db=options?.db;if(!db)throw new Error('Databas krävs för bankflödet.');
  Bank.initializeBankPayments(db);Queues.initializeQueues(db);
  const model=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
  function session(req){const token=Auth.parseCookies(req.headers.cookie).rollands_session;if(!token)return null;const s=Db.sessionByTokenHash(db,Auth.hashToken(token));if(!s||s.disabled)return null;s.actor={id:s.userId,name:s.displayName,companyId:s.companyId,authenticated:true,membershipActive:true,disabled:Boolean(s.disabled),role:s.role};return s}
  function requireSession(req){const s=session(req);if(!s)throw routeError('Personlig inloggning krävs.','AUTH_REQUIRED',401);return s}
  function csrf(req,s){const supplied=String(req.headers['x-csrf-token']||'');if(!supplied||!Auth.safeEqualText(Auth.hashToken(supplied),s.csrfHash))throw routeError('Säkerhetskontrollen misslyckades.','CSRF_FAILED',403)}
  function permission(s,id){if(!Access.authorize(model,s.actor,id).allowed)throw routeError('Du saknar behörighet för åtgärden.','ACCESS_DENIED',403)}

  async function handle(req,res){
    let url;try{url=new URL(req.url,'http://localhost')}catch{return false}
    if(!url.pathname.startsWith('/api/v1/bank/'))return false;
    try{
      const s=requireSession(req);if(req.method!=='GET')csrf(req,s);
      if(req.method==='GET'&&url.pathname==='/api/v1/bank/payments'){
        permission(s,'bank.view');return send(res,200,{payments:Bank.list(db,s.companyId,{status:String(url.searchParams.get('status')||'')})}),true;
      }
      if(req.method==='POST'&&url.pathname==='/api/v1/bank/payments'){
        permission(s,'bank.import');const payload=await readJson(req,res);if(!payload)return true;
        const result=Db.transaction(db,()=>{
          const created=Bank.create(db,{...payload,companyId:s.companyId,createdBy:s.userId});
          if(!created.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'BANK_PAYMENT_IMPORTED',entityType:'bank-payment',entityId:created.payment.id,details:{externalId:created.payment.externalId,amountOre:created.payment.amountOre}});
          return created;
        });
        return send(res,result.duplicate?200:201,result),true;
      }
      const match=url.pathname.match(/^\/api\/v1\/bank\/payments\/([^/]+)\/match$/);
      if(match&&req.method==='POST'){
        permission(s,'bank.reconcile');const payment=Bank.byId(db,s.companyId,match[1]);if(!payment)throw routeError('Bankhändelsen hittades inte.','BANK_PAYMENT_NOT_FOUND',404);
        const invoices=Db.listReceivables(db,s.companyId);
        const analysis=Matcher.analyzeIncomingPayment(payment,invoices);
        if(analysis.status==='no-match'){
          Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'BANK_PAYMENT_MATCH_NO_RESULT',entityType:'bank-payment',entityId:payment.id,details:{reason:analysis.reason}});
          return send(res,200,{analysis,proposal:null}),true;
        }
        const proposal=Matcher.createMatchProposal(payment,analysis,{createdBy:s.userId});
        const saved=Db.transaction(db,()=>{
          const stored=Queues.saveAutomationProposal(db,proposal,{idempotencyKey:`bank-payment-match:${payment.id}:v1`});
          if(!stored.duplicate){
            Bank.setStatus(db,s.companyId,payment.id,'proposal-created');
            Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'BANK_PAYMENT_MATCH_PROPOSED',entityType:'bank-payment',entityId:payment.id,details:{proposalId:stored.proposal.id,invoiceId:analysis.targetInvoiceId,confidence:analysis.confidence,ambiguous:analysis.ambiguous}});
          }
          return stored;
        });
        return send(res,200,{analysis,proposal:saved.proposal,duplicate:saved.duplicate,executionStatus:'not-executed'}),true;
      }
      send(res,404,{error:'Hittades inte.',code:'NOT_FOUND'});return true;
    }catch(error){const status=Number(error.statusCode||500);if(status>=500)console.error(error);send(res,status,{error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Begäran kunde inte behandlas.'),code:error.code||'INTERNAL_ERROR'});return true}
  }
  return Object.freeze({handle});
}
module.exports=Object.freeze({createBankRouter});
