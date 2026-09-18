'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
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
    assert.equal(saved.rateConfigVersion,'2');
    assert.equal(saved.rateVerifiedAt,'2026-09-18');
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


test('äldre sessionschema migreras utan att förlänga befintlig session', () => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE sessions(
      token_hash TEXT PRIMARY KEY,
      csrf_hash TEXT NOT NULL,
      user_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    ) STRICT;`);
    db.prepare('INSERT INTO sessions(token_hash,csrf_hash,user_id,company_id,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)')
      .run('old-token','csrf','u1','c1','2026-09-18T10:00:00.000Z','2026-09-18T11:00:00.000Z','2026-09-18T10:30:00.000Z');
    Db.initializeSchema(db);
    const columns=db.prepare('PRAGMA table_info(sessions)').all().map(row=>row.name);
    assert.ok(columns.includes('absolute_expires_at'));
    const row=db.prepare('SELECT expires_at AS expiresAt,absolute_expires_at AS absoluteExpiresAt FROM sessions WHERE token_hash=?').get('old-token');
    assert.equal(row.absoluteExpiresAt,row.expiresAt);
  } finally { db.close(); }
});

test('session touch begränsas av absolut sluttid och MFA-steg förbrukas en gång', () => {
  const {db,co1,user}=seed();
  try {
    Db.createSession(db,{tokenHash:'session-test',csrfHash:'csrf',userId:user.id,companyId:co1.id,expiresAt:'2099-01-01T01:00:00.000Z',absoluteExpiresAt:'2099-01-01T08:00:00.000Z'});
    Db.touchSession(db,'session-test','2099-01-02T00:00:00.000Z');
    const session=db.prepare('SELECT expires_at AS expiresAt,absolute_expires_at AS absoluteExpiresAt FROM sessions WHERE token_hash=?').get('session-test');
    assert.equal(session.expiresAt,'2099-01-01T08:00:00.000Z');
    Db.consumeMfaStep(db,{userId:user.id,totpCounter:12345});
    assert.throws(()=>Db.consumeMfaStep(db,{userId:user.id,totpCounter:12345}),error=>error.code==='MFA_CODE_REPLAYED');
  } finally { db.close(); }
});
