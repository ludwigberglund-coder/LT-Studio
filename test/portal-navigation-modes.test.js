'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Nav=require('../apps/portal/portal-nav.js');
const policy=require('../config/access-control.json');

const rolePermissions=role=>policy.roles.find(entry=>entry.id===role).permissions;
const flatten=groups=>groups.flatMap(group=>group.items);
const toIdMap=groups=>new Map(flatten(groups).map(([id,label,route])=>[id,{label,route}]));

test('en gemensam meny visar kundens uppgifter i begripliga grupper',()=>{
  const available=Nav.visibleGroups({authenticated:true,permissions:rolePermissions('admin')});
  const menu=Nav.unifiedGroups(available);
  assert.deepEqual(menu.map(group=>group.label),[
    'Start & AI','Fakturor & kunder','Inköp & underlag','Bank & betalningar',
    'Bokföring & AI','Rapporter & bokslut','Företaget'
  ]);
  for(const [id,label] of [
    ['documents','Kvitton & underlag (PDF)'],
    ['unplaced-payments','Betalningar att hantera'],
    ['automation','Förslag att granska'],
    ['ai-bookkeeping','AI-bokföring'],
    ['batches','Godkänn bokföring'],
    ['accounts','Kontoplan & intäktskonton'],
    ['trial-balance','Saldobalans'],
    ['inventory','Lager & svinn'],
    ['payroll','Lön & lönejournal']
  ]){
    assert.ok(flatten(menu).some(item=>item[0]===id&&item[1]===label),id+': missing or unclear');
  }
});

test('alla tidigare funktioner finns kvar med samma behörigheter, rutter och unika länkar',()=>{
  for(const role of ['admin','accountant','approver','readonly']){
    const authorized=Nav.visibleGroups({authenticated:true,permissions:rolePermissions(role)});
    const menu=Nav.unifiedGroups(authorized);
    const original=toIdMap(authorized);
    const actual=toIdMap(menu);
    assert.deepEqual([...actual.keys()].sort(),[...original.keys()].sort(),role+': lost or unexpected functions');
    assert.equal(flatten(menu).length,original.size,role+': duplicate navigation items');
    for(const [id,{route}] of actual){
      assert.equal(route,original.get(id).route,role+': changed route for '+id);
      assert.ok(menu.some(group=>group.items.some(item=>item[0]===id)),id);
    }
    assert.equal(actual.has('legacy'),false,role+': demo-only entry leaked');
    if(role!=='admin')assert.equal(actual.has('company-settings'),false,role);
  }
  assert.deepEqual(Nav.unifiedGroups(Nav.visibleGroups()),[]);
  assert.deepEqual(Nav.unifiedGroups([]),[]);
  assert.deepEqual(Nav.unifiedGroups(null),[]);
});

test('nya verktyg kan inte försvinna ur menyn när de ännu inte har placerats i en grupp',()=>{
  const future=[{id:'new-group',label:'Framtida',items:[['future-tool','Framtida funktion','portal/future-tool.html']]}];
  assert.deepEqual(Nav.unifiedGroups(future),[
    {id:'other',label:'Fler funktioner',items:[['future-tool','Framtida funktion','portal/future-tool.html']]}
  ]);
});

test('demo och äldre funktioner finns fortfarande tillgängliga men hålls åtskilda',()=>{
  const demo=Nav.visibleGroups({demo:true});
  const menu=Nav.unifiedGroups(demo);
  assert.deepEqual([...toIdMap(menu).keys()].sort(),[...toIdMap(demo).keys()].sort());
  const archive=menu.find(group=>group.id==='demo');
  assert.ok(archive);
  for(const id of ['legacy','journal','res-tools','inbox','uat','settings']){
    assert.ok(archive.items.some(item=>item[0]===id),id);
  }
});

test('menysökningen hanterar svenska bokstäver och behåller ursprungliga ord som sökbara alias',()=>{
  assert.equal(Nav.normalizeNavigationSearch('  ÖRESkalkylator  '),'oreskalkylator');
  assert.equal(Nav.normalizeNavigationSearch('Fakturor & Kvitton'),'fakturor & kvitton');
  assert.equal(Nav.normalizeNavigationSearch(null),'');
  const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','portal-nav.js'),'utf8');
  assert.match(source,/a\.dataset\.navSearch=normalizeNavigationSearch\(label\+' '\+\(originalLabels\.get\(id\)/);
  assert.match(source,/searchInput\.addEventListener\('input',filterNavigation\)/);
  assert.match(source,/searchEmpty\.hidden=!term\|\|found>0/);
  assert.match(source,/link\.hidden=!match/);
  assert.match(source,/input:not\(\[disabled\]\)/);
});

test('lägesväxeln är borttagen och nya menygrupper är hopfällbara utan förlorade djuplänkar',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','portal-nav.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'..','apps','portal','shared-nav.css'),'utf8');
  for(const obsolete of ['shared-nav-mode-switch','getSavedNavigationMode','saveNavigationMode','navigationModeKey','advancedRoute','simpleGroups(']){
    assert.equal(source.includes(obsolete),false,obsolete+' remains in JS');
  }
  assert.equal(css.includes('shared-nav-mode-button'),false);
  assert.match(source,/unifiedGroups\(authorizedGroups\)/);
  assert.match(source,/nav\.setAttribute\('aria-label','Alla tillgängliga funktioner'\)/);
  assert.match(source,/details\.open=group\.items\.some\(item=>active\(item\[2\]\)\)/);
  assert.match(source,/const storageId='unified:'\+group\.id/);
  assert.match(source,/summary\.addEventListener\('click'/);
  assert.doesNotMatch(source,/details\.addEventListener\('toggle'/);
  assert.match(css,/\.shared-navigation \.shared-links a\[hidden\]/);
  assert.match(css,/\.shared-nav-search input:focus-visible/);
  assert.match(css,/min-height:44px/);
});
