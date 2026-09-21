'use strict';

const Db=require('./database.js');
const Queues=require('./queues.js');
const Bank=require('./bank-payments.js');
const Accounting=require('./accounting-store.js');
const {protectAppendOnly}=require('./history-guards.js');

function paymentError(message,code='CUSTOMER_PAYMENT_EXECUTION_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(value){return String(value??'').trim()}
function nowIso(){return new Date().toISOString()}

function initializeCustomerPaymentPosting(db){
  Queues.initializeQueues(db);
  Bank.initializeBankPayments(db);
  Accounting.initializeAccountingStore(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_payment_executions(
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      proposal_id TEXT NOT NULL REFERENCES automation_proposals(id) ON DELETE RESTRICT,
      bank_payment_id TEXT NOT NULL REFERENCES bank_payments(id) ON DELETE RESTRICT,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      accounting_entry_id TEXT NOT NULL REFERENCES accounting_entries(id) ON DELETE RESTRICT,
      invoice_transaction_id TEXT NOT NULL REFERENCES invoice_transactions(id) ON DELETE RESTRICT,
      amount_ore INTEGER NOT NULL CHECK(amount_ore>0),
      posting_date TEXT NOT NULL,
      executed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      executed_at TEXT NOT NULL,
      PRIMARY KEY(company_id,proposal_id),
      UNIQUE(company_id,bank_payment_id),
      UNIQUE(company_id,accounting_entry_id),
      UNIQUE(company_id,invoice_transaction_id)
    ) STRICT;
  `);
  protectAppendOnly(db,'customer_payment_executions');
}

const EXECUTION_SELECT=`SELECT company_id AS companyId,proposal_id AS proposalId,bank_payment_id AS bankPaymentId,invoice_id AS invoiceId,
  accounting_entry_id AS accountingEntryId,invoice_transaction_id AS invoiceTransactionId,amount_ore AS amountOre,
  posting_date AS postingDate,executed_by AS executedBy,executed_at AS executedAt FROM customer_payment_executions`;
function executionByProposal(db,companyId,proposalId){return db.prepare(`${EXECUTION_SELECT} WHERE company_id=? AND proposal_id=?`).get(companyId,proposalId)||null}
function executionByBankPayment(db,companyId,bankPaymentId){return db.prepare(`${EXECUTION_SELECT} WHERE company_id=? AND bank_payment_id=?`).get(companyId,bankPaymentId)||null}

function approvedAccountingLines(proposal,amountOre){
  const suggestion=proposal?.suggestion||{};
  if(Array.isArray(suggestion.accountingLines)){
    const lines=suggestion.accountingLines.map(row=>({account:text(row?.account),debitOre:Number(row?.debitOre||0),creditOre:Number(row?.creditOre||0)}));
    if(lines.length!==2)throw paymentError('Den godkända kundbetalningen måste ha exakt två konteringsrader.','CUSTOMER_PAYMENT_CODING_NOT_SUPPORTED',409);
    const bank=lines.find(row=>row.account==='1930'),receivable=lines.find(row=>row.account==='1510');
    if(!bank||!receivable||bank.debitOre!==amountOre||bank.creditOre!==0||receivable.debitOre!==0||receivable.creditOre!==amountOre){
      throw paymentError('Den här versionen stöder endast exakt kontering 1930 debet mot 1510 kredit.','CUSTOMER_PAYMENT_CODING_NOT_SUPPORTED',409);
    }
    return lines;
  }
  if(text(suggestion.bankAccount||'1930')!=='1930'||text(suggestion.receivableAccount||'1510')!=='1510'){
    throw paymentError('Den här versionen stöder endast bankkonto 1930 mot kundfordringar 1510.','CUSTOMER_PAYMENT_CODING_NOT_SUPPORTED',409);
  }
  return[
    {account:'1930',debitOre:amountOre,creditOre:0},
    {account:'1510',debitOre:0,creditOre:amountOre}
  ];
}

function verifyExistingExecution(db,execution){
  const entry=Accounting.entryById(db,execution.companyId,execution.accountingEntryId);
  const transaction=Db.transactionById(db,execution.companyId,execution.invoiceTransactionId);
  if(!entry||!transaction||transaction.invoiceId!==execution.invoiceId||transaction.amountOre!==-execution.amountOre){
    throw paymentError('Den tidigare kundbetalningens bokförings- eller reskontrahistorik är ofullständig.','CUSTOMER_PAYMENT_EXECUTION_INTEGRITY_ERROR',500);
  }
  return{execution,entry,transaction};
}

function executeApprovedCustomerPayment(db,{companyId,proposalId,actorId}){
  initializeCustomerPaymentPosting(db);
  return Db.transaction(db,()=>{
    const proposal=Queues.automationProposalById(db,companyId,proposalId);
    if(!proposal)throw paymentError('Automationsförslaget hittades inte i företaget.','PROPOSAL_NOT_FOUND',404);
    if(proposal.type!=='bank-payment-match')throw paymentError('Endast godkända kundinbetalningsmatchningar kan genomföras här.','PROPOSAL_EXECUTION_NOT_SUPPORTED',409);

    const existing=executionByProposal(db,companyId,proposalId);
    if(existing)return{...verifyExistingExecution(db,existing),proposal,bankPayment:Bank.byId(db,companyId,existing.bankPaymentId),invoice:Db.invoiceById(db,companyId,existing.invoiceId),duplicate:true};

    if(proposal.status!=='approved'||!proposal.approvedBy||!proposal.approvedAt)throw paymentError('Matchningsförslaget måste vara mänskligt godkänt innan bokföring.','PROPOSAL_NOT_APPROVED',409);
    if(!actorId)throw paymentError('Personlig användaridentitet krävs för bokföringen.','PERSONAL_IDENTITY_REQUIRED',401);

    const suggestion=proposal.suggestion||{};
    const bankPaymentId=text(suggestion.bankPaymentId||proposal.sourceId);
    if(!bankPaymentId||bankPaymentId!==proposal.sourceId)throw paymentError('Det godkända förslaget pekar inte entydigt på bankhändelsen.','CUSTOMER_PAYMENT_SOURCE_MISMATCH',409);
    const bankPayment=Bank.byId(db,companyId,bankPaymentId);
    if(!bankPayment)throw paymentError('Bankhändelsen hittades inte i företaget.','BANK_PAYMENT_NOT_FOUND',404);
    if(!['proposal-created','reviewed'].includes(bankPayment.status))throw paymentError('Bankhändelsen är inte i ett bokföringsbart matchningsläge.','INVALID_BANK_PAYMENT_STATUS',409);
    if(bankPayment.currency!=='SEK')throw paymentError('Den här versionen stöder endast SEK-inbetalningar.','UNSUPPORTED_CURRENCY',409);
    if(text(suggestion.bookingDate)&&text(suggestion.bookingDate)!==bankPayment.bookingDate)throw paymentError('Bankhändelsens bokföringsdatum har ändrats sedan förslaget skapades.','CUSTOMER_PAYMENT_SOURCE_CHANGED',409);
    if(text(suggestion.externalId)&&text(suggestion.externalId)!==bankPayment.externalId)throw paymentError('Bankhändelsens externa id har ändrats sedan förslaget skapades.','CUSTOMER_PAYMENT_SOURCE_CHANGED',409);

    const invoiceId=text(suggestion.invoiceId);
    const invoice=Db.invoiceById(db,companyId,invoiceId);
    if(!invoice)throw paymentError('Den godkända kundfakturan hittades inte i företaget.','TARGET_INVOICE_NOT_FOUND',404);
    if(invoice.totalOre<=0||invoice.remainingOre<=0)throw paymentError('Endast en öppen vanlig kundfaktura kan ta emot betalningen.','TARGET_INVOICE_NOT_OPEN',409);
    if(invoice.invoiceAccount!=='1510')throw paymentError('Fakturans kundfordringskonto är inte 1510 och kräver manuell hantering.','CUSTOMER_PAYMENT_CODING_NOT_SUPPORTED',409);
    const invoiceEntry=Accounting.entryBySource(db,companyId,'customer-invoice',invoice.id);
    if(!invoiceEntry)throw paymentError('Kundfordran måste vara bokförd innan bankinbetalningen kan regleras.','CUSTOMER_RECEIVABLE_NOT_POSTED',409);
    const receivableNet=invoiceEntry.lines.filter(line=>line.account==='1510').reduce((sum,line)=>sum+line.debitOre-line.creditOre,0);
    if(receivableNet!==invoice.totalOre)throw paymentError('Kundfakturans 1510-verifikation stämmer inte med fakturabeloppet.','CUSTOMER_RECEIVABLE_INTEGRITY_ERROR',409);
    const transactions=Db.transactionsForInvoice(db,companyId,invoice.id).filter(row=>row.approved);
    const expectedRemaining=invoice.totalOre+transactions.reduce((sum,row)=>sum+Number(row.amountOre||0),0);
    if(expectedRemaining!==invoice.remainingOre)throw paymentError('Kundreskontrans restbelopp stämmer inte med transaktionshistoriken.','CUSTOMER_RECEIVABLE_INTEGRITY_ERROR',409);

    const amountOre=Number(suggestion.amountOre);
    if(!Number.isSafeInteger(amountOre)||amountOre<=0||amountOre!==bankPayment.amountOre||amountOre!==invoice.remainingOre){
      throw paymentError('Bankbeloppet måste exakt motsvara fakturans aktuella restbelopp.','CUSTOMER_PAYMENT_AMOUNT_MISMATCH',409);
    }
    approvedAccountingLines(proposal,amountOre);

    const duplicateBankExecution=executionByBankPayment(db,companyId,bankPayment.id);
    if(duplicateBankExecution)throw paymentError('Bankhändelsen är redan bokförd genom ett annat godkänt förslag.','BANK_PAYMENT_ALREADY_EXECUTED',409);

    const posted=Accounting.postEntry(db,{
      companyId,
      postingDate:bankPayment.bookingDate,
      description:`Kundinbetalning ${invoice.invoiceNumber} – ${invoice.customerName}`,
      sourceType:'customer-payment',
      sourceId:bankPayment.id,
      createdBy:actorId,
      series:'A',
      lines:[
        {account:'1930',text:`Bankinbetalning ${bankPayment.externalId}`,debitOre:amountOre,creditOre:0},
        {account:'1510',text:`Betald kundfaktura ${invoice.invoiceNumber}`,debitOre:0,creditOre:amountOre}
      ]
    });
    if(posted.duplicate)throw paymentError('Kundbetalningsverifikationen finns redan utan motsvarande exekveringshistorik.','CUSTOMER_PAYMENT_EXECUTION_INTEGRITY_ERROR',500);

    const transaction=Db.addInvoiceTransaction(db,{
      companyId,
      invoiceId:invoice.id,
      transactionType:'payment',
      paymentMethod:'Bank',
      paymentDate:bankPayment.bookingDate,
      postingDate:bankPayment.bookingDate,
      journalNumber:posted.entry.number,
      amountOre:-amountOre,
      approved:true,
      account:'1930',
      bankReference:bankPayment.externalId
    });

    const updatedAt=nowIso();
    const invoiceUpdate=db.prepare(`UPDATE invoices SET remaining_ore=0,status='Betald',updated_at=? WHERE company_id=? AND id=? AND remaining_ore=? AND total_ore>0`).run(updatedAt,companyId,invoice.id,amountOre);
    if(invoiceUpdate.changes!==1)throw paymentError('Fakturans restbelopp ändrades under bokföringen. Hela operationen återställdes.','CUSTOMER_PAYMENT_INVOICE_CONFLICT',409);
    const bankUpdate=db.prepare(`UPDATE bank_payments SET status='posted',updated_at=? WHERE company_id=? AND id=? AND status IN ('proposal-created','reviewed')`).run(updatedAt,companyId,bankPayment.id);
    if(bankUpdate.changes!==1)throw paymentError('Bankhändelsens status ändrades under bokföringen. Hela operationen återställdes.','CUSTOMER_PAYMENT_BANK_CONFLICT',409);

    db.prepare(`INSERT INTO customer_payment_executions(company_id,proposal_id,bank_payment_id,invoice_id,accounting_entry_id,invoice_transaction_id,amount_ore,posting_date,executed_by,executed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(companyId,proposal.id,bankPayment.id,invoice.id,posted.entry.id,transaction.id,amountOre,bankPayment.bookingDate,actorId,updatedAt);
    Db.appendAudit(db,{companyId,userId:actorId,action:'CUSTOMER_PAYMENT_POSTED_FROM_APPROVED_MATCH',entityType:'bank-payment',entityId:bankPayment.id,details:{
      proposalId:proposal.id,invoiceId:invoice.id,invoiceNumber:invoice.invoiceNumber,amountOre,accountingEntryId:posted.entry.id,accountingNumber:posted.entry.number,invoiceTransactionId:transaction.id,approvedBy:proposal.approvedBy,approvedAt:proposal.approvedAt
    }});

    const execution=executionByProposal(db,companyId,proposal.id);
    return{execution,entry:posted.entry,transaction,proposal,bankPayment:Bank.byId(db,companyId,bankPayment.id),invoice:Db.invoiceById(db,companyId,invoice.id),duplicate:false};
  });
}

module.exports=Object.freeze({initializeCustomerPaymentPosting,executionByProposal,executionByBankPayment,approvedAccountingLines,executeApprovedCustomerPayment});
