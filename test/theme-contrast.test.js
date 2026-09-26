'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'packages/shared/browser/theme.css'),'utf8');

function channel(value){
  const c=value/255;
  return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
}
function luminance(hex){
  const clean=hex.replace('#','');
  const [r,g,b]=[0,2,4].map(offset=>channel(parseInt(clean.slice(offset,offset+2),16)));
  return 0.2126*r+0.7152*g+0.0722*b;
}
function contrast(a,b){
  const l1=luminance(a),l2=luminance(b);
  return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
}
function token(name){
  const match=css.match(new RegExp('--'+name+':(#[0-9a-fA-F]{6})'));
  assert.ok(match,'missing color token '+name);
  return match[1].toLowerCase();
}
function atLeast(label,a,b,min){
  const ratio=contrast(a,b);
  assert.ok(ratio>=min,`${label}: ${ratio.toFixed(2)}:1 is below ${min}:1 (${a} on ${b})`);
}

test('Day theme meets Primer/WCAG AA text and control contrast',()=>{
  const canvas=token('lt-light-canvas');
  const surface=token('lt-light-surface');
  const soft=token('lt-light-surface-soft');
  const text=token('lt-light-text');
  const heading=token('lt-light-heading');
  const muted=token('lt-light-muted');
  const control=token('lt-light-control-border');
  const focus=token('lt-light-focus');

  atLeast('Day normal text on surface',text,surface,4.5);
  atLeast('Day normal text on canvas',text,canvas,4.5);
  atLeast('Day muted text on soft surface',muted,soft,4.5);
  atLeast('Day headings on surface',heading,surface,4.5);
  atLeast('Day input boundary on surface',control,surface,3);
  atLeast('Day input boundary on canvas',control,canvas,3);
  atLeast('Day focus indicator on surface',focus,surface,3);
});

test('Night theme meets Primer/WCAG AA text and control contrast',()=>{
  const canvas=token('lt-dark-canvas');
  const surface=token('lt-dark-surface');
  const soft=token('lt-dark-surface-soft');
  const text=token('lt-dark-text');
  const heading=token('lt-dark-heading');
  const muted=token('lt-dark-muted');
  const control=token('lt-dark-control-border');
  const focus=token('lt-dark-focus');

  atLeast('Night normal text on surface',text,surface,4.5);
  atLeast('Night normal text on canvas',text,canvas,4.5);
  atLeast('Night muted text on soft surface',muted,soft,4.5);
  atLeast('Night headings on surface',heading,surface,4.5);
  atLeast('Night input boundary on surface',control,surface,3);
  atLeast('Night input boundary on input background',control,'#262c34',3);
  atLeast('Night focus indicator on soft surface',focus,soft,3);
});

test('theme supports focus, increased contrast and forced colors without relying on theme color alone',()=>{
  assert.match(css,/:focus-visible\{/);
  assert.match(css,/@media\(prefers-contrast:more\)/);
  assert.match(css,/@media\(forced-colors:active\)/);
  assert.match(css,/forced-color-adjust:auto/);
  assert.match(css,/accent-color:/);
});
