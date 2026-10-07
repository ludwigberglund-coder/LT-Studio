'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');

test('Supabase login ger tydlig generell aktiveringsväg vid 400-fel',()=>{
  const session=fs.readFileSync(path.join(root,'apps','portal','supabase-session.js'),'utf8');
  const app=fs.readFileSync(path.join(root,'apps','portal','app.js'),'utf8');
  assert.match(session,/function normalizedLoginError/);
  assert.match(session,/LOGIN_NOT_READY/);
  assert.match(session,/kontot är inte aktiverat ännu/);
  assert.match(session,/personliga aktiveringslänk från LT Studio/);
  assert.match(session,/Number\(error\?\.status\)===400/);
  assert.match(app,/class="button ghost" href="\.\/company-activate\.html"/);
  assert.doesNotMatch(app,/Aktivera UAT-konto/);
});
