'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Access = require('../../packages/access-control/authorization.js');
const Auth = require('./auth.js');
const Db = require('./database.js');
const Queues = require('./queues.js');
const ReviewService = require('./automation-review-service.js');
const Bank = require('./bank-payments.js');
const CustomerPayment = require('./customer-payment-posting.js');
const {readJson,securityHeaders} = require('./app.js');

const DEFAULT_ACCESS = JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));

function routeError(message, code = 'AUTOMATION_ROUTE_ERROR', statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function send(res,status,body) {
  if (res.writableEnded) return;
  res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(body));
}

function createAutomationReviewRouter(options) {
  const db = options?.db;
  if (!db) throw new Error('Databas krävs för automationsgranskning.');
  Queues.initializeQueues(db);
  CustomerPayment.initializeCustomerPaymentPosting(db);
  const accessConfig = options.accessConfig || DEFAULT_ACCESS;
  const accessModel = Access.createModel(accessConfig);

  function currentSession(req) {
    const token = Auth.parseCookies(req.headers.cookie).rollands_session;
    if (!token) return null;
    const tokenHash = Auth.hashToken(token);
    const session = Db.sessionByTokenHash(db,tokenHash);
    if (!session || session.disabled) return null;
    session.tokenHash = tokenHash;
    session.actor = {id:session.userId,name:session.displayName,companyId:session.companyId,authenticated:true,membershipActive:true,disabled:Boolean(session.disabled)};
    return session;
  }

  function requireSession(req) {
    const session = currentSession(req);
    if (!session) throw routeError('Personlig inloggning krävs.','AUTH_REQUIRED',401);
    return session;
  }

  function requireCsrf(req,session) {
    const supplied = String(req.headers['x-csrf-token'] || '');
    if (!supplied || !Auth.safeEqualText(Auth.hashToken(supplied),session.csrfHash)) {
      throw routeError('Säkerhetskontrollen för formuläret misslyckades. Ladda om sidan och försök igen.','CSRF_FAILED',403);
    }
  }

  function requirePermission(session,permissionId) {
    const decision = Access.authorize(accessModel,session.actor,permissionId);
    if (!decision.allowed) throw routeError('Du saknar behörighet för åtgärden.','ACCESS_DENIED',403);
  }

  function requireProposal(session,proposalId) {
    const proposal = Queues.automationProposalById(db,session.companyId,proposalId);
    if (!proposal) throw routeError('Automationsförslaget hittades inte i det inloggade företaget.','PROPOSAL_NOT_FOUND',404);
    return proposal;
  }

  async function handle(req,res) {
    let url;
    try { url = new URL(req.url,'http://localhost'); }
    catch { return false; }
    if (!url.pathname.startsWith('/api/v1/automation/')) return false;

    try {
      const session = requireSession(req);
      if (req.method !== 'GET') requireCsrf(req,session);

      if (req.method === 'GET' && url.pathname === '/api/v1/automation/proposals') {
        requirePermission(session,'accounting.view');
        const status = String(url.searchParams.get('status') || '').trim();
        const proposals = ReviewService.listForReview(db,session.companyId,{status,limit:300});
        return send(res,200,{proposals,accounts:ReviewService.ACCOUNTS,executionPolicy:'human-approval-required'}), true;
      }

      const editMatch = url.pathname.match(/^\/api\/v1\/automation\/proposals\/([^/]+)\/suggestion$/);
      if (editMatch && req.method === 'PUT') {
        requirePermission(session,'accounting.post');
        requireProposal(session,editMatch[1]);
        const payload = await readJson(req,res); if (!payload) return true;
        const edited = Db.transaction(db,()=>{
          const value = ReviewService.saveReviewEdits(db,{companyId:session.companyId,proposalId:editMatch[1],editedBy:session.userId,input:payload});
          Db.appendAudit(db,{companyId:session.companyId,userId:session.userId,action:'AUTOMATION_PROPOSAL_EDITED',entityType:'automation-proposal',entityId:editMatch[1],details:{proposalType:value.proposal.type,sourceId:value.proposal.sourceId,invoiceId:value.proposal.suggestion?.invoiceId||null,accountingLines:value.proposal.review?.accountingLines||[],executionStatus:'not-executed'}});
          return value;
        });
        return send(res,200,{...edited,executionStatus:'not-executed',message:'Förslaget uppdaterades och kräver ny mänsklig granskning innan godkännande.'}), true;
      }

      const approveMatch = url.pathname.match(/^\/api\/v1\/automation\/proposals\/([^/]+)\/approve$/);
      if (approveMatch && req.method === 'POST') {
        requirePermission(session,'accounting.post');
        const existing = requireProposal(session,approveMatch[1]);
        const approved = Db.transaction(db,()=>{
          const proposal = Queues.approveAutomationProposal(db,{companyId:session.companyId,proposalId:existing.id,userId:session.userId});
          if(proposal.type==='bank-payment-match'){
            const payment=Bank.byId(db,session.companyId,proposal.suggestion?.bankPaymentId||proposal.sourceId);
            if(!payment)throw routeError('Bankhändelsen hittades inte i företaget.','BANK_PAYMENT_NOT_FOUND',404);
            if(!['proposal-created','reviewed'].includes(payment.status))throw routeError('Bankhändelsen är inte i ett granskningsbart läge.','INVALID_BANK_PAYMENT_STATUS',409);
            if(payment.status!=='reviewed')Bank.setStatus(db,session.companyId,payment.id,'reviewed');
          }
          Db.appendAudit(db,{companyId:session.companyId,userId:session.userId,action:'AUTOMATION_PROPOSAL_APPROVED',entityType:'automation-proposal',entityId:proposal.id,details:{proposalType:proposal.type,sourceId:proposal.sourceId,suggestion:proposal.suggestion,executionStatus:'not-executed'}});
          return ReviewService.byIdForReview(db,session.companyId,proposal.id);
        });
        return send(res,200,{proposal:approved,executionStatus:'not-executed',message:'Förslaget är godkänt för nästa kontrollerade steg men har inte bokförts eller betalats automatiskt.'}), true;
      }

      const executeMatch = url.pathname.match(/^\/api\/v1\/automation\/proposals\/([^/]+)\/execute$/);
      if (executeMatch && req.method === 'POST') {
        requirePermission(session,'bank.reconcile');
        requirePermission(session,'accounting.post');
        requireProposal(session,executeMatch[1]);
        const result=CustomerPayment.executeApprovedCustomerPayment(db,{companyId:session.companyId,proposalId:executeMatch[1],actorId:session.userId});
        return send(res,result.duplicate?200:201,{...result,executionStatus:'executed',message:result.duplicate?'Kundbetalningen var redan bokförd.':'Kundbetalningen är bokförd mot 1930/1510 och fakturan är reglerad.'}), true;
      }

      const reclassifyMatch = url.pathname.match(/^\/api\/v1\/automation\/proposals\/([^/]+)\/reclassify$/);
      if (reclassifyMatch && req.method === 'POST') {
        requirePermission(session,'bank.reconcile');
        requirePermission(session,'accounting.correct');
        requireProposal(session,reclassifyMatch[1]);
        const payload=await readJson(req,res);if(!payload)return true;
        const result=CustomerPayment.reclassifyCustomerPayment(db,{
          companyId:session.companyId,
          proposalId:reclassifyMatch[1],
          targetInvoiceId:payload.targetInvoiceId,
          requestId:payload.requestId,
          correctionDate:payload.correctionDate,
          reason:payload.reason,
          actorId:session.userId
        });
        return send(res,result.duplicate?200:201,{...result,executionStatus:'reclassified',message:result.duplicate?'Omföringen var redan bokförd.':'Kundbetalningen har omförts till den valda kundfakturan utan att bankinbetalningen ändrats.'}), true;
      }

      const rejectMatch = url.pathname.match(/^\/api\/v1\/automation\/proposals\/([^/]+)\/reject$/);
      if (rejectMatch && req.method === 'POST') {
        requirePermission(session,'accounting.post');
        const existing = requireProposal(session,rejectMatch[1]);
        const payload = await readJson(req,res); if (!payload) return true;
        const rejected = Db.transaction(db,()=>{
          const proposal = Queues.rejectAutomationProposal(db,{companyId:session.companyId,proposalId:existing.id,userId:session.userId,reason:payload.reason});
          Db.appendAudit(db,{companyId:session.companyId,userId:session.userId,action:'AUTOMATION_PROPOSAL_REJECTED',entityType:'automation-proposal',entityId:proposal.id,details:{proposalType:proposal.type,sourceId:proposal.sourceId,reason:proposal.rejectionReason}});
          return ReviewService.byIdForReview(db,session.companyId,proposal.id);
        });
        return send(res,200,{proposal:rejected,executionStatus:'not-executed'}), true;
      }

      send(res,404,{error:'Hittades inte.',code:'NOT_FOUND'});
      return true;
    } catch (error) {
      const status = Number(error.statusCode || 500);
      const message = status >= 500 ? 'Ett internt serverfel uppstod.' : String(error.message || 'Begäran kunde inte behandlas.');
      if (status >= 500) console.error(error);
      send(res,status,{error:message,code:error.code || 'INTERNAL_ERROR'});
      return true;
    }
  }

  return Object.freeze({handle,accessModel});
}

module.exports = Object.freeze({createAutomationReviewRouter});
