'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const themes=[
  'apps/portal/design-system.css',
  'apps/operator/design-system.css',
  'apps/admin/design-system.css',
  'apps/website/design-system.css',
  'public/design-system.css'
];

const canonicalTokens={
  '--color-canvas':'#f7f5f0',
  '--color-paper':'#ffffff',
  '--color-ink':'#16362b',
  '--color-ink-soft':'#27483d',
  '--color-ember':'#b4462f',
  '--color-brand':'#173f32',
  '--color-brand-2':'#2c624d',
  '--color-leaf':'#6f8f4f',
  '--color-lime':'#dce9a7',
  '--color-warm':'#c5653f',
  '--radius-cards':'24px',
  '--radius-buttons':'18px',
  '--radius-inputs':'18px',
  '--radius-badges':'18px'
};

function source(relative){return fs.readFileSync(path.join(root,relative),'utf8')}
function styleLinks(html){return [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)].map(match=>match[1])}

test('alla LT Studio-ytor använder samma kanoniska design tokens',()=>{
  for(const file of themes){
    const css=source(file);
    for(const [token,value] of Object.entries(canonicalTokens)){
      assert.match(css,new RegExp(`${token}:\\s*${value.replace('#','\\#')}`),`${file} saknar ${token}`);
    }
    assert.match(css,/--font-geist:\s*["']Geist["']/,`${file} måste använda Geist-stacken`);
    assert.match(css,/--shadow-subtle:/,`${file} måste använda den diskreta kortskuggan`);
    assert.match(css,/@media \(prefers-reduced-motion: reduce\)/,`${file} måste respektera reducerad rörelse`);
  }
});

test('LT Studio-paletten är avsiktlig och konsekvent mellan ytorna',()=>{
  for(const file of themes){
    const css=source(file);
    assert.match(css,/--color-brand:\s*#173f32/,file+' saknar primär LT Studio-grön');
    assert.match(css,/--color-brand-2:\s*#2c624d/,file+' saknar sekundär LT Studio-grön');
    assert.match(css,/--color-warm:\s*#c5653f/,file+' saknar varm accent');
    assert.match(css,/--color-leaf:\s*#6f8f4f/,file+' saknar bladaccent');
    assert.match(css,/--color-lime:\s*#dce9a7/,file+' saknar ljus accent');
  }
});

test('högspecificerade äldre ytor har uttryckliga moderna överstyrningar',()=>{
  const operator=source('apps/operator/design-system.css');
  const legacy=source('public/design-system.css');
  assert.match(operator,/\.topbar\s*\{[^}]*background:\s*rgb\(247 245 240/s);
  assert.match(operator,/\.global-access-panel \.panel-head[^{]*\{[^}]*background:\s*var\(--color-paper\)/s);
  assert.match(legacy,/\.status\.paid,[^{]*\.status\.review,[^{]*\{[^}]*background:\s*#f5f5f5/s);
  assert.match(legacy,/\.hero h1\s*\{[^}]*font-size:\s*clamp\(42px, 6vw, var\(--text-display\)\)/s);
});

test('designsystemet laddas sist på varje gränssnittssida',()=>{
  const pages=[
    ...fs.readdirSync(path.join(root,'apps','portal')).filter(name=>name.endsWith('.html')).map(name=>`apps/portal/${name}`),
    'apps/operator/index.html','apps/admin/index.html','apps/website/index.html','public/index.html'
  ];
  for(const file of pages){
    const html=source(file),links=styleLinks(html);
    assert.ok(links.length>0,`${file} saknar stylesheet`);
    assert.match(links.at(-1),/design-system\.css(?:\?|$)/,`${file} måste ladda designsystemet sist`);
    assert.match(html,/<meta name="theme-color" content="#f7f5f0">/,`${file} har fel browser-temafärg`);
  }
});

test('den statiska byggnaden placerar navigation före designsystemet',()=>{
  const buildSource=source('scripts/build-static.js');
  assert.match(buildSource,/const designSystem=\/<link\\b[^\n]+design-system\\\.css/);
  assert.match(buildSource,/html\.replace\(designSystem,match=>`\$\{sharedNavigation\}\\n\$\{match\}`\)/);
});
