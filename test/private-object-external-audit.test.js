'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Documents=require('../apps/api/documents.js');
const Planner=require('../apps/api/private-object-copy-planner.js');
const Inventory=require('../apps/api/private-object-inventory.js');
const Ledger=require('../apps/api/private-object-copy-ledger.js');
const Worker=require('../apps/api/private-object-copy-worker.js');
const Audit=require('../apps/api/private-object-external-audit.js');

function fakeTarget(){
  const objects=new Map();
  const calls=[];
  return{
    objects,
    calls,
    async put({storageKey,bytes}){
      calls.push(['put',storageKey]);
      objects.set(storageKey,Buffer.from(bytes));
      return true;
    },
    async get({storageKey}){
      calls.push(['get',storageKey]);
      const bytes=objects.get(storageKey);
      if(!bytes){
        const error=new Error('missing target object');
        error.code='SIMULATED_REMOTE_MISSING';
        throw error;
      }
      return Buffer.from(bytes);
    }
  };
}

async function plannedFixture(){
  const f=await fixture();
  const document=Documents.createPending(f.db,{
    companyId:f.a.id,
    uploadedBy:f.admin.id,
    title:'External audit document',
    category:'other',
    fileName:'external-audit.pdf',
    mimeType:'application/pdf'
  });
  Documents.storeContent(f.db,{
    companyId:f.a.id,
    documentId:document.id,
    bytes:Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\nexternal audit document\n%%EOF\n','ascii')
  });

  Planner.planVerifiedPrivateObjectCopies(f.db,{
    targetProvider:'r2',
    generatedAt:'2026-09-21T12:00:00.000Z',
    plannedAt:'2026-09-21T12:01:00.000Z'
  });
  const inventory=Inventory.buildPrivateObjectInventory(f.db,{
    provider:'sqlite',
    generatedAt:'2026-09-21T12:02:00.000Z'
  });
  assert.equal(inventory.ok,true);
  return{f,inventory,target:fakeTarget()};
}

async function copyObject(f,target,object){
  const copy=Ledger.copyByIdentity(f.db,{
    companyId:object.companyId,
    kind:object.kind,
    objectId:object.objectId,
    sha256:object.sha256,
    provider:'r2'
  });
  assert.ok(copy);
  await Worker.copyPlannedPrivateObject(
    f.db,
    Worker.identityFromCopy(copy),
    {targetStore:target}
  );
  return Ledger.copyByIdentity(f.db,Worker.identityFromCopy(copy));
}

test('extern staging-audit verifierar alla aktuella source-objekt mot ready-kopior',async()=>{
  const {f,inventory,target}=await plannedFixture();
  try{
    for(const object of inventory.objects)await copyObject(f,target,object);
    target.calls.length=0;

    const report=await Audit.auditExternalPrivateObjects(f.db,{
      targetStore:target,
      targetProvider:'r2',
      auditedAt:'2026-09-21T12:10:00.000Z'
    });

    assert.equal(report.ok,true);
    assert.equal(report.sourceOk,true);
    assert.equal(report.sourceObjectCount,inventory.objectCount);
    assert.equal(report.readyCount,inventory.objectCount);
    assert.equal(report.verifiedExternalCount,inventory.objectCount);
    assert.equal(report.missingReadyCount,0);
    assert.equal(report.issueCount,0);
    assert.match(report.sourceManifestSha256,/^[a-f0-9]{64}$/);
    assert.equal(target.calls.filter(call=>call[0]==='get').length,inventory.objectCount);
    assert.equal(report.countsByKind.document.verified,1);
    assert.ok(report.countsByKind['supplier-invoice'].verified>=1);
    assert.ok(report.countsByKind['customer-invoice-pdf'].verified>=1);
  }finally{
    await f.close();
  }
});

test('extern staging-audit stoppar när ett aktuellt objekt saknar ready-kopia',async()=>{
  const {f,inventory,target}=await plannedFixture();
  try{
    for(const object of inventory.objects.slice(0,-1))await copyObject(f,target,object);

    const report=await Audit.auditExternalPrivateObjects(f.db,{
      targetStore:target,
      targetProvider:'r2',
      auditedAt:'2026-09-21T12:20:00.000Z'
    });

    assert.equal(report.ok,false);
    assert.equal(report.sourceOk,true);
    assert.equal(report.missingReadyCount,1);
    assert.equal(report.verifiedExternalCount,inventory.objectCount-1);
    assert.ok(report.issues.some(issue=>issue.code==='PRIVATE_OBJECT_EXTERNAL_COPY_NOT_READY'));
  }finally{
    await f.close();
  }
});

test('extern staging-audit upptäcker bytekorruption även på en redan ready-markerad kopia',async()=>{
  const {f,inventory,target}=await plannedFixture();
  try{
    for(const object of inventory.objects)await copyObject(f,target,object);
    const [storageKey,stored]=target.objects.entries().next().value;
    const corrupted=Buffer.from(stored);
    corrupted[corrupted.length-1]^=1;
    target.objects.set(storageKey,corrupted);

    const report=await Audit.auditExternalPrivateObjects(f.db,{
      targetStore:target,
      targetProvider:'r2',
      auditedAt:'2026-09-21T12:30:00.000Z'
    });

    assert.equal(report.ok,false);
    assert.equal(report.readyCount,inventory.objectCount);
    assert.equal(report.verifiedExternalCount,inventory.objectCount-1);
    assert.ok(report.issues.some(issue=>issue.code==='PRIVATE_OBJECT_SHA256_MISMATCH'));
  }finally{
    await f.close();
  }
});

test('extern staging-audit gör inga externa läsningar om SQLite-källan inte längre verifieras',async()=>{
  const {f,target}=await plannedFixture();
  try{
    f.db.prepare('UPDATE supplier_invoices SET document_blob=? WHERE company_id=? AND id=?')
      .run(Buffer.from('%PDF-1.4\ncorrupt audit source\n','ascii'),f.a.id,f.payable.id);

    const report=await Audit.auditExternalPrivateObjects(f.db,{
      targetStore:target,
      targetProvider:'r2',
      auditedAt:'2026-09-21T12:40:00.000Z'
    });

    assert.equal(report.ok,false);
    assert.equal(report.sourceOk,false);
    assert.equal(report.verifiedExternalCount,0);
    assert.equal(target.calls.length,0);
    assert.ok(report.issueCount>=1);
  }finally{
    await f.close();
  }
});
