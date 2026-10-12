'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'apps/portal/bokslut.html'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/portal/bokslut.css'),'utf8');
const nav=require('../apps/portal/portal-nav.js');
const linked=['bank','invoices','payables','accounting','reports','documents'];

test('bokslutet har sex länkade områden och aldrig falskt klara statusar',()=>{
  for(const page of linked)assert.match(html,new RegExp('href="\\./'+page+'\\.html"'),page+' måste ha verklig ingång');
  assert.equal((html.match(/Status: Inte verifierad/g)||[]).length,6);
  assert.match(html,/Bokslut inte verifierat/);
  assert.match(html,/fullständig serverbaserad årsavstämning/);
  assert.doesNotMatch(html,/(?:Allt avstämt|Bokslut klart|Deklaration inlämnad)/);
});

test('bokslut syns bara med rapportbehörighet i normal navigation',()=>{
  const none=nav.visibleGroups({authenticated:false,permissions:['reports.view']});
  assert.equal(none.length,0);
  const noReport=nav.visibleGroups({authenticated:true,permissions:['accounting.view']});
  assert.equal(noReport.flatMap(group=>group.items).some(item=>item[0]==='bokslut'),false);
  const permitted=nav.visibleGroups({authenticated:true,permissions:['reports.view']});
  assert.ok(permitted.flatMap(group=>group.items).some(item=>item[0]==='bokslut'&&item[2]==='portal/bokslut.html'));
});

test('session krävs för verkliga företag; demo länkar behåller explicit demoläge',()=>{
  assert.match(html,/context\.authenticated!==true\|\|!context\.company/);
  assert.match(html,/location\.replace\('\.\/index\.html'\)/);
  assert.match(html,/new URLSearchParams\(location\.search\)\.get\('demo'\)==='1'/);
  assert.match(html,/querySelectorAll\('\.bokslut-card a'\)/);
  assert.match(html,/\+'demo=1'/);
  assert.doesNotMatch(html,/\.from\(|\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
  // The HTML is a checked-in fixture. Check the expected markers without
  // attempting to parse or sanitize HTML using a regular expression.
  assert.equal(html.split('<script>').length-1,1);
  assert.match(html,/LTSupabaseUat\.context\(\)/);
  assert.match(html,/getElementById\('lt-bokslut-app'\)/);
});

test('mobil, tangentbord och mörkt läge är tydligt stödda',()=>{
  assert.match(html,/<meta name="theme-color" content="#f7f5f0">/);
  assert.match(html,/href="\.\/bokslut\.css"/);
  assert.ok(html.indexOf('bokslut.css')<html.indexOf('design-system.css'));
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/grid-template-columns:1fr/);
  assert.match(css,/min-height:48px/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/html\[data-lt-theme="dark"\]/);
  assert.match(css,/prefers-reduced-motion/);
});
