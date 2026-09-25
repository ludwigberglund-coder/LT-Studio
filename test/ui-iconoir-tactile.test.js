'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Iconoir används i portal, operator, projektadmin och publik webb',()=>{
  const portal=read('apps/portal/portal-nav.js');
  const operator=read('apps/operator/app.js');
  const admin=read('apps/admin/app.js');
  const website=read('apps/website/app.js');

  assert.match(portal,/const ICONOIR=Object\.freeze/);
  assert.match(portal,/semanticButtonIcon/);
  assert.match(portal,/animateTap/);

  assert.match(operator,/const OPERATOR_ICONOIR=Object\.freeze/);
  assert.match(operator,/operatorTap/);
  assert.match(operator,/decorateOperatorUi/);

  assert.match(admin,/const ADMIN_ICONOIR=Object\.freeze/);
  assert.match(admin,/adminIcon\(item\.id\)/);

  assert.match(website,/const SITE_ICONOIR=Object\.freeze/);
  assert.match(website,/siteIcon\('menu'\)/);
  assert.match(website,/siteIcon\('mapPin'\)/);
});

test('designsystemen ger tydlig press-feedback, skuggor och reduced-motion',()=>{
  const files=[
    'apps/portal/design-system.css',
    'apps/operator/design-system.css',
    'apps/admin/design-system.css',
    'apps/website/design-system.css',
    'public/design-system.css'
  ];

  for(const file of files){
    const css=read(file);
    assert.match(css,/box-shadow/,`${file} ska ha elevation/skuggor`);
    assert.match(css,/:active/,`${file} ska ha tryckfeedback`);
    assert.match(css,/prefers-reduced-motion/,`${file} ska respektera reduced-motion`);
  }
});

test('disabled fakturaknapp behåller nya designsystemets blockerade state',()=>{
  const css=read('apps/portal/design-system.css');
  const browser=read('test/menu-invoice-browser.cjs');

  assert.match(css,/\.invoice-workspace #invoice-form button\[type="submit"\]:disabled/);
  assert.match(browser,/backgroundColor:'rgb\(229, 229, 229\)'/);
  assert.match(browser,/color:'rgb\(115, 115, 115\)'/);
});


test('användarmenyn renderar Iconoir som DOM och webbplatsens mobilmeny behåller responsiv synlighet',()=>{
  const portal=read('apps/portal/portal-nav.js');
  const websiteCss=read('apps/website/design-system.css');
  const baseWebsiteCss=read('apps/website/styles.css');

  assert.match(portal,/caret\.append\(iconoir\('navArrowDown'\)\)/);
  assert.doesNotMatch(portal,/caret\.innerHTML=iconoir/);
  assert.doesNotMatch(websiteCss,/\.site-with-icon\{display:inline-flex!important/);
  assert.match(baseWebsiteCss,/\.menu-button \{ display: none; \}/);
  assert.match(baseWebsiteCss,/\.menu-button \{ display: inline-flex;/);
});


test('Betalningar på GitHub Pages använder Supabase och sidomenyn håller ikonmellanrum',()=>{
  const html=read('apps/portal/payments.html');
  const js=read('apps/portal/payments.js');
  const navCss=read('apps/portal/shared-nav.css');
  const design=read('apps/portal/design-system.css');

  assert.match(html,/supabase-config\.js/);
  assert.match(html,/supabase-client\.js/);
  assert.match(html,/supabase-session\.js/);
  assert.match(js,/const isDemo=pageParams\.get\('demo'\)==='1'/);
  assert.match(js,/const isSupabase=location\.hostname==='ludwigberglund-coder\.github\.io'&&!isDemo/);
  assert.match(js,/async function supabasePayments\(\)/);
  assert.match(js,/customer_payment_executions/);
  assert.match(navCss,/shared-links a\{display:flex!important;align-items:center!important;gap:12px!important/);
  assert.match(design,/shared-navigation \.shared-links a\.ui-with-icon/);
  assert.match(design,/payments-live-banner/);
  assert.match(design,/prefers-reduced-motion:reduce/);
});
