'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('sessionssnapshot och verifiering är endast service-role',()=>{
  const sql=read('supabase/migrations/20261007211000_verify_operator_password_reset_sessions.sql');

  assert.match(sql,/operator_capture_user_sessions/);
  assert.match(sql,/operator_count_remaining_previous_sessions/);
  assert.match(sql,/from auth\.sessions/);
  assert.match(sql,/platform_operators/);
  assert.match(sql,/company_memberships/);
  assert.match(sql,/revoke all on function public\.operator_capture_user_sessions[\s\S]*from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.operator_capture_user_sessions[\s\S]*to service_role/i);
  assert.match(sql,/revoke all on function public\.operator_count_remaining_previous_sessions[\s\S]*from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.operator_count_remaining_previous_sessions[\s\S]*to service_role/i);
});

test('lösenordsreset fångar gamla sessioner före Auth-ändringen och verifierar dem efteråt',()=>{
  const edge=read('supabase/functions/operator-admin/index.ts');
  const start=edge.indexOf('if(action==="reset-password")');
  const end=edge.indexOf('if(action==="remove-user")',start);
  const reset=edge.slice(start,end);

  const capture=reset.indexOf('operator_capture_user_sessions');
  const passwordUpdate=reset.indexOf('updateUserById(target,{password})');
  const verify=reset.indexOf('operator_count_remaining_previous_sessions');

  assert.ok(capture>=0&&passwordUpdate>capture&&verify>passwordUpdate);
  assert.match(reset,/p_previous_session_ids:previousSessionIds/);
  assert.match(reset,/remainingPreviousSessions===0/);
});

test('reset failar stängt om sessionsåterkallning inte kan verifieras',()=>{
  const edge=read('supabase/functions/operator-admin/index.ts');
  const start=edge.indexOf('if(action==="reset-password")');
  const end=edge.indexOf('if(action==="remove-user")',start);
  const reset=edge.slice(start,end);

  assert.match(reset,/SESSION_REVOCATION_VERIFICATION_FAILED/);
  assert.match(reset,/SESSION_REVOCATION_NOT_CONFIRMED/);
  assert.match(reset,/saved:true,sessionsRevoked:false/);
  assert.match(reset,/sessionsRevoked:true,sessionScope:"global"/);
  assert.match(reset,/remainingPreviousSessionCount/);
});

test('verifieringen räknar bara sessioner som fanns före lösenordsbytet',()=>{
  const sql=read('supabase/migrations/20261007211000_verify_operator_password_reset_sessions.sql');

  assert.match(sql,/p_previous_session_ids uuid\[\]/);
  assert.match(sql,/s\.id=any\(coalesce\(p_previous_session_ids,'\{\}'::uuid\[\]\)\)/);
});

test('LT Studios RLS fortsätter kontrollera session_id mot auth.sessions',()=>{
  const guard=read('supabase/migrations/20260926152441_personal_session_server_guard.sql');

  assert.match(guard,/auth\.jwt\(\)->>'session_id'/);
  assert.match(guard,/from auth\.sessions s/);
  assert.match(guard,/s\.id=v_session_id/);
  assert.match(guard,/s\.user_id=v_uid/);
});
