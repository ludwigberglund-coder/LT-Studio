'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Bank=require('../apps/api/bank-payments.js');
const Accounting=require('../apps/api/accounting-store.js');
const Unplaced=require('../apps/api/unplaced-payments.js');

function seed(){
  const db=Db.openDatabase(':memory:');
  const company=Db.createCompany(db,{legalName:'Oplacerat AB',displayName:'Oplacerat',orgNumber:'559990-7001'});
  const otherCompany=Db.createCompany(db,{legalName:'Annat AB',displayName:'Annat',orgNumber:'559990-7002'});
  const user=Db.createUser(db,{username:'unplaced.user',displayName:'Unplaced User',passwordHash:Auth.hashPassword('Sakert testlosenord 2026!')});
  Db.addMembership(db,{companyId:company.id,userId:user.id,role:'accountant'});
  Unplaced.initializeUnplacedPayments(db);
  return{db,company,otherCompany,user};
}

test('o­placerad inbetalning kan bokföras som annan inbetalning med revisionsspår och retry-säkerhet',()=>{
  const {db,company,user}=seed();
  try{
    const payment=Bank.create(db,{companyId:company.id,externalId:'BANK-UNPLACED-1',bookingDate:'2026-10-07',amountOre:125000,reference:'Okänd insättning',createdBy:user.id}).payment;
    const first=Unplaced.resolveOther(db,{companyId:company.id,paymentId:payment.id,resolutionType:'other-income',counterAccount:'3990',description:'Övrig ersättning',requestId:'unplaced-request-0001',actorId:user.id});
    assert.equal(first.duplicate,false);
    assert.equal(first.payment.status,'posted');
    assert.deepEqual(first.entry.lines.map(line=>[line.account,line.debitOre,line.creditOre]),[['1930',125000,0],['3990',0,125000]]);
    assert.equal(first.entry.sourceType,'unplaced-bank-payment');
    assert.equal(Db.auditForCompany(db,company.id).filter(e=>e.action==='UNPLACED_BANK_PAYMENT_RESOLVED').length,1);

    const retry=Unplaced.resolveOther(db,{companyId:company.id,paymentId:payment.id,resolutionType:'other-income',counterAccount:'3990',description:'Övrig ersättning',requestId:'unplaced-request-0001',actorId:user.id});
    assert.equal(retry.duplicate,true);
    assert.equal(retry.entry.id,first.entry.id);
    assert.equal(Accounting.listEntries(db,company.id).filter(e=>e.sourceType==='unplaced-bank-payment').length,1);
  }finally{db.close()}
});

test('utbetalning bokförs med bank i kredit och kan inte hanteras från annat företag',()=>{
  const {db,company,otherCompany,user}=seed();
  try{
    const payment=Bank.create(db,{companyId:company.id,externalId:'BANK-UNPLACED-2',bookingDate:'2026-10-07',amountOre:45000,message:'Bankavgift',createdBy:user.id}).payment;
    assert.throws(()=>Unplaced.resolveOther(db,{companyId:otherCompany.id,paymentId:payment.id,resolutionType:'outgoing',counterAccount:'6570',description:'Bankkostnad',requestId:'unplaced-request-0002',actorId:user.id}),e=>e.code==='BANK_PAYMENT_NOT_FOUND');
    const result=Unplaced.resolveOther(db,{companyId:company.id,paymentId:payment.id,resolutionType:'outgoing',counterAccount:'6570',description:'Bankkostnad',requestId:'unplaced-request-0003',actorId:user.id});
    assert.deepEqual(result.entry.lines.map(line=>[line.account,line.debitOre,line.creditOre]),[['6570',45000,0],['1930',0,45000]]);
    assert.equal(Bank.byId(db,otherCompany.id,payment.id),null);
  }finally{db.close()}
});

test('reskontrakonton och redan placerade bankhändelser är spärrade',()=>{
  const {db,company,user}=seed();
  try{
    const payment=Bank.create(db,{companyId:company.id,externalId:'BANK-UNPLACED-3',bookingDate:'2026-10-07',amountOre:10000,createdBy:user.id}).payment;
    for(const account of ['1510','1930','2440']){
      assert.throws(()=>Unplaced.resolveOther(db,{companyId:company.id,paymentId:payment.id,resolutionType:'other-income',counterAccount:account,description:'Fel konto',requestId:`blocked-${account}-001`,actorId:user.id}),e=>e.code==='SUBLEDGER_ACCOUNT_BLOCKED');
    }
    Bank.setStatus(db,company.id,payment.id,'proposal-created');
    assert.throws(()=>Unplaced.resolveOther(db,{companyId:company.id,paymentId:payment.id,resolutionType:'other-income',counterAccount:'3990',description:'För sent',requestId:'unplaced-request-0004',actorId:user.id}),e=>e.code==='INVALID_BANK_PAYMENT_STATUS');
  }finally{db.close()}
});
