'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('Driftadmin premium UI is loaded after the base and shared styles',()=>{
  const html=read('apps/operator/index.html');
  assert.match(html,/styles\.css"[\s\S]*design-system\.css"[\s\S]*premium-ui\.css"/);
});
test('theme selection persists and updates without re-rendering protected data',()=>{
  const app=read('apps/operator/app.js');
  const css=read('apps/operator/premium-ui.css');
  assert.match(app,/operatorThemeKey='lt-operator-theme-v1'/);
  assert.match(app,/data-action="toggle-theme"/);
  assert.match(app,/if\(action==='toggle-theme'\)/);
  assert.match(app,/localStorage\.setItem\(operatorThemeKey,operatorTheme\)/);
  assert.match(app,/syncThemeButtons\(\)/);
  assert.match(css,/html\[data-operator-theme="dark"\]/);
  assert.match(css,/color-scheme:dark/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
test('the shared onboarding security checks and real operator actions remain intact',()=>{
  const app=read('apps/operator/app.js');
  const css=read('apps/operator/premium-ui.css');
  assert.match(app,/operator_create_company_onboarding|edgeAction\(path,options\)/);
  assert.match(app,/id="create-company-form"/);
  assert.match(app,/data-action="create-company"/);
  assert.match(app,/onboarding-progress/);
  assert.match(app,/showOnboardingError\(event\.target,error\)/);
  assert.match(app,/const created=await mutate\('\/companies'/);
  assert.match(app,/document\.body\.classList\.toggle\('operator-modal-open'/);
  assert.match(app,/event\.key!=='Tab'/);
  assert.match(css,/\.onboarding-modal-card/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/\.onboarding-form \.form-grid\{grid-template-columns:1fr\}/);
});

test('premium operator theme does not lose navigation contrast to Liquid Glass',()=>{
  const premium=read('apps/operator/premium-ui.css');
  const glass=read('packages/shared/browser/liquid-glass.css');
  assert.ok(glass.includes('data-lt-glass-surface="operator"'));
  assert.ok(premium.includes('html[data-lt-glass-surface="operator"][data-operator-theme="dark"]'));
  assert.ok(premium.includes('html[data-lt-glass-surface="operator"][data-operator-theme] .sidebar'));
  assert.ok(premium.includes('@media (prefers-reduced-transparency:reduce)'));
  assert.ok(premium.includes('@media (forced-colors:active)'));
});
