'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('admin overview contains live GitHub and Supabase system status',()=>{
  const html=read('apps/admin/index.html');
  const app=read('apps/admin/app.js');
  const js=read('apps/admin/system-status.js');
  const css=read('apps/admin/system-status.css');
  assert.match(html,/system-status\.css/);
  assert.match(html,/supabase-config\.js/);
  assert.match(html,/system-status\.js/);
  assert.match(app,/id="live-system-status"/);
  assert.match(js,/GitHub och Supabase i realtid/);
  assert.match(js,/function supabaseMark\(\)/);
  assert.ok(js.includes('auth/v1/health'));
  assert.ok(js.includes('realtime/v1/websocket'));
  assert.ok(js.includes("const REPO='ludwigberglund-coder/LT-Studio'"));
  assert.ok(js.includes('commits/main'));
  assert.ok(js.includes('actions/runs?branch=main&per_page=10'));
  assert.match(js,/GITHUB_REFRESH_MS=5\*60\*1000/);
  assert.match(js,/SUPABASE_REFRESH_MS=60\*1000/);
  assert.match(css,/@keyframes systemScan/);
  assert.match(css,/@keyframes systemDotPulse/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('live status only uses the public Supabase publishable key',()=>{
  const js=read('apps/admin/system-status.js');
  assert.match(js,/window\.LT_SUPABASE/);
  assert.match(js,/publishableKey/);
  assert.doesNotMatch(js,/service[_-]?role/i);
  assert.doesNotMatch(js,/sb_secret_/i);
});
