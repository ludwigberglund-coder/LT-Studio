'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Db = require('../apps/api/database.js');
const Auth = require('../apps/api/auth.js');
const Queues = require('../apps/api/queues.js');
const Delivery = require('../apps/api/notification-delivery.js');
const Automation = require('../packages/automation/proposals.js');

function seed() {
  const db = Db.openDatabase(':memory:');
  Queues.initializeQueues(db);
  const co1 = Db.createCompany(db,{legalName:'Bolag Ett AB',displayName:'Bolag Ett',orgNumber:'559200-0001'});
  const co2 = Db.createCompany(db,{legalName:'Bolag Två AB',displayName:'Bolag Två',orgNumber:'559200-0002'});
  const user = Db.createUser(db,{username:'queue.test',displayName:'Queue Test',passwordHash:Auth.hashPassword('Ett mycket sakert kolosenord 2026!')});
  Db.addMembership(db,{companyId:co1.id,userId:user.id,roles:['accountant']});
  return {db,co1,co2,user};
}

function proposal(companyId,overrides={}) {
  return Automation.createProposal({
    companyId,
    type:'bank-payment-match',
    sourceId:'bank-100',
    confidence:1,
    deterministic:true,
    reason:'OCR och exakt restbelopp matchar en enda faktura.',
    evidence:[{kind:'payment-reference',label:'OCR',value:'310100',sourceId:'bank-100'}],
    suggestion:{invoiceId:'invoice-100',amountOre:125000},
    engine:{kind:'rules',name:'exact-payment-match',version:'1'},
    createdAt:'2026-09-15T10:00:00.000Z',
    ...overrides
  });
}

test('outbox kräver giltig mottagare och stabil idempotensnyckel',()=>{
  const {db,co1,user}=seed();
  try {
    assert.throws(()=>Queues.enqueueEmail(db,{companyId:co1.id,entityType:'invoice',recipient:'fel',subject:'Påminnelse',bodyText:'Hej',idempotencyKey:'r1',createdBy:user.id}),error=>error.code==='INVALID_EMAIL');
    assert.throws(()=>Queues.enqueueEmail(db,{companyId:co1.id,entityType:'invoice',recipient:'kund@example.se',subject:'Påminnelse',bodyText:'Hej',idempotencyKey:'',createdBy:user.id}),error=>error.code==='INVALID_IDEMPOTENCY_KEY');
    const first=Queues.enqueueEmail(db,{companyId:co1.id,entityType:'invoice',entityId:'inv-1',recipient:'kund@example.se',subject:'Påminnelse 310100',bodyText:'Betalning saknas.',idempotencyKey:'reminder:inv-1:1',createdBy:user.id});
    const second=Queues.enqueueEmail(db,{companyId:co1.id,entityType:'invoice',entityId:'inv-1',recipient:'kund@example.se',subject:'Påminnelse 310100',bodyText:'Betalning saknas.',idempotencyKey:'reminder:inv-1:1',createdBy:user.id});
    assert.equal(first.duplicate,false);
    assert.equal(second.duplicate,true);
    assert.equal(first.notification.id,second.notification.id);
    assert.equal(Queues.listNotifications(db,co1.id).length,1);
  } finally { db.close(); }
});

test('utskick kan bara tas av en worker och markeras skickat efter leverantörsbekräftelse',async()=>{
  const {db,co1,user}=seed();
  try {
    Queues.enqueueEmail(db,{companyId:co1.id,entityType:'invoice-reminder',entityId:'r-1',recipient:'kund@example.se',subject:'Betalningspåminnelse',bodyText:'Hej',idempotencyKey:'r-1',createdBy:user.id,nextAttemptAt:'2026-09-15T10:00:00.000Z'});
    const sender={sendEmail:async message=>({accepted:true,messageId:`provider-${message.idempotencyKey}`,sentAt:'2026-09-15T10:01:00.000Z'})};
    const result=await Delivery.processOne(db,sender,{workerId:'worker-1',now:'2026-09-15T10:01:00.000Z'});
    assert.equal(result.processed,true);
    assert.equal(result.notification.status,'sent');
    assert.equal(result.notification.attempts,1);
    assert.equal(result.notification.providerMessageId,'provider-r-1');
    assert.equal(result.notification.sentAt,'2026-09-15T10:01:00.000Z');
    assert.equal((await Delivery.processOne(db,sender,{workerId:'worker-2',now:'2026-09-15T10:02:00.000Z'})).processed,false);
  } finally { db.close(); }
});

test('leveransfel ger kontrollerat återförsök och blockerar efter max antal försök',async()=>{
  const {db,co1,user}=seed();
  try {
    const queued=Queues.enqueueEmail(db,{companyId:co1.id,entityType:'invoice-reminder',entityId:'r-2',recipient:'kund@example.se',subject:'Påminnelse',bodyText:'Hej',idempotencyKey:'r-2',createdBy:user.id,maxAttempts:2,nextAttemptAt:'2026-09-15T10:00:00.000Z'}).notification;
    const sender={sendEmail:async()=>{throw new Error('Tillfälligt leveransfel')}};
    const first=await Delivery.processOne(db,sender,{workerId:'worker-1',now:'2026-09-15T10:00:00.000Z'});
    assert.equal(first.notification.status,'failed');
    assert.equal(first.notification.attempts,1);
    const second=await Delivery.processOne(db,sender,{workerId:'worker-1',now:first.notification.nextAttemptAt});
    assert.equal(second.notification.status,'blocked');
    assert.equal(second.notification.attempts,2);
    assert.match(second.notification.lastError,/leveransfel/i);
    assert.equal(Queues.notificationById(db,co1.id,queued.id).status,'blocked');
  } finally { db.close(); }
});

test('outbox är strikt företagsisolerad',()=>{
  const {db,co1,co2,user}=seed();
  try {
    const item=Queues.enqueueEmail(db,{companyId:co1.id,entityType:'invoice',recipient:'kund@example.se',subject:'Påminnelse',bodyText:'Hej',idempotencyKey:'isolering',createdBy:user.id}).notification;
    assert.equal(Queues.notificationById(db,co1.id,item.id).id,item.id);
    assert.equal(Queues.notificationById(db,co2.id,item.id),null);
    assert.equal(Queues.listNotifications(db,co2.id).length,0);
  } finally { db.close(); }
});

test('automationsförslag sparas permanent med heltalsbaserat säkerhetsvärde och idempotens',()=>{
  const {db,co1}=seed();
  try {
    const original=proposal(co1.id);
    const first=Queues.saveAutomationProposal(db,original,{idempotencyKey:'bank-100:v1'});
    const second=Queues.saveAutomationProposal(db,original,{idempotencyKey:'bank-100:v1'});
    assert.equal(first.duplicate,false);
    assert.equal(second.duplicate,true);
    assert.equal(first.proposal.confidence,1);
    assert.equal(first.proposal.status,'ready-for-approval');
    assert.deepEqual(first.proposal.suggestion,{invoiceId:'invoice-100',amountOre:125000});
    assert.equal(Queues.listAutomationProposals(db,co1.id).length,1);
  } finally { db.close(); }
});

test('godkännande och avvisning kräver rätt företag och giltig status',()=>{
  const {db,co1,co2,user}=seed();
  try {
    const first=Queues.saveAutomationProposal(db,proposal(co1.id),{idempotencyKey:'approve'}).proposal;
    assert.throws(()=>Queues.approveAutomationProposal(db,{companyId:co2.id,proposalId:first.id,userId:user.id}),error=>error.code==='INVALID_PROPOSAL_STATUS');
    const approved=Queues.approveAutomationProposal(db,{companyId:co1.id,proposalId:first.id,userId:user.id,approvedAt:'2026-09-15T11:00:00.000Z'});
    assert.equal(approved.status,'approved');
    assert.equal(approved.approvedBy,user.id);
    assert.throws(()=>Queues.approveAutomationProposal(db,{companyId:co1.id,proposalId:first.id,userId:user.id}),error=>error.code==='INVALID_PROPOSAL_STATUS');

    const second=Queues.saveAutomationProposal(db,proposal(co1.id,{sourceId:'bank-200',confidence:.55,deterministic:false,createdAt:'2026-09-15T12:00:00.000Z'}),{idempotencyKey:'reject'}).proposal;
    const rejected=Queues.rejectAutomationProposal(db,{companyId:co1.id,proposalId:second.id,userId:user.id,reason:'Referensen är tvetydig.',rejectedAt:'2026-09-15T12:05:00.000Z'});
    assert.equal(rejected.status,'rejected');
    assert.equal(rejected.rejectionReason,'Referensen är tvetydig.');
  } finally { db.close(); }
});
