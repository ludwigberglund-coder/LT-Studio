'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const portal=path.join(__dirname,'../apps/portal');
const html=fs.readFileSync(path.join(portal,'book-close-trial-balance.html'),'utf8');
const css=fs.readFileSync(path.join(portal,'book-close-trial-balance.css'),'utf8');
const ui=fs.readFileSync(path.join(portal,'book-close-trial-balance-ui.js'),'utf8');
const nav=fs.readFileSync(path.join(portal,'portal-nav.js'),'utf8');
test('trial balance is linked from authenticated navigation with reports permission',()=>{
  assert.match(nav,/\['trial-balance','Saldobalans · bokslut','portal\/book-close-trial-balance\.html'\]/);
  assert.match(nav,/'trial-balance':'reports\.view'/);
  assert.match(html,/\.\/supabase-session\.js/);
  assert.match(html,/\.\/book-close-trial-balance\.js/);
  assert.match(html,/\.\/book-close-trial-balance-ui\.js/);
});
test('clear readable trial balance with accessible period filters and searchable account rows',()=>{
  for(const id of ['tb-app','tb-form','tb-start','tb-end','tb-run','tb-search','tb-rows','tb-results','tb-warning','tb-difference'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(html,/type="date"/);
  assert.match(html,/id="tb-search" type="text" inputmode="search"/);
  assert.match(html,/aria-live="polite"/);
  assert.match(html,/ingående balans måste kontrolleras separat/);
  assert.match(css,/data-lt-theme="dark"/);
  assert.match(css,/@media\(max-width:650px\)/);
  assert.match(css,/focus-visible/);
});
test('browser does not round money, preserve stale results or fake approvals',()=>{
  assert.match(ui,/BigInt\(value\)/);
  assert.match(ui,/LTBookCloseTrialBalance\.inspect/);
  assert.match(ui,/activeCompany!==first\.company\.id/);
  assert.match(ui,/ticket!==revision/);
  assert.match(ui,/results\.hidden=true/);
  assert.match(ui,/createElement\('tr'\)/);
  assert.match(ui,/cell\.textContent=/);
  assert.match(ui,/Logga in i ett testföretag/);
  assert.doesNotMatch(ui,/innerHTML|localStorage|sessionStorage|service_role|\.insert\(|\.upsert\(|\.update\(/);
});
test('book-close trial balance page is read-only and never claims annual report approval',()=>{
  assert.match(html,/Inte avstämt/);
  assert.match(html,/Ingen kontroll körd ännu/);
  assert.doesNotMatch(html,/Bokslut klart|Årsredovisning godkänd|Deklaration inskickad/);
});
