'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');

test('kund utan fakturahistorik kan tas bort och raderingen loggas',async()=>{
  const f=await fixture();
  try{
    const customer=Db.createCustomer(f.db,{
      companyId:f.a.id,
      customerNumber:'K-DELETE-1',
      name:'Kund utan historik AB',
      address:{full:'Testgatan 1, Teststad'},
      orgNumber:'559900-3001'
    });
    const headers=await f.login(f.admin.username);
    const response=await fetch(f.base+'/api/v1/customers/'+customer.id,{method:'DELETE',headers});
    const data=await response.json();
    assert.equal(response.status,200);
    assert.equal(data.deleted,true);
    assert.equal(data.archived,false);
    assert.equal(Db.customerById(f.db,f.a.id,customer.id),null);
    const audit=Db.auditForCompany(f.db,f.a.id).find(event=>event.action==='CUSTOMER_DELETED'&&event.entityId===customer.id);
    assert.ok(audit);
    assert.equal(audit.details.customerNumber,'K-DELETE-1');
  }finally{await f.close()}
});

test('kund med fakturahistorik arkiveras i stället för att raderas och kan återställas',async()=>{
  const f=await fixture();
  try{
    const headers=await f.login(f.admin.username);
    const response=await fetch(f.base+'/api/v1/customers/'+f.customer.id,{method:'DELETE',headers});
    const data=await response.json();
    assert.equal(response.status,200);
    assert.equal(data.deleted,false);
    assert.equal(data.archived,true);
    assert.ok(data.customer.archivedAt);
    assert.equal(data.customer.invoiceCount,1);

    const activeResponse=await fetch(f.base+'/api/v1/customers',{headers});
    const active=await activeResponse.json();
    assert.equal(active.customers.some(row=>row.id===f.customer.id),false);

    const allResponse=await fetch(f.base+'/api/v1/customers?includeArchived=1',{headers});
    const all=await allResponse.json();
    assert.equal(all.customers.find(row=>row.id===f.customer.id).archivedAt!==null,true);

    const restore=await fetch(f.base+'/api/v1/customers/'+f.customer.id+'/restore',{method:'POST',headers});
    const restored=await restore.json();
    assert.equal(restore.status,200);
    assert.equal(restored.customer.archivedAt,null);

    const actions=Db.auditForCompany(f.db,f.a.id).filter(event=>event.entityId===f.customer.id).map(event=>event.action);
    assert.ok(actions.includes('CUSTOMER_ARCHIVED'));
    assert.ok(actions.includes('CUSTOMER_RESTORED'));
  }finally{await f.close()}
});

test('kund från annat företag kan varken tas bort eller arkiveras',async()=>{
  const f=await fixture();
  try{
    const foreign=Db.createCustomer(f.db,{
      companyId:f.b.id,
      customerNumber:'K-FOREIGN-DELETE',
      name:'Främmande kund AB',
      address:{full:'Annan gata 2, Teststad'},
      orgNumber:'559900-3002'
    });
    const headers=await f.login(f.admin.username);
    const response=await fetch(f.base+'/api/v1/customers/'+foreign.id,{method:'DELETE',headers});
    const data=await response.json();
    assert.equal(response.status,404);
    assert.equal(data.code,'CUSTOMER_NOT_FOUND');
    assert.ok(Db.customerById(f.db,f.b.id,foreign.id));
  }finally{await f.close()}
});
