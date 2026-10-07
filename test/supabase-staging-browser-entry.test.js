'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('hosted staging uses a dedicated public Supabase project and explicit environment selector',()=>{
  const config=read('apps/portal/supabase-config.js');
  assert.match(config,/https:\/\/rwnqkgbbbxjjfhwtepsi\.supabase\.co/);
  assert.match(config,/sb_publishable_9lqpsEtC15oreqlNjhVB2A_QV2SUGdN/);
  assert.match(config,/searchParams\.set\('lt-env','uat'\)/);
  assert.match(config,/get\('lt-env'\)/);
  assert.match(config,/STAGING · ENDAST SYNTETISK DATA/);
  assert.doesNotMatch(config,/sb_secret_/);
  assert.doesNotMatch(config,/service_role/i);
});

test('UAT and staging sessions use different browser keys and both require AAL2',()=>{
  const session=read('apps/portal/supabase-session.js');
  assert.match(session,/const ENV=window\.LT_SUPABASE\?\.environment==='staging'\?'staging':'uat'/);
  assert.match(session,/lt-studio-supabase-'\+ENV\+'-session-v1/);
  assert.match(session,/lt-studio-supabase-'\+ENV\+'-company-v1/);
  assert.match(session,/function requiresAal2\(\)\{return ENV==='uat'\|\|ENV==='staging'\}/);
});

test('staging entry always selects staging and MFA setup preserves the environment',()=>{
  const entry=read('apps/website/staging/index.html');
  const setup=read('apps/portal/uat-setup.js');
  const build=read('scripts/build-static.js');
  assert.match(entry,/portal\/uat-setup\.html\?lt-env=staging/);
  assert.match(setup,/const envQuery=staging\?'\?lt-env=staging':''/);
  assert.match(setup,/Staging-kontot/);
  assert.match(build,/'staging\/index\.html'/);
});
