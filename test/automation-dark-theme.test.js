'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const portal=path.join(__dirname,'..','apps','portal');
const css=fs.readFileSync(path.join(portal,'automation.css'),'utf8');
const html=fs.readFileSync(path.join(portal,'automation.html'),'utf8');

function luminance(hex){
  assert.match(hex,/^#[0-9a-f]{6}$/i);
  const channels=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
    .map(x=>x<=0.04045?x/12.92:Math.pow((x+0.055)/1.055,2.4));
  return 0.2126*channels[0]+0.7152*channels[1]+0.0722*channels[2];
}
function contrast(a,b){
  const l1=luminance(a),l2=luminance(b);
  return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
}
function darkColors(){
  const block=css.match(/html\[data-lt-theme="dark"\] \.automation-content\{([\s\S]*?)\n\}/);
  assert.ok(block,'page-scoped dark palette exists');
  const properties={};
  for(const entry of block[1].matchAll(/--(aq-[a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi))
    properties[entry[1]]=entry[2];
  return properties;
}

test('review queue keeps common stylesheet ordering, opaque surfaces and mobile widths',()=>{
  const styleRefs=[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(styleRefs.slice(-2),['./automation.css','./design-system.css']);
  assert.match(css,/\.automation-content \.automation-filter button\{[\s\S]*?min-height:44px/);
  assert.match(css,/@media\(max-width:720px\)/);
  assert.match(css,/overflow-wrap:anywhere/);
  assert.match(css,/:focus-visible/);
  const scoped=css.slice(css.indexOf('AI-ready review workspace'));
  assert.doesNotMatch(scoped,/backdrop-filter|backdropFilter|glassmorphism/i);
});

test('dark review panels, nested booking rows and action statuses have explicit surfaces',()=>{
  for(const selector of [
    '.automation-card','.proposal','.booking-box','.booking-row',
    '.evidence-row','.action-facts span','.target-editor','.no-booking',
    '.proposal-status.manual-review','.proposal-status.ready-for-approval',
    '.proposal-status.rejected','.automation-filter button.active',
    '.automation-filter button:not(.active)','.approval-confirmation'
  ])assert.ok(css.includes(selector),'Missing visible selector: '+selector);
  assert.match(css,/html\[data-lt-theme="dark"\] \.automation-content/);
  assert.match(css,/color:var\(--aq-ink\)!important/);
  assert.match(css,/background:var\(--aq-panel\)!important/);
  assert.match(css,/color:var\(--aq-review\)!important/);
});

test('dark mode palette passes AA contrast for regular text and risk states',()=>{
  const palette=darkColors();
  const pairs=[
    ['ink','panel'],['ink','soft'],['muted','panel'],
    ['warning','warning-bg'],['ready','ready-bg'],
    ['review','review-bg'],['danger','danger-bg'],
    ['active','active-bg']
  ];
  for(const [foreground,background] of pairs){
    const fg=palette['aq-'+foreground],bg=palette['aq-'+background];
    assert.ok(fg&&bg,foreground+' / '+background+' palette exists');
    assert.ok(contrast(fg,bg)>=4.5,
      foreground+' on '+background+' contrast '+contrast(fg,bg).toFixed(2)+' below 4.5');
  }
});
