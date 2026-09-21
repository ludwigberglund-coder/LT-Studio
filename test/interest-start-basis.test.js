'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Db=require('../apps/api/database.js');
const Receivables=require('../packages/receivables/customer-receivables.js');
const {verifiedInterestStartEvidence}=require('../apps/api/app.js');

const legalRates=JSON.parse(fs.readFileSync(path.join(__dirname,'..','config','legal-rates.json'),'utf8'));

function issuedFixture(){
  const invoice={
    id:'invoice-1',
    invoiceNumber:'310001',
    invoiceDate:'2026-09-01',
    dueDate:'2026-10-01',
    totalOre:125000,
    remainingOre:125000,
    transactions:[]
  };
  const stored={
    createdAt:'2026-09-01T10:00:00.000Z',
    document:{
      invoiceNumber:'310001',
      invoiceDate:'2026-09-01',
      dueDate:'2026-10-01',
      paymentTermsDays:30
    }
  };
  return{invoice,stored};
}

test('oföränderligt utställningsunderlag kan bevisa i förväg bestämd förfallodag',()=>{
  const {invoice,stored}=issuedFixture();
  const evidence=verifiedInterestStartEvidence(invoice,stored);
  assert.deepEqual(evidence,{
    basis:'predetermined-due-date',
    evidenceSource:'issued-invoice-document',
    verifiedAt:'2026-09-01T10:00:00.000Z'
  });
});

test('räntegrunden blir overifierad vid avvikande datum, saknade villkor eller för sen arkivering',()=>{
  const {invoice,stored}=issuedFixture();
  assert.equal(verifiedInterestStartEvidence(invoice,{...stored,document:{...stored.document,dueDate:'2026-10-02'}}).basis,'unverified');
  assert.equal(verifiedInterestStartEvidence(invoice,{...stored,document:{...stored.document,paymentTermsDays:undefined}}).basis,'unverified');
  assert.equal(verifiedInterestStartEvidence(invoice,{...stored,createdAt:'2026-10-02T00:00:00.000Z'}).basis,'unverified');
  assert.equal(verifiedInterestStartEvidence({...invoice,totalOre:-125000},stored).basis,'unverified');
});

test('automatisk ränta använder bara verifierad startgrund och sparar den i påminnelsehistoriken',()=>{
  const {invoice,stored}=issuedFixture();
  const evidence=verifiedInterestStartEvidence(invoice,stored);
  const verifiedInvoice={
    ...invoice,
    interestStartBasis:evidence.basis,
    interestStartEvidenceSource:evidence.evidenceSource,
    interestStartVerifiedAt:evidence.verifiedAt
  };
  const preview=Receivables.reminderPreview(verifiedInvoice,{sentDate:'2026-10-20',includeInterest:true},legalRates);
  assert.ok(preview.interestOre>0);
  assert.equal(preview.interestStartBasis,'predetermined-due-date');

  const db=Db.openDatabase(':memory:');
  try{
    const company=Db.createCompany(db,{legalName:'Ränteprov AB',displayName:'Ränteprov',orgNumber:'559900-6500'});
    const user=Db.createUser(db,{username:'interest.test',displayName:'Interest Test',passwordHash:'test-hash'});
    Db.addMembership(db,{companyId:company.id,userId:user.id});
    const customer=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-1',name:'Kund AB',customerType:'business'});
    const savedInvoice=Db.createInvoice(db,{
      id:'invoice-1',
      companyId:company.id,
      customerId:customer.id,
      invoiceNumber:'310001',
      invoiceDate:'2026-09-01',
      postingDate:'2026-09-01',
      dueDate:'2026-10-01',
      totalOre:125000,
      remainingOre:125000,
      vatOre:25000,
      status:'Bokförd'
    });
    const reminder=Receivables.createReminderRecord({
      invoice:{...savedInvoice,transactions:[],...{
        interestStartBasis:evidence.basis,
        interestStartEvidenceSource:evidence.evidenceSource,
        interestStartVerifiedAt:evidence.verifiedAt
      }},
      companyId:company.id,
      actor:{id:user.id,name:user.displayName},
      options:{sentDate:'2026-10-20',includeInterest:true},
      config:legalRates,
      now:'2026-10-20T08:00:00.000Z'
    });
    Db.addReminder(db,reminder);
    const storedReminder=Db.remindersForInvoice(db,company.id,savedInvoice.id)[0];
    assert.equal(storedReminder.interestStartBasis,'predetermined-due-date');
    assert.equal(storedReminder.interestStartEvidenceSource,'issued-invoice-document');
    assert.equal(storedReminder.interestStartVerifiedAt,'2026-09-01T10:00:00.000Z');
    assert.ok(storedReminder.interestOre>0);
  }finally{
    db.close();
  }
});

test('påminnelse utan ränta fungerar när startgrunden saknas',()=>{
  const {invoice}=issuedFixture();
  assert.throws(
    ()=>Receivables.reminderPreview(invoice,{sentDate:'2026-10-20',includeInterest:true},legalRates),
    error=>error.code==='INTEREST_START_BASIS_UNVERIFIED'
  );
  const preview=Receivables.reminderPreview(invoice,{sentDate:'2026-10-20',includeInterest:false},legalRates);
  assert.equal(preview.interestOre,0);
  assert.equal(preview.interestStartBasis,'none');
  assert.equal(preview.totalDueOre,invoice.remainingOre);
});
