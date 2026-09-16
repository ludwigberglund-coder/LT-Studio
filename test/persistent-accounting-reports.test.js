'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Accounting=require('../apps/api/accounting-store.js');
const Reports=require('../apps/api/accounting-reports.js');

function seed(){
  const db=Db.openDatabase(':memory:');Accounting.initializeAccountingStore(db);
  const company=Db.createCompany(db,{legalName:'Rapportbolag AB',displayName:'Rapportbolag',orgNumber:'559900-4040'});
  const user=Db.createUser(db,{username:'rapport',displayName:'Rapporttest',passwordHash:Auth.hashPassword('Sakert rapporttest 2026!')});
  Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-01',description:'Kundfaktura 1001',sourceType:'customer-invoice',sourceId:'ci-1',createdBy:user.id,lines:[{account:'1510',debitOre:125000,creditOre:0,text:'Kundfordran'},{account:'3010',debitOre:0,creditOre:100000,text:'Försäljning'},{account:'2611',debitOre:0,creditOre:25000,text:'Utgående moms'}]});
  Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-10',description:'Leverantörsfaktura L1',sourceType:'supplier-invoice',sourceId:'si-1',createdBy:user.id,lines:[{account:'4010',debitOre:80000,creditOre:0,text:'Varuinköp'},{account:'2641',debitOre:20000,creditOre:0,text:'Ingående moms'},{account:'2440',debitOre:0,creditOre:100000,text:'Leverantörsskuld'}]});
  return{db,company,user};
}

test('persistent saldobalans summerar varje konto exakt i ören',()=>{const {db,company}=seed();try{const report=Reports.trialBalance(Reports.rows(db,company.id));const by=Object.fromEntries(report.map(row=>[row.account,row]));assert.equal(by['1510'].debitOre,125000);assert.equal(by['3010'].creditOre,100000);assert.equal(report.reduce((s,r)=>s+r.debitOre,0),225000);assert.equal(report.reduce((s,r)=>s+r.creditOre,0),225000);}finally{db.close()}});
test('persistent resultatöversikt skiljer intäkter och kostnader utan flyttal',()=>{const {db,company}=seed();try{const report=Reports.incomeStatement(Reports.rows(db,company.id));assert.equal(report.revenueOre,100000);assert.equal(report.costOre,80000);assert.equal(report.resultOre,20000);assert.deepEqual(report.accounts.map(a=>a.account),['3010','4010']);}finally{db.close()}});
test('persistent balansöversikt visar tillgångar och skulder samt resultatdifferens',()=>{const {db,company}=seed();try{const report=Reports.balanceSheet(Reports.rows(db,company.id));assert.equal(report.assetsOre,125000);assert.equal(report.equityLiabilitiesOre,105000);assert.equal(report.differenceOre,20000);}finally{db.close()}});
test('persistent momsöversikt skiljer utgående och ingående moms',()=>{const {db,company}=seed();try{const report=Reports.vatSummary(Reports.rows(db,company.id));assert.equal(report.outputVatOre,25000);assert.equal(report.inputVatOre,20000);assert.equal(report.netVatPayableOre,5000);assert.deepEqual(report.accounts.map(a=>a.account),['2611','2641']);}finally{db.close()}});
test('persistent rapportdatum filtrerar verifikationer och rader',()=>{const {db,company}=seed();try{const rows=Reports.rows(db,company.id,{from:'2026-09-05',to:'2026-09-30'});assert.equal(new Set(rows.map(r=>r.entryId)).size,1);assert.ok(rows.every(r=>r.sourceType==='supplier-invoice'));const entries=Reports.entries(db,company.id,{from:'2026-09-01',to:'2026-09-30'});assert.equal(entries.length,2);assert.ok(entries.every(entry=>entry.lines.length>=2));assert.throws(()=>Reports.rows(db,company.id,{from:'2026-10-01',to:'2026-09-01'}),e=>e.code==='INVALID_REPORT_RANGE');}finally{db.close()}});
test('persistent rapportdata är strikt isolerad per företag',()=>{const {db,company,user}=seed();try{const other=Db.createCompany(db,{legalName:'Annat AB',displayName:'Annat',orgNumber:'559900-4041'});Accounting.postEntry(db,{companyId:other.id,postingDate:'2026-09-01',description:'Annan post',sourceType:'manual',sourceId:'other-1',createdBy:user.id,lines:[{account:'1930',debitOre:5000,creditOre:0},{account:'2890',debitOre:0,creditOre:5000}]});assert.equal(Reports.entries(db,company.id).length,2);assert.equal(Reports.entries(db,other.id).length,1);}finally{db.close()}});
