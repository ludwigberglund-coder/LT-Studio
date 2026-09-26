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

  for(const color of ['#22272e','#2d333b','#373e47','#444c56','#adbac7','#909dab']){
    assert.ok(css.includes(color),`dimmed palette color missing: ${color}`);
  }
  assert.match(js,/M12 18C15\.3137 18 18 15\.3137 18 12/);
  assert.match(js,/M3 11\.5066C3 16\.7497/);
  assert.match(js,/lt-studio-theme-v1/);
  assert.match(js,/prefers-color-scheme: dark/);
  assert.match(js,/MutationObserver/);
  assert.match(js,/Stäng av mörkt läge/);
  assert.match(js,/Slå på mörkt läge/);
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
