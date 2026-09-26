'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');

test('UAT login has clear activation guidance for Supabase 400 errors',()=>{
  const session=fs.readFileSync(path.join(root,'apps','portal','supabase-session.js'),'utf8');
  const app=fs.readFileSync(path.join(root,'apps','portal','app.js'),'utf8');
  assert.match(session,/function normalizedLoginError/);
  assert.match(session,/UAT_LOGIN_NOT_READY/);
  assert.match(session,/UAT-kontot är inte aktiverat ännu/);
  assert.match(session,/Number\(error\?\.status\)===400/);
  assert.match(app,/class="button ghost" href="\.\/uat-setup\.html"/);
});
