'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('every Driftadmin request obtains a refreshed access token before sending an operator action',()=>{
  const app=read('apps/operator/app.js');
  const session=read('apps/portal/supabase-session.js');
  assert.match(app,/const token=await globalThis\.LTSupabaseUat\.freshToken\(\)/);
  assert.match(session,/async function freshToken\(\)/);
  assert.match(session,/operatorRefresh=refreshIfNeeded\(read\(\)\)\.finally/);
  assert.match(session,/window\.LTSupabaseUat=\{read,token,freshToken,/);
  assert.match(session,/REFRESH_EARLY_MS=5\*60\*1000/);
  assert.match(session,/write\(refreshed,mode\)/);
});

test('operator backend still independently validates active operator and MFA',()=>{
  const edge=read('supabase/functions/operator-admin/index.ts');
  assert.match(edge,/claims\.aal!=="aal2"/);
  assert.match(edge,/from\("platform_operators"\)/);
  assert.match(edge,/if\(!operator\|\|operator\.disabled\)/);
  assert.match(edge,/if\(action==="create-company"\)/);
});
