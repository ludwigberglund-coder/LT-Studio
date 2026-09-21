'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Inventory=require('../apps/api/inventory.js');

test('identiskt artikelskapande återanvänder samma artikel utan ny audit',async()=>{
  const f=await fixture();
  try{
    const headers=await f.login(f.admin.username);
    const payload={
      sku:'IDEMP-PEAR',
      name:'Idempotenta päron',
      unit:'kg',
      purchaseAccount:'4010',
      inventoryAccount:'1460'
    };

    const first=await fetch(f.base+'/api/v1/inventory/items',{
      method:'POST',headers,body:JSON.stringify(payload)
    });
    const firstBody=await first.json();
    assert.equal(first.status,201);
    assert.equal(firstBody.duplicate,false);

    const retry=await fetch(f.base+'/api/v1/inventory/items',{
      method:'POST',headers,body:JSON.stringify(payload)
    });
    const retryBody=await retry.json();
    assert.equal(retry.status,200);
    assert.equal(retryBody.duplicate,true);
    assert.equal(retryBody.item.id,firstBody.item.id);

    assert.equal(Inventory.listItems(f.db,f.a.id).filter(item=>item.sku===payload.sku).length,1);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='INVENTORY_ITEM_CREATED'&&event.entityId===firstBody.item.id).length,
      1
    );

    const changedName=await fetch(f.base+'/api/v1/inventory/items',{
      method:'POST',headers,body:JSON.stringify({...payload,name:'Andra päron'})
    });
    assert.equal(changedName.status,409);
    assert.equal((await changedName.json()).code,'INVENTORY_ITEM_IDEMPOTENCY_CONFLICT');

    const changedAccount=await fetch(f.base+'/api/v1/inventory/items',{
      method:'POST',headers,body:JSON.stringify({...payload,purchaseAccount:'4020'})
    });
    assert.equal(changedAccount.status,409);
    assert.equal((await changedAccount.json()).code,'INVENTORY_ITEM_IDEMPOTENCY_CONFLICT');

    assert.equal(Inventory.listItems(f.db,f.a.id).filter(item=>item.sku===payload.sku).length,1);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='INVENTORY_ITEM_CREATED'&&event.entityId===firstBody.item.id).length,
      1
    );
  }finally{
    await f.close();
  }
});
