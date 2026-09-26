'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createSupabaseUatStore}=require('../apps/api/supabase-uat-store.js');

const COMPANY_A='11111111-1111-4111-8111-111111111111';
const COMPANY_B='22222222-2222-4222-8222-222222222222';

function response(rows,{status=200}={}) {
  return {
    ok:status>=200&&status<300,
    status,
    async json(){return rows},
    async text(){return JSON.stringify(rows)}
  };
}

test('Supabase UAT store requires server-side project URL and service-role key',()=>{
  assert.throws(()=>createSupabaseUatStore({env:{}}),/SUPABASE_PROJECT_URL/);
  assert.throws(
    ()=>createSupabaseUatStore({env:{SUPABASE_PROJECT_URL:'https://demo.supabase.co'}}),
    /SUPABASE_SERVICE_ROLE_KEY/
  );
});

test('customer reads are always scoped to one validated company',async()=>{
  const calls=[];
  const store=createSupabaseUatStore({
    env:{
      SUPABASE_PROJECT_URL:'https://demo.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY:'server-only-secret'
    },
    fetchImpl:async(url,options)=>{
      calls.push({url,options});
      return response([{
        id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        company_id:COMPANY_A,
        customer_number:'1001',
        name:'Synthetic Customer A',
        org_number:'559000-0001',
        email:'a@example.invalid',
        customer_type:'business',
        reminder_fee_agreed:true,
        created_at:'2026-09-26T12:00:00Z',
        updated_at:'2026-09-26T12:00:00Z'
      }]);
    }
  });
  const rows=await store.listCustomers(COMPANY_A);
  assert.equal(rows.length,1);
  assert.equal(rows[0].companyId,COMPANY_A);
  assert.match(calls[0].url,/company_id=eq%5C?\.?/i);
  const parsed=new URL(calls[0].url);
  assert.equal(parsed.searchParams.get('company_id'),`eq.${COMPANY_A}`);
  assert.equal(calls[0].options.headers.apikey,'server-only-secret');
  assert.equal(calls[0].options.headers.authorization,'Bearer server-only-secret');
});

test('store fails closed if Supabase ever returns another company row',async()=>{
  const store=createSupabaseUatStore({
    env:{
      SUPABASE_PROJECT_URL:'https://demo.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY:'server-only-secret'
    },
    fetchImpl:async()=>response([{
      id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      company_id:COMPANY_B,
      customer_number:'2001',
      name:'Wrong tenant'
    }])
  });
  await assert.rejects(
    store.listCustomers(COMPANY_A),
    error=>error?.code==='TENANT_ISOLATION_ERROR'
  );
});

test('invalid tenant identifiers are rejected before any network request',async()=>{
  let called=false;
  const store=createSupabaseUatStore({
    env:{
      SUPABASE_PROJECT_URL:'https://demo.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY:'server-only-secret'
    },
    fetchImpl:async()=>{called=true;return response([])}
  });
  await assert.rejects(
    store.listCustomers('company-a'),
    error=>error?.code==='INVALID_TENANT_ID'
  );
  assert.equal(called,false);
});

test('customer number lookup keeps company scope and returns null when absent',async()=>{
  let requested;
  const store=createSupabaseUatStore({
    env:{
      SUPABASE_PROJECT_URL:'https://demo.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY:'server-only-secret'
    },
    fetchImpl:async(url)=>{requested=new URL(url);return response([])}
  });
  const row=await store.customerByNumber(COMPANY_A,'1001');
  assert.equal(row,null);
  assert.equal(requested.searchParams.get('company_id'),`eq.${COMPANY_A}`);
  assert.equal(requested.searchParams.get('customer_number'),'eq.1001');
});

test('Supabase HTTP failures do not expose the service-role key in the error message',async()=>{
  const secret='do-not-leak-this-service-role-key';
  const store=createSupabaseUatStore({
    env:{
      SUPABASE_PROJECT_URL:'https://demo.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY:secret
    },
    fetchImpl:async()=>response({message:'denied'},{status:401})
  });
  await assert.rejects(
    store.listCustomers(COMPANY_A),
    error=>error?.code==='SUPABASE_REQUEST_FAILED'&&!String(error.message).includes(secret)
  );
});
