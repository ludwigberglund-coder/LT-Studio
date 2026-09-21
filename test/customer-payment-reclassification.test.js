'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Accounting=require('../apps/api/accounting-store.js');
const Bank=require('../apps/api/bank-payments.js');
const Queues=require('../apps/api/queues.js');
const Matcher=require('../packages/automation/bank-payment-matcher.js');
const CustomerPayment=require('../apps/api/customer-payment-posting.js');
const Receivables=require('../packages/receivables/customer-receivables.js');
const {createServer}=require('../apps/api/server.js');

const MFA_SECRET='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const ENCRYPTION_KEY='customer-reclass-test-encryption-key-longer-than-thirty-two-characters';
const PASSWORD='Sakert kundomforingstest 2026!';

function createPostedInvoice(db,{company,user,customer,invoiceNumber,amountOre=125000}){
  const invoice=Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber,ocr:invoiceNumber,invoiceDate:'2026-09-01',postingDate:'2026-09-01',dueDate:'2026-09-20',totalOre:amountOre,remainingOre:amountOre,vatOre:25000,status:'Bokförd',invoiceAccount:'1510'});
  const entry=Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-01',description:`Kundfaktura ${invoiceNumber}`,sourceType:'customer-invoice',sourceId:invoice.id,createdBy:user.id,series:'F',lines:[
    {account:'1510',text:'Kundfordran',debitOre:amountOre,creditOre:0},
    {account:'3051',text:'Försäljning',debitOre:0,creditOre:amountOre-25000},
    {account:'2611',text:'Utgående moms',debitOre:0,creditOre:25000}
  ]}).entry;
  return{invoice,entry};
}

function seed(db,{companyName='Reclass AB',orgNumber='559950-1001',prefix='reclass'}={}){
  CustomerPayment.initializeCustomerPaymentPosting(db);
  const company=Db.createCompany(db,{legalName:companyName,displayName:companyName,orgNumber});
  const user=Db.createUser(db,{username:`${prefix}.user`,displayName:'Reclass User',passwordHash:Auth.hashPassword(PASSWORD),mfaSecretEncrypted:Auth.encryptSecret(MFA_SECRET,ENCRYPTION_KEY)});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  const sourceCustomer=Db.createCustomer(db,{companyId:company.id,customerNumber:`${prefix}-A`,name:'Fel Kund AB'});
  const targetCustomer=Db.createCustomer(db,{companyId:company.id,customerNumber:`${prefix}-B`,name:'Rätt Kund AB'});
  const source=createPostedInvoice(db,{company,user,customer:sourceCustomer,invoiceNumber:`${prefix.toUpperCase()}-A`});
  const target=createPostedInvoice(db,{company,user,customer:targetCustomer,invoiceNumber:`${prefix.toUpperCase()}-B`});
  const bank=Bank.create(db,{companyId:company.id,externalId:`BANK-${prefix.toUpperCase()}`,bookingDate:'2026-09-20',amountOre:125000,reference:source.invoice.invoiceNumber,payerName:'Fel Kund AB',createdBy:user.id}).payment;
  const analysis=Matcher.analyzeIncomingPayment(bank,Db.listReceivables(db,company.id));
  const proposal=Queues.saveAutomationProposal(db,Matcher.createMatchProposal(bank,analysis,{createdBy:user.id}),{idempotencyKey:`bank-payment-match:${bank.id}:v1`}).proposal;
  Bank.setStatus(db,company.id,bank.id,'proposal-created');
  Queues.approveAutomationProposal(db,{companyId:company.id,proposalId:proposal.id,userId:user.id});
  const execution=CustomerPayment.executeApprovedCustomerPayment(db,{companyId:company.id,proposalId:proposal.id,actorId:user.id});
  return{company,user,sourceCustomer,targetCustomer,source,target,bank,proposal,execution};
}

function accountNet(entries,account){
  return entries.flatMap(entry=>entry.lines||[]).filter(line=>line.account===account).reduce((sum,line)=>sum+line.debitOre-line.creditOre,0);
}

test('kundbetalning kan omföras A till B och tillbaka utan att bankbokningen ändras',()=>{
  const db=Db.openDatabase(':memory:');try{
    const ctx=seed(db);
    const first=CustomerPayment.reclassifyCustomerPayment(db,{
      companyId:ctx.company.id,proposalId:ctx.proposal.id,targetInvoiceId:ctx.target.invoice.id,
      requestId:'customer-reclass-request-0001',correctionDate:'2026-09-21',reason:'Betalningen kopplades till fel kundfaktura.',actorId:ctx.user.id
    });
    assert.equal(first.duplicate,false);
    assert.equal(first.reclassification.sequence,1);
    assert.deepEqual(first.entry.lines.map(line=>[line.account,line.debitOre,line.creditOre]),[['1510',125000,0],['1510',0,125000]]);
    assert.equal(first.sourceInvoice.remainingOre,125000);
    assert.equal(first.sourceInvoice.status,'Bokförd');
    assert.equal(first.targetInvoice.remainingOre,0);
    assert.equal(first.targetInvoice.status,'Betald');
    assert.equal(first.bankPayment.status,'posted');
    assert.equal(first.reclassification.sourceStatusBeforePayment,'Bokförd');
    assert.equal(first.reclassification.targetStatusBeforePayment,'Bokförd');
    assert.equal(Accounting.entryById(db,ctx.company.id,ctx.execution.entry.id).id,ctx.execution.entry.id);
    assert.equal(accountNet([ctx.execution.entry,first.entry],'1930'),125000);
    assert.equal(first.entry.lines.some(line=>line.account==='1930'),false);

    const sourceTx=Db.transactionsForInvoice(db,ctx.company.id,ctx.source.invoice.id);
    const targetTx=Db.transactionsForInvoice(db,ctx.company.id,ctx.target.invoice.id);
    assert.deepEqual(sourceTx.map(row=>[row.transactionType,row.amountOre]),[['payment',-125000],['payment-reversal',125000]]);
    assert.deepEqual(targetTx.map(row=>[row.transactionType,row.amountOre]),[['payment',-125000]]);
    const sourceReceivable=Db.listReceivables(db,ctx.company.id).find(row=>row.id===ctx.source.invoice.id);
    const targetReceivable=Db.listReceivables(db,ctx.company.id).find(row=>row.id===ctx.target.invoice.id);
    assert.equal(Receivables.interestBalanceHistory(sourceReceivable,'2026-09-22').balanceOre,125000);
    assert.equal(Receivables.interestBalanceHistory(targetReceivable,'2026-09-22').balanceOre,0);

    const retry=CustomerPayment.reclassifyCustomerPayment(db,{
      companyId:ctx.company.id,proposalId:ctx.proposal.id,targetInvoiceId:ctx.target.invoice.id,
      requestId:'customer-reclass-request-0001',correctionDate:'2026-09-21',reason:'Betalningen kopplades till fel kundfaktura.',actorId:ctx.user.id
    });
    assert.equal(retry.duplicate,true);
    assert.equal(retry.entry.id,first.entry.id);
    assert.equal(CustomerPayment.reclassificationsForBankPayment(db,ctx.company.id,ctx.bank.id).length,1);
    assert.equal(Db.auditForCompany(db,ctx.company.id).filter(event=>event.action==='CUSTOMER_PAYMENT_REALLOCATED').length,1);

    const second=CustomerPayment.reclassifyCustomerPayment(db,{
      companyId:ctx.company.id,proposalId:ctx.proposal.id,targetInvoiceId:ctx.source.invoice.id,
      requestId:'customer-reclass-request-0002',correctionDate:'2026-09-22',reason:'Den första omföringen var fel och återställs.',actorId:ctx.user.id
    });
    assert.equal(second.reclassification.sequence,2);
    assert.equal(second.sourceInvoice.id,ctx.target.invoice.id);
    assert.equal(second.sourceInvoice.remainingOre,125000);
    assert.equal(second.targetInvoice.id,ctx.source.invoice.id);
    assert.equal(second.targetInvoice.remainingOre,0);
    assert.equal(CustomerPayment.reclassificationsForBankPayment(db,ctx.company.id,ctx.bank.id).length,2);
    assert.equal(Bank.byId(db,ctx.company.id,ctx.bank.id).status,'posted');
    const sourceAfterSecond=Db.listReceivables(db,ctx.company.id).find(row=>row.id===ctx.source.invoice.id);
    const targetAfterSecond=Db.listReceivables(db,ctx.company.id).find(row=>row.id===ctx.target.invoice.id);
    assert.equal(Receivables.interestBalanceHistory(sourceAfterSecond,'2026-09-23').balanceOre,0);
    assert.equal(Receivables.interestBalanceHistory(targetAfterSecond,'2026-09-23').balanceOre,125000);
    const all=Accounting.listEntries(db,ctx.company.id).map(row=>Accounting.entryById(db,ctx.company.id,row.id));
    assert.equal(accountNet(all,'1930'),125000);
    assert.equal(accountNet(all,'1510'),125000);
  }finally{db.close()}
});

test('omföring är idempotent, append-only och blockerar ändrad payload med samma request-id',()=>{
  const db=Db.openDatabase(':memory:');try{
    const ctx=seed(db,{prefix:'immut'});
    const input={companyId:ctx.company.id,proposalId:ctx.proposal.id,targetInvoiceId:ctx.target.invoice.id,requestId:'customer-reclass-immut-0001',correctionDate:'2026-09-21',reason:'Felaktig allokering ska rättas.',actorId:ctx.user.id};
    const first=CustomerPayment.reclassifyCustomerPayment(db,input);
    assert.throws(()=>CustomerPayment.reclassifyCustomerPayment(db,{...input,reason:'Annan orsak med samma request-id.'}),e=>e.code==='CUSTOMER_PAYMENT_RECLASS_IDEMPOTENCY_CONFLICT'&&e.statusCode===409);
    assert.throws(()=>db.prepare('UPDATE customer_payment_reclassifications SET reason=? WHERE id=?').run('Ändrad',first.reclassification.id),/HISTORY_IMMUTABLE/);
    assert.throws(()=>db.prepare('DELETE FROM customer_payment_reclassifications WHERE id=?').run(first.reclassification.id),/HISTORY_IMMUTABLE/);
    assert.throws(()=>db.prepare('UPDATE customer_payment_executions SET invoice_status_before=? WHERE company_id=? AND proposal_id=?').run('Ändrad',ctx.company.id,ctx.proposal.id),/HISTORY_IMMUTABLE/);
  }finally{db.close()}
});

test('låst period eller auditfel rullar tillbaka hela kundomföringen',()=>{
  for(const mode of ['locked','audit']){
    const db=Db.openDatabase(':memory:');try{
      const ctx=seed(db,{companyName:`Reclass ${mode} AB`,orgNumber:mode==='locked'?'559950-2001':'559950-2002',prefix:`reclass-${mode}`});
      if(mode==='locked')db.prepare(`INSERT INTO accounting_periods(company_id,period,status) VALUES(?,?,'locked')`).run(ctx.company.id,'2026-10');
      else db.exec(`CREATE TRIGGER fail_customer_reclass_audit BEFORE INSERT ON audit_events WHEN NEW.action='CUSTOMER_PAYMENT_REALLOCATED' BEGIN SELECT RAISE(ABORT,'audit fail'); END;`);
      const input={companyId:ctx.company.id,proposalId:ctx.proposal.id,targetInvoiceId:ctx.target.invoice.id,requestId:`customer-reclass-${mode}-0001`,correctionDate:mode==='locked'?'2026-10-01':'2026-09-21',reason:'Kontrollerat rollbackprov för kundomföring.',actorId:ctx.user.id};
      assert.throws(()=>CustomerPayment.reclassifyCustomerPayment(db,input),mode==='locked'?e=>e.code==='PERIOD_LOCKED':/audit fail/);
      assert.equal(Db.invoiceById(db,ctx.company.id,ctx.source.invoice.id).remainingOre,0);
      assert.equal(Db.invoiceById(db,ctx.company.id,ctx.target.invoice.id).remainingOre,125000);
      assert.equal(Bank.byId(db,ctx.company.id,ctx.bank.id).status,'posted');
      assert.equal(CustomerPayment.reclassificationsForBankPayment(db,ctx.company.id,ctx.bank.id).length,0);
      assert.equal(Accounting.listEntries(db,ctx.company.id).filter(entry=>entry.sourceType==='customer-payment-reclassification').length,0);
      assert.deepEqual(Db.transactionsForInvoice(db,ctx.company.id,ctx.source.invoice.id).map(row=>row.transactionType),['payment']);
      assert.equal(Db.transactionsForInvoice(db,ctx.company.id,ctx.target.invoice.id).length,0);
    }finally{db.close()}
  }
});

test('privat omföringsroute kräver CSRF och håller företag åtskilda',async()=>{
  const db=Db.openDatabase(':memory:');
  const a=seed(db,{companyName:'Reclass HTTP A AB',orgNumber:'559950-3001',prefix:'http-ra'});
  const b=seed(db,{companyName:'Reclass HTTP B AB',orgNumber:'559950-3002',prefix:'http-rb'});
  const runtime=createServer({databasePath:':memory:',db,secureCookies:false,authEncryptionKey:ENCRYPTION_KEY});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  try{
    const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:a.user.username,password:PASSWORD,totp:Auth.totpCode(MFA_SECRET)})});
    const signed=await login.json(),cookie=String(login.headers.get('set-cookie')||'').split(';')[0];
    const headers={Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':signed.csrfToken};
    const payload={targetInvoiceId:a.target.invoice.id,requestId:'customer-http-reclass-0001',correctionDate:'2026-09-21',reason:'HTTP-test av säker kundomföring.'};

    const noCsrf=await fetch(base+`/api/v1/automation/proposals/${a.proposal.id}/reclassify`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    assert.equal(noCsrf.status,403);

    const foreignProposal=await fetch(base+`/api/v1/automation/proposals/${b.proposal.id}/reclassify`,{method:'POST',headers,body:JSON.stringify({...payload,targetInvoiceId:b.target.invoice.id})});
    assert.equal(foreignProposal.status,404);

    const foreignTarget=await fetch(base+`/api/v1/automation/proposals/${a.proposal.id}/reclassify`,{method:'POST',headers,body:JSON.stringify({...payload,targetInvoiceId:b.target.invoice.id,requestId:'customer-http-reclass-0002'})});
    assert.equal(foreignTarget.status,404);

    const first=await fetch(base+`/api/v1/automation/proposals/${a.proposal.id}/reclassify`,{method:'POST',headers,body:JSON.stringify(payload)});
    const one=await first.json();
    assert.equal(first.status,201);
    assert.equal(one.executionStatus,'reclassified');
    assert.equal(one.sourceInvoice.remainingOre,125000);
    assert.equal(one.targetInvoice.remainingOre,0);

    const retry=await fetch(base+`/api/v1/automation/proposals/${a.proposal.id}/reclassify`,{method:'POST',headers,body:JSON.stringify(payload)});
    assert.equal(retry.status,200);
    assert.equal((await retry.json()).duplicate,true);
  }finally{
    await new Promise(resolve=>runtime.close(resolve));
  }
});


test('omföring till faktura med annat restbelopp blockeras utan sidoeffekter',()=>{
  const db=Db.openDatabase(':memory:');try{
    const ctx=seed(db,{prefix:'mismatch'});
    const wrongCustomer=Db.createCustomer(db,{companyId:ctx.company.id,customerNumber:'MISMATCH-C',name:'Fel belopp AB'});
    const wrong=createPostedInvoice(db,{company:ctx.company,user:ctx.user,customer:wrongCustomer,invoiceNumber:'MISMATCH-C',amountOre:100000});
    assert.throws(()=>CustomerPayment.reclassifyCustomerPayment(db,{
      companyId:ctx.company.id,proposalId:ctx.proposal.id,targetInvoiceId:wrong.invoice.id,
      requestId:'customer-reclass-mismatch-0001',correctionDate:'2026-09-21',reason:'Försök till felbeloppsomföring.',actorId:ctx.user.id
    }),e=>e.code==='CUSTOMER_PAYMENT_AMOUNT_MISMATCH'&&e.statusCode===409);
    assert.equal(Db.invoiceById(db,ctx.company.id,ctx.source.invoice.id).remainingOre,0);
    assert.equal(Db.invoiceById(db,ctx.company.id,wrong.invoice.id).remainingOre,100000);
    assert.equal(Bank.byId(db,ctx.company.id,ctx.bank.id).status,'posted');
    assert.equal(CustomerPayment.reclassificationsForBankPayment(db,ctx.company.id,ctx.bank.id).length,0);
  }finally{db.close()}
});

test('kundbetalningshistoriken migrerar från exekveringsschema utan statuskolumn',()=>{
  const db=Db.openDatabase(':memory:');try{
    Queues.initializeQueues(db);Bank.initializeBankPayments(db);Accounting.initializeAccountingStore(db);
    db.exec(`
      CREATE TABLE customer_payment_executions(
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
    CustomerPayment.initializeCustomerPaymentPosting(db);
    assert.ok(db.prepare('PRAGMA table_info(customer_payment_executions)').all().some(row=>row.name==='invoice_status_before'));
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customer_payment_reclassifications'").get());
    CustomerPayment.initializeCustomerPaymentPosting(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='customer_payment_reclassifications'").get().n,1);
  }finally{db.close()}
});
