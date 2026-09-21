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
    ['POST','/inventory/movements',{requestId:'foreign-inventory-0001',itemId:item.id,movementDate:'2026-09-20',type:'sale',quantityMilli:-1000}],
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


test('manuell lagerrörelse är idempotent genom HTTP och skapar bara ett audit-event',()=>run(async f=>{
  const item=Inventory.createItem(f.db,{
    companyId:f.a.id,
    sku:'IDEMP-APPLE',
    name:'Idempotensäpple',
    unit:'kg',
    purchaseAccount:'4010',
    inventoryAccount:'1460'
  });
  const headers=await f.login();
  const body={requestId:'inventory-http-retry-0001',itemId:item.id,movementDate:'2026-09-20',type:'receipt',quantityMilli:10000,note:'HTTP retry'};

  const first=await fetch(f.base+'/api/v1/inventory/movements',{method:'POST',headers,body:JSON.stringify(body)});
  const firstData=await first.json();
  assert.equal(first.status,201);assert.equal(firstData.duplicate,false);

  const retry=await fetch(f.base+'/api/v1/inventory/movements',{method:'POST',headers,body:JSON.stringify(body)});
  const retryData=await retry.json();
  assert.equal(retry.status,200);assert.equal(retryData.duplicate,true);assert.equal(retryData.movement.id,firstData.movement.id);

  const conflict=await fetch(f.base+'/api/v1/inventory/movements',{method:'POST',headers,body:JSON.stringify({...body,quantityMilli:11000})});
  const conflictData=await conflict.json();
  assert.equal(conflict.status,409);assert.equal(conflictData.code,'INVENTORY_IDEMPOTENCY_CONFLICT');

  assert.equal(Inventory.balanceMilli(f.db,f.a.id,item.id),10000);
  assert.equal(Inventory.listMovements(f.db,f.a.id,{itemId:item.id}).length,1);
  assert.equal(Db.auditForCompany(f.db,f.a.id).filter(e=>e.action==='INVENTORY_MOVEMENT_CREATED'&&e.entityId===firstData.movement.id).length,1);
}));
