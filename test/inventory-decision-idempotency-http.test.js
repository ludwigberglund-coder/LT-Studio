'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Inventory=require('../apps/api/inventory.js');

test('lagerjusteringens godkännande och avslag är idempotenta för samma beslutsfattare',async()=>{
  const f=await fixture();
  try{
    const approverHeaders=await f.login(f.auditor.username);
    const item=Inventory.createItem(f.db,{
      companyId:f.a.id,
      sku:'DECISION-APPLE',
      name:'Beslutstest äpplen',
      unit:'kg',
      purchaseAccount:'4010',
      inventoryAccount:'1460'
    });
    Inventory.addMovement(f.db,{
      companyId:f.a.id,
      itemId:item.id,
      movementDate:'2026-09-21',
      type:'receipt',
      quantityMilli:10000,
      actorId:f.admin.id
    });

    const approveTarget=Inventory.createAdjustment(f.db,{
      companyId:f.a.id,
      itemId:item.id,
      adjustmentDate:'2026-09-21',
      countedQuantityMilli:8000,
      reason:'Godkännandetest',
      countedBy:f.admin.id
    });

    const approve1=await fetch(f.base+`/api/v1/inventory/adjustments/${approveTarget.id}/approve`,{
      method:'POST',
      headers:approverHeaders,
      body:JSON.stringify({})
    });
    const approve1Body=await approve1.json();
    assert.equal(approve1.status,200);
    assert.equal(approve1Body.duplicate,false);
    assert.equal(approve1Body.adjustment.status,'approved');
    assert.equal(approve1Body.movement.quantityMilli,-2000);
    assert.equal(Inventory.balanceMilli(f.db,f.a.id,item.id),8000);

    const approve2=await fetch(f.base+`/api/v1/inventory/adjustments/${approveTarget.id}/approve`,{
      method:'POST',
      headers:approverHeaders,
      body:JSON.stringify({})
    });
    const approve2Body=await approve2.json();
    assert.equal(approve2.status,200);
    assert.equal(approve2Body.duplicate,true);
    assert.equal(approve2Body.movement.id,approve1Body.movement.id);
    assert.equal(approve2Body.adjustment.approvedAt,approve1Body.adjustment.approvedAt);
    assert.equal(Inventory.balanceMilli(f.db,f.a.id,item.id),8000);
    assert.equal(
      Inventory.listMovements(f.db,f.a.id,{itemId:item.id})
        .filter(row=>row.referenceType==='inventory-adjustment'&&row.referenceId===approveTarget.id).length,
      1
    );
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='INVENTORY_ADJUSTMENT_APPROVED'&&event.entityId===approveTarget.id).length,
      1
    );

    assert.throws(
      ()=>Inventory.approveAdjustmentIdempotent(f.db,{
        companyId:f.a.id,
        adjustmentId:approveTarget.id,
        approvedBy:f.admin.id
      }),
      error=>error.code==='ADJUSTMENT_ALREADY_DECIDED'
    );

    const rejectTarget=Inventory.createAdjustment(f.db,{
      companyId:f.a.id,
      itemId:item.id,
      adjustmentDate:'2026-09-21',
      countedQuantityMilli:7000,
      reason:'Avslagstest',
      countedBy:f.admin.id
    });

    const reject1=await fetch(f.base+`/api/v1/inventory/adjustments/${rejectTarget.id}/reject`,{
      method:'POST',
      headers:approverHeaders,
      body:JSON.stringify({})
    });
    const reject1Body=await reject1.json();
    assert.equal(reject1.status,200);
    assert.equal(reject1Body.duplicate,false);
    assert.equal(reject1Body.adjustment.status,'rejected');
    assert.equal(Inventory.balanceMilli(f.db,f.a.id,item.id),8000);

    const reject2=await fetch(f.base+`/api/v1/inventory/adjustments/${rejectTarget.id}/reject`,{
      method:'POST',
      headers:approverHeaders,
      body:JSON.stringify({})
    });
    const reject2Body=await reject2.json();
    assert.equal(reject2.status,200);
    assert.equal(reject2Body.duplicate,true);
    assert.equal(reject2Body.adjustment.id,reject1Body.adjustment.id);
    assert.equal(reject2Body.adjustment.rejectedAt,reject1Body.adjustment.rejectedAt);
    assert.equal(Inventory.balanceMilli(f.db,f.a.id,item.id),8000);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='INVENTORY_ADJUSTMENT_REJECTED'&&event.entityId===rejectTarget.id).length,
      1
    );

    assert.throws(
      ()=>Inventory.rejectAdjustmentIdempotent(f.db,{
        companyId:f.a.id,
        adjustmentId:rejectTarget.id,
        rejectedBy:f.admin.id
      }),
      error=>error.code==='ADJUSTMENT_ALREADY_DECIDED'
    );
  }finally{
    await f.close();
  }
});
