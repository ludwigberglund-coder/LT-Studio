'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const seed=fs.readFileSync(
  path.resolve(__dirname,'..','supabase','seeds','shared-uat-synthetic.sql'),
  'utf8'
);

test('shared Supabase UAT seed is synthetic-only and contains two isolated companies',()=>{
  assert.match(seed,/Synthetic Staging Company Alpha/);
  assert.match(seed,/Synthetic Staging Company Beta/);
  assert.match(seed,/company_11111111-1111-4111-8111-111111111111/);
  assert.match(seed,/company_22222222-2222-4222-8222-222222222222/);
  assert.match(seed,/@example\.invalid/);
  assert.doesNotMatch(seed,/@gmail\.com|@outlook\.com|@hotmail\.com/i);
  assert.doesNotMatch(seed,/insert\s+into\s+public\.app_users/i);
});

test('shared Supabase UAT seed keeps customer and supplier rows tenant-scoped',()=>{
  for(const table of ['customers','suppliers','customer_invoices','supplier_invoices']){
    const pattern=new RegExp(`insert into public\\.${table}\\s*\\([^)]*company_id`,'i');
    assert.match(seed,pattern,`${table} seed must explicitly include company_id`);
  }
});

test('shared Supabase UAT seed is idempotent by primary identifier',()=>{
  const inserts=(seed.match(/insert into public\./gi)||[]).length;
  const conflicts=(seed.match(/on conflict \(id\) do nothing/gi)||[]).length;
  assert.ok(inserts>=5);
  assert.equal(conflicts,inserts);
});
