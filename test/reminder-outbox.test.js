'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Db = require('../apps/api/database.js');
const Auth = require('../apps/api/auth.js');
const Queues = require('../apps/api/queues.js');
const ReminderOutbox = require('../apps/api/reminder-outbox.js');

function setup(email) {
  const db = Db.openDatabase(':memory:');
  Queues.initializeQueues(db);
  ReminderOutbox.initializeReminderOutbox(db);
  const company = Db.createCompany(db,{legalName:'Testbolaget AB',displayName:'Testbolaget',orgNumber:'559300-0001'});
  const user = Db.createUser(db,{username:'reminder.test',displayName:'Reminder Test',passwordHash:Auth.hashPassword('Ett mycket sakert testlosenord 2026!')});
  Db.addMembership(db,{companyId:company.id,userId:user.id,roles:['accountant']});
  const customer = Db.createCustomer(db,{companyId:company.id,customerNumber:'K-100',name:'Kundbolaget AB',email,customerType:'business'});
  const invoice = Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'310100',ocr:'310100',invoiceDate:'2026-08-01',postingDate:'2026-08-01',dueDate:'2026-08-31',totalOre:125000,remainingOre:125000,vatOre:25000,status:'Bokförd'});
  return {db,company,user,invoice};
}

function reminder({company,user,invoice,id='reminder-1'}) {
  return {
    id,
    companyId:company.id,
    invoiceId:invoice.id,
    createdBy:user.id,
    kind:'payment-reminder',
    reminderDate:'2026-09-15',
    principalOre:125000,
    reminderFeeOre:0,
    interestOre:4100,
    businessLatePaymentCompensationOre:0,
    totalDueOre:129100,
    annualRateBasisPoints:1000,
    interestSegments:[{from:'2026-08-31',to:'2026-09-15',days:15,annualRateBasisPoints:1000,interestOre:4100}],
    note:'Första påminnelsen',
    createdAt:'2026-09-15T12:00:00.000Z'
  };
}

test('sparad betalningspåminnelse skapar automatiskt ett köat men inte skickat utskick',()=>{
  const ctx=setup('kund@example.se');
  try {
    Db.addReminder(ctx.db,reminder(ctx));
    const items=Queues.listNotifications(ctx.db,ctx.company.id);
    assert.equal(items.length,1);
    assert.equal(items[0].status,'queued');
    assert.equal(items[0].recipient,'kund@example.se');
    assert.equal(items[0].entityType,'invoice-reminder');
    assert.equal(items[0].entityId,'reminder-1');
    assert.match(items[0].subject,/310100/);
    assert.match(items[0].bodyText,/1291\.00 SEK/);
    assert.equal(items[0].sentAt,null);
    assert.equal(items[0].providerMessageId,null);
  } finally { ctx.db.close(); }
});

test('saknad e-postadress blockerar utskicket utan att förlora påminnelseunderlaget',()=>{
  const ctx=setup(null);
  try {
    Db.addReminder(ctx.db,reminder({...ctx,id:'reminder-2'}));
    assert.equal(Db.remindersForInvoice(ctx.db,ctx.company.id,ctx.invoice.id).length,1);
    const items=Queues.listNotifications(ctx.db,ctx.company.id);
    assert.equal(items.length,1);
    assert.equal(items[0].status,'blocked');
    assert.equal(items[0].recipient,'');
    assert.match(items[0].lastError,/e-postadress saknas/i);
    assert.equal(items[0].sentAt,null);
  } finally { ctx.db.close(); }
});

test('påminnelse och utskick rullas tillbaka tillsammans om transaktionen misslyckas',()=>{
  const ctx=setup('kund@example.se');
  try {
    assert.throws(()=>Db.transaction(ctx.db,()=>{
      Db.addReminder(ctx.db,reminder(ctx));
      throw new Error('simulerat fel efter påminnelsen');
    }),/simulerat fel/);
    assert.equal(Db.remindersForInvoice(ctx.db,ctx.company.id,ctx.invoice.id).length,0);
    assert.equal(Queues.listNotifications(ctx.db,ctx.company.id).length,0);
  } finally { ctx.db.close(); }
});
