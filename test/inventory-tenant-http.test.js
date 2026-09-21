'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Inventory=require('../apps/api/inventory.js');

async function run(fn){const f=await fixture();try{await fn(f)}finally{await f.close()}}

test('lagerobjekt från annat företag kan inte användas via HTTP',()=>run(async f=>{
  const item=Inventory.createItem(f.db,{
    companyId:f.a.id,
    sku:'IDOR-APPLE',
    name:'IDOR testäpple',
    unit:'kg',
    purchaseAccount:'4010',
    inventoryAccount:'1460'
  });
  Inventory.addMovement(f.db,{
    companyId:f.a.id,
    itemId:item.id,
    movementDate:'2026-09-20',
    type:'receipt',
    quantityMilli:10000,
    actorId:f.admin.id
  });
  const adjustment=Inventory.createAdjustment(f.db,{
    companyId:f.a.id,
    itemId:item.id,
    adjustmentDate:'2026-09-20',
    countedQuantityMilli:9000,
    reason:'IDOR test',
    countedBy:f.admin.id
  });

  const otherHeaders=await f.login(f.other.username);
  const cases=[
    ['POST','/inventory/movements',{itemId:item.id,movementDate:'2026-09-20',type:'sale',quantityMilli:-1000}],
    ['POST','/inventory/adjustments',{itemId:item.id,adjustmentDate:'2026-09-20',countedQuantityMilli:8000,reason:'Ska stoppas'}],
    ['POST','/inventory/adjustments/'+adjustment.id+'/approve',{}],
    ['POST','/inventory/adjustments/'+adjustment.id+'/reject',{}]
  ];

  for(const [method,route,body] of cases){
    const response=await fetch(f.base+'/api/v1'+route,{method,headers:otherHeaders,body:JSON.stringify(body)});
    assert.equal(response.status,404,method+' '+route);
  }

  assert.equal(Inventory.balanceMilli(f.db,f.a.id,item.id),10000);
  assert.equal(Inventory.adjustmentById(f.db,f.a.id,adjustment.id).status,'pending');
  assert.equal(Db.auditForCompany(f.db,f.b.id).filter(e=>e.action.startsWith('INVENTORY_')).length,0);
}));


test('lager-HTTP är idempotent för rörelser och inventeringsbegäran',()=>run(async f=>{
  const item=Inventory.createItem(f.db,{
    companyId:f.a.id,
    sku:'IDEMP-APPLE',
    name:'Idempotent testäpple',
    unit:'kg',
    purchaseAccount:'4010',
    inventoryAccount:'1460'
  });
  const headers=await f.login();

  const movementBody={
    requestId:'inventory-http-move-0001',
    itemId:item.id,
    movementDate:'2026-09-20',
    type:'receipt',
    quantityMilli:10000,
    note:'Retry-safe HTTP movement'
  };
  const first=await fetch(f.base+'/api/v1/inventory/movements',{method:'POST',headers,body:JSON.stringify(movementBody)});
  assert.equal(first.status,201);
  const firstBody=await first.json();assert.equal(firstBody.duplicate,false);

  const retry=await fetch(f.base+'/api/v1/inventory/movements',{method:'POST',headers,body:JSON.stringify(movementBody)});
  assert.equal(retry.status,200);
  const retryBody=await retry.json();assert.equal(retryBody.duplicate,true);assert.equal(retryBody.movement.id,firstBody.movement.id);

  const conflict=await fetch(f.base+'/api/v1/inventory/movements',{method:'POST',headers,body:JSON.stringify({...movementBody,quantityMilli:11000})});
  assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'INVENTORY_IDEMPOTENCY_CONFLICT');
  assert.equal(Inventory.balanceMilli(f.db,f.a.id,item.id),10000);
  assert.equal(Db.auditForCompany(f.db,f.a.id).filter(e=>e.action==='INVENTORY_MOVEMENT_CREATED'&&e.entityId===firstBody.movement.id).length,1);

  const adjustmentBody={
    requestId:'inventory-http-adjust-0001',
    itemId:item.id,
    adjustmentDate:'2026-09-20',
    countedQuantityMilli:9000,
    reason:'Retry-safe HTTP adjustment'
  };
  const adjustmentFirst=await fetch(f.base+'/api/v1/inventory/adjustments',{method:'POST',headers,body:JSON.stringify(adjustmentBody)});
  assert.equal(adjustmentFirst.status,201);
  const adjustmentOne=await adjustmentFirst.json();assert.equal(adjustmentOne.duplicate,false);

  const adjustmentRetry=await fetch(f.base+'/api/v1/inventory/adjustments',{method:'POST',headers,body:JSON.stringify(adjustmentBody)});
  assert.equal(adjustmentRetry.status,200);
  const adjustmentTwo=await adjustmentRetry.json();assert.equal(adjustmentTwo.duplicate,true);assert.equal(adjustmentTwo.adjustment.id,adjustmentOne.adjustment.id);

  const adjustmentConflict=await fetch(f.base+'/api/v1/inventory/adjustments',{method:'POST',headers,body:JSON.stringify({...adjustmentBody,countedQuantityMilli:8500})});
  assert.equal(adjustmentConflict.status,409);assert.equal((await adjustmentConflict.json()).code,'INVENTORY_IDEMPOTENCY_CONFLICT');
  assert.equal(Inventory.listAdjustments(f.db,f.a.id,{status:'pending'}).length,1);
  assert.equal(Db.auditForCompany(f.db,f.a.id).filter(e=>e.action==='INVENTORY_ADJUSTMENT_REQUESTED'&&e.entityId===adjustmentOne.adjustment.id).length,1);
}));
