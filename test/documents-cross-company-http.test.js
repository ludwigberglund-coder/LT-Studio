'use strict';

// Cross-company document access is verified through the authenticated HTTP boundary.
// CI synchronize marker: document IDOR regression must run on the current main base.
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Documents=require('../apps/api/documents.js');

test('dokumentarkiv stoppar läsning, innehållsskrivning och länkning över företagsgränsen',async()=>{
  const f=await fixture();
  try{
    const foreign=Documents.createPending(f.db,{
      companyId:f.b.id,
      uploadedBy:f.other.id,
      title:'Främmande dokument',
      category:'other',
      fileName:'foreign.pdf',
      mimeType:'application/pdf'
    });
    const bytes=Buffer.from('%PDF-1.4\n% foreign document\n','ascii');
    Documents.storeContent(f.db,{companyId:f.b.id,documentId:foreign.id,bytes});

    const headers=await f.login(f.admin.username);

    const detail=await fetch(f.base+'/api/v1/documents/'+foreign.id,{headers});
    assert.equal(detail.status,404);
    assert.equal((await detail.json()).code,'DOCUMENT_NOT_FOUND');

    const contentRead=await fetch(f.base+'/api/v1/documents/'+foreign.id+'/content',{headers});
    assert.equal(contentRead.status,404);
    assert.equal((await contentRead.json()).code,'DOCUMENT_CONTENT_NOT_FOUND');

    const contentWrite=await fetch(f.base+'/api/v1/documents/'+foreign.id+'/content',{
      method:'PUT',
      headers:{...headers,'Content-Type':'application/pdf'},
      body:Buffer.from('%PDF-1.4\n% forbidden replacement\n','ascii')
    });
    assert.equal(contentWrite.status,404);
    assert.equal((await contentWrite.json()).code,'DOCUMENT_NOT_FOUND');

    const link=await fetch(f.base+'/api/v1/documents/'+foreign.id+'/links',{
      method:'POST',
      headers,
      body:JSON.stringify({entityType:'customer-invoice',entityId:'foreign-target',label:'Otillåten länk'})
    });
    assert.equal(link.status,404);
    assert.equal((await link.json()).code,'DOCUMENT_NOT_FOUND');

    assert.deepEqual(Buffer.from(Documents.content(f.db,f.b.id,foreign.id).bytes),bytes);

    const wrongCompanyAudit=Db.auditForCompany(f.db,f.a.id).filter(event=>
      ['DOCUMENT_CONTENT_STORED','DOCUMENT_LINKED'].includes(event.action)&&event.entityId===foreign.id
    );
    assert.equal(wrongCompanyAudit.length,0);
  }finally{
    await f.close();
  }
});
