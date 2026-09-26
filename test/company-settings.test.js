'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Settings=require('../apps/api/company-invoice-settings.js');
const CustomerInvoicing=require('../apps/api/customer-invoicing.js');

test('företagsinställningar blir fakturans säljaruppgifter',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const company=Db.createCompany(db,{legalName:'Synthetic Invoice AB',displayName:'Synthetic Invoice',orgNumber:'000000-0000'});
    const user=Db.createUser(db,{
      username:'settings-admin',
      displayName:'Settings Admin',
      passwordHash:Auth.hashPassword('Settings-Test-2026!'),
      mfaSecretEncrypted:null
    });
    Db.addMembership(db,{companyId:company.id,userId:user.id});
    CustomerInvoicing.initializeCustomerInvoicing(db);
    const customer=Db.createCustomer(db,{
      companyId:company.id,
      customerNumber:'K-1001',
      name:'Fiktiv Kund AB',
      orgNumber:'111111-1111',
      email:'kund@example.invalid',
      address:{full:'Testgatan 1, 411 00 Göteborg'},
      customerType:'business',
      reminderFeeAgreed:false
    });

    const saved=Settings.setCompanySettings(db,{
      companyId:company.id,
      address:'Testvägen 10, 411 00 Göteborg',
      email:'ekonomi@example.invalid',
      phone:'+46 31 000 00 00',
      website:'https://example.invalid/',
      vatNumber:'SE000000000001',
      bankgiro:'1234-5678',
      taxStatus:'Godkänd för F-skatt',
      updatedBy:user.id
    });

    assert.equal(saved.bankgiro,'1234-5678');
    assert.equal(saved.vatNumber,'SE000000000001');
    assert.equal(saved.address,'Testvägen 10, 411 00 Göteborg');

    const publicProfile={
      legalName:'Fel gammalt namn',
      orgNumber:'999999-9999',
      vatNumber:'SE999999999901',
      address:{full:'Gammal adress'},
      contact:{email:'old@example.invalid',phone:'000'},
      website:'https://old.example.invalid/',
      invoice:{bankgiro:'9999-9999',taxStatus:'Fel status'}
    };
    const resolved=CustomerInvoicing.resolvedProfile(db,company.id,publicProfile);
    assert.equal(resolved.configured,true);
    assert.equal(resolved.profile.legalName,'Synthetic Invoice AB');
    assert.equal(resolved.profile.orgNumber,'000000-0000');
    assert.equal(resolved.profile.vatNumber,'SE000000000001');
    assert.equal(resolved.profile.address.full,'Testvägen 10, 411 00 Göteborg');
    assert.equal(resolved.profile.contact.email,'ekonomi@example.invalid');
    assert.equal(resolved.profile.contact.phone,'+46 31 000 00 00');
    assert.equal(resolved.profile.website,'https://example.invalid/');
    assert.equal(resolved.profile.invoice.bankgiro,'1234-5678');
    assert.equal(resolved.profile.invoice.taxStatus,'Godkänd för F-skatt');

    const prepared=CustomerInvoicing.prepareInvoiceIssuance(db,{
      companyId:company.id,
      userId:user.id,
      profile:publicProfile,
      payload:{
        requestId:'company-settings-invoice-0001',
        customerNumber:customer.customerNumber,
        invoiceDate:'2026-09-22',
        postingDate:'2026-09-22',
        dueDate:'2026-10-22',
        paymentTermsDays:30,
        ourReference:'UAT',
        yourReference:'Test',
        notes:'Fiktiv UAT',
        lines:[{
          description:'Fiktiv konsulttjänst',
          quantity:'1',
          unit:'st',
          unitPrice:'1000',
          vatTreatment:'se-standard-25',
          vatRate:25,
          revenueAccount:'3041'
        }]
      }
    });

    assert.equal(prepared.document.seller.name,'Synthetic Invoice AB');
    assert.equal(prepared.document.seller.orgNumber,'000000-0000');
    assert.equal(prepared.document.seller.address,'Testvägen 10, 411 00 Göteborg');
    assert.equal(prepared.document.seller.vatNumber,'SE000000000001');
    assert.equal(prepared.document.seller.bankgiro,'1234-5678');
    assert.equal(prepared.document.seller.taxStatus,'Godkänd för F-skatt');
    assert.equal(prepared.paymentAccount,'1234-5678');
  }finally{
    db.close();
  }
});


test('företagsinställningar använder Supabase UAT på GitHub Pages',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const root=path.resolve(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'apps','portal','company-settings.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'apps','portal','company-settings.js'),'utf8');
  assert.match(html,/supabase-config\.js/);
  assert.match(html,/supabase-client\.js/);
  assert.match(html,/supabase-session\.js/);
  assert.match(js,/const isSupabase=location\.hostname==='ludwigberglund-coder\.github\.io'&&!isDemo/);
  assert.match(js,/LTSupabaseUat\.context/);
  assert.match(js,/LTSupabase\.from\('company_invoice_settings'/);
  assert.match(js,/ctx\.membership\?\.role==='admin'/);
  assert.doesNotMatch(js,/location\.hostname\.endsWith\('\.github\.io'\)/);
});
