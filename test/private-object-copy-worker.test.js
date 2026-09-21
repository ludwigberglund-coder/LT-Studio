'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Planner=require('../apps/api/private-object-copy-planner.js');
const Ledger=require('../apps/api/private-object-copy-ledger.js');
const Worker=require('../apps/api/private-object-copy-worker.js');
const PrivateObject=require('../apps/api/private-object-contract.js');

function fakeTarget(){
  const objects=new Map();
  const calls=[];
  return{
    objects,
    calls,
    corruptRead:false,
    failPut:false,
    async put({storageKey,metadata,bytes}){
      calls.push(['put',storageKey,metadata.sha256]);
      if(this.failPut)throw Object.assign(new Error('simulerat targetfel'),{code:'SIMULATED_TARGET_FAILURE'});
      objects.set(storageKey,Buffer.from(bytes));
      return true;
    },
    async get({storageKey,metadata}){
      calls.push(['get',storageKey,metadata.sha256]);
      const bytes=objects.get(storageKey);
      if(!bytes)return null;
      if(this.corruptRead)return Buffer.from('%PDF-1.4\ncorrupt target readback\n','ascii');
      return Buffer.from(bytes);
    }
  };
}

async function plannedFixture(){
  const f=await fixture();
  Planner.planVerifiedPrivateObjectCopies(f.db,{
    targetProvider:'r2',
    generatedAt:'2026-09-21T09:30:00.000Z',
    plannedAt:'2026-09-21T09:31:00.000Z'
  });
  const copy=Ledger.copiesForCompany(f.db,f.a.id).find(row=>
    row.kind===PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE&&
    row.objectId===f.payable.id
  );
  if(!copy)throw new Error('planned supplier copy missing');
  return{f,copy,identity:Worker.identityFromCopy(copy)};
}

test('async copy worker verifierar source, upload och readback innan ready',async()=>{
  const {f,copy,identity}=await plannedFixture();
  const target=fakeTarget();
  try{
    const result=await Worker.copyPlannedPrivateObject(f.db,identity,{targetStore:target});
    assert.equal(result.duplicate,false);
    assert.equal(result.copy.status,'ready');
    assert.equal(result.copy.attemptCount,1);
    assert.equal(target.calls.length,2);
    assert.equal(target.calls[0][0],'put');
    assert.equal(target.calls[1][0],'get');
    assert.equal(target.calls[0][1],copy.storageKey);
    assert.equal(target.objects.size,1);

    const repeated=await Worker.copyPlannedPrivateObject(f.db,identity,{targetStore:target});
    assert.equal(repeated.duplicate,true);
    assert.equal(repeated.copy.status,'ready');
    assert.equal(target.calls.length,2);
  }finally{
    await f.close();
  }
});

test('felaktig readback markeras failed och kan återförsökas på samma immutabla nyckel',async()=>{
  const {f,copy,identity}=await plannedFixture();
  const target=fakeTarget();
  target.corruptRead=true;
  try{
    await assert.rejects(
      Worker.copyPlannedPrivateObject(f.db,identity,{targetStore:target}),
      error=>error.code==='PRIVATE_OBJECT_COPY_ATTEMPT_FAILED'&&
        error.causeCode==='PRIVATE_OBJECT_SIZE_MISMATCH'
    );
    const failed=Ledger.copyByIdentity(f.db,identity);
    assert.equal(failed.status,'failed');
    assert.equal(failed.attemptCount,1);
    assert.match(failed.lastError,/PRIVATE_OBJECT_SIZE_MISMATCH/);
    assert.equal(target.objects.size,1);

    target.corruptRead=false;
    const retry=await Worker.copyPlannedPrivateObject(f.db,identity,{targetStore:target});
    assert.equal(retry.copy.status,'ready');
    assert.equal(retry.copy.attemptCount,2);
    assert.equal(retry.copy.storageKey,copy.storageKey);
    assert.equal(target.objects.size,1);
  }finally{
    await f.close();
  }
});

test('källan verifieras igen efter planering och korruption stoppas före upload',async()=>{
  const {f,identity}=await plannedFixture();
  const target=fakeTarget();
  try{
    const original=f.db.prepare('SELECT document_blob AS bytes FROM supplier_invoices WHERE company_id=? AND id=?')
      .get(f.a.id,f.payable.id).bytes;
    const corrupted=Buffer.from(original);
    corrupted[corrupted.length-1]^=1;
    f.db.prepare('UPDATE supplier_invoices SET document_blob=? WHERE company_id=? AND id=?')
      .run(corrupted,f.a.id,f.payable.id);

    await assert.rejects(
      Worker.copyPlannedPrivateObject(f.db,identity,{targetStore:target}),
      error=>error.code==='PRIVATE_OBJECT_COPY_ATTEMPT_FAILED'&&
        error.causeCode==='PRIVATE_OBJECT_SHA256_MISMATCH'
    );
    const failed=Ledger.copyByIdentity(f.db,identity);
    assert.equal(failed.status,'failed');
    assert.equal(failed.attemptCount,1);
    assert.equal(target.calls.length,0);
    assert.equal(target.objects.size,0);
  }finally{
    await f.close();
  }
});

test('worker kräver planerad tenant-specifik identity och ett explicit staging-target',async()=>{
  const {f,copy}=await plannedFixture();
  try{
    await assert.rejects(
      Worker.copyPlannedPrivateObject(f.db,{
        companyId:f.b.id,
        kind:copy.kind,
        objectId:copy.objectId,
        sha256:copy.sha256,
        provider:copy.provider
      },{targetStore:fakeTarget()}),
      error=>error.code==='PRIVATE_OBJECT_COPY_NOT_FOUND'
    );
    await assert.rejects(
      Worker.copyPlannedPrivateObject(f.db,Worker.identityFromCopy(copy),{}),
      error=>error.code==='PRIVATE_OBJECT_COPY_TARGET_REQUIRED'
    );
  }finally{
    await f.close();
  }
});
