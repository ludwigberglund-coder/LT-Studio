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
