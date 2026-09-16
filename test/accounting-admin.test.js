'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Accounting=require('../apps/api/accounting-store.js');
const Admin=require('../apps/api/accounting-admin.js');

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
  return Accounting.postEntry(db,{companyId:company.id,postingDate:date,description:'Inköp test',sourceType:'test',sourceId,createdBy:user.id,series:'A',lines:[{account:'5460',text:'Förbrukning',debitOre:12500,creditOre:0},{account:'1930',text:'Bank',debitOre:0,creditOre:12500}]}).entry;
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
