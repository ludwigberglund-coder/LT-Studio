'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildStatic}=require('../scripts/build-static.js');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('every published workspace installs the single final contrast layer',()=>{
  const dist=buildStatic();
  for(const route of ['index.html','portal/dashboard.html','portal/suppliers.html',
    'portal/payments.html','portal/batches.html','portal/bokslut.html',
    'operator/index.html','legacy/index.html']){
    const html=fs.readFileSync(path.join(dist,route),'utf8');
    const contrast=[...html.matchAll(/theme-contrast\.css\?v=/g)];
    const theme=[...html.matchAll(/theme\.css\?v=/g)];
    assert.equal(contrast.length,1,route+' must load one contrast override');
    assert.equal(theme.length,1,route+' must load one global theme');
    assert.ok(html.lastIndexOf('theme-contrast.css')>html.lastIndexOf('design-system.css'),
      route+' must load contrast CSS last');
    assert.match(html,/theme\.js\?v=/,route+' must have an appearance switch');
  }
  for(const route of ['admin/index.html','uat/index.html']){
    const html=fs.readFileSync(path.join(dist,route),'utf8');
    assert.doesNotMatch(html,/theme-contrast\.css|theme\.js/,route+' is a redirect');
  }
});

test('both appearances protect nested text, icons and entry fields',()=>{
  const css=read('packages/shared/browser/theme-contrast.css');
  assert.match(css,/--lt-read-text:#1c2523/);
  assert.match(css,/--lt-read-text:#ffffff/);
  assert.match(css,/\.shared-navigation \.shared-links a/);
  assert.match(css,/\.operator-shell \.sidebar/);
  assert.match(css,/\.ui-icon,\.op-icon/);
  assert.match(css,/-webkit-text-fill-color:#ffffff!important/);
  assert.match(css,/::placeholder/);
  assert.match(css,/\[readonly\]/);
  assert.match(css,/\.contact :where/);
  assert.match(css,/@media\(forced-colors:active\)/);
});

test('operator and global appearance are the same persisted mode',()=>{
  const operator=read('apps/operator/app.js');
  const global=read('packages/shared/browser/theme.js');
  assert.match(operator,/const sharedThemeKey='lt-studio-theme-v1'/);
  assert.match(operator,/document\.documentElement\.dataset\.ltTheme=operatorTheme/);
  assert.match(operator,/window\.LTTheme\?\.apply\(operatorTheme,\{persist:true\}\)/);
  assert.match(operator,/addEventListener\('lt-themechange'/);
  assert.match(global,/localStorage\.setItem\(STORAGE_KEY,normalized\)/);
});
