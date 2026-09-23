'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const CustomerInvoicing=require('../apps/api/customer-invoicing.js');
const ReminderDocuments=require('../apps/api/payment-reminder-documents.js');

test('betalningspåminnelse får eget nummer, arkiverad PDF och referens till originalfaktura',{timeout:15000},async()=>{
  const db=Db.openDatabase(':memory:');
  try{
    CustomerInvoicing.initializeCustomerInvoicing(db);
    const company=Db.createCompany(db,{legalName:'Synthetic Reminder AB',displayName:'Synthetic Reminder',orgNumber:'000000-0000'});
    const user=Db.createUser(db,{username:'reminder-user',displayName:'Reminder User',passwordHash:Auth.hashPassword('Reminder-Test-2026!'),mfaSecretEncrypted:null});
    Db.addMembership(db,{companyId:company.id,userId:user.id});
    const customer=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-1001',name:'Fiktiv Kund AB',orgNumber:'111111-1111',email:'kund@example.invalid',address:{full:'Testgatan 1, 411 00 Göteborg'},customerType:'business',reminderFeeAgreed:true});
    const invoice=Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'310001',ocr:'310001',invoiceDate:'2026-08-01',postingDate:'2026-08-01',dueDate:'2026-08-31',totalOre:106000,remainingOre:106000,vatOre:21200,status:'Förfallen',paymentMethod:'Bankgiro',paymentAccount:'0000-0000',invoiceAccount:'1510'});
    const originalDocument={
      schemaVersion:3,documentType:'FAKTURA',invoiceNumber:'310001',ocr:'310001',invoiceDate:'2026-08-01',dueDate:'2026-08-31',postingDate:'2026-08-01',
      customerNumber:'K-1001',seller:{name:'Synthetic Reminder AB',address:'Testvägen 1, 411 00 Göteborg',orgNumber:'000000-0000',vatNumber:'SE000000000001',email:'ekonomi@example.invalid',bankgiro:'0000-0000',taxStatus:'Godkänd för F-skatt'},
      buyer:{name:'Fiktiv Kund AB',address:'Testgatan 1, 411 00 Göteborg',orgNumber:'111111-1111',email:'kund@example.invalid'},currency:'SEK'
    };
    const documentJson=JSON.stringify(originalDocument),documentSha256=crypto.createHash('sha256').update(documentJson).digest('hex'),now=new Date().toISOString();
    db.prepare('INSERT INTO customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,created_at) VALUES(?,?,?,?,?)').run(invoice.id,company.id,documentJson,documentSha256,now);

    const reminder={
      id:'reminder_123456abcdef',
      companyId:company.id,invoiceId:invoice.id,createdBy:user.id,createdByName:user.displayName,kind:'payment-reminder',
      createdAt:now,reminderDate:'2026-09-23',sentAt:'2026-09-23T12:00:00.000Z',deliveryStatus:'not-sent',deliveredAt:null,
      rateConfigVersion:'test',rateVerifiedAt:now,principalOre:106000,reminderFeeOre:6000,interestOre:1200,businessLatePaymentCompensationOre:0,totalDueOre:113200,
      annualRateBasisPoints:1000,interestStartBasis:'predetermined-due-date',interestStartEvidenceSource:'issued-invoice-document',interestStartVerifiedAt:now,interestSegments:[],note:'Vänligen betala.'
    };
    const archive=await ReminderDocuments.prepareArchive(db,{companyId:company.id,invoice:{...invoice,customerNumber:'K-1001'},reminder});
    assert.match(archive.reminderNumber,/^P-310001-/);
    assert.equal(archive.pdfBytes.subarray(0,5).toString('ascii'),'%PDF-');
    assert.equal(archive.pdfSha256,crypto.createHash('sha256').update(archive.pdfBytes).digest('hex'));

    Db.addReminder(db,{...reminder,...archive,requestFingerprint:'a'.repeat(64)});
    ReminderDocuments.storeArchive(db,{companyId:company.id,reminderId:reminder.id,archive});
    const stored=Db.remindersForInvoice(db,company.id,invoice.id)[0];
    assert.equal(stored.reminderNumber,archive.reminderNumber);
    assert.equal(stored.pdfSha256,archive.pdfSha256);
    assert.equal(stored.totalDueOre,113200);

    const restored=ReminderDocuments.pdfArchive(db,{companyId:company.id,invoiceId:invoice.id,reminderId:reminder.id});
    assert.equal(restored.pdfSha256,archive.pdfSha256);
    assert.equal(restored.bytes.equals(archive.pdfBytes),true);
  }finally{db.close()}
});
