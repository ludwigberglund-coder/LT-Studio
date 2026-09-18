'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Db = require('../apps/api/database.js');
const Auth = require('../apps/api/auth.js');
const Receivables = require('../packages/receivables/customer-receivables.js');
const rates = require('../config/legal-rates.json');

function seed() {
  const db=Db.openDatabase(':memory:');
  const co1=Db.createCompany(db,{legalName:'Bolag Ett AB',displayName:'Bolag Ett',orgNumber:'559000-0001'});
  const co2=Db.createCompany(db,{legalName:'Bolag Två AB',displayName:'Bolag Två',orgNumber:'559000-0002'});
  const user=Db.createUser(db,{username:'anna.test',displayName:'Anna Test',passwordHash:Auth.hashPassword('Ett starkt testlosenord 2026!')});
  Db.addMembership(db,{companyId:co1.id,userId:user.id,roles:['sales']});
  const customer1=Db.createCustomer(db,{companyId:co1.id,customerNumber:'K-1',name:'Kund Ett AB',customerType:'business',reminderFeeAgreed:true});
  const customer2=Db.createCustomer(db,{companyId:co2.id,customerNumber:'K-2',name:'Kund Två AB',customerType:'business',reminderFeeAgreed:false});
  const inv1=Db.createInvoice(db,{companyId:co1.id,customerId:customer1.id,invoiceNumber:'310001',ocr:'310001',invoiceDate:'2026-08-01',postingDate:'2026-08-01',dueDate:'2026-08-31',totalOre:100000,remainingOre:100000,vatOre:20000,status:'Bokförd'});
  const inv2=Db.createInvoice(db,{companyId:co2.id,customerId:customer2.id,invoiceNumber:'410001',ocr:'410001',invoiceDate:'2026-08-01',postingDate:'2026-08-01',dueDate:'2026-08-31',totalOre:200000,remainingOre:200000,vatOre:40000,status:'Bokförd'});
  return {db,co1,co2,user,inv1,inv2};
}

test('alla fakturafrågor kräver rätt companyId', () => {
  const {db,co1,co2,inv1,inv2}=seed();
  try {
    assert.equal(Db.invoiceById(db,co1.id,inv1.id).invoiceNumber,'310001');
    assert.equal(Db.invoiceById(db,co1.id,inv2.id),null);
    assert.equal(Db.invoiceById(db,co2.id,inv1.id),null);
    assert.deepEqual(Db.listReceivables(db,co1.id).map(i=>i.id),[inv1.id]);
    assert.deepEqual(Db.listReceivables(db,co2.id).map(i=>i.id),[inv2.id]);
  } finally { db.close(); }
});

test('kommentarer är företagsskyddade och bevarar personlig avsändare', () => {
  const {db,co1,co2,user,inv1}=seed();
  try {
    const comment=Receivables.createInvoiceComment({invoiceId:inv1.id,companyId:co1.id,actor:{id:user.id,name:user.displayName},text:'Kunden lovar betalning på fredag.',now:'2026-09-15T10:00:00.000Z'});
    Db.addComment(db,comment);
    assert.equal(Db.commentsForInvoice(db,co1.id,inv1.id).length,1);
    assert.equal(Db.commentsForInvoice(db,co2.id,inv1.id).length,0);
    assert.equal(Db.commentsForInvoice(db,co1.id,inv1.id)[0].authorName,'Anna Test');
  } finally { db.close(); }
});

test('påminnelser sparar ränteunderlaget och kan granskas i efterhand', () => {
  const {db,co1,user,inv1}=seed();
  try {
    const invoice=Db.invoiceById(db,co1.id,inv1.id);
    invoice.transactions=Db.transactionsForInvoice(db,co1.id,inv1.id);
    const reminder=Receivables.createReminderRecord({
      invoice,
      companyId:co1.id,
      actor:{id:user.id,name:user.displayName},
      options:{sentDate:'2026-09-15',includeReminderFee:true,reminderFeeAgreed:true,includeInterest:true,customerType:'business'},
      config:rates,
      now:'2026-09-15T10:00:00.000Z'
    });
    Db.addReminder(db,reminder);
    const saved=Db.remindersForInvoice(db,co1.id,inv1.id)[0];
    assert.equal(saved.principalOre,100000);
    assert.equal(saved.reminderFeeOre,6000);
    assert.ok(saved.interestOre>0);
    assert.ok(saved.interestSegments.length>=1);
    assert.equal(saved.reminderDate,'2026-09-15');
    assert.equal(saved.deliveryStatus,'not-sent');
    assert.equal(saved.deliveredAt,null);
    assert.equal(saved.rateConfigVersion,'1');
    assert.equal(saved.rateVerifiedAt,'2026-09-15');
  } finally { db.close(); }
});

test('databastransaktion rullar tillbaka alla delsteg vid fel', () => {
  const {db,co1,user}=seed();
  try {
    assert.throws(()=>Db.transaction(db,()=>{
      Db.appendAudit(db,{companyId:co1.id,userId:user.id,action:'TEST_STEP',entityType:'test',details:{}});
      throw new Error('stop');
    }));
    assert.equal(Db.auditForCompany(db,co1.id).filter(event=>event.action==='TEST_STEP').length,0);
  } finally { db.close(); }
});
