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


test('Supabase oplacerade betalningar går genom JWT-verifierad Edge Function och server-only RPC',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const root=path.resolve(__dirname,'..');
  const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
  const portal=read('apps/portal/unplaced-payments.js');
  const bridge=read('supabase/migrations/20261007165000_unplaced_payment_edge_bridge.sql');
  const edge=read('supabase/functions/resolve-unplaced-payment/index.ts');
  const config=read('supabase/config.toml');

  assert.match(portal,/functions\.invoke\('resolve-unplaced-payment'/);
  assert.doesNotMatch(portal,/LTSupabase\.rpc\('resolve_unplaced_bank_payment'/);
  assert.match(bridge,/create or replace function public\.resolve_unplaced_bank_payment_server/);
  assert.match(bridge,/join auth\.sessions s/);
  assert.match(bridge,/u\.disabled=false/);
  assert.match(bridge,/m\.role in \('admin','accountant'\)/);
  assert.match(bridge,/set_config\('request\.jwt\.claim\.sub'/);
  assert.match(bridge,/revoke all on function public\.resolve_unplaced_bank_payment_server[\s\S]*from public,anon,authenticated/);
  assert.match(bridge,/grant execute on function public\.resolve_unplaced_bank_payment_server[\s\S]*to service_role/);
  assert.match(bridge,/revoke execute on function public\.resolve_unplaced_bank_payment\(text,text,text,text,text,text\)[\s\S]*from authenticated/);
  assert.match(edge,/auth\.getUser\(token\)/);
  assert.match(edge,/claims\.aal!=="aal2"/);
  assert.match(edge,/claims\.session_id/);
  assert.match(edge,/admin\.rpc\("resolve_unplaced_bank_payment_server"/);
  assert.match(config,/\[functions\.resolve-unplaced-payment\][\s\S]*verify_jwt = true/);
});
