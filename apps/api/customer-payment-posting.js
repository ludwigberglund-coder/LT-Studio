'use strict';

const Db=require('./database.js');
const Queues=require('./queues.js');
const Bank=require('./bank-payments.js');
const Accounting=require('./accounting-store.js');
const {protectAppendOnly}=require('./history-guards.js');

function paymentError(message,code='CUSTOMER_PAYMENT_EXECUTION_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(value){return String(value??'').trim()}
function nowIso(){return new Date().toISOString()}
function hasColumn(db,table,column){return db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column)}
function validRequestId(value){return /^[A-Za-z0-9_-]{16,100}$/.test(text(value))}

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
      invoice_status_before TEXT,
      executed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      executed_at TEXT NOT NULL,
      PRIMARY KEY(company_id,proposal_id),
      UNIQUE(company_id,bank_payment_id),
      UNIQUE(company_id,accounting_entry_id),
      UNIQUE(company_id,invoice_transaction_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS customer_payment_reclassifications(
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      bank_payment_id TEXT NOT NULL REFERENCES bank_payments(id) ON DELETE RESTRICT,
      original_proposal_id TEXT NOT NULL REFERENCES automation_proposals(id) ON DELETE RESTRICT,
      sequence INTEGER NOT NULL CHECK(sequence>0),
      source_invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      target_invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      source_status_before_payment TEXT NOT NULL,
      target_status_before_payment TEXT NOT NULL,
      original_payment_transaction_id TEXT NOT NULL REFERENCES invoice_transactions(id) ON DELETE RESTRICT,
      source_reversal_transaction_id TEXT NOT NULL REFERENCES invoice_transactions(id) ON DELETE RESTRICT,
      target_payment_transaction_id TEXT NOT NULL REFERENCES invoice_transactions(id) ON DELETE RESTRICT,
      accounting_entry_id TEXT NOT NULL REFERENCES accounting_entries(id) ON DELETE RESTRICT,
      amount_ore INTEGER NOT NULL CHECK(amount_ore>0),
      correction_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      request_id TEXT NOT NULL,
      corrected_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      corrected_at TEXT NOT NULL,
      UNIQUE(company_id,bank_payment_id,sequence),
      UNIQUE(company_id,request_id),
      UNIQUE(company_id,accounting_entry_id),
      UNIQUE(company_id,source_reversal_transaction_id),
      UNIQUE(company_id,target_payment_transaction_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_customer_payment_reclass_bank
      ON customer_payment_reclassifications(company_id,bank_payment_id,sequence);
  `);
  if(!hasColumn(db,'customer_payment_executions','invoice_status_before'))db.exec('ALTER TABLE customer_payment_executions ADD COLUMN invoice_status_before TEXT');
  protectAppendOnly(db,'customer_payment_executions');
  protectAppendOnly(db,'customer_payment_reclassifications');
}

const EXECUTION_SELECT=`SELECT company_id AS companyId,proposal_id AS proposalId,bank_payment_id AS bankPaymentId,invoice_id AS invoiceId,
  accounting_entry_id AS accountingEntryId,invoice_transaction_id AS invoiceTransactionId,amount_ore AS amountOre,
  posting_date AS postingDate,invoice_status_before AS invoiceStatusBefore,executed_by AS executedBy,executed_at AS executedAt FROM customer_payment_executions`;
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
    if(!Number.isSafeInteger(amountOre)||amountOre<=0||amountOre!==bankPayment.amountOre||amountOre>invoice.remainingOre){
      throw paymentError('Bankbeloppet måste vara positivt och får inte överstiga fakturans aktuella restbelopp.','CUSTOMER_PAYMENT_AMOUNT_MISMATCH',409);
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
    const remainingAfter=invoice.remainingOre-amountOre;
    const statusAfter=remainingAfter===0?'Betald':invoice.status;
    const invoiceUpdate=db.prepare(`UPDATE invoices SET remaining_ore=?,status=?,updated_at=? WHERE company_id=? AND id=? AND remaining_ore=? AND status=? AND total_ore>0`).run(
      remainingAfter,statusAfter,updatedAt,companyId,invoice.id,invoice.remainingOre,invoice.status
    );
    if(invoiceUpdate.changes!==1)throw paymentError('Fakturans restbelopp eller status ändrades under bokföringen. Hela operationen återställdes.','CUSTOMER_PAYMENT_INVOICE_CONFLICT',409);
    const bankUpdate=db.prepare(`UPDATE bank_payments SET status='posted',updated_at=? WHERE company_id=? AND id=? AND status IN ('proposal-created','reviewed')`).run(updatedAt,companyId,bankPayment.id);
    if(bankUpdate.changes!==1)throw paymentError('Bankhändelsens status ändrades under bokföringen. Hela operationen återställdes.','CUSTOMER_PAYMENT_BANK_CONFLICT',409);

    db.prepare(`INSERT INTO customer_payment_executions(company_id,proposal_id,bank_payment_id,invoice_id,accounting_entry_id,invoice_transaction_id,amount_ore,posting_date,invoice_status_before,executed_by,executed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(companyId,proposal.id,bankPayment.id,invoice.id,posted.entry.id,transaction.id,amountOre,bankPayment.bookingDate,invoice.status,actorId,updatedAt);
    Db.appendAudit(db,{companyId,userId:actorId,action:'CUSTOMER_PAYMENT_POSTED_FROM_APPROVED_MATCH',entityType:'bank-payment',entityId:bankPayment.id,details:{
      proposalId:proposal.id,invoiceId:invoice.id,invoiceNumber:invoice.invoiceNumber,amountOre,remainingBeforeOre:invoice.remainingOre,remainingAfterOre:remainingAfter,partialPayment:remainingAfter>0,accountingEntryId:posted.entry.id,accountingNumber:posted.entry.number,invoiceTransactionId:transaction.id,approvedBy:proposal.approvedBy,approvedAt:proposal.approvedAt
    }});

    const execution=executionByProposal(db,companyId,proposal.id);
    return{execution,entry:posted.entry,transaction,proposal,bankPayment:Bank.byId(db,companyId,bankPayment.id),invoice:Db.invoiceById(db,companyId,invoice.id),duplicate:false};
  });
}


const RECLASS_SELECT=`SELECT id,company_id AS companyId,bank_payment_id AS bankPaymentId,original_proposal_id AS originalProposalId,sequence,
  source_invoice_id AS sourceInvoiceId,target_invoice_id AS targetInvoiceId,source_status_before_payment AS sourceStatusBeforePayment,
  target_status_before_payment AS targetStatusBeforePayment,original_payment_transaction_id AS originalPaymentTransactionId,
  source_reversal_transaction_id AS sourceReversalTransactionId,target_payment_transaction_id AS targetPaymentTransactionId,
  accounting_entry_id AS accountingEntryId,amount_ore AS amountOre,correction_date AS correctionDate,reason,request_id AS requestId,
  corrected_by AS correctedBy,corrected_at AS correctedAt FROM customer_payment_reclassifications`;
function reclassificationByRequest(db,companyId,requestId){return db.prepare(`${RECLASS_SELECT} WHERE company_id=? AND request_id=?`).get(companyId,requestId)||null}
function reclassificationsForBankPayment(db,companyId,bankPaymentId){return db.prepare(`${RECLASS_SELECT} WHERE company_id=? AND bank_payment_id=? ORDER BY sequence`).all(companyId,bankPaymentId)}
function latestReclassification(db,companyId,bankPaymentId){return db.prepare(`${RECLASS_SELECT} WHERE company_id=? AND bank_payment_id=? ORDER BY sequence DESC LIMIT 1`).get(companyId,bankPaymentId)||null}

function assertReceivableIntegrity(db,companyId,invoice,{requireOpenAmount=null}={}){
  if(!invoice||invoice.totalOre<=0)throw paymentError('Endast en vanlig kundfaktura kan användas i omföringen.','TARGET_INVOICE_NOT_OPEN',409);
  if(invoice.invoiceAccount!=='1510')throw paymentError('Kundfakturans fordringskonto måste vara 1510 för automatisk omföring.','CUSTOMER_PAYMENT_CODING_NOT_SUPPORTED',409);
  const invoiceEntry=Accounting.entryBySource(db,companyId,'customer-invoice',invoice.id);
  if(!invoiceEntry)throw paymentError('Kundfordran måste vara bokförd innan betalningen kan omföras.','CUSTOMER_RECEIVABLE_NOT_POSTED',409);
  const receivableNet=invoiceEntry.lines.filter(line=>line.account==='1510').reduce((sum,line)=>sum+line.debitOre-line.creditOre,0);
  if(receivableNet!==invoice.totalOre)throw paymentError('Kundfakturans 1510-verifikation stämmer inte med fakturabeloppet.','CUSTOMER_RECEIVABLE_INTEGRITY_ERROR',409);
  const transactions=Db.transactionsForInvoice(db,companyId,invoice.id).filter(row=>row.approved);
  const expectedRemaining=invoice.totalOre+transactions.reduce((sum,row)=>sum+Number(row.amountOre||0),0);
  if(expectedRemaining!==invoice.remainingOre)throw paymentError('Kundreskontrans restbelopp stämmer inte med transaktionshistoriken.','CUSTOMER_RECEIVABLE_INTEGRITY_ERROR',409);
  if(requireOpenAmount!==null&&invoice.remainingOre!==requireOpenAmount)throw paymentError('Målfakturans restbelopp måste exakt motsvara betalningen.','CUSTOMER_PAYMENT_AMOUNT_MISMATCH',409);
  return{invoiceEntry,transactions};
}

function currentAllocation(db,execution){
  const latest=latestReclassification(db,execution.companyId,execution.bankPaymentId);
  if(latest)return{
    invoiceId:latest.targetInvoiceId,
    statusBeforePayment:latest.targetStatusBeforePayment,
    paymentTransactionId:latest.targetPaymentTransactionId,
    sequence:latest.sequence
  };
  return{
    invoiceId:execution.invoiceId,
    statusBeforePayment:execution.invoiceStatusBefore,
    paymentTransactionId:execution.invoiceTransactionId,
    sequence:0
  };
}

function reclassifyCustomerPayment(db,{companyId,proposalId,targetInvoiceId,requestId,correctionDate,reason,actorId}){
  initializeCustomerPaymentPosting(db);
  return Db.transaction(db,()=>{
    const key=text(requestId),cleanReason=text(reason),date=text(correctionDate),targetId=text(targetInvoiceId);
    if(!validRequestId(key))throw paymentError('Ett giltigt request-id krävs för omföringen.','INVALID_CUSTOMER_PAYMENT_RECLASS_REQUEST_ID',422);
    if(cleanReason.length<5||cleanReason.length>500)throw paymentError('Omföringen kräver en tydlig orsak på 5–500 tecken.','CUSTOMER_PAYMENT_RECLASS_REASON_REQUIRED',422);
    if(!Accounting.validDate(date))throw paymentError('Omföringsdatumet är ogiltigt.','INVALID_POSTING_DATE',422);
    if(!actorId)throw paymentError('Personlig användaridentitet krävs för omföringen.','PERSONAL_IDENTITY_REQUIRED',401);

    const priorByRequest=reclassificationByRequest(db,companyId,key);
    if(priorByRequest){
      if(priorByRequest.originalProposalId!==proposalId||priorByRequest.targetInvoiceId!==targetId||priorByRequest.correctionDate!==date||priorByRequest.reason!==cleanReason||priorByRequest.correctedBy!==actorId){
        throw paymentError('Request-id är redan använt för en annan kundbetalningsomföring.','CUSTOMER_PAYMENT_RECLASS_IDEMPOTENCY_CONFLICT',409);
      }
      const entry=Accounting.entryById(db,companyId,priorByRequest.accountingEntryId);
      const sourceInvoice=Db.invoiceById(db,companyId,priorByRequest.sourceInvoiceId);
      const targetInvoice=Db.invoiceById(db,companyId,priorByRequest.targetInvoiceId);
      const bankPayment=Bank.byId(db,companyId,priorByRequest.bankPaymentId);
      const sourceTx=Db.transactionById(db,companyId,priorByRequest.sourceReversalTransactionId);
      const targetTx=Db.transactionById(db,companyId,priorByRequest.targetPaymentTransactionId);
      if(!entry||!sourceInvoice||!targetInvoice||!bankPayment||!sourceTx||!targetTx||sourceTx.amountOre!==priorByRequest.amountOre||targetTx.amountOre!==-priorByRequest.amountOre){
        throw paymentError('Den tidigare omföringens bokförings- eller reskontrahistorik är ofullständig.','CUSTOMER_PAYMENT_RECLASS_INTEGRITY_ERROR',500);
      }
      return{reclassification:priorByRequest,entry,sourceInvoice,targetInvoice,bankPayment,duplicate:true};
    }

    const execution=executionByProposal(db,companyId,proposalId);
    if(!execution)throw paymentError('Kundbetalningen måste först vara genomförd från det godkända matchningsförslaget.','CUSTOMER_PAYMENT_NOT_EXECUTED',409);
    if(!execution.invoiceStatusBefore)throw paymentError('Den äldre betalningen saknar verifierad föregående fakturastatus och kan inte omföras automatiskt.','CUSTOMER_PAYMENT_RECLASS_LEGACY_BLOCKED',409);
    const bankPayment=Bank.byId(db,companyId,execution.bankPaymentId);
    if(!bankPayment||bankPayment.status!=='posted')throw paymentError('Bankhändelsen måste vara bokförd innan betalningen kan omföras.','INVALID_BANK_PAYMENT_STATUS',409);

    const allocation=currentAllocation(db,execution);
    if(!allocation.statusBeforePayment)throw paymentError('Aktuell betalningsallokering saknar verifierad föregående fakturastatus.','CUSTOMER_PAYMENT_RECLASS_INTEGRITY_ERROR',500);
    if(allocation.invoiceId===targetId)throw paymentError('Betalningen är redan allokerad till den valda fakturan.','CUSTOMER_PAYMENT_ALREADY_ALLOCATED',409);

    const sourceInvoice=Db.invoiceById(db,companyId,allocation.invoiceId);
    const targetInvoice=Db.invoiceById(db,companyId,targetId);
    if(!sourceInvoice||!targetInvoice)throw paymentError('Käll- eller målfakturan hittades inte i företaget.','TARGET_INVOICE_NOT_FOUND',404);
    if(sourceInvoice.remainingOre!==0||sourceInvoice.status!=='Betald')throw paymentError('Delbetalningar kan ännu inte omföras automatiskt. Betalningen måste ha reglerat den aktuella fakturan helt.','CUSTOMER_PAYMENT_RECLASS_PARTIAL_UNSUPPORTED',409);
    assertReceivableIntegrity(db,companyId,sourceInvoice);
    assertReceivableIntegrity(db,companyId,targetInvoice,{requireOpenAmount:execution.amountOre});

    const currentPaymentTx=Db.transactionById(db,companyId,allocation.paymentTransactionId);
    if(!currentPaymentTx||currentPaymentTx.invoiceId!==sourceInvoice.id||currentPaymentTx.transactionType!=='payment'||currentPaymentTx.amountOre!==-execution.amountOre){
      throw paymentError('Den aktuella betalningstransaktionen stämmer inte med exekveringshistoriken.','CUSTOMER_PAYMENT_RECLASS_INTEGRITY_ERROR',500);
    }
    if(date<execution.postingDate)throw paymentError('Omföringsdatumet får inte ligga före bankinbetalningens bokföringsdatum.','CUSTOMER_PAYMENT_RECLASS_DATE_BEFORE_PAYMENT',409);

    const sequence=allocation.sequence+1;
    const posted=Accounting.postEntry(db,{
      companyId,
      postingDate:date,
      description:`Omför kundinbetalning ${sourceInvoice.invoiceNumber} → ${targetInvoice.invoiceNumber}`,
      sourceType:'customer-payment-reclassification',
      sourceId:`${execution.bankPaymentId}:${sequence}`,
      createdBy:actorId,
      series:'A',
      lines:[
        {account:'1510',text:`Återöppna kundfaktura ${sourceInvoice.invoiceNumber}`,debitOre:execution.amountOre,creditOre:0},
        {account:'1510',text:`Reglera kundfaktura ${targetInvoice.invoiceNumber}`,debitOre:0,creditOre:execution.amountOre}
      ]
    });
    if(posted.duplicate)throw paymentError('Omföringsverifikationen finns redan utan motsvarande omföringshistorik.','CUSTOMER_PAYMENT_RECLASS_INTEGRITY_ERROR',500);

    const sourceReversal=Db.addInvoiceTransaction(db,{
      companyId,invoiceId:sourceInvoice.id,transactionType:'payment-reversal',paymentMethod:'Bank',
      paymentDate:bankPayment.bookingDate,postingDate:date,journalNumber:posted.entry.number,amountOre:execution.amountOre,
      approved:true,account:'1510',bankReference:`${bankPayment.externalId}:R${sequence}:SOURCE`
    });
    const targetPayment=Db.addInvoiceTransaction(db,{
      companyId,invoiceId:targetInvoice.id,transactionType:'payment',paymentMethod:'Bank',
      paymentDate:bankPayment.bookingDate,postingDate:date,journalNumber:posted.entry.number,amountOre:-execution.amountOre,
      approved:true,account:'1510',bankReference:`${bankPayment.externalId}:R${sequence}:TARGET`
    });

    const correctedAt=nowIso();
    const sourceUpdate=db.prepare(`UPDATE invoices SET remaining_ore=?,status=?,updated_at=? WHERE company_id=? AND id=? AND remaining_ore=0 AND status='Betald'`).run(
      execution.amountOre,allocation.statusBeforePayment,correctedAt,companyId,sourceInvoice.id
    );
    if(sourceUpdate.changes!==1)throw paymentError('Källfakturans reskontra ändrades under omföringen. Hela operationen återställdes.','CUSTOMER_PAYMENT_RECLASS_SOURCE_CONFLICT',409);
    const targetUpdate=db.prepare(`UPDATE invoices SET remaining_ore=0,status='Betald',updated_at=? WHERE company_id=? AND id=? AND remaining_ore=? AND total_ore>0`).run(
      correctedAt,companyId,targetInvoice.id,execution.amountOre
    );
    if(targetUpdate.changes!==1)throw paymentError('Målfakturans reskontra ändrades under omföringen. Hela operationen återställdes.','CUSTOMER_PAYMENT_RECLASS_TARGET_CONFLICT',409);

    const reclassId=`cpreclass_${require('node:crypto').randomUUID()}`;
    db.prepare(`INSERT INTO customer_payment_reclassifications(id,company_id,bank_payment_id,original_proposal_id,sequence,source_invoice_id,target_invoice_id,
      source_status_before_payment,target_status_before_payment,original_payment_transaction_id,source_reversal_transaction_id,target_payment_transaction_id,
      accounting_entry_id,amount_ore,correction_date,reason,request_id,corrected_by,corrected_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      reclassId,companyId,execution.bankPaymentId,proposalId,sequence,sourceInvoice.id,targetInvoice.id,allocation.statusBeforePayment,targetInvoice.status,
      currentPaymentTx.id,sourceReversal.id,targetPayment.id,posted.entry.id,execution.amountOre,date,cleanReason,key,actorId,correctedAt
    );
    Db.appendAudit(db,{companyId,userId:actorId,action:'CUSTOMER_PAYMENT_REALLOCATED',entityType:'bank-payment',entityId:execution.bankPaymentId,details:{
      proposalId,sequence,sourceInvoiceId:sourceInvoice.id,sourceInvoiceNumber:sourceInvoice.invoiceNumber,targetInvoiceId:targetInvoice.id,targetInvoiceNumber:targetInvoice.invoiceNumber,
      amountOre:execution.amountOre,correctionDate:date,reason:cleanReason,accountingEntryId:posted.entry.id,accountingNumber:posted.entry.number,
      sourceReversalTransactionId:sourceReversal.id,targetPaymentTransactionId:targetPayment.id
    }});
    return{
      reclassification:reclassificationByRequest(db,companyId,key),
      entry:posted.entry,
      sourceInvoice:Db.invoiceById(db,companyId,sourceInvoice.id),
      targetInvoice:Db.invoiceById(db,companyId,targetInvoice.id),
      bankPayment:Bank.byId(db,companyId,execution.bankPaymentId),
      duplicate:false
    };
  });
}

module.exports=Object.freeze({initializeCustomerPaymentPosting,executionByProposal,executionByBankPayment,reclassificationByRequest,reclassificationsForBankPayment,latestReclassification,currentAllocation,approvedAccountingLines,executeApprovedCustomerPayment,reclassifyCustomerPayment});
