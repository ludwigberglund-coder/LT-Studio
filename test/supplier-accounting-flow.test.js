'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Payables=require('../apps/api/payables.js');
const Release=require('../apps/api/payment-release.js');
const Accounting=require('../apps/api/accounting-store.js');
const SupplierAccounting=require('../apps/api/supplier-accounting.js');
const Domain=require('../packages/payables/supplier-invoices.js');

function seed({number='BKS-771',coding}={}){
  const db=Db.openDatabase(':memory:');SupplierAccounting.initializeSupplierAccounting(db);
  const company=Db.createCompany(db,{legalName:'Rollands Test AB',displayName:'Rollands Test',orgNumber:'559900-7711'});
  const otherCompany=Db.createCompany(db,{legalName:'Annat Test AB',displayName:'Annat Test',orgNumber:'559900-7712'});
  const hash=Auth.hashPassword('Sakert leverantorstest 2026!');
  const registrar=Db.createUser(db,{username:`registrar-${number}`,displayName:'Registrerare',passwordHash:hash});
  const approver=Db.createUser(db,{username:`approver-${number}`,displayName:'Attestant',passwordHash:hash});
  const accountant=Db.createUser(db,{username:`accountant-${number}`,displayName:'Ekonom',passwordHash:hash});
  const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-144',name:'Billdal Kyla & Service AB',orgNumber:'559100-1449',bankgiro:'333-4411',defaultCostAccount:'4010'});
  const invoice=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:number,invoiceDate:'2026-09-08',dueDate:'2026-09-17',totalOre:125000,vatOre:25000,registeredBy:registrar.id});
  Payables.storeDocument(db,{companyId:company.id,invoiceId:invoice.id,name:'BKS-771.pdf',bytes:Buffer.from('%PDF-1.4\n% supplier accounting test\n')});
  const lines=coding||Domain.buildCoding({totalOre:125000,vatOre:25000,costAccount:'4010'}).lines;
  Payables.saveCoding(db,{companyId:company.id,invoiceId:invoice.id,lines});
  approveCurrent(db,company.id,invoice.id,approver.id);
  return{db,company,otherCompany,registrar,approver,accountant,supplier,invoice};
}

function accountNet(entries,account){return entries.flatMap(entry=>entry.lines||[]).filter(line=>line.account===account).reduce((sum,line)=>sum+line.debitOre-line.creditOre,0)}
function approveCurrent(db,companyId,invoiceId,actorId){const current=Payables.invoiceById(db,companyId,invoiceId);return Payables.approve(db,{companyId,invoiceId,actorId,expectedCodingSha256:current.codingSha256,expectedDocumentSha256:current.documentSha256})}


test('leverantörsfaktura 1 250 kr bokförs exakt en gång som 4010 + 2641 mot 2440',()=>{
  const ctx=seed();try{
    const first=SupplierAccounting.postSupplierInvoice(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,actorId:ctx.accountant.id});
    assert.equal(first.duplicate,false);
    assert.deepEqual(first.entry.lines.map(line=>[line.account,line.debitOre,line.creditOre]),[['4010',100000,0],['2641',25000,0],['2440',0,125000]]);
    assert.equal(first.invoice.openAmountOre,125000);assert.equal(first.invoice.accountingStatus,'posted');
    const retry=SupplierAccounting.postSupplierInvoice(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,actorId:ctx.accountant.id});
    assert.equal(retry.duplicate,true);assert.equal(retry.entry.id,first.entry.id);
    assert.equal(Accounting.listEntries(ctx.db,ctx.company.id).filter(entry=>entry.sourceType==='supplier-invoice').length,1);
    assert.equal(Db.auditForCompany(ctx.db,ctx.company.id).filter(event=>event.action==='SUPPLIER_INVOICE_POSTED').length,1);
  }finally{ctx.db.close()}
});

test('full betalning nollar reskontra och sammanlagd 2440-påverkan',()=>{
  const ctx=seed();try{
    const invoicePost=SupplierAccounting.postSupplierInvoice(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,actorId:ctx.accountant.id});
    const payment=Payables.preparePayment(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,paymentDate:'2026-09-17',amountOre:125000,account:'1930',preparedBy:ctx.accountant.id});
    Release.releasePayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,releasedBy:ctx.approver.id});
    const paid=SupplierAccounting.confirmSupplierPayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,confirmationReference:'BANK-BKS-771',postingDate:'2026-09-17',actorId:ctx.accountant.id});
    assert.deepEqual(paid.entry.lines.map(line=>[line.account,line.debitOre,line.creditOre]),[['2440',125000,0],['1930',0,125000]]);
    const finalInvoice=Payables.invoiceById(ctx.db,ctx.company.id,ctx.invoice.id);
    assert.equal(finalInvoice.status,'paid');assert.equal(finalInvoice.openAmountOre,0);assert.equal(SupplierAccounting.accountingStatus(ctx.db,ctx.company.id,ctx.invoice.id),'paid');
    const entries=[invoicePost.entry,paid.entry];assert.equal(accountNet(entries,'2440'),0);
    const retry=SupplierAccounting.confirmSupplierPayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,confirmationReference:'BANK-BKS-771',postingDate:'2026-09-17',actorId:ctx.accountant.id});
    assert.equal(retry.duplicate,true);assert.equal(retry.entry.id,paid.entry.id);
    assert.equal(Accounting.listEntries(ctx.db,ctx.company.id).filter(entry=>['supplier-invoice','supplier-payment'].includes(entry.sourceType)).length,2);
    assert.equal(Db.auditForCompany(ctx.db,ctx.company.id).filter(event=>event.action==='SUPPLIER_PAYMENT_CONFIRMED_AND_POSTED').length,1);
  }finally{ctx.db.close()}
});

test('auditfel rullar tillbaka verifikation, bokföringsstatus och idempotenspost atomiskt',()=>{
  const ctx=seed();try{
    ctx.db.exec(`CREATE TRIGGER fail_supplier_invoice_audit BEFORE INSERT ON audit_events WHEN NEW.action='SUPPLIER_INVOICE_POSTED' BEGIN SELECT RAISE(ABORT,'audit fail'); END;`);
    assert.throws(()=>SupplierAccounting.postSupplierInvoice(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,actorId:ctx.accountant.id}));
    assert.equal(Accounting.entryBySource(ctx.db,ctx.company.id,'supplier-invoice',ctx.invoice.id),null);
    assert.equal(SupplierAccounting.operationBySource(ctx.db,ctx.company.id,'invoice-post',ctx.invoice.id),null);
    const invoice=Payables.invoiceById(ctx.db,ctx.company.id,ctx.invoice.id);assert.equal(invoice.liabilityAccountingEntryId,null);assert.equal(invoice.openAmountOre,125000);assert.equal(SupplierAccounting.accountingStatus(ctx.db,ctx.company.id,ctx.invoice.id),'unposted');
  }finally{ctx.db.close()}
});

test('betalningsauditfel rullar tillbaka betalningsstatus, reskontra, verifikation och idempotenspost',()=>{
  const ctx=seed({number:'BKS-AUDIT-PAY'});try{
    SupplierAccounting.postSupplierInvoice(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,actorId:ctx.accountant.id});
    const payment=Payables.preparePayment(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,paymentDate:'2026-09-17',amountOre:125000,account:'1930',preparedBy:ctx.accountant.id});
    Release.releasePayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,releasedBy:ctx.approver.id});
    ctx.db.exec(`CREATE TRIGGER fail_supplier_payment_audit BEFORE INSERT ON audit_events WHEN NEW.action='SUPPLIER_PAYMENT_CONFIRMED_AND_POSTED' BEGIN SELECT RAISE(ABORT,'audit fail'); END;`);
    assert.throws(()=>SupplierAccounting.confirmSupplierPayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,confirmationReference:'BANK-AUDIT-FAIL',postingDate:'2026-09-17',actorId:ctx.accountant.id}));
    assert.equal(Accounting.entryBySource(ctx.db,ctx.company.id,'supplier-payment',payment.id),null);assert.equal(SupplierAccounting.operationBySource(ctx.db,ctx.company.id,'payment-post',payment.id),null);
    const storedPayment=SupplierAccounting.paymentForConfirmation(ctx.db,ctx.company.id,payment.id),invoice=Payables.invoiceById(ctx.db,ctx.company.id,ctx.invoice.id);assert.equal(storedPayment.status,'released');assert.equal(storedPayment.confirmationReference,null);assert.equal(invoice.status,'payment-prepared');assert.equal(invoice.openAmountOre,125000);assert.equal(SupplierAccounting.accountingStatus(ctx.db,ctx.company.id,ctx.invoice.id),'posted');
  }finally{ctx.db.close()}
});

test('låst period, fel företag och ogiltig leverantörskontering stoppas',()=>{
  const locked=seed({number:'BKS-LOCK'});try{
    locked.db.prepare(`INSERT INTO accounting_periods(company_id,period,status) VALUES(?,?,'locked')`).run(locked.company.id,'2026-09');
    assert.throws(()=>SupplierAccounting.postSupplierInvoice(locked.db,{companyId:locked.company.id,invoiceId:locked.invoice.id,actorId:locked.accountant.id}),error=>error.code==='PERIOD_LOCKED');
    assert.equal(Accounting.entryBySource(locked.db,locked.company.id,'supplier-invoice',locked.invoice.id),null);
    assert.throws(()=>SupplierAccounting.postSupplierInvoice(locked.db,{companyId:locked.otherCompany.id,invoiceId:locked.invoice.id,actorId:locked.accountant.id}),error=>error.code==='INVOICE_NOT_FOUND');
  }finally{locked.db.close()}
  const bad=seed({number:'BKS-BAD',coding:[{account:'4010',debitOre:100000,creditOre:0,text:'Kostnad'},{account:'2641',debitOre:25000,creditOre:0,text:'Moms'},{account:'2990',debitOre:0,creditOre:125000,text:'Fel skuld'}]});try{
    assert.throws(()=>SupplierAccounting.postSupplierInvoice(bad.db,{companyId:bad.company.id,invoiceId:bad.invoice.id,actorId:bad.accountant.id}),error=>error.code==='INVALID_SUPPLIER_LIABILITY_CODING');
    assert.equal(Accounting.entryBySource(bad.db,bad.company.id,'supplier-invoice',bad.invoice.id),null);
  }finally{bad.db.close()}
});

test('låst betalningsperiod rullar tillbaka betalningsbokföringen och lämnar reskontran öppen',()=>{
  const ctx=seed({number:'BKS-PAYLOCK'});try{
    SupplierAccounting.postSupplierInvoice(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,actorId:ctx.accountant.id});
    const payment=Payables.preparePayment(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,paymentDate:'2026-10-01',amountOre:125000,account:'1930',preparedBy:ctx.accountant.id});
    Release.releasePayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,releasedBy:ctx.approver.id});
    ctx.db.prepare(`INSERT INTO accounting_periods(company_id,period,status) VALUES(?,?,'locked')`).run(ctx.company.id,'2026-10');
    assert.throws(()=>SupplierAccounting.confirmSupplierPayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,confirmationReference:'BANK-LOCKED',postingDate:'2026-10-01',actorId:ctx.accountant.id}),error=>error.code==='PERIOD_LOCKED');
    assert.equal(SupplierAccounting.paymentForConfirmation(ctx.db,ctx.company.id,payment.id).status,'released');
    assert.equal(Payables.invoiceById(ctx.db,ctx.company.id,ctx.invoice.id).openAmountOre,125000);
    assert.equal(Accounting.entryBySource(ctx.db,ctx.company.id,'supplier-payment',payment.id),null);
  }finally{ctx.db.close()}
});


test('bokförd leverantörsbetalning kan rättas atomiskt och bokföras på nytt utan att originalhistoriken försvinner',()=>{
  const ctx=seed({number:'BKS-CORR-1'});try{
    const invoicePost=SupplierAccounting.postSupplierInvoice(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,actorId:ctx.accountant.id});
    const payment=Payables.preparePayment(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,paymentDate:'2026-09-17',amountOre:125000,account:'1930',preparedBy:ctx.accountant.id});
    Release.releasePayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,releasedBy:ctx.approver.id});
    const paid=SupplierAccounting.confirmSupplierPayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,confirmationReference:'BANK-CORR-1',postingDate:'2026-09-17',actorId:ctx.accountant.id});

    const correctionInput={companyId:ctx.company.id,paymentId:payment.id,requestId:'supplier-correction-0001',correctionDate:'2026-09-18',reason:'Felaktig betalningsbokföring ska återföras.',actorId:ctx.accountant.id};
    const corrected=SupplierAccounting.correctSupplierPayment(ctx.db,correctionInput);
    assert.equal(corrected.duplicate,false);
    assert.deepEqual(corrected.reversal.lines.map(line=>[line.account,line.debitOre,line.creditOre]),[['2440',0,125000],['1930',125000,0]]);
    assert.equal(corrected.payment.status,'released');
    assert.equal(corrected.payment.confirmationReference,null);
    assert.equal(corrected.payment.accountingEntryId,null);
    assert.equal(corrected.invoice.status,'payment-prepared');
    assert.equal(corrected.invoice.accountingStatus,'posted');
    assert.equal(corrected.invoice.openAmountOre,125000);
    const attemptsAfterCorrection=SupplierAccounting.paymentAttempts(ctx.db,ctx.company.id,payment.id);
    assert.equal(attemptsAfterCorrection.length,1);
    assert.equal(attemptsAfterCorrection[0].status,'reversed');
    assert.equal(attemptsAfterCorrection[0].reversalEntryId,corrected.reversal.id);
    assert.equal(accountNet([invoicePost.entry,paid.entry,corrected.reversal],'2440'),-125000);

    const retry=SupplierAccounting.correctSupplierPayment(ctx.db,correctionInput);
    assert.equal(retry.duplicate,true);
    assert.equal(retry.reversal.id,corrected.reversal.id);
    assert.equal(Accounting.listEntries(ctx.db,ctx.company.id).filter(entry=>entry.sourceType==='supplier-payment-reversal').length,1);
    assert.equal(Db.auditForCompany(ctx.db,ctx.company.id).filter(event=>event.action==='SUPPLIER_PAYMENT_CORRECTED').length,1);

    const repaid=SupplierAccounting.confirmSupplierPayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,confirmationReference:'BANK-CORR-1',postingDate:'2026-09-19',actorId:ctx.accountant.id});
    assert.equal(repaid.duplicate,false);
    assert.equal(repaid.attempt.attemptNumber,2);
    assert.equal(repaid.entry.sourceType,'supplier-payment-repost');
    assert.equal(Payables.invoiceById(ctx.db,ctx.company.id,ctx.invoice.id).openAmountOre,0);
    assert.equal(SupplierAccounting.paymentForConfirmation(ctx.db,ctx.company.id,payment.id).status,'paid');
    const attempts=SupplierAccounting.paymentAttempts(ctx.db,ctx.company.id,payment.id);
    assert.deepEqual(attempts.map(row=>[row.attemptNumber,row.status]),[[1,'reversed'],[2,'posted']]);
    assert.equal(accountNet([invoicePost.entry,paid.entry,corrected.reversal,repaid.entry],'2440'),0);
  }finally{ctx.db.close()}
});

test('betalningsrättelse är fail-closed vid låst period eller auditfel och lämnar betalning och reskontra orörda',()=>{
  for(const mode of ['locked','audit']){
    const ctx=seed({number:`BKS-CORR-${mode}`});try{
      SupplierAccounting.postSupplierInvoice(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,actorId:ctx.accountant.id});
      const payment=Payables.preparePayment(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,paymentDate:'2026-09-17',amountOre:125000,account:'1930',preparedBy:ctx.accountant.id});
      Release.releasePayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,releasedBy:ctx.approver.id});
      const paid=SupplierAccounting.confirmSupplierPayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,confirmationReference:`BANK-CORR-${mode}`,postingDate:'2026-09-17',actorId:ctx.accountant.id});
      if(mode==='locked')ctx.db.prepare(`INSERT INTO accounting_periods(company_id,period,status) VALUES(?,?,'locked')`).run(ctx.company.id,'2026-10');
      else ctx.db.exec(`CREATE TRIGGER fail_payment_correction_audit BEFORE INSERT ON audit_events WHEN NEW.action='SUPPLIER_PAYMENT_CORRECTED' BEGIN SELECT RAISE(ABORT,'audit fail'); END;`);

      assert.throws(()=>SupplierAccounting.correctSupplierPayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,requestId:`supplier-correction-${mode}-0001`,correctionDate:mode==='locked'?'2026-10-01':'2026-09-18',reason:'Kontrollerat felprov av betalningsrättelse.',actorId:ctx.accountant.id}),mode==='locked'?e=>e.code==='PERIOD_LOCKED':/audit fail/);
      const storedPayment=SupplierAccounting.paymentForConfirmation(ctx.db,ctx.company.id,payment.id);
      const invoice=Payables.invoiceById(ctx.db,ctx.company.id,ctx.invoice.id);
      assert.equal(storedPayment.status,'paid');
      assert.equal(storedPayment.accountingEntryId,paid.entry.id);
      assert.equal(invoice.status,'paid');
      assert.equal(invoice.openAmountOre,0);
      assert.equal(SupplierAccounting.paymentAttempts(ctx.db,ctx.company.id,payment.id).filter(row=>row.status==='posted').length,1);
      assert.equal(Accounting.listEntries(ctx.db,ctx.company.id).filter(entry=>entry.sourceType==='supplier-payment-reversal').length,0);
      assert.equal(Db.auditForCompany(ctx.db,ctx.company.id).filter(event=>event.action==='SUPPLIER_PAYMENT_CORRECTED').length,0);
    }finally{ctx.db.close()}
  }
});

test('betalningsförsök och historiska bankreferenser kan inte skrivas om efteråt',()=>{
  const ctx=seed({number:'BKS-CORR-HISTORY'});try{
    SupplierAccounting.initializeSupplierAccounting(ctx.db);
    SupplierAccounting.postSupplierInvoice(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,actorId:ctx.accountant.id});
    const payment=Payables.preparePayment(ctx.db,{companyId:ctx.company.id,invoiceId:ctx.invoice.id,paymentDate:'2026-09-17',amountOre:125000,account:'1930',preparedBy:ctx.accountant.id});
    Release.releasePayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,releasedBy:ctx.approver.id});
    SupplierAccounting.confirmSupplierPayment(ctx.db,{companyId:ctx.company.id,paymentId:payment.id,confirmationReference:'BANK-HISTORY-1',postingDate:'2026-09-17',actorId:ctx.accountant.id});
    SupplierAccounting.initializeSupplierAccounting(ctx.db);
    const attempt=SupplierAccounting.paymentAttempts(ctx.db,ctx.company.id,payment.id)[0];
    assert.throws(()=>ctx.db.prepare(`UPDATE supplier_payment_attempts SET confirmation_reference='CHANGED' WHERE id=?`).run(attempt.id),/PAYMENT_ATTEMPT_HISTORY_IMMUTABLE/);
    assert.throws(()=>ctx.db.prepare(`DELETE FROM supplier_payment_attempts WHERE id=?`).run(attempt.id),/HISTORY_IMMUTABLE/);
    assert.throws(()=>ctx.db.prepare(`UPDATE supplier_payment_confirmation_refs SET confirmation_reference='CHANGED' WHERE company_id=? AND confirmation_reference='BANK-HISTORY-1'`).run(ctx.company.id),/HISTORY_IMMUTABLE/);
    assert.throws(()=>ctx.db.prepare(`DELETE FROM supplier_payment_confirmation_refs WHERE company_id=? AND confirmation_reference='BANK-HISTORY-1'`).run(ctx.company.id),/HISTORY_IMMUTABLE/);
  }finally{ctx.db.close()}
});
