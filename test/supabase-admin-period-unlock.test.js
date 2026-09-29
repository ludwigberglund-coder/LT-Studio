'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sql=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20260928_admin_period_self_unlock.sql'),'utf8');

test('Supabase periodupplåsning låter admin besluta om egen begäran men inte ekonom',()=>{
  assert.match(sql,/m\.role in \('admin','accountant'\)/i);
  assert.match(sql,/v_req\.requested_by=v_uid and v_role<>'admin'/i);
  assert.match(sql,/SEPARATION_OF_DUTIES_FAILED/);
  assert.match(sql,/decided_by=v_uid/);
  assert.match(sql,/decision_reason=nullif\(v_reason,''\)/);
  assert.match(sql,/security invoker/i);
});
