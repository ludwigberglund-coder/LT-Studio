'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('personal Supabase session limit is enforced by restrictive RLS',()=>{
  const sql=read('supabase/migrations/20260926_personal_session_limits.sql');
  assert.match(sql,/security definer/i);
  assert.match(sql,/auth\.sessions/i);
  assert.match(sql,/session_id/i);
  assert.match(sql,/session_duration_minutes/i);
  assert.match(sql,/make_interval\(mins => v_minutes\)/i);
  assert.match(sql,/as restrictive for all to authenticated/i);
  assert.match(sql,/lt_security\.session_within_personal_limit/i);
  assert.match(sql,/grant update\(session_duration_minutes\) on table public\.app_users to authenticated/i);
  assert.doesNotMatch(sql,/grant update on table public\.app_users to authenticated/i);
});

test('profile page uses Supabase session security on GitHub Pages',()=>{
  const html=read('apps/portal/profile.html');
  const js=read('apps/portal/profile.js');
  assert.match(html,/supabase-config\.js/);
  assert.match(html,/supabase-client\.js/);
  assert.match(html,/supabase-session\.js/);
  assert.match(js,/LTSupabaseUat\.context/);
  assert.match(js,/set_personal_session_duration/);
  assert.doesNotMatch(js,/from\('app_users'[^\n]+\.update/);
  assert.match(js,/LTSupabaseUat\.signOut\('global'\)/);
  assert.match(js,/allowedSessionDurationMinutes:\[120,240,360,480\]/);
});

test('Supabase session helper refreshes expiring JWTs and supports session-only storage',()=>{
  const client=read('apps/portal/supabase-client.js');
  const session=read('apps/portal/supabase-session.js');
  assert.match(client,/grant_type=refresh_token/);
  assert.match(client,/scope='global'/);
  assert.match(session,/REFRESH_EARLY_MS=5\*60\*1000/);
  assert.match(session,/sessionStorage\.getItem\(KEY\)/);
  assert.match(session,/sessionDurationMinutes===null\?'session':'local'/);
  assert.match(session,/sessionExpired:true/);
});


test('personal session changes use an invoker RPC plus private audit trigger',()=>{
  const sql=read('supabase/migrations/20260926_personal_session_audit_rpc.sql');
  assert.match(sql,/create or replace function public\.set_personal_session_duration/i);
  assert.match(sql,/security invoker/i);
  assert.match(sql,/set search_path=''/i);
  assert.match(sql,/v_uid uuid := auth\.uid\(\)/i);
  assert.match(sql,/auth\.jwt\(\)->>'aal'/i);
  assert.match(sql,/lt_security\.session_within_personal_limit\(\)/i);
  assert.match(sql,/from public\.company_memberships/i);
  assert.match(sql,/set_config\('app\.profile_session_write','1',true\)/i);
  assert.match(sql,/create or replace function private\.audit_personal_session_duration_change/i);
  assert.match(sql,/CONTROLLED_PROFILE_WRITE_REQUIRED/);
  assert.match(sql,/USER_SESSION_DURATION_CHANGED/);
  assert.match(sql,/jsonb_build_object\([\s\S]*'before'[\s\S]*'after'/i);
  assert.match(sql,/revoke all on function private\.audit_personal_session_duration_change\(\)[\s\S]*from public, anon, authenticated/i);
  assert.match(sql,/create trigger app_users_personal_session_audit/i);
  assert.match(sql,/grant update\(session_duration_minutes\) on table public\.app_users to authenticated/i);
  assert.match(sql,/revoke all on function public\.set_personal_session_duration\(text,integer\)[\s\S]*from public, anon, authenticated/i);
  assert.match(sql,/grant execute on function public\.set_personal_session_duration\(text,integer\)[\s\S]*to authenticated/i);
});
