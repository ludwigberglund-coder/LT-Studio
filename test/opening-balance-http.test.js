'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Accounting=require('../apps/api/accounting-store.js');
const {createAccountingAdminRouter}=require('../apps/api/accounting-admin-router.js');

async function fixture(){
  const db=Db.openDatabase(':memory:');
  const company=Db.createCompany(db,{legalName:'Opening Balance AB',displayName:'Opening Balance',orgNumber:'559980-1001'});
  const user=Db.createUser(db,{username:'opening.user',displayName:'Opening User',passwordHash:'test-only'});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  const token='opening-balance-session',csrf='opening-balance-csrf';
  Db.createSession(db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),companyId:company.id,userId:user.id,expiresAt:new Date(Date.now()+60000).toISOString()});
  const router=createAccountingAdminRouter({db});
  const server=http.createServer(async(req,res)=>{if(!await router.handle(req,res)){res.writeHead(404);res.end();}});
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  return{
    db,company,user,
    base:`http://127.0.0.1:${server.address().port}`,
    headers:{Cookie:`rollands_session=${token}`,'X-CSRF-Token':csrf,'Content-Type':'application/json'},
    close:()=>new Promise(resolve=>server.close(()=>{db.close();resolve();}))
  };
}

test('privat API importerar ingående balans retry-säkert med en audit-händelse',async()=>{
  const f=await fixture();
  try{
    const path='/api/v1/accounting/opening-balances/2026';
    const body={postingDate:'2026-01-01',lines:[
      {account:'1930',text:'Bank',debitOre:300000,creditOre:0},
      {account:'2091',text:'Eget kapital',debitOre:0,creditOre:300000}
    ]};
    assert.equal((await fetch(f.base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,401);

    const first=await fetch(f.base+path,{method:'POST',headers:f.headers,body:JSON.stringify(body)});
    const firstData=await first.json();
    assert.equal(first.status,201);
    assert.equal(firstData.duplicate,false);
    assert.equal(firstData.entry.number,'IB1');

    const retry=await fetch(f.base+path,{method:'POST',headers:f.headers,body:JSON.stringify(body)});
    const retryData=await retry.json();
    assert.equal(retry.status,200);
    assert.equal(retryData.duplicate,true);
    assert.equal(retryData.entry.id,firstData.entry.id);

    const get=await fetch(f.base+path,{headers:{Cookie:f.headers.Cookie}});
    const read=await get.json();
    assert.equal(get.status,200);
    assert.equal(read.entry.id,firstData.entry.id);
    assert.equal(Accounting.listEntries(f.db,f.company.id).length,1);
    assert.equal(Db.auditForCompany(f.db,f.company.id).filter(e=>e.action==='OPENING_BALANCE_IMPORTED').length,1);
  }finally{await f.close()}
});

test('privat API stoppar ingående reskontrasaldo utan detaljunderlag',async()=>{
  const f=await fixture();
  try{
    const response=await fetch(f.base+'/api/v1/accounting/opening-balances/2026',{method:'POST',headers:f.headers,body:JSON.stringify({
      postingDate:'2026-01-01',
      lines:[
        {account:'1510',text:'Kundfordringar',debitOre:100000,creditOre:0},
        {account:'2091',text:'Eget kapital',debitOre:0,creditOre:100000}
      ]
    })});
    const body=await response.json();
    assert.equal(response.status,409);
    assert.equal(body.code,'OPENING_BALANCE_SUBLEDGER_REQUIRED');
    assert.equal(Accounting.listEntries(f.db,f.company.id).length,0);
    assert.equal(Db.auditForCompany(f.db,f.company.id).filter(e=>e.action==='OPENING_BALANCE_IMPORTED').length,0);
  }finally{await f.close()}
});
