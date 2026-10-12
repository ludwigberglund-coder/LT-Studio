const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('översikten laddar delad meny även på Supabase UAT',()=>{
  const html=read('apps/portal/dashboard.html');
  const js=read('apps/portal/dashboard.js');
  assert.match(html,/supabase-config\.js/);
  assert.match(html,/supabase-client\.js/);
  assert.match(html,/supabase-session\.js/);
  assert.ok(html.indexOf('supabase-session.js')<html.indexOf('portal-nav.js'));
  assert.match(js,/const isDemo=pageParams\.get\('demo'\)==='1'/);
  assert.match(js,/const isSupabase=location\.hostname==='ludwigberglund-coder\.github\.io'&&!isDemo/);
  assert.match(js,/function sidebar\(\)\{return '<aside class="sidebar"><\/aside>'\}/);
  assert.match(js,/RollandsNavigation\?\.mount/);
  assert.match(js,/LTSupabase\.from\('period_unlock_requests'/);
  assert.match(js,/LTSupabase\.from\('financial_batches'/);
  assert.match(js,/Godkänn väntande buntar/);
  assert.doesNotMatch(js,/accounting_unlock_requests/);
});

test('översikten är medvetet gles och visar högst sex viktiga uppgifter',()=>{
  const js=read('apps/portal/dashboard.js');
  const css=read('apps/portal/dashboard.css');
  assert.match(js,/return tasks\.slice\(0,6\)/);
  assert.doesNotMatch(js,/Starta testguiden/);
  assert.doesNotMatch(js,/Alla områden/);
  assert.doesNotMatch(js,/Öppet kundsaldo/);
  assert.match(js,/God morgon/);
  assert.match(js,/God eftermiddag/);
  assert.match(js,/God kväll/);
  assert.match(css,/welcome-motion/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});


test('delad navigation startar om med öppen desktopmeny efter UAT-fixen',()=>{
  const nav=read('apps/portal/portal-nav.js');
  assert.match(nav,/rollands-navigation-v3/);
  assert.match(nav,/read\(\)\.sidebarCollapsed!==true/);
});

test('översikten ger en tydlig första handling och är ärlig om ofullständiga data',()=>{
  const js=read('apps/portal/dashboard.js');
  const css=read('apps/portal/dashboard.css');
  assert.match(js,/function pendingTaskCount\(m\)/);
  assert.match(js,/const totalPending=pendingTaskCount\(m\)/);
  assert.match(js,/const incomplete=Boolean\(m\.loadErrors\?\.length\)/);
  assert.match(js,/Översikten är ofullständig/);
  assert.match(js,/Kontrollera de saknade köerna/);
  assert.match(js,/class="welcome-next"/);
  assert.match(js,/href="\$\{url\(tasks\[0\]\.href\)\}"/);
  assert.match(js,/index===0\?'Börja här'/);
  assert.match(css,/\.welcome-next:focus-visible/);
  assert.match(css,/\.today-count\.incomplete/);
});
