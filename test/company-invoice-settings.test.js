'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Settings=require('../apps/api/company-invoice-settings.js');

test('privata fakturainställningar ersätter publika demovärden utan att lagras i repo-konfiguration',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const company=Db.createCompany(db,{legalName:'Test AB',displayName:'Test',orgNumber:'559100-0001'});
    const user=Db.createUser(db,{username:'admin',displayName:'Admin',passwordHash:'test-hash'});
    const before=Settings.privateProfile(db,company.id,{vatNumber:'EJ ANGIVET',invoice:{bankgiro:'DEMO-EJ-BETALNING',taxStatus:'Demo – verifiera'}});
    assert.equal(before.configured,false);
    assert.equal(before.profile.invoice.bankgiro,'');
    assert.equal(before.profile.invoice.taxStatus,'');
    const saved=Settings.setInvoiceSettings(db,{companyId:company.id,bankgiro:'BG 123 4567',taxStatus:'Godkänd för F-skatt',vatNumber:'SE559100000101',updatedBy:user.id});
    assert.equal(saved.bankgiro,'123-4567');
    assert.equal(saved.vatNumber,'SE559100000101');
    const after=Settings.privateProfile(db,company.id,{vatNumber:'EJ ANGIVET',invoice:{bankgiro:'DEMO-EJ-BETALNING',taxStatus:'Demo – verifiera'}});
    assert.equal(after.configured,true);
    assert.equal(after.profile.invoice.bankgiro,'123-4567');
    assert.equal(after.profile.invoice.taxStatus,'Godkänd för F-skatt');
    assert.equal(after.profile.vatNumber,'SE559100000101');
  }finally{db.close();}
});

test('demo-, test- och ogiltiga betalningsuppgifter stoppas före lagring',()=>{
  assert.throws(()=>Settings.normalizeBankgiro('DEMO-EJ-BETALNING'),error=>error.code==='INVALID_BANKGIRO');
  assert.throws(()=>Settings.normalizeBankgiro('123'),error=>error.code==='INVALID_BANKGIRO');
  assert.throws(()=>Settings.normalizeTaxStatus('Demo – verifiera'),error=>error.code==='INVALID_TAX_STATUS');
  assert.throws(()=>Settings.normalizeVatNumber('EJ ANGIVET'),error=>error.code==='INVALID_VAT_NUMBER');
});

test('VAT-numret måste motsvara företagets organisationsnummer',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const company=Db.createCompany(db,{legalName:'Test AB',displayName:'Test',orgNumber:'559100-0001'});
    const user=Db.createUser(db,{username:'vat.admin',displayName:'VAT Admin',passwordHash:'test-hash'});
    assert.equal(Settings.expectedVatNumberForOrgNumber(company.orgNumber),'SE559100000101');
    assert.equal(Settings.vatNumberMatchesOrgNumber('SE559100000101',company.orgNumber),true);
    assert.equal(Settings.vatNumberMatchesOrgNumber('SE559100000201',company.orgNumber),false);
    assert.throws(
      ()=>Settings.setInvoiceSettings(db,{companyId:company.id,bankgiro:'123-4567',taxStatus:'Godkänd för F-skatt',vatNumber:'SE559100000201',updatedBy:user.id}),
      error=>error.code==='VAT_NUMBER_COMPANY_MISMATCH'
    );
    assert.equal(Settings.getInvoiceSettings(db,company.id),null);
  }finally{db.close()}
});
