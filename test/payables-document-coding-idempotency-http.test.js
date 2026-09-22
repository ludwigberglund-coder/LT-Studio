'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Payables=require('../apps/api/payables.js');
const {safePdf}=require('./pdf-fixture.cjs');

test('leverantörsfakturans PDF och kontering återanvänds vid identiska retries utan extra audit',async()=>{
  const f=await fixture();
  try{
    const headers=await f.login(f.admin.username);
    const supplierId=f.payable.supplierId;

    const created=await fetch(f.base+'/api/v1/payables/invoices',{
      method:'POST',
      headers,
      body:JSON.stringify({
        supplierId,
        supplierInvoiceNumber:'IDEMP-DOC-CODING-001',
        invoiceDate:'2026-09-21',
        dueDate:'2026-10-21',
        totalOre:125000,
        vatOre:25000,
        currency:'SEK',
        vatTreatment:'se-domestic-full-input-vat'
      })
    });
    const createdBody=await created.json();
    assert.equal(created.status,201);
    const invoiceId=createdBody.invoice.id;

    const pdf=await safePdf('idempotent supplier invoice document');
    const pdfHeaders={...headers,'Content-Type':'application/pdf','X-Document-Name':'idem-underlag.pdf'};

    const firstPdf=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/document`,{
      method:'PUT',headers:pdfHeaders,body:pdf
    });
    const firstPdfBody=await firstPdf.json();
    assert.equal(firstPdf.status,201);
    assert.equal(firstPdfBody.duplicate,false);
    const afterFirstPdf=Payables.invoiceById(f.db,f.a.id,invoiceId);
    const pdfDownload=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/document`,{headers});
    assert.equal(pdfDownload.status,200);
    assert.match(pdfDownload.headers.get('content-disposition')||'',/^attachment;/);
    assert.match(pdfDownload.headers.get('content-security-policy')||'',/sandbox/);
    assert.equal(pdfDownload.headers.get('content-type'),'application/pdf');
    assert.deepEqual(Buffer.from(await pdfDownload.arrayBuffer()),pdf);

    const retryPdf=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/document`,{
      method:'PUT',headers:pdfHeaders,body:pdf
    });
    const retryPdfBody=await retryPdf.json();
    assert.equal(retryPdf.status,200);
    assert.equal(retryPdfBody.duplicate,true);
    assert.equal(retryPdfBody.document.sha256,firstPdfBody.document.sha256);
    assert.equal(Payables.invoiceById(f.db,f.a.id,invoiceId).updatedAt,afterFirstPdf.updatedAt);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='SUPPLIER_INVOICE_DOCUMENT_STORED'&&event.entityId===invoiceId).length,
      1
    );

    const lines=[
      {account:'4010',debitOre:100000,creditOre:0,text:'Varuinköp',vatCode:'INPUT_VAT'},
      {account:'2641',debitOre:25000,creditOre:0,text:'Ingående moms',vatCode:'INPUT_VAT'},
      {account:'2440',debitOre:0,creditOre:125000,text:'Leverantörsskuld',vatCode:''}
    ];

    const firstCoding=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/coding`,{
      method:'PUT',headers,body:JSON.stringify({lines})
    });
    const firstCodingBody=await firstCoding.json();
    assert.equal(firstCoding.status,200);
    assert.equal(firstCodingBody.duplicate,false);
    const afterFirstCoding=Payables.invoiceById(f.db,f.a.id,invoiceId);

    const retryCoding=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/coding`,{
      method:'PUT',headers,body:JSON.stringify({lines})
    });
    const retryCodingBody=await retryCoding.json();
    assert.equal(retryCoding.status,200);
    assert.equal(retryCodingBody.duplicate,true);
    assert.equal(retryCodingBody.invoice.codingSha256,firstCodingBody.invoice.codingSha256);
    assert.equal(Payables.invoiceById(f.db,f.a.id,invoiceId).updatedAt,afterFirstCoding.updatedAt);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='SUPPLIER_INVOICE_CODING_UPDATED'&&event.entityId===invoiceId).length,
      1
    );

    const approver=Db.createUser(f.db,{username:'idempotency.approver',displayName:'Idempotency Approver',passwordHash:'test-only-hash'});
    const approved=Payables.approve(f.db,{
      companyId:f.a.id,
      invoiceId,
      actorId:approver.id,
      expectedCodingSha256:firstCodingBody.invoice.codingSha256,
      expectedDocumentSha256:firstPdfBody.document.sha256
    });
    assert.equal(approved.status,'approved');

    const delayedPdfRetry=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/document`,{
      method:'PUT',headers:pdfHeaders,body:pdf
    });
    assert.equal(delayedPdfRetry.status,200);
    assert.equal((await delayedPdfRetry.json()).duplicate,true);

    const delayedCodingRetry=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/coding`,{
      method:'PUT',headers,body:JSON.stringify({lines})
    });
    assert.equal(delayedCodingRetry.status,200);
    assert.equal((await delayedCodingRetry.json()).duplicate,true);

    const changedPdf=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/document`,{
      method:'PUT',headers:pdfHeaders,body:await safePdf('changed document after approval')
    });
    assert.equal(changedPdf.status,409);
    assert.equal((await changedPdf.json()).code,'DOCUMENT_LOCKED');

    const changedLines=lines.map((line,index)=>index===0?{...line,account:'5460',text:'Förbrukningsmaterial'}:line);
    const changedCoding=await fetch(f.base+`/api/v1/payables/invoices/${invoiceId}/coding`,{
      method:'PUT',headers,body:JSON.stringify({lines:changedLines})
    });
    assert.equal(changedCoding.status,409);
    assert.equal((await changedCoding.json()).code,'CODING_LOCKED');

    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='SUPPLIER_INVOICE_DOCUMENT_STORED'&&event.entityId===invoiceId).length,
      1
    );
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='SUPPLIER_INVOICE_CODING_UPDATED'&&event.entityId===invoiceId).length,
      1
    );
  }finally{
    await f.close();
  }
});
