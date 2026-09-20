'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Metadata=require('../apps/api/private-object-metadata.js');

function bytes(label='metadata'){return Buffer.from('%PDF-1.4\n% '+label+'\n','ascii')}

test('provider-neutral metadata skapar serverstyrd objektnyckel',()=>{
  const payload=bytes('invoice');
  const metadata=Metadata.metadataForBytes({
    companyId:'company_123',
    kind:'customer-invoice-pdf',
    objectId:'invoice_456',
    mimeType:'application/pdf',
    bytes:payload
  });
  assert.equal(metadata.version,1);
  assert.equal(metadata.companyId,'company_123');
  assert.equal(metadata.objectKey,'private/company_123/customer-invoice-pdf/invoice_456');
  assert.equal(metadata.mimeType,'application/pdf');
  assert.equal(metadata.sizeBytes,payload.length);
  assert.equal(metadata.sha256,crypto.createHash('sha256').update(payload).digest('hex'));
  assert.equal(metadata.status,'ready');
  assert.equal(Metadata.assertBytesMatch(metadata,payload),metadata);
});

test('objektnyckeln kan inte styras med slash eller traversal i id-fält',()=>{
  assert.throws(()=>Metadata.objectKey({companyId:'../company',kind:'document',objectId:'doc_1'}),error=>error.code==='OBJECT_METADATA_INVALID');
  assert.throws(()=>Metadata.objectKey({companyId:'company_1',kind:'document',objectId:'../../secret'}),error=>error.code==='OBJECT_METADATA_INVALID');
});

test('endast kända privata objekttyper tillåts',()=>{
  assert.throws(()=>Metadata.createObjectMetadata({
    companyId:'company_1',
    kind:'unknown-private-object',
    objectId:'object_1',
    mimeType:'application/pdf',
    sizeBytes:10,
    sha256:'a'.repeat(64),
    status:'ready'
  }),error=>error.code==='OBJECT_METADATA_INVALID');
});

test('integritetskontroll stoppar ändrade bytes och fel storlek',()=>{
  const original=bytes('original');
  const metadata=Metadata.metadataForBytes({
    companyId:'company_1',
    kind:'document',
    objectId:'doc_1',
    mimeType:'application/pdf',
    bytes:original
  });
  assert.throws(()=>Metadata.assertBytesMatch(metadata,bytes('changed')),error=>error.code==='OBJECT_METADATA_INTEGRITY_ERROR');
  assert.throws(()=>Metadata.assertBytesMatch({...metadata,sizeBytes:metadata.sizeBytes+1},original),error=>error.code==='OBJECT_METADATA_INTEGRITY_ERROR');
});
