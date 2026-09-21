'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Accounting=require('../apps/api/accounting-store.js');
const Payables=require('../apps/api/payables.js');
const Reports=require('../apps/api/reports.js');

function seed(){
  const db=Db.openDatabase(':memory:');Accounting.initializeAccountingStore(db);Payables.initializePayables(db);
  const company=Db.createCompany(db,{legalName:'Rapportbolaget AB',displayName:'Rapportbolaget',orgNumber:'559900-5050'});
  const user=Db.createUser(db,{username:'report',displayName:'Rapporttest',passwordHash:Auth.hashPassword('Sakert rapporttest 2026!')});
  const customer=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-1',name:'Kund AB'});
  const customerInvoice=Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'1001',invoiceDate:'2026-09-05',postingDate:'2026-09-05',dueDate:'2026-10-05',totalOre:125000,vatOre:25000,remainingOre:125000});
  const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-1',name:'Leverantör AB',defaultCostAccount:'4010'});
  const supplierInvoice=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'S-1',invoiceDate:'2026-09-08',dueDate:'2026-10-08',totalOre:62500,vatOre:12500,registeredBy:user.id});
  Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-08-31',description:'Ingående bank',sourceType:'seed',sourceId:'open',createdBy:user.id,series:'A',lines:[{account:'1930',debitOre:100000,creditOre:0},{account:'2091',debitOre:0,creditOre:100000}]});
  Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-05',description:'Kundfaktura 1001',sourceType:'customer-invoice',sourceId:customerInvoice.id,createdBy:user.id,series:'A',lines:[{account:'1510',debitOre:125000,creditOre:0},{account:'3010',debitOre:0,creditOre:100000},{account:'2611',debitOre:0,creditOre:25000}]});
  const supplierPosting=Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-08',description:'Leverantörsfaktura S-1',sourceType:'supplier-invoice',sourceId:supplierInvoice.id,createdBy:user.id,series:'A',lines:[{account:'4010',debitOre:50000,creditOre:0},{account:'2641',debitOre:12500,creditOre:0},{account:'2440',debitOre:0,creditOre:62500}]});
  db.prepare('UPDATE supplier_invoices SET liability_accounting_entry_id=?,open_amount_ore=? WHERE company_id=? AND id=?').run(supplierPosting.entry.id,62500,company.id,supplierInvoice.id);
  return{db,company,user};
}

test('trial balance visar ingående saldo, periodens debet/kredit och utgående saldo',()=>{const {db,company}=seed();try{const r=Reports.trialBalance(db,company.id,{from:'2026-09-01',to:'2026-09-30'});const bank=r.rows.find(x=>x.account==='1930');const receivable=r.rows.find(x=>x.account==='1510');assert.equal(bank.openingOre,100000);assert.equal(bank.debitOre,0);assert.equal(bank.closingOre,100000);assert.equal(receivable.debitOre,125000);assert.equal(r.totals.debitOre,r.totals.creditOre);}finally{db.close()}});

test('huvudbok kan filtreras på konto',()=>{const {db,company}=seed();try{const r=Reports.generalLedger(db,company.id,{from:'2026-09-01',to:'2026-09-30',account:'2611'});assert.equal(r.rows.length,1);assert.equal(r.rows[0].creditOre,25000);assert.equal(r.rows[0].number,'A2');}finally{db.close()}});

test('resultatrapport summerar konton 3000-8999',()=>{const {db,company}=seed();try{const r=Reports.profitLoss(db,company.id,{from:'2026-09-01',to:'2026-09-30'});assert.equal(r.rows.find(x=>x.account==='3010').amountOre,100000);assert.equal(r.rows.find(x=>x.account==='4010').amountOre,-50000);assert.equal(r.resultOre,50000);}finally{db.close()}});

test('försäljningsrapport summerar fakturadatum och isolerar andra företag',()=>{const {db,company}=seed();try{
  const customer2=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-2',name:'Kund Två AB'});
  Db.createInvoice(db,{companyId:company.id,customerId:customer2.id,invoiceNumber:'1002',invoiceDate:'2026-09-20',postingDate:'2026-09-20',dueDate:'2026-10-20',totalOre:212000,vatOre:12000,remainingOre:120000,status:'Bokförd'});
  const other=Db.createCompany(db,{legalName:'Annat Rapportbolag AB',displayName:'Annat Rapportbolag',orgNumber:'559900-6060'});
  const otherCustomer=Db.createCustomer(db,{companyId:other.id,customerNumber:'X-1',name:'Annan Kund AB'});
  Db.createInvoice(db,{companyId:other.id,customerId:otherCustomer.id,invoiceNumber:'X-SECRET',invoiceDate:'2026-09-15',postingDate:'2026-09-15',dueDate:'2026-10-15',totalOre:999999,vatOre:199999,remainingOre:999999,status:'Bokförd'});

  const r=Reports.salesReport(db,company.id,{from:'2026-09-01',to:'2026-09-30'});
  assert.equal(r.basis,'customer-invoice-operational');
  assert.equal(r.totals.invoiceCount,2);
  assert.equal(r.totals.netOre,300000);
  assert.equal(r.totals.vatOre,37000);
  assert.equal(r.totals.grossOre,337000);
  assert.equal(r.totals.paidOre,92000);
  assert.equal(r.totals.outstandingOre,245000);
  assert.equal(r.totals.averageInvoiceOre,168500);
  assert.equal(r.rows.length,2);
  assert.equal(r.customers.length,2);
  assert.equal(r.customers[0].customerNumber,'K-2');
  assert.doesNotMatch(JSON.stringify(r),/X-SECRET|Annan Kund AB|999999/);
  assert.match(r.warning,/operativ försäljning/i);
}finally{db.close()}});

test('momsavstämning bygger beloppen från huvudbokens momskonton och stämmer av fakturakällorna',()=>{const {db,company}=seed();try{
  const r=Reports.vatControl(db,company.id,{period:'2026-09'});
  assert.equal(r.basis,'booked-ledger-control');
  assert.equal(r.outputVatOre,25000);assert.equal(r.inputVatOre,12500);assert.equal(r.netVatOre,12500);
  assert.equal(r.outputVatByRate['25'],25000);assert.equal(r.outputVatByRate['12'],0);assert.equal(r.outputVatByRate['6'],0);
  assert.equal(r.sourceReconciliation.customerInvoices.length,1);assert.equal(r.sourceReconciliation.supplierInvoices.length,1);
  assert.deepEqual(r.sourceReconciliation.mismatches,[]);
  assert.equal(r.integrityOk,true);assert.equal(r.declarationReady,false);
  assert.match(r.warning,/inte en färdig momsdeklaration/i);
}finally{db.close()}});

test('obokförda fakturaregisterbelopp får inte styra momsbeloppet i rapporten',()=>{const {db,company}=seed();try{
  const customer=Db.listCustomers(db,company.id)[0];
  Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'1002',invoiceDate:'2026-09-12',postingDate:'2026-09-12',dueDate:'2026-10-12',totalOre:240000,vatOre:40000,remainingOre:240000});
  const r=Reports.vatControl(db,company.id,{period:'2026-09'});
  assert.equal(r.outputVatOre,25000);
  assert.equal(r.operationalControl.customerVatOre,65000);
  assert.equal(r.customerInvoiceCount,2);
}finally{db.close()}});

test('momsavstämningen flaggar när en fakturas sparade moms och dess bokförda moms skiljer sig',()=>{const {db,company}=seed();try{
  db.prepare("UPDATE invoices SET vat_ore=24000 WHERE company_id=? AND invoice_number='1001'").run(company.id);
  const r=Reports.vatControl(db,company.id,{period:'2026-09'});
  assert.equal(r.integrityOk,false);
  assert.equal(r.sourceReconciliation.mismatches.length,1);
  assert.equal(r.sourceReconciliation.mismatches[0].kind,'customer-invoice');
  assert.equal(r.sourceReconciliation.mismatches[0].differenceOre,1000);
  assert.match(r.warning,/får inte behandlas som deklarationsklar/i);
}finally{db.close()}});

test('huvudboken särredovisar 25, 12 och 6 procent på rätt utgående momskonton',()=>{const {db,company,user}=seed();try{
  Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-15',description:'12 procent moms',sourceType:'manual',sourceId:'vat-12',createdBy:user.id,series:'M',lines:[{account:'1510',debitOre:112000,creditOre:0},{account:'3042',debitOre:0,creditOre:100000},{account:'2621',debitOre:0,creditOre:12000}]});
  Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-16',description:'6 procent moms',sourceType:'manual',sourceId:'vat-6',createdBy:user.id,series:'M',lines:[{account:'1510',debitOre:106000,creditOre:0},{account:'3043',debitOre:0,creditOre:100000},{account:'2631',debitOre:0,creditOre:6000}]});
  const r=Reports.vatControl(db,company.id,{period:'2026-09'});
  assert.equal(r.outputVatByRate['25'],25000);
  assert.equal(r.outputVatByRate['12'],12000);
  assert.equal(r.outputVatByRate['6'],6000);
  assert.equal(r.outputVatOre,43000);
}finally{db.close()}});

test('leverantörsfakturans sparade moms måste stämma med konto 2641 i källverifikationen',()=>{const {db,company}=seed();try{
  db.prepare("UPDATE supplier_invoices SET vat_ore=12000 WHERE company_id=? AND supplier_invoice_number='S-1'").run(company.id);
  const r=Reports.vatControl(db,company.id,{period:'2026-09'});
  const mismatch=r.sourceReconciliation.mismatches.find(row=>row.kind==='supplier-invoice');
  assert.ok(mismatch);
  assert.equal(mismatch.expectedVatOre,12000);
  assert.equal(mismatch.bookedVatOre,12500);
  assert.equal(mismatch.differenceOre,500);
  assert.equal(r.integrityOk,false);
}finally{db.close()}});

test('okända aktiva 26-konton flaggas i stället för att klassificeras som svensk moms automatiskt',()=>{const {db,company,user}=seed();try{
  Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-20',description:'Ej klassificerad moms',sourceType:'manual',sourceId:'vat-unknown',createdBy:user.id,series:'M',lines:[{account:'2614',debitOre:0,creditOre:1000},{account:'3740',debitOre:1000,creditOre:0}]});
  const r=Reports.vatControl(db,company.id,{period:'2026-09'});
  assert.equal(r.integrityOk,false);
  assert.equal(r.unsupportedVatAccounts.length,1);
  assert.equal(r.unsupportedVatAccounts[0].account,'2614');
  assert.equal(r.outputVatOre,25000);
}finally{db.close()}});

test('kundreskontran stämmer mot konto 1510 i normalfallet',()=>{const {db,company}=seed();try{
  const r=Reports.receivablesControl(db,company.id);
  assert.equal(r.integrityOk,true);
  assert.equal(r.subledgerOpenOre,125000);
  assert.equal(r.ledger1510Ore,125000);
  assert.equal(r.differenceOre,0);
  assert.equal(r.missingSourceEntries.length,0);
  assert.equal(r.sourceMismatches.length,0);
}finally{db.close()}});

test('kundreskontrakontrollen flaggar betalning som minskat restbelopp utan motsvarande 1510-bokföring',()=>{const {db,company}=seed();try{
  const invoice=db.prepare("SELECT id FROM invoices WHERE company_id=? AND invoice_number='1001'").get(company.id);
  db.prepare('UPDATE invoices SET remaining_ore=? WHERE company_id=? AND id=?').run(25000,company.id,invoice.id);
  Db.addInvoiceTransaction(db,{companyId:company.id,invoiceId:invoice.id,transactionType:'payment',paymentDate:'2026-09-20',postingDate:'2026-09-20',amountOre:-100000,account:'1930',bankReference:'PAY-1001'});
  const r=Reports.receivablesControl(db,company.id);
  assert.equal(r.integrityOk,false);
  assert.equal(r.subledgerOpenOre,25000);
  assert.equal(r.ledger1510Ore,125000);
  assert.equal(r.differenceOre,100000);
  assert.match(r.warning,/måste utredas/i);
}finally{db.close()}});

test('kundreskontrakontrollen blir grön när betalningen även är bokförd mot 1510',()=>{const {db,company,user}=seed();try{
  const invoice=db.prepare("SELECT id FROM invoices WHERE company_id=? AND invoice_number='1001'").get(company.id);
  db.prepare('UPDATE invoices SET remaining_ore=? WHERE company_id=? AND id=?').run(25000,company.id,invoice.id);
  Db.addInvoiceTransaction(db,{companyId:company.id,invoiceId:invoice.id,transactionType:'payment',paymentDate:'2026-09-20',postingDate:'2026-09-20',amountOre:-100000,account:'1930',bankReference:'PAY-1001'});
  Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-20',description:'Kundinbetalning 1001',sourceType:'customer-payment',sourceId:'PAY-1001',createdBy:user.id,series:'A',lines:[{account:'1930',debitOre:100000,creditOre:0},{account:'1510',debitOre:0,creditOre:100000}]});
  const r=Reports.receivablesControl(db,company.id);
  assert.equal(r.integrityOk,true);
  assert.equal(r.subledgerOpenOre,25000);
  assert.equal(r.ledger1510Ore,25000);
  assert.equal(r.differenceOre,0);
}finally{db.close()}});

test('leverantörsreskontran stämmer mot konto 2440 för bokförda fakturor',()=>{const {db,company}=seed();try{
  const r=Reports.payablesControl(db,company.id);
  assert.equal(r.integrityOk,true);
  assert.equal(r.subledgerOpenOre,62500);
  assert.equal(r.ledger2440Ore,62500);
  assert.equal(r.differenceOre,0);
  assert.equal(r.sourceMismatches.length,0);
}finally{db.close()}});

test('leverantörskontrollen flaggar minskat öppet saldo utan motsvarande 2440-bokföring',()=>{const {db,company}=seed();try{
  db.prepare("UPDATE supplier_invoices SET open_amount_ore=0,status='paid' WHERE company_id=? AND supplier_invoice_number='S-1'").run(company.id);
  const r=Reports.payablesControl(db,company.id);
  assert.equal(r.integrityOk,false);
  assert.equal(r.subledgerOpenOre,0);
  assert.equal(r.ledger2440Ore,62500);
  assert.equal(r.differenceOre,62500);
  assert.match(r.warning,/måste utredas/i);
}finally{db.close()}});

test('leverantörskontrollen blir grön när betalningen även bokförts mot 2440',()=>{const {db,company,user}=seed();try{
  const invoice=db.prepare("SELECT id FROM supplier_invoices WHERE company_id=? AND supplier_invoice_number='S-1'").get(company.id);
  db.prepare("UPDATE supplier_invoices SET open_amount_ore=0,status='paid' WHERE company_id=? AND id=?").run(company.id,invoice.id);
  Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-20',description:'Betalning leverantörsfaktura S-1',sourceType:'supplier-payment',sourceId:'SPAY-S-1',createdBy:user.id,series:'A',lines:[{account:'2440',debitOre:62500,creditOre:0},{account:'1930',debitOre:0,creditOre:62500}]});
  const r=Reports.payablesControl(db,company.id);
  assert.equal(r.integrityOk,true);
  assert.equal(r.subledgerOpenOre,0);
  assert.equal(r.ledger2440Ore,0);
  assert.equal(r.differenceOre,0);
}finally{db.close()}});

test('ej bokförda leverantörsfakturor redovisas separat från 2440-avstämningen',()=>{const {db,company,user}=seed();try{
  const supplier=Payables.listSuppliers(db,company.id)[0];
  Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'S-2',invoiceDate:'2026-09-15',dueDate:'2026-10-15',totalOre:10000,vatOre:2000,registeredBy:user.id});
  const r=Reports.payablesControl(db,company.id);
  assert.equal(r.integrityOk,true);
  assert.equal(r.unpostedInvoices.length,1);
  assert.equal(r.unpostedInvoices[0].invoiceNumber,'S-2');
  assert.equal(r.subledgerOpenOre,62500);
  assert.equal(r.ledger2440Ore,62500);
}finally{db.close()}});

test('felaktiga perioder och konton stoppas',()=>{const {db,company}=seed();try{assert.throws(()=>Reports.vatControl(db,company.id,{period:'2026-13'}),e=>e.code==='INVALID_PERIOD');assert.throws(()=>Reports.generalLedger(db,company.id,{from:'2026-09-01',to:'2026-09-30',account:'26A1'}),e=>e.code==='INVALID_ACCOUNT');assert.throws(()=>Reports.trialBalance(db,company.id,{from:'2026-10-01',to:'2026-09-01'}),e=>e.code==='INVALID_REPORT_RANGE');}finally{db.close()}});
