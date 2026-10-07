'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('Driftadmin använder samma starka lösenordskrav som produktions-onboarding',()=>{
  const edge=read('supabase/functions/operator-admin/index.ts');

  assert.match(edge,/value\.length>=12/);
  assert.match(edge,/\[0-9\]\/\.test\(value\)/);
  assert.match(edge,/\[\^A-Za-zÅÄÖåäö0-9\]/);
  assert.match(edge,/minst 12 tecken/i);
});

test('nya och resetade operatörsskapade lösenord kontrolleras mot kända läckor',()=>{
  const edge=read('supabase/functions/operator-admin/index.ts');

  assert.ok(edge.includes('api.pwnedpasswords.com/range/'));
  assert.match(edge,/Add-Padding/);
  assert.match(edge,/slice\(0,5\)/);
  assert.match(edge,/PASSWORD_COMPROMISED/);
  assert.match(edge,/PASSWORD_BREACH_CHECK_UNAVAILABLE/);

  const checks=(edge.match(/await assertPasswordNotCompromised\(password\)/g)||[]).length;
  assert.equal(checks,2);
});

test('lösenordsreset kräver fortfarande medlemskap i exakt valt företag',()=>{
  const edge=read('supabase/functions/operator-admin/index.ts');

  const start=edge.indexOf('if(action==="reset-password")');
  const end=edge.indexOf('if(action==="remove-user")',start);
  const reset=edge.slice(start,end);

  assert.match(reset,/from\("company_memberships"\)/);
  assert.match(reset,/\.eq\("company_id",companyId\)\.eq\("auth_user_id",target\)/);
  assert.match(reset,/MEMBERSHIP_NOT_FOUND/);
});




test('administrativt lösenordsbyte rapporterar verifierad sessionsstatus korrekt',()=>{
  const edge=read('supabase/functions/operator-admin/index.ts');
  const start=edge.indexOf('if(action==="reset-password")');
  const end=edge.indexOf('if(action==="remove-user")',start);
  const reset=edge.slice(start,end);
  assert.match(reset,/sessionsRevoked:false/);
  assert.match(reset,/sessionScope:"supabase"/);
  assert.match(reset,/sessionsRevoked:true,sessionScope:"global"/);
  assert.match(reset,/SESSION_REVOCATION_NOT_CONFIRMED/);
});
