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
  assert.match(js,/session_duration_minutes/);
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
