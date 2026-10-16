'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../apps/portal/supplier-persistence.js');
const context=()=>({authenticated:true,company:{id:'company-a'},authUser:{id:'user-a'},accessToken:'synthetic-token',membership:{role:'accountant'}});
const requestId='00000000-0000-4000-8000-000000008251';
const row=()=>({id:'supplier-a',company_id:'company-a',supplier_number:'L1',name:'Synthetic supplier',org_number:null,country_code:null,email:null,bankgiro:null,plusgiro:null,default_cost_account:null,row_version:1,last_change_request_id:null});
function fake(initial=null,{failAfterCommit=false,zeroUpdate=false}={}){
  let stored=initial?{...initial}:null,writes=0;
  const calls=[];
  const client={from(table,token){assert.equal(table,'suppliers','no audit, invoice, payment or journal table is written');calls.push([table,token]);return{
    async select(query,filters){assert.match(filters,/company_id=eq.company-a/);assert.match(filters,/id=eq.supplier-a/);return stored?[{...stored}]:[];},
    async insert(rows){writes++;assert.equal(stored,null);stored={...rows[0]};if(failAfterCommit)throw new Error('Network lost after commit');return[{...stored}];},
    async update(values,filters){writes++;assert.match(filters,/row_version=eq.1/);if(zeroUpdate)return[];stored={...stored,...values};if(failAfterCommit)throw new Error('Network lost after commit');return[{...stored}];}
  }}};
  return{client,calls,get stored(){return stored},get writes(){return writes}};
}
const createOp=()=>S.operation({context:context(),id:'supplier-a',kind:'create',payload:{supplierNumber:'L1',name:'Synthetic supplier'},requestId});
const editOp=()=>S.operation({context:context(),supplier:S.record(row()),kind:'profile',payload:{name:'Updated supplier'},requestId});
test('creation is explicit and produces one supplier write, not accounting',async()=>{
 const f=fake();const saved=await S.save({client:f.client,getContext:async()=>context(),operation:createOp()});
 assert.equal(saved.id,'supplier-a');assert.equal(saved.rowVersion,1);assert.equal(f.writes,1);
});
test('exact create retry reads the original result without another insertion',async()=>{
 const f=fake(),op=createOp();await S.save({client:f.client,getContext:async()=>context(),operation:op});
 await S.save({client:f.client,getContext:async()=>context(),operation:op});assert.equal(f.writes,1);
});
test('lost creation response is resolved by exact request identity',async()=>{
 const f=fake(null,{failAfterCommit:true});const saved=await S.save({client:f.client,getContext:async()=>context(),operation:createOp()});
 assert.equal(saved.lastChangeRequestId,requestId);assert.equal(f.writes,1);
});
test('lost update response is resolved without a duplicate audit mutation',async()=>{
 const f=fake(row(),{failAfterCommit:true}),op=editOp();const saved=await S.save({client:f.client,getContext:async()=>context(),operation:op});
 assert.equal(saved.name,'Updated supplier');assert.equal(f.writes,1);
});
test('changed company before write leaves all data unchanged',async()=>{
 const f=fake(),ctx=context();ctx.company.id='company-b';
 await assert.rejects(S.save({client:f.client,getContext:async()=>ctx,operation:createOp()}),/CONTEXT_CHANGED/);assert.equal(f.writes,0);
});
test('company switch during preflight read stops mutation',async()=>{
 const f=fake();let reads=0;
 await assert.rejects(S.save({client:f.client,getContext:async()=>{const c=context();if(++reads>1)c.company.id='company-b';return c},operation:createOp()}),/CONTEXT_CHANGED/);
 assert.equal(f.writes,0);
});
test('user switch cannot reuse a prior operation',async()=>{
 const f=fake(),ctx=context();ctx.authUser.id='user-b';
 await assert.rejects(S.save({client:f.client,getContext:async()=>ctx,operation:createOp()}),/CONTEXT_CHANGED/);assert.equal(f.writes,0);
});
test('late response after company change is not returned into the new UI context',async()=>{
 const f=fake();let n=0;
 await assert.rejects(S.save({client:f.client,getContext:async()=>{const c=context();if(++n>2)c.company.id='company-b';return c},operation:createOp()}),/CONTEXT_CHANGED/);
 assert.equal(f.writes,1);assert.equal(f.stored.company_id,'company-a');
});
test('stale revision is refused before writing',async()=>{
 const f=fake({...row(),row_version:2});
 await assert.rejects(S.save({client:f.client,getContext:async()=>context(),operation:editOp()}),/VERSION_CONFLICT/);assert.equal(f.writes,0);
});
test('race lost at database update is not reported as successful',async()=>{
 const f=fake(row(),{zeroUpdate:true});
 await assert.rejects(S.save({client:f.client,getContext:async()=>context(),operation:editOp()}),/VERSION_CONFLICT/);assert.equal(f.stored.name,'Synthetic supplier');
});
test('same request id with different contents is not accepted as a replay',async()=>{
 const f=fake(),op=createOp();await S.save({client:f.client,getContext:async()=>context(),operation:op});
 const conflicting=S.operation({context:context(),id:'supplier-a',kind:'create',payload:{supplierNumber:'L1',name:'Different supplier'},requestId});
 await assert.rejects(S.save({client:f.client,getContext:async()=>context(),operation:conflicting}),/REQUEST_CONFLICT/);assert.equal(f.writes,1);
});
test('viewer can retain read scope but cannot create a write operation',()=>{
 const ctx=context();ctx.membership.role='viewer';assert.equal(S.scope(ctx).role,'viewer');
 assert.throws(()=>S.operation({context:ctx,id:'supplier-a',kind:'create',payload:{supplierNumber:'L1',name:'No'},requestId}),/ACCESS_DENIED/);
});
test('invalid and injected profile fields are rejected',()=>{
 assert.throws(()=>S.values({name:'Good',approved:true},'profile'),/INVALID_SUPPLIER_INPUT/);
 assert.throws(()=>S.values({name:'Bad\nName'},'profile'),/INVALID_SUPPLIER_INPUT/);
 assert.throws(()=>S.values({name:'Good',defaultCostAccount:'x'},'profile'),/INVALID_SUPPLIER_INPUT/);
 assert.throws(()=>S.values({name:'Good',countryCode:'se'},'profile'),/INVALID_SUPPLIER_INPUT/);
});
