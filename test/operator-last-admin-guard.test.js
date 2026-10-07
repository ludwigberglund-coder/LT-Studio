'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('sista aktiva företagsadmin skyddas atomiskt i databasen',()=>{
  const sql=read('supabase/migrations/20261007200500_protect_last_company_admin.sql');

  assert.match(sql,/create or replace function public\.operator_change_company_membership/i);
  assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\(p_company_id\|\|':company-admin-floor'/i);
  assert.match(sql,/from public\.company_memberships m[\s\S]*for update/i);
  assert.match(sql,/m\.role='admin'/i);
  assert.match(sql,/u\.disabled=false/i);
  assert.match(sql,/LAST_ACTIVE_ADMIN_REQUIRED/);
});

test('två samtidiga adminborttagningar kan inte båda lämna företaget adminlöst',()=>{
  const sql=read('supabase/migrations/20261007200500_protect_last_company_admin.sql');

  const lock=sql.indexOf("pg_advisory_xact_lock");
  const memberRead=sql.indexOf("select * into v_member");
  const adminCount=sql.indexOf("select count(*) into v_other_active_admins");
  const mutation=Math.min(
    ...[sql.indexOf("update public.company_memberships"),sql.indexOf("delete from public.company_memberships")].filter(i=>i>=0)
  );
  assert.ok(lock>=0&&memberRead>lock&&adminCount>memberRead&&mutation>adminCount);
});

test('medlemskaps-RPC är endast service-role och audit-loggar atomiskt',()=>{
  const sql=read('supabase/migrations/20261007200500_protect_last_company_admin.sql');

  assert.match(sql,/security invoker/i);
  assert.match(sql,/revoke all on function public\.operator_change_company_membership\(text,uuid,text,text,uuid\)[\s\S]*from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.operator_change_company_membership\(text,uuid,text,text,uuid\)[\s\S]*to service_role/i);
  assert.match(sql,/insert into public\.operator_audit_events/i);
  assert.match(sql,/CUSTOMER_USER_ROLE_CHANGED/);
  assert.match(sql,/CUSTOMER_USER_REMOVED/);
});

test('Driftadmin använder den atomiska RPC-vägen för rollbyte och borttagning',()=>{
  const edge=read('supabase/functions/operator-admin/index.ts');

  const occurrences=(edge.match(/operator_change_company_membership/g)||[]).length;
  assert.equal(occurrences,2);
  assert.match(edge,/p_action:"set-role"/);
  assert.match(edge,/p_action:"remove"/);
  assert.match(edge,/LAST_ACTIVE_ADMIN_REQUIRED/);
  assert.match(edge,/minst en aktiv administratör/i);
  assert.doesNotMatch(edge,/from\("company_memberships"\)\.update\(\{role\}\)/);
  assert.doesNotMatch(edge,/from\("company_memberships"\)\.delete\(\)\.eq\("company_id",companyId\)\.eq\("auth_user_id",target\)/);
});

test('recovery är add-first: ny admin måste finnas innan sista admin kan degraderas eller tas bort',()=>{
  const sql=read('supabase/migrations/20261007200500_protect_last_company_admin.sql');

  assert.match(sql,/m\.auth_user_id<>p_target_auth_user_id/);
  assert.match(sql,/if v_other_active_admins<1 then[\s\S]*LAST_ACTIVE_ADMIN_REQUIRED/i);
  assert.doesNotMatch(sql,/force|override|bypass/i);
});
