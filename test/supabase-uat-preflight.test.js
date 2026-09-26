'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {runPreflight}=require('../scripts/supabase-uat-preflight.js');

const COMPANY='company_11111111-1111-4111-8111-111111111111';

function baseEnv(){
  return {
    ROLLANDS_ENV:'staging',
    ROLLANDS_DATA_CLASSIFICATION:'synthetic',
    ROLLANDS_REAL_DATA_ALLOWED:'0',
    LT_DATABASE_ENGINE:'postgresql',
    SUPABASE_DATABASE_URL:'postgresql://uat:secret@db.example.supabase.co:6543/postgres?sslmode=require',
    SUPABASE_PROJECT_URL:'https://demo.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY:'server-only-secret',
    LT_SUPABASE_UAT_COMPANY_ID:COMPANY
  };
}

function ok(rows=[]){
  return {
    ok:true,
    status:200,
    async json(){return rows},
    async text(){return JSON.stringify(rows)}
  };
}

test('Supabase UAT preflight refuses non-synthetic environments',async()=>{
  for(const mutate of [
    env=>{env.ROLLANDS_ENV='pilot'},
    env=>{env.ROLLANDS_DATA_CLASSIFICATION='real'},
    env=>{env.ROLLANDS_REAL_DATA_ALLOWED='1'}
  ]){
    const env=baseEnv();
    mutate(env);
    await assert.rejects(runPreflight({env,fetchImpl:async()=>ok(),write:()=>{}}));
  }
});

test('Supabase UAT preflight requires PostgreSQL mode',async()=>{
  const env=baseEnv();
  env.LT_DATABASE_ENGINE='sqlite';
  await assert.rejects(
    runPreflight({env,fetchImpl:async()=>ok(),write:()=>{}}),
    /LT_DATABASE_ENGINE måste vara postgresql/
  );
});

test('Supabase UAT preflight verifies all shared read models',async()=>{
  const requested=[];
  const summary=await runPreflight({
    env:baseEnv(),
    fetchImpl:async url=>{
      const parsed=new URL(url);
      requested.push(parsed.pathname);
      return ok([]);
    },
    write:()=>{}
  });
  assert.deepEqual(summary,{
    engine:'postgresql',
    dataClassification:'synthetic',
    companyId:COMPANY,
    customers:0,
    suppliers:0,
    customerInvoices:0,
    supplierInvoices:0
  });
  assert.deepEqual(requested.sort(),[
    '/rest/v1/customer_invoices',
    '/rest/v1/customers',
    '/rest/v1/supplier_invoices',
    '/rest/v1/suppliers'
  ]);
});
