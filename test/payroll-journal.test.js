'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Payroll=require('../apps/api/payroll.js');
const Accounting=require('../apps/api/accounting-store.js');

function seed(){
  const db=Db.openDatabase(':memory:');Payroll.initializePayroll(db);
  const company=Db.createCompany(db,{legalName:'Lönebolaget AB',displayName:'Lönebolaget',orgNumber:'559900-6060'});
  const user=Db.createUser(db,{username:'payroll',displayName:'Löneadmin',passwordHash:Auth.hashPassword('Sakert lonetest 2026!')});
  return{db,company,user};
}
function input(companyId,userId){return{
  companyId,period:'2026-09',payDate:'2026-09-25',sourceName:'Extern lön september',
  grossSalaryOre:3000000,withheldTaxOre:900000,employerContributionsOre:942600,netPayOre:2100000,vacationLiabilityChangeOre:240000,
  importedBy:userId,
  lines:[
    {account:'7010',text:'Bruttolön',debitOre:3000000,creditOre:0},
    {account:'7510',text:'Arbetsgivaravgifter',debitOre:942600,creditOre:0},
    {account:'2920',text:'Semesterlöneskuld förändring',debitOre:240000,creditOre:0},
    {account:'2710',text:'Personalskatt',debitOre:0,creditOre:900000},
    {account:'2731',text:'Arbetsgivaravgifter skuld',debitOre:0,creditOre:942600},
    {account:'2910',text:'Upplupna löner',debitOre:0,creditOre:2100000},
    {account:'2920',text:'Semesterlöneskuld',debitOre:0,creditOre:240000}
  ]
}}

test('balanserad aggregerad lönejournal importeras utan personuppgifter',()=>{const {db,company,user}=seed();try{const run=Payroll.importRun(db,input(company.id,user.id));assert.equal(run.status,'validated');assert.equal(run.period,'2026-09');assert.equal(run.grossSalaryOre,3000000);assert.match(run.journalSha256,/^[a-f0-9]{64}$/);assert.equal(run.lines.length,7);assert.equal(JSON.stringify(run).includes('personnummer'),false);}finally{db.close()}});

test('obalanserad lönejournal stoppas',()=>{const {db,company,user}=seed();try{const data=input(company.id,user.id);data.lines[0].debitOre-=100;assert.throws(()=>Payroll.importRun(db,data),e=>e.code==='UNBALANCED_PAYROLL_JOURNAL');}finally{db.close()}});

test('samma lönejournal kan inte importeras två gånger',()=>{const {db,company,user}=seed();try{const data=input(company.id,user.id);Payroll.importRun(db,data);assert.throws(()=>Payroll.importRun(db,data),e=>e.code==='DUPLICATE_PAYROLL_RUN');}finally{db.close()}});

test('ogiltiga sammanfattningsbelopp stoppas',()=>{const {db,company,user}=seed();try{const data=input(company.id,user.id);data.withheldTaxOre=data.grossSalaryOre+1;assert.throws(()=>Payroll.importRun(db,data),e=>e.code==='INVALID_PAYROLL_SUMMARY');}finally{db.close()}});

test('validerad lönejournal bokförs i L-serie',()=>{const {db,company,user}=seed();try{const run=Payroll.importRun(db,input(company.id,user.id));const result=Db.transaction(db,()=>Payroll.postRun(db,{companyId:company.id,runId:run.id,postedBy:user.id}));assert.equal(result.run.status,'posted');assert.equal(result.entry.number,'L1');assert.equal(result.entry.sourceType,'payroll-run');assert.equal(result.entry.sourceId,run.id);assert.equal(result.entry.lines.reduce((s,l)=>s+l.debitOre,0),result.entry.lines.reduce((s,l)=>s+l.creditOre,0));}finally{db.close()}});

test('låst bokföringsperiod stoppar lönejournal och lämnar den validerad',()=>{const {db,company,user}=seed();try{const run=Payroll.importRun(db,input(company.id,user.id));db.prepare(`INSERT INTO accounting_periods(company_id,period,status) VALUES(?,?,'locked')`).run(company.id,'2026-09');assert.throws(()=>Db.transaction(db,()=>Payroll.postRun(db,{companyId:company.id,runId:run.id,postedBy:user.id})),e=>e.code==='PERIOD_LOCKED');assert.equal(Payroll.runById(db,company.id,run.id).status,'validated');assert.equal(Accounting.entryBySource(db,company.id,'payroll-run',run.id),null);}finally{db.close()}});

test('lönekörningar är isolerade per företag',()=>{const {db,company,user}=seed();try{const run=Payroll.importRun(db,input(company.id,user.id));const other=Db.createCompany(db,{legalName:'Annat AB',displayName:'Annat',orgNumber:'559900-7070'});assert.equal(Payroll.runById(db,other.id,run.id),null);assert.equal(Payroll.listRuns(db,other.id).length,0);}finally{db.close()}});
