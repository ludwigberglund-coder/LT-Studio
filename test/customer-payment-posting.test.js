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
const {createServer}=require('../apps/api/server.js');

const MFA_SECRET='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const ENCRYPTION_KEY='customer-payment-test-encryption-key-longer-than-thirty-two-characters';

function seed(db,{companyName='Customer Pay AB',orgNumber='559960-1001',userPrefix='cpay',externalId='BANK-CPAY-1',invoiceNumber='310501'}={}){
  CustomerPayment.initializeCustomerPaymentPosting(db);
  const company=Db.createCompany(db,{legalName:companyName,displayName:companyName,orgNumber});
  const user=Db.createUser(db,{username:`${userPrefix}.user`,displayName:'Customer Payment User',passwordHash:Auth.hashPassword('Sakert kundbetalningstest 2026!'),mfaSecretEncrypted:Auth.encryptSecret(MFA_SECRET,ENCRYPTION_KEY)});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  const customer=Db.createCustomer(db,{companyId:company.id,customerNumber:`K-${invoiceNumber}`,name:'Kundbetalning Test AB'});
  const invoice=Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber,ocr:invoiceNumber,invoiceDate:'2026-09-01',postingDate:'2026-09-01',dueDate:'2026-09-20',totalOre:125000,remainingOre:125000,vatOre:25000,status:'Bokförd',invoiceAccount:'1510'});
  const invoiceEntry=Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-01',description:`Kundfaktura ${invoiceNumber}`,sourceType:'customer-invoice',sourceId:invoice.id,createdBy:user.id,series:'F',lines:[
    {account:'1510',text:'Kundfordran',debitOre:125000,creditOre:0},
    {account:'3051',text:'Försäljning',debitOre:0,creditOre:100000},
    {account:'2611',text:'Utgående moms',debitOre:0,creditOre:25000}
  ]}).entry;
  const bank=Bank.create(db,{companyId:company.id,externalId,bookingDate:'2026-09-20',amountOre:125000,reference:invoiceNumber,payerName:'Kundbetalning Test AB',createdBy:user.id}).payment;
  const analysis=Matcher.analyzeIncomingPayment(bank,Db.listReceivables(db,company.id));
  assert.equal(analysis.status,'proposal');
  const proposal=Queues.saveAutomationProposal(db,Matcher.createMatchProposal(bank,analysis,{createdBy:user.id}),{idempotencyKey:`bank-payment-match:${bank.id}:v1`}).proposal;
  Bank.setStatus(db,company.id,bank.id,'proposal-created');
  return{company,user,customer,invoice,invoiceEntry,bank,proposal};
}
function approve(db,ctx){return Queues.approveAutomationProposal(db,{companyId:ctx.company.id,proposalId:ctx.proposal.id,userId:ctx.user.id})}
function net(entries,account){return entries.flatMap(entry=>entry.lines||[]).filter(line=>line.account===account).reduce((sum,line)=>sum+line.debitOre-line.creditOre,0)}

test('godkänd bankmatchning bokför 1930 mot 1510, reglerar fakturan och är retry-säker',()=>{
  const db=Db.openDatabase(':memory:');try{
    const ctx=seed(db);approve(db,ctx);
    const first=CustomerPayment.executeApprovedCustomerPayment(db,{companyId:ctx.company.id,proposalId:ctx.proposal.id,actorId:ctx.user.id});
    assert.equal(first.duplicate,false);
    assert.deepEqual(first.entry.lines.map(line=>[line.account,line.debitOre,line.creditOre]),[['1930',125000,0],['1510',0,125000]]);
    assert.equal(first.entry.sourceType,'customer-payment');
    assert.equal(first.entry.sourceId,ctx.bank.id);
    assert.equal(first.bankPayment.status,'posted');
    assert.equal(first.invoice.remainingOre,0);
    assert.equal(first.invoice.status,'Betald');
    assert.equal(first.transaction.transactionType,'payment');
    assert.equal(first.transaction.amountOre,-125000);
    assert.equal(first.transaction.bankReference,ctx.bank.externalId);
    assert.equal(first.execution.proposalId,ctx.proposal.id);
    assert.equal(net([ctx.invoiceEntry,first.entry],'1510'),0);

    const retry=CustomerPayment.executeApprovedCustomerPayment(db,{companyId:ctx.company.id,proposalId:ctx.proposal.id,actorId:ctx.user.id});
    assert.equal(retry.duplicate,true);
    assert.equal(retry.entry.id,first.entry.id);
    assert.equal(retry.transaction.id,first.transaction.id);
    assert.equal(Accounting.listEntries(db,ctx.company.id).filter(entry=>entry.sourceType==='customer-payment').length,1);
    assert.equal(Db.transactionsForInvoice(db,ctx.company.id,ctx.invoice.id).length,1);
    assert.equal(Db.auditForCompany(db,ctx.company.id).filter(event=>event.action==='CUSTOMER_PAYMENT_POSTED_FROM_APPROVED_MATCH').length,1);
  }finally{db.close()}
});

test('kundbetalning kräver godkänt förslag och avstämd öppen reskontra',()=>{
  const db=Db.openDatabase(':memory:');try{
    const ctx=seed(db,{externalId:'BANK-CPAY-2',invoiceNumber:'310502'});
    assert.throws(()=>CustomerPayment.executeApprovedCustomerPayment(db,{companyId:ctx.company.id,proposalId:ctx.proposal.id,actorId:ctx.user.id}),e=>e.code==='PROPOSAL_NOT_APPROVED'&&e.statusCode===409);
    approve(db,ctx);
    db.prepare('UPDATE invoices SET remaining_ore=? WHERE company_id=? AND id=?').run(120000,ctx.company.id,ctx.invoice.id);
    assert.throws(()=>CustomerPayment.executeApprovedCustomerPayment(db,{companyId:ctx.company.id,proposalId:ctx.proposal.id,actorId:ctx.user.id}),e=>e.code==='CUSTOMER_RECEIVABLE_INTEGRITY_ERROR'&&e.statusCode===409);
    assert.equal(Accounting.entryBySource(db,ctx.company.id,'customer-payment',ctx.bank.id),null);
    assert.equal(Bank.byId(db,ctx.company.id,ctx.bank.id).status,'proposal-created');
  }finally{db.close()}
});

test('låst period och auditfel rullar tillbaka hela kundbetalningen',()=>{
  for(const mode of ['locked','audit']){
    const db=Db.openDatabase(':memory:');try{
      const ctx=seed(db,{companyName:`Rollback ${mode} AB`,orgNumber:mode==='locked'?'559960-2001':'559960-2002',userPrefix:`cpay-${mode}`,externalId:`BANK-${mode.toUpperCase()}`,invoiceNumber:mode==='locked'?'310503':'310504'});
      approve(db,ctx);
      if(mode==='locked')db.prepare(`INSERT INTO accounting_periods(company_id,period,status) VALUES(?,?,'locked')`).run(ctx.company.id,'2026-09');
      else db.exec(`CREATE TRIGGER fail_customer_payment_audit BEFORE INSERT ON audit_events WHEN NEW.action='CUSTOMER_PAYMENT_POSTED_FROM_APPROVED_MATCH' BEGIN SELECT RAISE(ABORT,'audit fail'); END;`);
      assert.throws(()=>CustomerPayment.executeApprovedCustomerPayment(db,{companyId:ctx.company.id,proposalId:ctx.proposal.id,actorId:ctx.user.id}),mode==='locked'?e=>e.code==='PERIOD_LOCKED':/audit fail/);
      assert.equal(Accounting.entryBySource(db,ctx.company.id,'customer-payment',ctx.bank.id),null);
      assert.equal(Db.transactionsForInvoice(db,ctx.company.id,ctx.invoice.id).length,0);
      assert.equal(Db.invoiceById(db,ctx.company.id,ctx.invoice.id).remainingOre,125000);
      assert.equal(Bank.byId(db,ctx.company.id,ctx.bank.id).status,'proposal-created');
      assert.equal(CustomerPayment.executionByProposal(db,ctx.company.id,ctx.proposal.id),null);
    }finally{db.close()}
  }
});

test('privat API godkänner först och genomför sedan kundbetalningen med CSRF och tenant-isolering',async()=>{
  const db=Db.openDatabase(':memory:');
  const a=seed(db,{companyName:'HTTP Customer A AB',orgNumber:'559960-3001',userPrefix:'http-cpay-a',externalId:'BANK-HTTP-A',invoiceNumber:'310505'});
  const b=seed(db,{companyName:'HTTP Customer B AB',orgNumber:'559960-3002',userPrefix:'http-cpay-b',externalId:'BANK-HTTP-B',invoiceNumber:'310506'});
  const runtime=createServer({databasePath:':memory:',db,secureCookies:false,authEncryptionKey:ENCRYPTION_KEY});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  try{
    const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:a.user.username,password:'Sakert kundbetalningstest 2026!',totp:Auth.totpCode(MFA_SECRET)})});
    const signed=await login.json(),cookie=String(login.headers.get('set-cookie')||'').split(';')[0];
    const headers={Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':signed.csrfToken};

    const approveResponse=await fetch(base+`/api/v1/automation/proposals/${a.proposal.id}/approve`,{method:'POST',headers,body:'{}'});
    const approved=await approveResponse.json();
    assert.equal(approveResponse.status,200);
    assert.equal(approved.proposal.status,'approved');
    assert.equal(Bank.byId(db,a.company.id,a.bank.id).status,'reviewed');

    const noCsrf=await fetch(base+`/api/v1/automation/proposals/${a.proposal.id}/execute`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});
    assert.equal(noCsrf.status,403);

    const foreign=await fetch(base+`/api/v1/automation/proposals/${b.proposal.id}/execute`,{method:'POST',headers,body:'{}'});
    assert.equal(foreign.status,404);
    assert.equal(Bank.byId(db,b.company.id,b.bank.id).status,'proposal-created');

    const execute=await fetch(base+`/api/v1/automation/proposals/${a.proposal.id}/execute`,{method:'POST',headers,body:'{}'});
    const executed=await execute.json();
    assert.equal(execute.status,201);
    assert.equal(executed.executionStatus,'executed');
    assert.equal(executed.invoice.remainingOre,0);
    assert.equal(executed.bankPayment.status,'posted');

    const retry=await fetch(base+`/api/v1/automation/proposals/${a.proposal.id}/execute`,{method:'POST',headers,body:'{}'});
    const retried=await retry.json();
    assert.equal(retry.status,200);
    assert.equal(retried.duplicate,true);
    assert.equal(retried.entry.id,executed.entry.id);
  }finally{
    await new Promise(resolve=>runtime.close(resolve));
  }
});
