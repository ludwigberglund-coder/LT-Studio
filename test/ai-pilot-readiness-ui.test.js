'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const pilot=fs.readFileSync(path.join(root,'apps/portal/ai-bookkeeping.js'),'utf8');
const assistant=fs.readFileSync(path.join(root,'apps/portal/ai-assistant.js'),'utf8');
const edge=fs.readFileSync(path.join(root,'supabase/functions/ai-bookkeeping-pilot/index.ts'),'utf8');
test('AI pilot action stays disabled while server pilot is hard locked',()=>{
  assert.match(edge,/const RELEASE_APPROVED = false;/);
  assert.match(edge,/const DURABLE_IP_LIMITER_VERIFIED = false;/);
  assert.match(pilot,/const AI_PILOT_RELEASED = false;/);
  assert.match(pilot,/const canCall=Boolean\(AI_PILOT_RELEASED&&!demo/);
  assert.match(pilot,/if\(!AI_PILOT_RELEASED\)/);
  assert.match(pilot,/!canCall\|\|busy\?'disabled'/);
  assert.match(pilot,/AI-anslutningen är ännu inte aktiverad/);
  assert.match(assistant,/Guider tillgängliga · AI avstängd/);
});
