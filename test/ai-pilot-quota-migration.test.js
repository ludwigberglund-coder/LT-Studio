'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261013071500_ai_pilot_atomic_quota.sql'),'utf8');

test('AI pilot quota is disabled by default and inaccessible to browser roles',()=>{
  assert.match(migration,/enabled boolean not null default false/);
  assert.match(migration,/values\(true,false\)/);
  assert.match(migration,/enable row level security/g);
  assert.match(migration,/revoke all on public\.ai_pilot_request_reservations from public,anon,authenticated/);
  assert.match(migration,/auth\.role\(\).*<> 'service_role'/s);
  assert.match(migration,/grant execute on function public\.reserve_ai_pilot_request_server\(text,uuid,uuid,text,text\)\s+to service_role/);
});

test('reservation verifies current session, tenant and privileged accounting role',()=>{
  assert.match(migration,/from auth\.sessions s/);
  assert.match(migration,/u\.disabled=false/);
  assert.match(migration,/m\.company_id=p_company_id/);
  assert.match(migration,/m\.role in \('admin','accountant'\)/);
  assert.match(migration,/s\.id=p_session_id and s\.user_id=p_actor_uid/);
  assert.match(migration,/v_session_not_after/);
  assert.match(migration,/make_interval\(mins=>v_session_minutes\)/);
});

test('global, company, user and hashed-IP quota checks are atomic',()=>{
  const lock=migration.indexOf('pg_advisory_xact_lock');
  const globalCount=migration.indexOf('daily_global_limit',lock);
  const insert=migration.indexOf('insert into public.ai_pilot_request_reservations',lock);
  assert.ok(lock>0&&globalCount>lock&&insert>globalCount);
  assert.match(migration,/daily_company_limit/);
  assert.match(migration,/daily_user_limit/);
  assert.match(migration,/ip_window_seconds/);
  assert.match(migration,/client_ip_hash text not null check \(client_ip_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
});

test('idempotency returns a blocked duplicate and never writes accounting data',()=>{
  assert.match(migration,/unique\(company_id,actor_uid,request_id\)/);
  assert.match(migration,/return query select v_existing\.id,true,false,false,true,true/);
  assert.doesNotMatch(migration,/insert into public\.(journal_entries|journal_lines|automation_proposals)/);
  assert.doesNotMatch(migration,/update public\.(journal_entries|journal_lines|bank_payments)/);
});
