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

test('theme toggle is mounted beside the profile in every workspace topbar',()=>{
  const css=read('packages/shared/browser/theme.css');
  const js=read('packages/shared/browser/theme.js');

  assert.match(js,/function topbarTarget\(\)/);
  assert.match(js,/document\.querySelector\('\.topbar'\)/);
  assert.match(js,/topbar\.insertBefore\(topbarButton,profile\)/);
  assert.match(js,/\.shared-user-menu,\.user-chip,\.operator-user,\.admin-user/);
  assert.match(js,/menu\?\.remove\(\)/);
  assert.match(js,/floating\?\.remove\(\)/);
  assert.match(css,/\.lt-theme-toggle-topbar/);
  assert.match(css,/\.topbar>\.lt-theme-toggle-topbar\+\.shared-user-menu/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.lt-theme-toggle-topbar/);
});

test('overview cards use shared surfaces and are dark-mode safe',()=>{
  const css=read('packages/shared/browser/theme.css');
  const dashboard=read('apps/portal/dashboard.css');

  assert.match(css,/\.welcome-card,\.today-work,\.overview-empty/);
  assert.match(css,/html\[data-lt-theme="dark"\] :where\(\.welcome-card,\.today-work,\.overview-empty\)/);
  assert.match(dashboard,/background:var\(--surface-card/);
  assert.match(dashboard,/background:var\(--surface-alt/);
  assert.doesNotMatch(dashboard,/background:\s*#fff\b/);
});

test('customer credit settlement dialog uses theme tokens in dark mode',()=>{
  const theme=read('packages/shared/browser/theme.css');
  const portal=read('apps/portal/styles.css');

  assert.match(portal,/\.settlement-block\{[^}]*background:var\(--surface-alt/);
  assert.match(portal,/\.settlement-grid input:disabled\{[^}]*opacity:1/);
  assert.match(portal,/-webkit-text-fill-color:var\(--ink/);
  assert.match(theme,/\.settlement-block/);
  assert.match(theme,/\.settlement-block-head span,\.settlement-grid label,\.settlement-limit/);
  assert.match(theme,/html\[data-lt-theme="dark"\] \.settlement-grid input:disabled/);
  assert.match(theme,/-webkit-text-fill-color:#fff!important/);
});

test('settlement dialog follows both light and dark themes and static assets are versioned',()=>{
  const portal=read('apps/portal/styles.css');
  const build=read('scripts/build-static.js');

  assert.match(portal,/html\[data-lt-theme="light"\] \.settlement-block/);
  assert.match(portal,/html\[data-lt-theme="dark"\] \.settlement-block/);
  assert.match(portal,/html\[data-lt-theme="dark"\] \.settlement-grid input:disabled/);
  assert.match(build,/function versionStaticAssets\(directory,version\)/);
  assert.match(build,/css\|js/);
  assert.match(build,/process\.env\.GITHUB_SHA\|\|'local'/);
  assert.match(build,/versionStaticAssets\(target,process\.env\.GITHUB_SHA\|\|'local'\)/);
});

