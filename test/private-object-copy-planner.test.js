'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Documents=require('../apps/api/documents.js');
const Planner=require('../apps/api/private-object-copy-planner.js');

async function fixtureWithAllKinds(){
  const f=await fixture();
  const document=Documents.createPending(f.db,{
    companyId:f.a.id,
    uploadedBy:f.admin.id,
    title:'Copy planner document',
    category:'other',
    fileName:'copy-planner.pdf',
    mimeType:'application/pdf'
  });
  Documents.storeContent(f.db,{companyId:f.a.id,documentId:document.id,bytes:f.pdf});
  return f;
}

test('kopieringsplan skapas atomiskt från ett helt verifierat manifest och är idempotent',async()=>{
  const f=await fixtureWithAllKinds();
  try{
    const first=Planner.planVerifiedPrivateObjectCopies(f.db,{
      targetProvider:'r2',
      generatedAt:'2026-09-21T09:00:00.000Z',
      plannedAt:'2026-09-21T09:01:00.000Z'
    });
    assert.equal(first.sourceObjectCount,4);
    assert.equal(first.newPlans,4);
    assert.equal(first.existingPlans,0);
    assert.deepEqual(first.statusCounts,{pending:4,failed:0,ready:0});

    const second=Planner.planVerifiedPrivateObjectCopies(f.db,{
      targetProvider:'r2',
      generatedAt:'2026-09-21T09:02:00.000Z',
      plannedAt:'2026-09-21T09:03:00.000Z'
    });
    assert.equal(second.sourceObjectCount,4);
    assert.equal(second.newPlans,0);
    assert.equal(second.existingPlans,4);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM private_object_copies').get().count,4);
  }finally{
    await f.close();
  }
});

test('korrupt källobjekt stoppar hela kopieringsplanen innan ledger-rader skapas',async()=>{
  const f=await fixtureWithAllKinds();
  try{
    f.db.prepare('UPDATE supplier_invoices SET document_blob=? WHERE company_id=? AND id=?')
      .run(Buffer.from('%PDF-1.4\ncorrupt before plan\n','ascii'),f.a.id,f.payable.id);

    assert.throws(
      ()=>Planner.planVerifiedPrivateObjectCopies(f.db,{
        targetProvider:'r2',
        generatedAt:'2026-09-21T09:10:00.000Z',
        plannedAt:'2026-09-21T09:11:00.000Z'
      }),
      error=>error.code==='PRIVATE_OBJECT_COPY_SOURCE_NOT_VERIFIED'
    );
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM private_object_copies').get().count,0);
  }finally{
    await f.close();
  }
});

test('ogiltig migrationstarget stoppas innan planering',async()=>{
  const f=await fixtureWithAllKinds();
  try{
    assert.throws(
      ()=>Planner.planVerifiedPrivateObjectCopies(f.db,{targetProvider:'filesystem'}),
      error=>error.code==='PRIVATE_OBJECT_COPY_PROVIDER_UNSUPPORTED'
    );
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM private_object_copies').get().count,0);
  }finally{
    await f.close();
  }
});
