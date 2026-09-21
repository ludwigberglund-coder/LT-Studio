'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Review=require('../../packages/automation/review-model.js');
const Queues=require('./queues.js');
const CustomerPayment=require('./customer-payment-posting.js');

const ACCOUNT_CONFIG=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','accounting-accounts.json'),'utf8'));
const ACCOUNTS=Object.freeze((ACCOUNT_CONFIG.accounts||[]).map(row=>Object.freeze({number:String(row.number),name:String(row.name),group:String(row.group||'Övrigt')})));
function serviceError(message,code='AUTOMATION_REVIEW_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(v){return String(v??'').trim()}
function accountExists(number){return ACCOUNTS.some(row=>row.number===text(number))}
function customerInvoice(db,companyId,invoiceId){return db.prepare(`SELECT i.id,i.invoice_number AS invoiceNumber,i.remaining_ore AS remainingOre,i.total_ore AS totalOre,i.due_date AS dueDate,c.name AS customerName FROM invoices i JOIN customers c ON c.id=i.customer_id AND c.company_id=i.company_id WHERE i.company_id=? AND i.id=?`).get(companyId,invoiceId)||null}
function matchingCustomerInvoices(db,companyId,amountOre){return db.prepare(`SELECT i.id,i.invoice_number AS invoiceNumber,i.remaining_ore AS remainingOre,i.due_date AS dueDate,c.name AS customerName FROM invoices i JOIN customers c ON c.id=i.customer_id AND c.company_id=i.company_id WHERE i.company_id=? AND i.remaining_ore>=? AND i.remaining_ore>0 ORDER BY i.due_date,i.invoice_number`).all(companyId,Number(amountOre||0))}
function exactCustomerInvoices(db,companyId,amountOre){return db.prepare(`SELECT i.id,i.invoice_number AS invoiceNumber,i.remaining_ore AS remainingOre,i.due_date AS dueDate,c.name AS customerName FROM invoices i JOIN customers c ON c.id=i.customer_id AND c.company_id=i.company_id WHERE i.company_id=? AND i.remaining_ore=? AND i.remaining_ore>0 ORDER BY i.due_date,i.invoice_number`).all(companyId,Number(amountOre||0))}
function supplierInvoice(db,companyId,invoiceId){try{return db.prepare(`SELECT i.id,i.supplier_invoice_number AS invoiceNumber,i.total_ore AS totalOre,i.vat_ore AS vatOre,s.name AS supplierName FROM supplier_invoices i JOIN suppliers s ON s.id=i.supplier_id AND s.company_id=i.company_id WHERE i.company_id=? AND i.id=?`).get(companyId,invoiceId)||null}catch{return null}}
function bankPayment(db,companyId,paymentId){try{return db.prepare(`SELECT id,booking_date AS bookingDate,amount_ore AS amountOre,reference,message,payer_name AS payerName FROM bank_payments WHERE company_id=? AND id=?`).get(companyId,paymentId)||null}catch{return null}}
function enrichProposal(db,proposal){
  const p={...proposal,suggestion:{...(proposal.suggestion||{})}};
  if(p.type==='bank-payment-match'){
    const payment=bankPayment(db,p.companyId,p.suggestion.bankPaymentId||p.sourceId);const invoice=customerInvoice(db,p.companyId,p.suggestion.invoiceId);
    if(payment){p.suggestion.amountOre=Number(p.suggestion.amountOre||payment.amountOre);p.suggestion.bookingDate=p.suggestion.bookingDate||payment.bookingDate;p.context={...(p.context||{}),payerName:payment.payerName,reference:payment.reference||payment.message,invoiceOptions:matchingCustomerInvoices(db,p.companyId,payment.amountOre)}}
    if(invoice){p.suggestion.invoiceNumber=p.suggestion.invoiceNumber||invoice.invoiceNumber;p.suggestion.customerName=p.suggestion.customerName||invoice.customerName;p.context={...(p.context||{}),invoiceNumber:invoice.invoiceNumber,customerName:invoice.customerName,remainingOre:invoice.remainingOre}}
    const execution=CustomerPayment.executionByProposal(db,p.companyId,p.id);
    p.executionStatus=execution?'executed':'not-executed';p.execution=execution||null;
    if(execution){
      const allocation=CustomerPayment.currentAllocation(db,execution);
      const allocatedInvoice=customerInvoice(db,p.companyId,allocation.invoiceId);
      p.currentAllocation=allocatedInvoice?{invoiceId:allocatedInvoice.id,invoiceNumber:allocatedInvoice.invoiceNumber,customerName:allocatedInvoice.customerName,remainingOre:allocatedInvoice.remainingOre}:null;
      if(p.context)p.context.invoiceOptions=exactCustomerInvoices(db,p.companyId,execution.amountOre).filter(row=>row.id!==allocation.invoiceId);
    }
  }
  if(p.type==='supplier-invoice-coding'){
    const invoice=supplierInvoice(db,p.companyId,p.suggestion.invoiceId||p.sourceId);if(invoice){p.suggestion.totalOre=Number(p.suggestion.totalOre||invoice.totalOre);p.suggestion.vatOre=Number(p.suggestion.vatOre??invoice.vatOre);p.suggestion.supplierInvoiceId=invoice.id;p.context={...(p.context||{}),invoiceNumber:invoice.invoiceNumber,supplierName:invoice.supplierName}}
  }
  p.review=Review.buildReviewModel(p);return p;
}
function listForReview(db,companyId,{status='',limit=300}={}){return Queues.listAutomationProposals(db,companyId,{status,limit}).map(proposal=>enrichProposal(db,proposal))}
function byIdForReview(db,companyId,proposalId){const proposal=Queues.automationProposalById(db,companyId,proposalId);return proposal?enrichProposal(db,proposal):null}
function validateAccounts(lines,currentLines=[]){for(let index=0;index<(lines||[]).length;index++){const row=lines[index];const current=text(currentLines[index]?.account);if(!accountExists(row.account)&&text(row.account)!==current)throw serviceError(`Konto ${row.account} finns inte i den valbara kontolistan.`,'ACCOUNT_NOT_ALLOWED')};return lines}
function saveReviewEdits(db,{companyId,proposalId,editedBy,input}){
  const proposal=Queues.automationProposalById(db,companyId,proposalId);if(!proposal)throw serviceError('Automationsförslaget hittades inte.','PROPOSAL_NOT_FOUND',404);
  const enriched=enrichProposal(db,proposal);const normalized=Review.validateEditedSuggestion(enriched,input);
  if(Array.isArray(normalized.accountingLines))validateAccounts(normalized.accountingLines,enriched.review?.accountingLines||[]);
  if(proposal.type==='bank-payment-match'&&normalized.invoiceId){const target=customerInvoice(db,companyId,normalized.invoiceId);if(!target)throw serviceError('Den valda kundfakturan hittades inte i företaget.','TARGET_INVOICE_NOT_FOUND',404);const payment=bankPayment(db,companyId,normalized.bankPaymentId||proposal.sourceId);if(payment&&Number(target.remainingOre)<Number(payment.amountOre))throw serviceError('Den valda fakturans restbelopp får inte vara lägre än inbetalningen.','TARGET_AMOUNT_MISMATCH',409);normalized.invoiceNumber=target.invoiceNumber;normalized.customerName=target.customerName}
  const updatedAt=new Date().toISOString();
  const result=db.prepare(`UPDATE automation_proposals SET suggestion_json=?,status='manual-review',deterministic=0,ambiguous=1,decision_reason=? WHERE company_id=? AND id=? AND status IN ('manual-review','ready-for-approval')`).run(JSON.stringify(normalized),'Förslaget har ändrats manuellt och kräver därför ny mänsklig granskning före godkännande.',companyId,proposalId);
  if(result.changes!==1)throw serviceError('Förslaget kan inte ändras i nuvarande status.','INVALID_PROPOSAL_STATUS',409);
  return{proposal:byIdForReview(db,companyId,proposalId),editedBy,editedAt:updatedAt};
}
module.exports=Object.freeze({ACCOUNTS,accountExists,customerInvoice,matchingCustomerInvoices,exactCustomerInvoices,supplierInvoice,bankPayment,enrichProposal,listForReview,byIdForReview,saveReviewEdits});
