'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('admin entry routes to the secure Driftadmin operator portal',()=>{
  const html=read('apps/admin/index.html');
  assert.match(html,/LT Studio · Adminportal/);
  assert.match(html,/http-equiv="refresh" content="0; url=\.\.\/operator\/"/);
  assert.match(html,/location\.replace\(target\)/);
  assert.match(html,/href="\.\.\/operator\/"/);
  assert.doesNotMatch(html,/Projektadmin|system-status\.js|\.\/app\.js/);
});

test('operator portal requires Supabase Auth, verified TOTP and active platform operator access',()=>{
  const html=read('apps/operator/index.html');
  const app=read('apps/operator/app.js');
  const edge=read('supabase/functions/operator-admin/index.ts');

  assert.match(html,/supabase-config\.js/);
  assert.match(html,/supabase-client\.js/);
  assert.match(html,/supabase-session\.js/);
  assert.match(app,/LTSupabase\.signIn/);
  assert.match(app,/status==='verified'&&item\.factor_type==='totp'/);
  assert.match(app,/LTSupabase\.mfaChallenge/);
  assert.match(app,/LTSupabase\.mfaVerify/);
  assert.match(app,/functions\/v1\/operator-admin/);
  assert.doesNotMatch(app,/service[_-]?role|sb_secret_/i);

  assert.match(edge,/auth\.getUser\(token\)/);
  assert.match(edge,/claims\.aal!==\"aal2\"/);
  assert.match(edge,/from\(\"platform_operators\"\)/);
  assert.match(edge,/eq\(\"auth_user_id\",userData\.user\.id\)/);
  assert.match(edge,/if\(!operator\|\|operator\.disabled\)/);
});
