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
  '--color-surface-alt':'#fafafa',
  '--color-ink':'#0a0a0a',
  '--color-ink-soft':'#171717',
  '--color-mid-gray':'#737373',
  '--color-hairline':'#e5e5e5',
  '--color-ember':'#e7000b',
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
    if(file!=='apps/website/design-system.css')assert.doesNotMatch(css,/(?:linear|radial)-gradient\(/,`${file} får inte återinföra gradienter`);
    assert.match(css,/@media \(prefers-reduced-motion: reduce\)/,`${file} måste respektera reducerad rörelse`);
  }
});

test('temafilerna är akromatiska utanför den avsiktliga canvasen och felrött',()=>{
  for(const file of themes){
    const colors=new Set(source(file).match(/#[0-9a-f]{6}\b/gi)||[]);
    for(const color of colors){
      const normalized=color.toLowerCase();
      if(normalized==='#f7f5f0'||normalized==='#e7000b')continue;
      const [,red,green,blue]=normalized.match(/^#(..)(..)(..)$/);
      assert.equal(red,green,`${file} innehåller en otillåten kulör: ${color}`);
      assert.equal(green,blue,`${file} innehåller en otillåten kulör: ${color}`);
    }
  }
});

test('publika hemsidan får använda den kontrollerade LT Studio-paletten och mjuka gradienter',()=>{
  const website=source('apps/website/design-system.css');
  for(const token of ['--brand-forest:#173f32','--brand-peach:#f2b18e','--brand-lime:#dfe9ad','--brand-sky:#dcecf2']){
    assert.match(website,new RegExp(token.replace('#','\\#')),\`hemsidan saknar godkänd varumärkesfärg: \${token}\`);
  }
  assert.match(website,/(?:linear|radial)-gradient\\(/,'hemsidan ska få använda mjuka gradienter');
  assert.match(website,/--brand-ink:#18342b/,'hemsidan ska använda den mörka gröna textfärgen för kontrast');
  assert.match(website,/prefers-reduced-motion/,'hemsidan ska fortfarande respektera reducerad rörelse');
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
