'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Contract=require('../apps/api/private-object-store-contract.js');
const PrivateObject=require('../apps/api/private-object-contract.js');

function fixture(){
  const bytes=Buffer.from('%PDF-1.4\n% object-store-contract\n','ascii');
  const metadata=PrivateObject.createPrivateObjectMetadata({
    companyId:'company_contract',
    kind:PrivateObject.PRIVATE_OBJECT_KINDS.DOCUMENT,
    objectId:'doc_contract',
    mimeType:'application/pdf',
    sizeBytes:bytes.length,
    sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
    createdAt:'2026-09-20T21:40:00.000Z'
  });
  return{bytes,metadata};
}

test('gemensam objektreferens skapar samma serverstyrda nyckel',()=>{
  const reference=Contract.createPrivateObjectReference({
    companyId:'company_contract',
    kind:'supplier-invoice',
    objectId:'sinv_contract'
  });
  assert.deepEqual(reference,{
    companyId:'company_contract',
    kind:'supplier-invoice',
    objectId:'sinv_contract',
    objectKey:'private/company_contract/supplier-invoices/sinv_contract'
  });
  assert.equal(Object.isFrozen(reference),true);
});

test('put-kontrakt verifierar storlek och SHA-256 före provider',()=>{
  const {bytes,metadata}=fixture();
  const request=Contract.normalizePutRequest({metadata,bytes});
  assert.deepEqual(request.metadata,metadata);
  assert.notEqual(request.bytes,bytes);
  assert.deepEqual(request.bytes,bytes);
  assert.throws(
    ()=>Contract.normalizePutRequest({metadata:{...metadata,sizeBytes:metadata.sizeBytes+1},bytes}),
    error=>error.code==='PRIVATE_OBJECT_SIZE_MISMATCH'
  );
  assert.throws(
    ()=>Contract.normalizePutRequest({metadata,bytes:Buffer.from('%PDF-1.4\nchanged\n')}),
    error=>error.code==='PRIVATE_OBJECT_SIZE_MISMATCH'||error.code==='PRIVATE_OBJECT_SHA256_MISMATCH'
  );
});

test('provider måste implementera put get och exists',()=>{
  assert.throws(
    ()=>Contract.assertPrivateObjectStore({put(){},get(){}}),
    error=>error.code==='PRIVATE_OBJECT_STORE_INVALID'
  );
  const provider={put(){return true},get(){return null},exists(){return false}};
  assert.equal(Contract.assertPrivateObjectStore(provider),provider);
});

test('kontrakterad provider får en enda normaliserad indataform',()=>{
  const calls=[];
  const provider={
    put(request){calls.push(['put',request]);return true},
    get(reference){calls.push(['get',reference]);return Buffer.from('stored')},
    exists(reference){calls.push(['exists',reference]);return true}
  };
  const store=Contract.createContractedPrivateObjectStore(provider);
  const {bytes,metadata}=fixture();

  assert.equal(store.put({metadata,bytes}),true);
  assert.deepEqual(store.get({companyId:metadata.companyId,kind:metadata.kind,objectId:metadata.objectId}),Buffer.from('stored'));
  assert.equal(store.exists({companyId:metadata.companyId,kind:metadata.kind,objectId:metadata.objectId}),true);

  assert.equal(calls[0][0],'put');
  assert.equal(calls[0][1].metadata.objectKey,metadata.objectKey);
  assert.deepEqual(calls[1][1],{
    companyId:metadata.companyId,
    kind:metadata.kind,
    objectId:metadata.objectId,
    objectKey:metadata.objectKey
  });
  assert.deepEqual(calls[2][1],calls[1][1]);
});
