'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Payables=require('../apps/api/payables.js');
const Release=require('../apps/api/payment-release.js');
const SupplierAccounting=require('../apps/api/supplier-accounting.js');
const Domain=require('../packages/payables/supplier-invoices.js');

test('attest, konteringsförslag och betalningsfrisläppning är audit-idempotenta vid identiska retries',async()=>{
  const f=await fixture();
  try{
    const registrarHeaders=await f.login(f.admin.username);
    const approverHeaders=await f.login(f.auditor.username);
    const invoiceId=f.payable.id;

    const suggestion1=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/coding-suggestion`,{
      method:'POST',headers:registrarHeaders,body:JSON.stringify({})
    });
    const suggestion1Body=await suggestion1.json();
    assert.equal(suggestion1.status,200);
    assert.equal(suggestion1Body.duplicate,false);

    const suggestion2=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/coding-suggestion`,{
      method:'POST',headers:registrarHeaders,body:JSON.stringify({})
    });
    const suggestion2Body=await suggestion2.json();
    assert.equal(suggestion2.status,200);
    assert.equal(suggestion2Body.duplicate,true);
    assert.equal(suggestion2Body.proposal.id,suggestion1Body.proposal.id);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='SUPPLIER_CODING_SUGGESTED'&&event.entityId===invoiceId).length,
      1
    );

    const coding=Domain.buildCoding({
      totalOre:f.payable.totalOre,
      vatOre:f.payable.vatOre,
      costAccount:'5460'
    }).lines;
    const savedCoding=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/coding`,{
      method:'PUT',headers:registrarHeaders,body:JSON.stringify({lines:coding})
    });
    const savedCodingBody=await savedCoding.json();
    assert.equal(savedCoding.status,200);
    assert.equal(savedCodingBody.duplicate,false);

    const reviewed=Payables.invoiceById(f.db,f.a.id,invoiceId);
    const approvalPayload={
      expectedCodingSha256:reviewed.codingSha256,
      expectedDocumentSha256:reviewed.documentSha256
    };

    const approval1=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/approve`,{
      method:'POST',headers:approverHeaders,body:JSON.stringify(approvalPayload)
    });
    const approval1Body=await approval1.json();
    assert.equal(approval1.status,200);
    assert.equal(approval1Body.duplicate,false);
    assert.equal(approval1Body.invoice.status,'approved');

    const approval2=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/approve`,{
      method:'POST',headers:approverHeaders,body:JSON.stringify(approvalPayload)
    });
    const approval2Body=await approval2.json();
    assert.equal(approval2.status,200);
    assert.equal(approval2Body.duplicate,true);
    assert.equal(approval2Body.invoice.id,approval1Body.invoice.id);
    assert.equal(approval2Body.invoice.approvedAt,approval1Body.invoice.approvedAt);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='SUPPLIER_INVOICE_APPROVED'&&event.entityId===invoiceId).length,
      1
    );

    const otherApprover=Db.createUser(f.db,{
      username:'other.idempotency.approver',
      displayName:'Other Approver',
      passwordHash:'test-only-hash'
    });
    assert.throws(
      ()=>Payables.approveIdempotent(f.db,{
        companyId:f.a.id,
        invoiceId,
        actorId:otherApprover.id,
        ...approvalPayload
      }),
      error=>error.code==='INVALID_INVOICE_STATUS'
    );

    SupplierAccounting.postSupplierInvoice(f.db,{
      companyId:f.a.id,
      invoiceId,
      actorId:f.admin.id
    });
    const payment=Payables.preparePayment(f.db,{
      companyId:f.a.id,
      invoiceId,
      paymentDate:'2026-10-18',
      amountOre:f.payable.totalOre,
      account:'1930',
      preparedBy:f.admin.id
    });

    const release1=await fetch(f.base+`/api/v1/payables/payments/${payment.id}/release`,{
      method:'POST',headers:registrarHeaders,body:JSON.stringify({})
    });
    const release1Body=await release1.json();
    assert.equal(release1.status,200);
    assert.equal(release1Body.duplicate,false);
    assert.equal(release1Body.payment.status,'released');

    const release2=await fetch(f.base+`/api/v1/payables/payments/${payment.id}/release`,{
      method:'POST',headers:registrarHeaders,body:JSON.stringify({})
    });
    const release2Body=await release2.json();
    assert.equal(release2.status,200);
    assert.equal(release2Body.duplicate,true);
    assert.equal(release2Body.payment.id,release1Body.payment.id);
    assert.equal(release2Body.payment.releasedAt,release1Body.payment.releasedAt);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='SUPPLIER_PAYMENT_RELEASED'&&event.entityId===payment.id).length,
      1
    );

    assert.throws(
      ()=>Release.releasePaymentIdempotent(f.db,{
        companyId:f.a.id,
        paymentId:payment.id,
        releasedBy:f.auditor.id
      }),
      error=>error.code==='INVALID_PAYMENT_STATUS'
    );
  }finally{
    await f.close();
  }
});
