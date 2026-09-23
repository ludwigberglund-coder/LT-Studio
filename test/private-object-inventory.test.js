'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Documents=require('../apps/api/documents.js');
const Inventory=require('../apps/api/private-object-inventory.js');
const PrivateObject=require('../apps/api/private-object-contract.js');
const Db=require('../apps/api/database.js');
const ReminderDocuments=require('../apps/api/payment-reminder-documents.js');

test('privat objektinventering verifierar alla tre filflöden utan att exponera bytes',async()=>{
  const f=await fixture();
  try{
    const document=Documents.createPending(f.db,{
      companyId:f.a.id,
      uploadedBy:f.admin.id,
      title:'Migreringsinventering',
      category:'other',
      fileName:'inventering.pdf',
      mimeType:'application/pdf'
    });
    Documents.storeContent(f.db,{companyId:f.a.id,documentId:document.id,bytes:f.pdf});

    const report=Inventory.buildPrivateObjectInventory(f.db,{
      provider:'sqlite',
      generatedAt:'2026-09-21T08:00:00.000Z'
    });

    assert.equal(report.ok,true);
    assert.equal(report.issueCount,0);
    assert.equal(report.verifiedCount,report.objectCount);
    assert.equal(report.countsByKind[PrivateObject.PRIVATE_OBJECT_KINDS.DOCUMENT].objects,1);
    assert.equal(report.countsByKind[PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE].objects,2);
    assert.equal(report.countsByKind[PrivateObject.PRIVATE_OBJECT_KINDS.CUSTOMER_INVOICE_PDF].objects,1);

    const foreignSupplier=report.objects.find(object=>
      object.kind===PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE&&
      object.companyId===f.b.id
    );
    assert.ok(foreignSupplier);
    assert.match(foreignSupplier.objectKey,new RegExp('^private/'+f.b.id+'/supplier-invoices/'));
    assert.equal(Object.hasOwn(foreignSupplier,'bytes'),false);
    assert.ok(report.objects.every(object=>object.verified));
  }finally{
    await f.close();
  }
});

test('privat objektinventering stoppar migreringsevidens vid SHA-256-avvikelse',async()=>{
  const f=await fixture();
  try{
    f.db.prepare('UPDATE supplier_invoices SET document_blob=? WHERE company_id=? AND id=?')
      .run(Buffer.from('%PDF-1.4\ncorrupt migration source\n','ascii'),f.a.id,f.payable.id);

    const report=Inventory.buildPrivateObjectInventory(f.db,{
      provider:'sqlite',
      generatedAt:'2026-09-21T08:00:00.000Z'
    });

    assert.equal(report.ok,false);
    assert.ok(report.issueCount>=1);
    const damaged=report.objects.find(object=>object.objectId===f.payable.id);
    assert.ok(damaged);
    assert.equal(damaged.verified,false);
    assert.ok(damaged.issues.some(issue=>issue.code==='PRIVATE_OBJECT_SHA256_MISMATCH'));
  }finally{
    await f.close();
  }
});


test('betalningspåminnelsens PDF ingår verifierat i privata objektinventeringen',async()=>{
  const f=await fixture();
  try{
    const invoice=f.issued.invoice;
    const createdAt='2026-10-20T12:00:00.000Z';
    const reminder={
      id:'reminder_inventory_test_001',
      companyId:f.a.id,
      invoiceId:invoice.id,
      createdBy:f.admin.id,
      createdByName:f.admin.displayName||f.admin.username,
      kind:'payment-reminder',
      createdAt,
      reminderDate:'2026-10-20',
      sentAt:createdAt,
      deliveryStatus:'not-sent',
      deliveredAt:null,
      rateConfigVersion:'inventory-test',
      rateVerifiedAt:createdAt,
      principalOre:invoice.remainingOre,
      reminderFeeOre:6000,
      interestOre:0,
      businessLatePaymentCompensationOre:0,
      totalDueOre:invoice.remainingOre+6000,
      annualRateBasisPoints:0,
      interestStartBasis:'none',
      interestStartEvidenceSource:'',
      interestStartVerifiedAt:'',
      interestSegments:[],
      note:'Inventeringstest'
    };
    const archive=await ReminderDocuments.prepareArchive(f.db,{companyId:f.a.id,invoice,reminder});
    Db.addReminder(f.db,{...reminder,...archive,requestFingerprint:'b'.repeat(64)});
    ReminderDocuments.storeArchive(f.db,{companyId:f.a.id,reminderId:reminder.id,archive});

    const report=Inventory.buildPrivateObjectInventory(f.db,{provider:'sqlite',generatedAt:'2026-10-20T13:00:00.000Z'});
    const object=report.objects.find(row=>row.kind===PrivateObject.PRIVATE_OBJECT_KINDS.PAYMENT_REMINDER_PDF&&row.objectId===reminder.id);
    assert.ok(object);
    assert.equal(object.verified,true);
    assert.equal(object.sha256,archive.pdfSha256);
    assert.equal(object.sizeBytes,archive.pdfSizeBytes);
    assert.match(object.objectKey,new RegExp('^private/'+f.a.id+'/payment-reminders/'));
    assert.equal(Object.hasOwn(object,'bytes'),false);
  }finally{
    await f.close();
  }
});
