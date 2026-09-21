'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Db=require('../apps/api/database.js');
const Ledger=require('../apps/api/private-object-copy-ledger.js');
const PrivateObject=require('../apps/api/private-object-contract.js');
const StoreFactory=require('../apps/api/private-object-store-factory.js');

function metadata({companyId='company_a',objectId='sinv_1',bytes=Buffer.from('%PDF-1.4\ncopy-ledger\n','ascii')}={}){
  return PrivateObject.createPrivateObjectMetadata({
    companyId,
    kind:PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE,
    objectId,
    mimeType:'application/pdf',
    sizeBytes:bytes.length,
    sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
    createdAt:'2026-09-21T08:30:00.000Z'
  });
}

function fixture(){
  const db=Db.openDatabase(':memory:');
  Db.createCompany(db,{id:'company_a',legalName:'A AB',displayName:'A',orgNumber:'559900-2001'});
  Db.createCompany(db,{id:'company_b',legalName:'B AB',displayName:'B',orgNumber:'559900-2002'});
  Ledger.initializePrivateObjectCopyLedger(db);
  return db;
}

test('extern kopieringsledger planerar immutabla innehållsnycklar utan att aktivera extern runtime-provider',()=>{
  const db=fixture();
  try{
    const source=metadata({});
    const copy=Ledger.planPrivateObjectCopy(db,{metadata:source,provider:'r2',createdAt:'2026-09-21T08:31:00.000Z'});
    assert.equal(copy.status,'pending');
    assert.equal(copy.attemptCount,0);
    assert.equal(copy.logicalKey,source.objectKey);
    assert.equal(copy.storageKey,source.objectKey+'/'+source.sha256);
    assert.equal(copy.companyId,'company_a');
    assert.deepEqual(StoreFactory.SUPPORTED_PROVIDERS,['sqlite']);
    assert.throws(()=>StoreFactory.normalizeProvider('r2'),error=>error.code==='PRIVATE_OBJECT_STORE_PROVIDER_UNSUPPORTED');
  }finally{db.close()}
});

test('ny SHA för samma affärsobjekt får en ny fysisk lagringsnyckel',()=>{
  const db=fixture();
  try{
    const first=metadata({bytes:Buffer.from('%PDF-1.4\nversion-one\n','ascii')});
    const second=metadata({bytes:Buffer.from('%PDF-1.4\nversion-two\n','ascii')});
    const a=Ledger.planPrivateObjectCopy(db,{metadata:first,provider:'r2'});
    const b=Ledger.planPrivateObjectCopy(db,{metadata:second,provider:'r2'});
    assert.notEqual(a.sha256,b.sha256);
    assert.notEqual(a.storageKey,b.storageKey);
    assert.equal(Ledger.copiesForCompany(db,'company_a').length,2);
  }finally{db.close()}
});

test('misslyckad kopia kan återförsökas idempotent men ready är slutstatus',()=>{
  const db=fixture();
  try{
    const source=metadata({});
    const identity={
      companyId:source.companyId,
      kind:source.kind,
      objectId:source.objectId,
      sha256:source.sha256,
      provider:'r2'
    };
    Ledger.planPrivateObjectCopy(db,{metadata:source,provider:'r2'});
    const firstAttempt=Ledger.startCopyAttempt(db,identity,{updatedAt:'2026-09-21T08:32:00.000Z'});
    assert.equal(firstAttempt.attemptCount,1);
    const failed=Ledger.markCopyFailed(db,identity,{message:'simulerat nätverksfel',updatedAt:'2026-09-21T08:33:00.000Z'});
    assert.equal(failed.status,'failed');
    const retry=Ledger.startCopyAttempt(db,identity,{updatedAt:'2026-09-21T08:34:00.000Z'});
    assert.equal(retry.status,'pending');
    assert.equal(retry.attemptCount,2);
    const ready=Ledger.markCopyReady(db,identity,{verifiedAt:'2026-09-21T08:35:00.000Z'});
    assert.equal(ready.status,'ready');
    assert.equal(ready.verifiedAt,'2026-09-21T08:35:00.000Z');
    assert.throws(
      ()=>Ledger.markCopyFailed(db,identity,{message:'ska stoppas'}),
      error=>error.code==='PRIVATE_OBJECT_COPY_READY_IMMUTABLE'
    );
    assert.equal(Ledger.startCopyAttempt(db,identity).status,'ready');
  }finally{db.close()}
});

test('samma objekt-id i två företag får separata externa nycklar och separata ledger-rader',()=>{
  const db=fixture();
  try{
    const a=metadata({companyId:'company_a',objectId:'shared_id'});
    const b=metadata({companyId:'company_b',objectId:'shared_id'});
    const copyA=Ledger.planPrivateObjectCopy(db,{metadata:a,provider:'r2'});
    const copyB=Ledger.planPrivateObjectCopy(db,{metadata:b,provider:'r2'});
    assert.notEqual(copyA.storageKey,copyB.storageKey);
    assert.match(copyA.storageKey,/^private\/company_a\//);
    assert.match(copyB.storageKey,/^private\/company_b\//);
    assert.equal(Ledger.copiesForCompany(db,'company_a').length,1);
    assert.equal(Ledger.copiesForCompany(db,'company_b').length,1);
  }finally{db.close()}
});


test('API-start initierar kopieringsledgern innan requests accepteras',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','apps','api','server.js'),'utf8');
  assert.match(source,/require\('\.\/private-object-copy-ledger\.js'\)/);
  assert.match(source,/PrivateObjectCopyLedger\.initializePrivateObjectCopyLedger\(db\)/);
});


test('identisk planering återanvänder raden även om ett senare försök har annan createdAt',()=>{
  const db=fixture();
  try{
    const source=metadata({});
    const first=Ledger.planPrivateObjectCopy(db,{
      metadata:source,
      provider:'r2',
      createdAt:'2026-09-21T09:40:00.000Z'
    });
    const second=Ledger.planPrivateObjectCopy(db,{
      metadata:source,
      provider:'r2',
      createdAt:'2026-09-21T09:41:00.000Z'
    });

    assert.equal(second.createdAt,first.createdAt);
    assert.equal(second.storageKey,first.storageKey);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM private_object_copies').get().count,1);
  }finally{db.close()}
});
