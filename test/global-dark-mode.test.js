'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('shared dark mode uses a dimmed palette and Iconoir sun/moon icons',()=>{
  const css=read('packages/shared/browser/theme.css');
  const js=read('packages/shared/browser/theme.js');

  for(const color of ['#22272e','#2d333b','#373e47','#444c56']){
    assert.ok(css.includes(color),`dimmed palette color missing: ${color}`);
  }
  assert.match(css,/--lt-dark-text:#ffffff/);
  assert.match(css,/--lt-dark-heading:#ffffff/);
  assert.match(css,/--lt-dark-muted:#dce4ec/);
  assert.match(js,/M12 18C15\.3137 18 18 15\.3137 18 12/);
  assert.match(js,/M3 11\.5066C3 16\.7497/);
  assert.match(js,/lt-studio-theme-v1/);
  assert.match(js,/prefers-color-scheme: dark/);
  assert.match(js,/MutationObserver/);
  assert.match(js,/button\.dataset\.ltThemeState===theme/);
  assert.match(js,/Stäng av mörkt läge/);
  assert.match(js,/Slå på mörkt läge/);
  assert.match(css,/--color-ink:#ffffff/);
  assert.match(css,/--surface-card:var\(--lt-dark-surface\)/);
  assert.match(css,/\.res-table td,.queue-table td/);
  assert.match(css,/\.shared-navigation \.shared-links a\[aria-current="page"\]/);
  assert.match(css,/color:#fff!important/);
});

test('static build installs dark mode on every system workspace',()=>{
  const build=read('scripts/build-static.js');
  assert.match(build,/function installGlobalTheme\(directory\)/);
  assert.match(build,/theme\.css/);
  assert.match(build,/theme\.js/);
  assert.match(build,/for\(const workspace of \['portal','admin','operator','legacy','uat'\]\)installGlobalTheme\(path\.join\(target,workspace\)\)/);
  assert.match(build,/'shared\/theme\.css'/);
  assert.match(build,/'shared\/theme\.js'/);
});

test('theme toggle remains keyboard accessible and visible on mobile',()=>{
  const css=read('packages/shared/browser/theme.css');
  assert.match(css,/\.lt-theme-toggle:focus-visible/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/\.lt-theme-toggle-floating/);
  assert.match(css,/min-height:40px/);
});

test('dark portal modules keep batches, suppliers and navigation readable',()=>{
  const theme=read('packages/shared/browser/theme.css');
  const design=read('apps/portal/design-system.css');
  const batches=read('apps/portal/batches.css');
  const suppliers=read('apps/portal/suppliers.css');

  assert.match(theme,/\.batch-list,\.batch-editor/);
  assert.match(theme,/\.supplier-row,\.supplier-search-results,\.supplier-search-option/);
  assert.match(theme,/\.status-approved/);
  assert.match(theme,/\.critical-box/);
  assert.match(design,/html\[data-lt-theme="dark"\] \.shared-sidebar \.ui-icon/);
  assert.match(design,/color:#fff!important/);
  assert.match(design,/\.topbar>\.shared-menu-toggle/);
  assert.match(design,/column-gap:16px/);
  assert.match(batches,/var\(--surface-card/);
  assert.match(batches,/var\(--surface-alt/);
  assert.match(suppliers,/var\(--surface-card/);
  assert.match(suppliers,/var\(--surface-input-fill/);
});

