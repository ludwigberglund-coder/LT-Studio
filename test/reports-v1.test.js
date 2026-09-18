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
  Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-05',description:'Kundfaktura 1001',sourceType:'customer-invoice',sourceId:customerInvoice.id,createdBy:user.id,series:'A',lines:[{account:'1510',debitOre:125000,creditOre:0},{account:'3010',debitOre:0,creditOre:100000},{account:'2611',debitOre:0,creditOre:25000}],vatEvidence:[{evidenceType:'output-domestic',vatCode:'OUTPUT_DOMESTIC_25',vatRateBasisPoints:2500,taxableBaseOre:100000,vatOre:25000,vatAccount:'2611',declarationBaseBox:'05',declarationVatBox:'10'}]});
  Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-08',description:'Leverantörsfaktura S-1',sourceType:'supplier-invoice',sourceId:supplierInvoice.id,createdBy:user.id,series:'A',lines:[{account:'4010',debitOre:50000,creditOre:0},{account:'2641',debitOre:12500,creditOre:0},{account:'2440',debitOre:0,creditOre:62500}],vatEvidence:[{evidenceType:'input-domestic',vatCode:'INPUT_DOMESTIC',vatRateBasisPoints:null,taxableBaseOre:50000,vatOre:12500,vatAccount:'2641',declarationBaseBox:null,declarationVatBox:'48'}]});
  return{db,company,user};
}

test('trial balance visar ingående saldo, periodens debet/kredit och utgående saldo',()=>{const {db,company}=seed();try{const r=Reports.trialBalance(db,company.id,{from:'2026-09-01',to:'2026-09-30'});const bank=r.rows.find(x=>x.account==='1930');const receivable=r.rows.find(x=>x.account==='1510');assert.equal(bank.openingOre,100000);assert.equal(bank.debitOre,0);assert.equal(bank.closingOre,100000);assert.equal(receivable.debitOre,125000);assert.equal(r.totals.debitOre,r.totals.creditOre);}finally{db.close()}});

test('huvudbok kan filtreras på konto',()=>{const {db,company}=seed();try{const r=Reports.generalLedger(db,company.id,{from:'2026-09-01',to:'2026-09-30',account:'2611'});assert.equal(r.rows.length,1);assert.equal(r.rows[0].creditOre,25000);assert.equal(r.rows[0].number,'A2');}finally{db.close()}});

test('resultatrapport summerar konton 3000-8999',()=>{const {db,company}=seed();try{const r=Reports.profitLoss(db,company.id,{from:'2026-09-01',to:'2026-09-30'});assert.equal(r.rows.find(x=>x.account==='3010').amountOre,100000);assert.equal(r.rows.find(x=>x.account==='4010').amountOre,-50000);assert.equal(r.resultOre,50000);}finally{db.close()}});

test('momsavstämning bygger på bokförda momsbevis och stämmer mot momskonton',()=>{const {db,company}=seed();try{const r=Reports.vatControl(db,company.id,{period:'2026-09'});assert.equal(r.outputVatOre,25000);assert.equal(r.inputVatOre,12500);assert.equal(r.netVatOre,12500);assert.equal(r.customerInvoiceCount,1);assert.equal(r.supplierInvoiceCount,1);assert.equal(r.ledgerReconciled,true);assert.equal(r.declarationBoxes['05'],100000);assert.equal(r.declarationBoxes['10'],25000);assert.equal(r.declarationBoxes['48'],12500);assert.equal(r.declarationReady,false);assert.match(r.warning,/bokförda momskonton/i);}finally{db.close()}});

test('felaktiga perioder och konton stoppas',()=>{const {db,company}=seed();try{assert.throws(()=>Reports.vatControl(db,company.id,{period:'2026-13'}),e=>e.code==='INVALID_PERIOD');assert.throws(()=>Reports.generalLedger(db,company.id,{from:'2026-09-01',to:'2026-09-30',account:'26A1'}),e=>e.code==='INVALID_ACCOUNT');assert.throws(()=>Reports.trialBalance(db,company.id,{from:'2026-10-01',to:'2026-09-01'}),e=>e.code==='INVALID_REPORT_RANGE');}finally{db.close()}});
