'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Inventory=require('../apps/api/inventory.js');

function seed(){
  const db=Db.openDatabase(':memory:');Inventory.initializeInventory(db);
  const company=Db.createCompany(db,{legalName:'Lagerbolaget AB',displayName:'Lagerbolaget',orgNumber:'559900-3030'});
  const hash=Auth.hashPassword('Sakert lagertest 2026!');
  const counter=Db.createUser(db,{username:'counter',displayName:'Inventerare',passwordHash:hash});
  const approver=Db.createUser(db,{username:'stockapprover',displayName:'Lagergodkännare',passwordHash:hash});
  const item=Inventory.createItem(db,{companyId:company.id,sku:'APPLE-SE',name:'Svenska äpplen',unit:'kg',purchaseAccount:'4010',inventoryAccount:'1460'});
  return{db,company,counter,approver,item};
}

test('inleverans, försäljning och svinn ger korrekt lagersaldo i tusendelar',()=>{
  const {db,company,counter,item}=seed();try{
    Inventory.addMovement(db,{companyId:company.id,itemId:item.id,movementDate:'2026-09-16',type:'receipt',quantityMilli:12500,unitCostOre:3200,actorId:counter.id});
    Inventory.addMovement(db,{companyId:company.id,itemId:item.id,movementDate:'2026-09-16',type:'sale',quantityMilli:-2250,actorId:counter.id});
    Inventory.addMovement(db,{companyId:company.id,itemId:item.id,movementDate:'2026-09-16',type:'waste',quantityMilli:-750,note:'Skadat',actorId:counter.id});
    assert.equal(Inventory.balanceMilli(db,company.id,item.id),9500);
  }finally{db.close()}
});

test('manuell lagerrörelse återanvänds vid retry och konfliktar om samma request-id ändras',()=>{
  const {db,company,counter,item}=seed();try{
    const input={companyId:company.id,requestId:'inventory-retry-0001',itemId:item.id,movementDate:'2026-09-16',type:'receipt',quantityMilli:10000,note:'Retry test',actorId:counter.id};
    const first=Inventory.createMovement(db,input);
    const retry=Inventory.createMovement(db,input);
    assert.equal(first.duplicate,false);
    assert.equal(retry.duplicate,true);
    assert.equal(retry.movement.id,first.movement.id);
    assert.equal(Inventory.balanceMilli(db,company.id,item.id),10000);
    assert.equal(Inventory.listMovements(db,company.id).length,1);
    assert.throws(()=>Inventory.createMovement(db,{...input,quantityMilli:11000}),e=>e.code==='INVENTORY_IDEMPOTENCY_CONFLICT'&&e.statusCode===409);
    assert.equal(Inventory.balanceMilli(db,company.id,item.id),10000);
  }finally{db.close()}
});

test('lagret får inte bli negativt',()=>{
  const {db,company,counter,item}=seed();try{
    assert.throws(()=>Inventory.addMovement(db,{companyId:company.id,itemId:item.id,movementDate:'2026-09-16',type:'waste',quantityMilli:-1000,actorId:counter.id}),e=>e.code==='NEGATIVE_STOCK');
  }finally{db.close()}
});

test('inventeraren får inte ensam godkänna sin justering',()=>{
  const {db,company,counter,item}=seed();try{
    Inventory.addMovement(db,{companyId:company.id,itemId:item.id,movementDate:'2026-09-16',type:'receipt',quantityMilli:10000,actorId:counter.id});
    const adjustment=Inventory.createAdjustment(db,{companyId:company.id,itemId:item.id,adjustmentDate:'2026-09-16',countedQuantityMilli:9000,reason:'Inventering',countedBy:counter.id});
    assert.equal(adjustment.differenceMilli,-1000);
    assert.throws(()=>Inventory.approveAdjustment(db,{companyId:company.id,adjustmentId:adjustment.id,approvedBy:counter.id}),e=>e.code==='SEPARATION_OF_DUTIES_FAILED');
  }finally{db.close()}
});

test('separat godkännare skapar justeringsrörelse och nytt saldo',()=>{
  const {db,company,counter,approver,item}=seed();try{
    Inventory.addMovement(db,{companyId:company.id,itemId:item.id,movementDate:'2026-09-16',type:'receipt',quantityMilli:10000,actorId:counter.id});
    const adjustment=Inventory.createAdjustment(db,{companyId:company.id,itemId:item.id,adjustmentDate:'2026-09-16',countedQuantityMilli:8750,reason:'Inventeringsdifferens',countedBy:counter.id});
    const result=Inventory.approveAdjustment(db,{companyId:company.id,adjustmentId:adjustment.id,approvedBy:approver.id});
    assert.equal(result.adjustment.status,'approved');
    assert.equal(result.movement.quantityMilli,-1250);
    assert.equal(Inventory.balanceMilli(db,company.id,item.id),8750);
  }finally{db.close()}
});

test('justering blockeras om lagret ändrats efter räkningen',()=>{
  const {db,company,counter,approver,item}=seed();try{
    Inventory.addMovement(db,{companyId:company.id,itemId:item.id,movementDate:'2026-09-16',type:'receipt',quantityMilli:10000,actorId:counter.id});
    const adjustment=Inventory.createAdjustment(db,{companyId:company.id,itemId:item.id,adjustmentDate:'2026-09-16',countedQuantityMilli:9000,reason:'Inventering',countedBy:counter.id});
    Inventory.addMovement(db,{companyId:company.id,itemId:item.id,movementDate:'2026-09-16',type:'sale',quantityMilli:-500,actorId:counter.id});
    assert.throws(()=>Inventory.approveAdjustment(db,{companyId:company.id,adjustmentId:adjustment.id,approvedBy:approver.id}),e=>e.code==='STOCK_CHANGED_SINCE_COUNT');
    assert.equal(Inventory.balanceMilli(db,company.id,item.id),9500);
  }finally{db.close()}
});

test('artiklar är isolerade per företag',()=>{
  const {db,company,item}=seed();try{
    const other=Db.createCompany(db,{legalName:'Andra Bolaget AB',displayName:'Andra',orgNumber:'559900-4040'});
    assert.equal(Inventory.itemById(db,other.id,item.id),null);
    assert.equal(Inventory.listItems(db,other.id).length,0);
    assert.equal(Inventory.listItems(db,company.id).length,1);
  }finally{db.close()}
});
