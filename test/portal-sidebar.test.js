'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const portal=path.join(root,'apps','portal');
const privatePortalPages=[
  'dashboard.html','invoices.html','index.html','payables.html','bank.html','automation.html',
  'accounting.html','reports.html','accounts.html','payroll.html','customers.html','suppliers.html',
  'inventory.html','website.html','documents.html'
];

test('alla privata portalsidor monterar samma delade sidomeny',()=>{
  for(const page of privatePortalPages){
    const html=fs.readFileSync(path.join(portal,page),'utf8');
    assert.match(html,/styles\.css/,page+' måste använda den gemensamma portalstilen');
    assert.match(html,/portal-nav\.js/,page+' måste ladda den gemensamma sidomenyn');
  }
});

test('sidomenyn ligger kvar vid vertikal scroll och har egen scroll vid behov',()=>{
  const css=fs.readFileSync(path.join(portal,'styles.css'),'utf8');
  assert.match(css,/\.sidebar\{[^}]*position:sticky;[^}]*top:0;[^}]*height:100vh;[^}]*overflow-y:auto;/);
  assert.match(css,/@media\(max-width:1000px\)\{\.portal,\.dash-shell\{grid-template-columns:76px minmax\(0,1fr\)\}/);
  assert.match(css,/@media\(max-width:720px\)[\s\S]*?\.portal,\.dash-shell\{grid-template-columns:1fr\}\.sidebar\{display:none\}/);
});

test('arbetsöversikten använder samma sidomenybredd och mobilgräns som övriga portalen',()=>{
  const css=fs.readFileSync(path.join(portal,'dashboard.css'),'utf8');
  assert.match(css,/\.dash-shell\{[^}]*grid-template-columns:var\(--sidebar-width\) minmax\(0,1fr\)/);
  assert.match(css,/@media\(max-width:720px\)\{/);
  assert.doesNotMatch(css,/@media\(max-width:760px\)/);
});


test('gemensamma portalen upptäcker serveruppdatering utan hård omladdning',()=>{
  const js=fs.readFileSync(path.join(portal,'portal-nav.js'),'utf8');
  assert.match(js,/fetch\('\/_runtime-version'/);
  assert.match(js,/cache:'no-store'/);
  assert.match(js,/previous&&previous!==runtimeId\)\{location\.reload\(\)/);
  assert.match(js,/addEventListener\('focus',ensureFreshRuntime\)/);
  assert.match(js,/visibilitychange/);
  assert.match(js,/setInterval\(ensureFreshRuntime,30000\)/);
});
