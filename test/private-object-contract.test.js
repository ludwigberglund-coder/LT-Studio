'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Contract=require('../apps/api/private-object-contract.js');

const SHA='a'.repeat(64);
const CREATED='2026-09-20T21:20:00.000Z';

test('servern skapar stabil företagsisolerad objektnyckel',()=>{
  const a=Contract.createPrivateObjectMetadata({
    companyId:'company_11111111-1111-1111-1111-111111111111',
    kind:Contract.PRIVATE_OBJECT_KINDS.DOCUMENT,
    objectId:'doc_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    mimeType:'application/pdf',
    sizeBytes:1234,
    sha256:SHA,
    createdAt:CREATED
  });
  const b=Contract.createPrivateObjectMetadata({
    companyId:'company_22222222-2222-2222-2222-222222222222',
    kind:Contract.PRIVATE_OBJECT_KINDS.DOCUMENT,
    objectId:'doc_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    mimeType:'application/pdf',
    sizeBytes:1234,
    sha256:SHA,
    createdAt:CREATED
  });

  assert.equal(a.objectKey,'private/company_11111111-1111-1111-1111-111111111111/documents/doc_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert.notEqual(a.objectKey,b.objectKey);
  assert.equal(a.companyId,'company_11111111-1111-1111-1111-111111111111');
  assert.equal(a.kind,'document');
  assert.equal(a.mimeType,'application/pdf');
  assert.equal(a.sizeBytes,1234);
  assert.equal(a.sha256,SHA);
  assert.equal(a.createdAt,CREATED);
  assert.equal(Object.isFrozen(a),true);
});

test('objektnyckeln kan inte styras med sökväg eller okänd objekttyp',()=>{
  assert.throws(
    ()=>Contract.buildPrivateObjectKey({companyId:'../company-a',kind:'document',objectId:'doc_1'}),
    error=>error.code==='INVALID_PRIVATE_OBJECT_ID'
  );
  assert.throws(
    ()=>Contract.buildPrivateObjectKey({companyId:'company_a',kind:'../../other',objectId:'doc_1'}),
    error=>error.code==='INVALID_PRIVATE_OBJECT_KIND'
  );
  assert.throws(
    ()=>Contract.buildPrivateObjectKey({companyId:'company_a',kind:'document',objectId:'../doc_1'}),
    error=>error.code==='INVALID_PRIVATE_OBJECT_ID'
  );
});

test('metadata kräver verifierbar storlek, MIME och SHA-256',()=>{
  const base={
    companyId:'company_a',
    kind:'customer-invoice-pdf',
    objectId:'invoice_1',
    mimeType:'application/pdf',
    sizeBytes:500,
    sha256:SHA,
    createdAt:CREATED
  };
  assert.throws(()=>Contract.createPrivateObjectMetadata({...base,sizeBytes:0}),error=>error.code==='INVALID_PRIVATE_OBJECT_SIZE');
  assert.throws(()=>Contract.createPrivateObjectMetadata({...base,sizeBytes:Contract.MAX_PRIVATE_OBJECT_BYTES+1}),error=>error.code==='INVALID_PRIVATE_OBJECT_SIZE');
  assert.throws(()=>Contract.createPrivateObjectMetadata({...base,mimeType:'not-a-mime'}),error=>error.code==='INVALID_PRIVATE_OBJECT_MIME');
  assert.throws(()=>Contract.createPrivateObjectMetadata({...base,sha256:'abc'}),error=>error.code==='INVALID_PRIVATE_OBJECT_SHA256');
  assert.throws(()=>Contract.createPrivateObjectMetadata({...base,createdAt:'inte ett datum'}),error=>error.code==='INVALID_PRIVATE_OBJECT_CREATED_AT');
});

test('klienten kan inte ersätta den servergenererade objectKey-fältet',()=>{
  const metadata=Contract.createPrivateObjectMetadata({
    companyId:'company_a',
    kind:'supplier-invoice',
    objectId:'sinv_1',
    objectKey:'public/evil',
    mimeType:'application/pdf',
    sizeBytes:100,
    sha256:SHA,
    createdAt:CREATED
  });
  assert.equal(metadata.objectKey,'private/company_a/supplier-invoices/sinv_1');
});
