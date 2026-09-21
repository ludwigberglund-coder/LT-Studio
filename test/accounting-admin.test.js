'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Accounting=require('../apps/api/accounting-store.js');
const Admin=require('../apps/api/accounting-admin.js');
const AccountingSettings=require('../apps/api/accounting-settings.js');

function seed(){
  const db=Db.openDatabase(':memory:');
  Admin.initializeAccountingAdmin(db);
  const company=Db.createCompany(db,{legalName:'Bokföringstest AB',displayName:'Bokföringstest',orgNumber:'559900-4040'});
  const company2=Db.createCompany(db,{legalName:'Annat Bokföringstest AB',displayName:'Annat företag',orgNumber:'559900-4041'});
  const maker=Db.createUser(db,{username:'maker',displayName:'Ekonom Ett',passwordHash:Auth.hashPassword('Bokforing testlosenord 2026!')});
  const controller=Db.createUser(db,{username:'controller2',displayName:'Kontrollant Två',passwordHash:Auth.hashPassword('Kontroll testlosenord 2026!')});
  return{db,company,company2,maker,controller};
}
function post(db,company,user,sourceId='original',date='2026-09-16'){
  return Accounting.postEntry(db,{companyId:company.id,postingDate:date,description:'Inköp test',sourceType:'manual',sourceId,createdBy:user.id,series:'A',lines:[{account:'5460',text:'Förbrukning',debitOre:12500,creditOre:0},{account:'1930',text:'Bank',debitOre:0,creditOre:12500}]}).entry;
}

test('period kan låsas och bokföring stoppas',()=>{
  const {db,company,maker}=seed();
  try{
    const period=Admin.lockPeriod(db,{companyId:company.id,period:'2026-09',lockedBy:maker.id});
    assert.equal(period.status,'locked');
    assert.throws(()=>post(db,company,maker,'blocked'),e=>e.code==='PERIOD_LOCKED');
  }finally{db.close()}
});

test('upplåsning kräver annan person och historiken tillåter en senare ny begäran',()=>{
  const {db,company,maker,controller}=seed();
  try{
    Admin.lockPeriod(db,{companyId:company.id,period:'2026-09',lockedBy:maker.id});
    const first=Admin.requestUnlock(db,{companyId:company.id,period:'2026-09',reason:'Behöver rätta periodens bokföring',requestedBy:maker.id});
    assert.throws(()=>Admin.requestUnlock(db,{companyId:company.id,period:'2026-09',reason:'Ytterligare begäran',requestedBy:maker.id}),e=>e.code==='UNLOCK_ALREADY_PENDING');
    assert.throws(()=>Admin.decideUnlock(db,{companyId:company.id,requestId:first.id,decidedBy:maker.id,decision:'approved'}),e=>e.code==='SEPARATION_OF_DUTIES_FAILED');
    const decided=Admin.decideUnlock(db,{companyId:company.id,requestId:first.id,decidedBy:controller.id,decision:'approved',decisionReason:'Kontrollerad rättelse behövs'});
    assert.equal(decided.period.status,'open');
    Admin.lockPeriod(db,{companyId:company.id,period:'2026-09',lockedBy:controller.id});
    const second=Admin.requestUnlock(db,{companyId:company.id,period:'2026-09',reason:'Ny separat rättelse vid senare kontroll',requestedBy:maker.id});
    assert.notEqual(second.id,first.id);
    assert.equal(Admin.listUnlockRequests(db,company.id,{status:'all'}).length,2);
  }finally{db.close()}
});

test('rättelse bevarar originalet och skapar motverifikation samt ersättningspost',()=>{
  const {db,company,maker}=seed();
  try{
    const original=post(db,company,maker);
    const result=Db.transaction(db,()=>Admin.correctEntry(db,{companyId:company.id,entryId:original.id,postingDate:'2026-09-17',reason:'Fel kostnadskonto',createdBy:maker.id,replacementLines:[{account:'5410',text:'Förbrukningsinventarier',debitOre:12500,creditOre:0},{account:'1930',text:'Bank',debitOre:0,creditOre:12500}]}));
    assert.equal(result.original.id,original.id);
    assert.notEqual(result.reversal.id,original.id);
    assert.ok(result.replacement);
    assert.equal(result.reversal.lines[0].creditOre,12500);
    assert.equal(result.reversal.lines[1].debitOre,12500);
    assert.equal(Admin.entryById(db,company.id,original.id).lines[0].account,'5460');
    assert.equal(Accounting.listEntries(db,company.id).length,3);
    assert.throws(()=>Db.transaction(db,()=>Admin.correctEntry(db,{companyId:company.id,entryId:original.id,postingDate:'2026-09-18',reason:'Försök att rätta igen',createdBy:maker.id})),e=>e.code==='ENTRY_ALREADY_CORRECTED');
  }finally{db.close()}
});

test('ogiltig ersättningspost rullas tillbaka atomärt',()=>{
  const {db,company,maker}=seed();
  try{
    const original=post(db,company,maker,'atomic');
    assert.throws(()=>Db.transaction(db,()=>Admin.correctEntry(db,{companyId:company.id,entryId:original.id,postingDate:'2026-09-17',reason:'Test av atomisk rättelse',createdBy:maker.id,replacementLines:[{account:'5410',debitOre:10000,creditOre:0},{account:'1930',debitOre:0,creditOre:9000}]})),e=>e.code==='UNBALANCED_ENTRY');
    assert.equal(Accounting.listEntries(db,company.id).length,1);
    assert.equal(Admin.correctionByOriginal(db,company.id,original.id),null);
  }finally{db.close()}
});

test('företagsisolering gäller för verifikationer och periodbegäran',()=>{
  const {db,company,company2,maker}=seed();
  try{
    const entry=post(db,company,maker,'tenant');
    assert.equal(Admin.entryById(db,company2.id,entry.id),null);
    Admin.lockPeriod(db,{companyId:company.id,period:'2026-09',lockedBy:maker.id});
    const request=Admin.requestUnlock(db,{companyId:company.id,period:'2026-09',reason:'Företagsspecifik begäran',requestedBy:maker.id});
    assert.equal(Admin.unlockRequestById(db,company2.id,request.id),null);
  }finally{db.close()}
});


test('periodupplåsning kan inte beslutas två gånger',()=>{
  const {db,company,maker,controller}=seed();
  try{
    Admin.lockPeriod(db,{companyId:company.id,period:'2026-10',lockedBy:maker.id});
    const request=Admin.requestUnlock(db,{companyId:company.id,period:'2026-10',reason:'Retry-test av periodbeslut',requestedBy:maker.id});
    const first=Admin.decideUnlock(db,{companyId:company.id,requestId:request.id,decidedBy:controller.id,decision:'approved',decisionReason:'Godkänd rättelse'});
    assert.equal(first.request.status,'approved');assert.equal(first.period.status,'open');
    assert.throws(()=>Admin.decideUnlock(db,{companyId:company.id,requestId:request.id,decidedBy:controller.id,decision:'approved',decisionReason:'Godkänd rättelse'}),e=>e.code==='UNLOCK_ALREADY_DECIDED'&&e.statusCode===409);
    assert.equal(Admin.listUnlockRequests(db,company.id,{status:'all'}).filter(x=>x.id===request.id).length,1);
    assert.equal(Admin.unlockRequestById(db,company.id,request.id).status,'approved');
    assert.equal(Admin.periodStatus(db,company.id,'2026-10').status,'open');
  }finally{db.close()}
});


test('ingående balans bokas en gång, är retry-säker och använder bara balanskonton',()=>{
  const {db,company,maker}=seed();
  try{
    const input={companyId:company.id,year:'2026',postingDate:'2026-01-01',createdBy:maker.id,lines:[
      {account:'1930',text:'Bank',debitOre:250000,creditOre:0},
      {account:'2091',text:'Balanserat eget kapital',debitOre:0,creditOre:250000}
    ]};
    const first=Admin.importOpeningBalance(db,input);
    const retry=Admin.importOpeningBalance(db,input);
    assert.equal(first.duplicate,false);
    assert.equal(retry.duplicate,true);
    assert.equal(retry.entry.id,first.entry.id);
    assert.equal(first.entry.series,'IB');
    assert.equal(first.entry.number,'IB1');
    assert.equal(first.entry.sourceType,'opening-balance');
    assert.equal(first.entry.sourceId,'2026');
    assert.equal(first.entry.postingDate,'2026-01-01');
    assert.equal(Admin.openingBalanceByYear(db,company.id,'2026').id,first.entry.id);
    assert.equal(Accounting.listEntries(db,company.id).length,1);
    assert.throws(()=>Admin.importOpeningBalance(db,{...input,lines:[
      {account:'1930',text:'Bank',debitOre:240000,creditOre:0},
      {account:'2091',text:'Balanserat eget kapital',debitOre:0,creditOre:240000}
    ]}),e=>e.code==='IDEMPOTENCY_CONFLICT'&&e.statusCode===409);
    assert.equal(Accounting.listEntries(db,company.id).length,1);
  }finally{db.close()}
});

test('ingående balans blockerar reskontrakonton, resultatkonton och fel datum',()=>{
  const {db,company,maker}=seed();
  try{
    const base={companyId:company.id,year:'2026',postingDate:'2026-01-01',createdBy:maker.id};
    for(const account of ['1510','2440']){
      assert.throws(()=>Admin.importOpeningBalance(db,{...base,lines:[
        {account,debitOre:10000,creditOre:0},
        {account:'2091',debitOre:0,creditOre:10000}
      ]}),e=>e.code==='OPENING_BALANCE_SUBLEDGER_REQUIRED'&&e.statusCode===409);
    }
    assert.throws(()=>Admin.importOpeningBalance(db,{...base,lines:[
      {account:'1930',debitOre:10000,creditOre:0},
      {account:'3010',debitOre:0,creditOre:10000}
    ]}),e=>e.code==='OPENING_BALANCE_ACCOUNT_NOT_ALLOWED'&&e.statusCode===409);
    assert.throws(()=>Admin.importOpeningBalance(db,{...base,postingDate:'2026-01-02',lines:[
      {account:'1930',debitOre:10000,creditOre:0},
      {account:'2091',debitOre:0,creditOre:10000}
    ]}),e=>e.code==='INVALID_OPENING_BALANCE_DATE'&&e.statusCode===409);
    assert.equal(Accounting.listEntries(db,company.id).length,0);
  }finally{db.close()}
});

test('ingående balans är företagsisolerad och kan inte rättas som fristående manuell verifikation',()=>{
  const {db,company,company2,maker}=seed();
  try{
    const imported=Admin.importOpeningBalance(db,{companyId:company.id,year:'2026',postingDate:'2026-01-01',createdBy:maker.id,lines:[
      {account:'1930',debitOre:50000,creditOre:0},
      {account:'2091',debitOre:0,creditOre:50000}
    ]});
    assert.equal(Admin.openingBalanceByYear(db,company2.id,'2026'),null);
    assert.equal(Admin.correctionPolicy(db,company.id,imported.entry.id).allowed,false);
    assert.throws(()=>Admin.correctEntry(db,{companyId:company.id,entryId:imported.entry.id,postingDate:'2026-01-02',reason:'Försök till fristående rättelse',createdBy:maker.id}),e=>e.code==='SOURCE_CORRECTION_REQUIRED'&&e.statusCode===409);
    assert.equal(Accounting.listEntries(db,company.id).length,1);
  }finally{db.close()}
});


test('första ingående balans måste importeras innan årets övriga verifikationer',()=>{
  const {db,company,maker}=seed();
  try{
    post(db,company,maker,'already-started','2026-01-02');
    assert.throws(()=>Admin.importOpeningBalance(db,{companyId:company.id,year:'2026',postingDate:'2026-01-01',createdBy:maker.id,lines:[
      {account:'1930',debitOre:10000,creditOre:0},
      {account:'2091',debitOre:0,creditOre:10000}
    ]}),e=>e.code==='OPENING_BALANCE_REQUIRES_EMPTY_YEAR'&&e.statusCode===409);
    assert.equal(Accounting.listEntries(db,company.id).length,1);
    assert.equal(Admin.openingBalanceByYear(db,company.id,'2026'),null);
  }finally{db.close()}
});


test('kundåterbetalningskonto kräver explicit verifierat skuldkonto och beslutsreferens',()=>{
  const {db,company,maker}=seed();
  try{
    assert.equal(AccountingSettings.getAccountingSettings(db,company.id),null);
    assert.throws(()=>AccountingSettings.setCustomerRefundLiabilityAccount(db,{companyId:company.id,account:'1510',decisionReference:'Beslut #254',updatedBy:maker.id}),e=>e.code==='INVALID_CUSTOMER_REFUND_LIABILITY_ACCOUNT');
    assert.throws(()=>AccountingSettings.setCustomerRefundLiabilityAccount(db,{companyId:company.id,account:'2440',decisionReference:'Beslut #254',updatedBy:maker.id}),e=>e.code==='PROTECTED_CUSTOMER_REFUND_LIABILITY_ACCOUNT');
    assert.throws(()=>AccountingSettings.setCustomerRefundLiabilityAccount(db,{companyId:company.id,account:'2890',decisionReference:'x',updatedBy:maker.id}),e=>e.code==='CUSTOMER_REFUND_DECISION_REFERENCE_REQUIRED');
    const saved=AccountingSettings.setCustomerRefundLiabilityAccount(db,{companyId:company.id,account:'2890',decisionReference:'Testbeslut för verifierad kundåterbetalningsskuld.',updatedBy:maker.id});
    assert.equal(saved.customerRefundLiabilityAccount,'2890');
    assert.equal(saved.customerRefundDecisionReference,'Testbeslut för verifierad kundåterbetalningsskuld.');
    assert.equal(saved.updatedBy,maker.id);
  }finally{db.close()}
});

test('kundåterbetalningskonto är strikt företagsisolerat',()=>{
  const {db,company,company2,maker}=seed();
  try{
    AccountingSettings.setCustomerRefundLiabilityAccount(db,{companyId:company.id,account:'2890',decisionReference:'Testbeslut för företag ett.',updatedBy:maker.id});
    assert.equal(AccountingSettings.getAccountingSettings(db,company.id).customerRefundLiabilityAccount,'2890');
    assert.equal(AccountingSettings.getAccountingSettings(db,company2.id),null);
  }finally{db.close()}
});
