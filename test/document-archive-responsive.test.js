'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..','apps','portal');
const css=fs.readFileSync(path.join(root,'documents.css'),'utf8');
const html=fs.readFileSync(path.join(root,'documents.html'),'utf8');

function luminance(hex){
  const color=hex.replace('#','');
  assert.match(color,/^[0-9a-f]{6}$/i);
  const rgb=[0,2,4].map(i=>parseInt(color.slice(i,i+2),16)/255)
    .map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
function contrast(a,b){
  const l1=luminance(a),l2=luminance(b);
  return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
}
function variables(block){
  const out={};
  for(const m of block.matchAll(/--(docs-[a-z-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi))
    out[m[1]]=m[2];
  return out;
}

test('mobile document archive becomes readable cards without a 900px wide table',()=>{
  const section=css.slice(css.indexOf('LT Studio document archive usability'));
  assert.match(section,/@media\(max-width:720px\)/);
  assert.match(section,/\.documents-main \.documents-table\{\s*display:block;\s*min-width:0;\s*width:100%/);
  assert.match(section,/\.documents-main \.documents-table tbody\{\s*display:grid;/);
  assert.match(section,/\.documents-main \.documents-table tbody tr\{\s*display:flex;\s*flex-direction:column/);
  assert.match(section,/\.documents-main \.documents-table tbody td:nth-child\(2\)\{order:0\}/);
  for(const label of ['Dokument','Kategori','Koppling','Storlek','Kontrollsumma','Registrerat','Åtgärder'])
    assert.ok(section.includes('content:"'+label+'"'),label+' label should be visible on mobile');
  assert.match(section,/td\[colspan\]/);
});

test('document buttons remain touch friendly and search controls do not trigger iPhone zoom',()=>{
  const section=css.slice(css.indexOf('LT Studio document archive usability'));
  assert.match(section,/\.documents-main \.documents-toolbar \.button,[\s\S]*?min-height:44px/);
  assert.match(section,/\.documents-main \.documents-filters :is\(input,select\)\{font-size:16px!important\}/);
  assert.match(section,/:focus-visible\{/);
  assert.doesNotMatch(section,/backdrop-filter|glassmorphism/i);
  const sheets=[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(sheets,['./styles.css','./documents.css','./design-system.css']);
});

test('archive theme has distinct high-contrast opaque card, caption and category colors',()=>{
  const light=variables(css.slice(css.indexOf('.documents-shell{'),css.indexOf('.documents-main .documents-toolbar,')));
  const darkMatch=css.match(/html\[data-lt-theme="dark"\] \.documents-shell\{([\s\S]*?)\n\}/);
  assert.ok(darkMatch,'dark palette is scoped to document archive');
  const dark=variables(darkMatch[1]);
  for(const p of [light,dark]){
    for(const [f,b] of [
      ['ink','surface'],['ink','soft'],['muted','surface'],['pill-ink','pill']
    ]){
      const foreground=p['docs-'+f],background=p['docs-'+b];
      assert.ok(foreground&&background,f+' on '+b+' palette');
      assert.ok(contrast(foreground,background)>=4.5,
        f+' on '+b+' contrast '+contrast(foreground,background).toFixed(2)+' must be at least 4.5');
    }
  }
  assert.match(css,/html\[data-lt-theme="dark"\] \.documents-main \.documents-table th/);
  assert.match(css,/html\[data-lt-theme="dark"\] \.documents-main \.doc-category/);
});
