'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Documents=require('../apps/api/documents.js');

test('dokumentuppladdning är idempotent över metadata-POST och fil-PUT',async()=>{
  const f=await fixture();
  try{
    const headers=await f.login(f.admin.username);
    const meta={
      requestId:'document-http-request-0001',
      title:'Idempotent original',
      category:'other',
      fileName:'idempotent.pdf',
      mimeType:'application/pdf',
      note:'Retry-test'
    };

    const missingRequestId=await fetch(f.base+'/api/v1/documents',{
      method:'POST',
      headers,
      body:JSON.stringify({...meta,requestId:undefined})
    });
    assert.equal(missingRequestId.status,422);
    assert.equal((await missingRequestId.json()).code,'DOCUMENT_REQUEST_ID_REQUIRED');

    const first=await fetch(f.base+'/api/v1/documents',{
      method:'POST',
      headers,
      body:JSON.stringify(meta)
    });
    const firstBody=await first.json();
    assert.equal(first.status,201);
    assert.equal(firstBody.duplicate,false);
    assert.equal(firstBody.document.status,'pending');

    const retryMeta=await fetch(f.base+'/api/v1/documents',{
      method:'POST',
      headers,
      body:JSON.stringify(meta)
    });
    const retryMetaBody=await retryMeta.json();
    assert.equal(retryMeta.status,200);
    assert.equal(retryMetaBody.duplicate,true);
    assert.equal(retryMetaBody.document.id,firstBody.document.id);

    const conflict=await fetch(f.base+'/api/v1/documents',{
      method:'POST',
      headers,
      body:JSON.stringify({...meta,title:'Annan titel'})
    });
    assert.equal(conflict.status,409);
    assert.equal((await conflict.json()).code,'DOCUMENT_IDEMPOTENCY_CONFLICT');

    const bytes=Buffer.from('%PDF-1.4\n% idempotent original\n','ascii');
    const uploadHeaders={...headers,'Content-Type':'application/pdf'};
    const firstContent=await fetch(f.base+'/api/v1/documents/'+firstBody.document.id+'/content',{
      method:'PUT',
      headers:uploadHeaders,
      body:bytes
    });
    const firstContentBody=await firstContent.json();
    assert.equal(firstContent.status,200);
    assert.equal(firstContentBody.duplicate,false);
    assert.equal(firstContentBody.document.status,'ready');

    const retryContent=await fetch(f.base+'/api/v1/documents/'+firstBody.document.id+'/content',{
      method:'PUT',
      headers:uploadHeaders,
      body:bytes
    });
    const retryContentBody=await retryContent.json();
    assert.equal(retryContent.status,200);
    assert.equal(retryContentBody.duplicate,true);
    assert.equal(retryContentBody.document.sha256,firstContentBody.document.sha256);

    const retryMetaAfterReady=await fetch(f.base+'/api/v1/documents',{
      method:'POST',
      headers,
      body:JSON.stringify(meta)
    });
    const afterReadyBody=await retryMetaAfterReady.json();
    assert.equal(retryMetaAfterReady.status,200);
    assert.equal(afterReadyBody.duplicate,true);
    assert.equal(afterReadyBody.document.id,firstBody.document.id);
    assert.equal(afterReadyBody.document.status,'ready');

    const changedBytes=await fetch(f.base+'/api/v1/documents/'+firstBody.document.id+'/content',{
      method:'PUT',
      headers:uploadHeaders,
      body:Buffer.from('%PDF-1.4\n% changed original\n','ascii')
    });
    assert.equal(changedBytes.status,409);
    assert.equal((await changedBytes.json()).code,'DOCUMENT_IMMUTABLE');

    const linkBody={entityType:'customer-invoice',entityId:f.issued.invoice.id,label:'Fakturaunderlag'};
    const firstLink=await fetch(f.base+'/api/v1/documents/'+firstBody.document.id+'/links',{
      method:'POST',headers,body:JSON.stringify(linkBody)
    });
    const firstLinkBody=await firstLink.json();
    assert.equal(firstLink.status,200);
    assert.equal(firstLinkBody.duplicate,false);
    assert.equal(firstLinkBody.links.length,1);

    const retryLink=await fetch(f.base+'/api/v1/documents/'+firstBody.document.id+'/links',{
      method:'POST',headers,body:JSON.stringify(linkBody)
    });
    const retryLinkBody=await retryLink.json();
    assert.equal(retryLink.status,200);
    assert.equal(retryLinkBody.duplicate,true);
    assert.equal(retryLinkBody.links.length,1);

    const changedLink=await fetch(f.base+'/api/v1/documents/'+firstBody.document.id+'/links',{
      method:'POST',headers,body:JSON.stringify({...linkBody,label:'Annan etikett'})
    });
    assert.equal(changedLink.status,409);
    assert.equal((await changedLink.json()).code,'DOCUMENT_LINK_IDEMPOTENCY_CONFLICT');

    assert.equal(Documents.listDocuments(f.db,f.a.id).length,1);
    const audit=Db.auditForCompany(f.db,f.a.id);
    assert.equal(audit.filter(event=>event.action==='DOCUMENT_REGISTERED'&&event.entityId===firstBody.document.id).length,1);
    assert.equal(audit.filter(event=>event.action==='DOCUMENT_CONTENT_STORED'&&event.entityId===firstBody.document.id).length,1);
    assert.equal(audit.filter(event=>event.action==='DOCUMENT_LINKED'&&event.entityId===firstBody.document.id).length,1);
  }finally{
    await f.close();
  }
});
