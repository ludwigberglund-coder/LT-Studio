'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function formStage(){
  const css=read('apps/portal/design-system.css');
  const marker='LT Studio UI 2.0 — form surfaces';
  const index=css.indexOf(marker);
  assert.ok(index>=0,'form UI stage marker is missing');
  const end=css.indexOf('/* LT Studio UI 2.0 — shared dialogs',index);
  return css.slice(index,end>index?end:css.length);
}

test('portal form controls share one solid Apple-inspired treatment',()=>{
  const stage=formStage();
  for(const selector of [
    '.invoice-grid',
    '.accounting-form',
    '.sales-form',
    '.payroll-form',
    '.cms-form',
    '.intake-grid',
    '#security-form',
    '.company-settings-form',
    '.documents-modal form',
    '.inventory-form',
    '.opening-line-row',
    '#payment-confirm-form',
    '.target-editor',
    '.booking-row',
    '.proposal-actions',
    '.coding-table'
  ]){
    assert.ok(stage.includes(selector),`form stage must cover ${selector}`);
  }
  assert.match(stage,/min-height:44px/);
  assert.match(stage,/border-radius:14px!important/);
  assert.match(stage,/background:var\(--lt-form-control-bg\)!important/);
  assert.doesNotMatch(stage,/backdrop-filter/i,'data-entry controls must stay solid, not glassy');
});

test('form focus, disabled and readonly states remain explicit',()=>{
  const stage=formStage();
  assert.match(stage,/:focus-visible\{/);
  assert.match(stage,/outline:2px solid var\(--lt-form-focus\)!important/);
  assert.match(stage,/:disabled,/);
  assert.match(stage,/\[readonly\]/);
  assert.match(stage,/cursor:not-allowed/);
});

test('form UI supports dark mode and reduced motion',()=>{
  const stage=formStage();
  assert.match(stage,/html\[data-lt-theme="dark"\]/);
  assert.match(stage,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(stage,/transition:none!important/);
});

test('search controls remain owned by the separate search stage',()=>{
  const stage=formStage();
  assert.doesNotMatch(stage,/\.shared-search-shell/);
  assert.doesNotMatch(stage,/\.supplier-search-control/);
  assert.doesNotMatch(stage,/\.receivable-search-field/);
});

test('existing business forms and required fields remain present',()=>{
  const customers=read('apps/portal/customers.js');
  const payroll=read('apps/portal/payroll.js');
  const website=read('apps/portal/website.js');
  const profile=read('apps/portal/profile.js');

  assert.match(customers,/id="customer-form" class="sales-form"/);
  assert.match(customers,/required/);
  assert.match(payroll,/id="payroll-import"/);
  assert.match(payroll,/required/);
  assert.match(website,/id="cms-form" class="panel cms-form"/);
  assert.match(profile,/id="security-form"/);
});
