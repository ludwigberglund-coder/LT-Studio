'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Nav=require('../apps/portal/portal-nav.js');
const policy=require('../config/access-control.json');

const rolePermissions=role=>policy.roles.find(entry=>entry.id===role).permissions;
const flatten=groups=>groups.flatMap(group=>group.items);

test('enkelt läge grupperar vardagsuppgifter utan tekniska undermenyer',()=>{
  const authorized=Nav.visibleGroups({authenticated:true,permissions:rolePermissions('admin')});
  const simple=Nav.simpleGroups(authorized);
  assert.deepEqual(simple.map(group=>group.label),[
    'Start','Fakturor & kunder','Inköp & kvitton',
    'Bank & betalningar','Bokföring & resultat','Inställningar'
  ]);
  assert.ok(simple.every(group=>group.items.length<=5));
  assert.ok(flatten(simple).some(([id,label])=>id==='documents'&&label==='Lämna underlag'));
  assert.ok(flatten(simple).some(([id,label])=>id==='ai-assistant'&&label==='Fråga AI-bokföraren'));
  assert.equal(flatten(simple).some(([id])=>id==='suppliers'),false);
  assert.ok(flatten(simple).some(([id,label])=>id==='unplaced-payments'&&label==='Betalningar att hantera'));
  assert.ok(flatten(simple).some(([id,label])=>id==='batches'&&label==='Godkänn bokföring'));
  assert.ok(flatten(simple).some(([id,label])=>id==='automation'&&label==='Förslag att granska'));
  assert.equal(flatten(simple).some(([id])=>id==='accounts'),false);
});

test('enkel navigation använder bara redan tillåtna roller och ursprungliga rutter',()=>{
  for(const role of ['admin','accountant','approver','readonly']){
    const advanced=Nav.visibleGroups({authenticated:true,permissions:rolePermissions(role)});
    const simple=Nav.simpleGroups(advanced);
    const byId=new Map(flatten(advanced).map(([id,label,route])=>[id,route]));
    const seen=new Set();
    for(const [id,label,route] of flatten(simple)){
      assert.ok(byId.has(id),role+': unexpected permission for '+id);
      assert.equal(route,byId.get(id),role+': route must remain unchanged for '+id);
      assert.ok(!seen.has(id),role+': duplicate '+id);
      assert.ok(label.length>0);
      seen.add(id);
    }
    if(role!=='admin')assert.equal(seen.has('company-settings'),false);
    if(role==='readonly'){
      assert.equal(seen.has('payroll'),false);
      assert.equal(seen.has('accounts'),false);
    }
    assert.ok(byId.has('accounts'),role+': original advanced access is not removed');
  }
  assert.deepEqual(Nav.simpleGroups(Nav.visibleGroups()),[]);
  assert.deepEqual(Nav.simpleGroups([]),[]);
});

test('demo och avancerat läge behåller ursprungliga menylänkar',()=>{
  const demo=Nav.visibleGroups({demo:true});
  const ids=flatten(demo).map(item=>item[0]);
  assert.ok(ids.includes('legacy'));
  assert.ok(ids.includes('journal'));
  assert.ok(ids.includes('accounts'));
});

test('lägesväxeln sparas separat per användare och företag och är bara presentation',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','portal-nav.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'..','apps','portal','shared-nav.css'),'utf8');
  assert.match(source,/function navigationModeKey\(session\)/);
  assert.match(source,/session\?\.company\?\.id/);
  assert.match(source,/session\?\.user\?\.id/);
  assert.match(source,/getSavedNavigationMode/);
  assert.match(source,/saveNavigationMode/);
  assert.match(source,/shared-nav-mode-switch/);
  assert.match(source,/aria-pressed/);
  assert.match(source,/advancedRoute/);
  assert.match(source,/mode==='simple'&&advancedRoute/);
  assert.match(source,/simpleGroups\(authorizedGroups\)/);
  // New users must be able to click existing customer links without first expanding categories.
  assert.match(source,/saved\[storageId\]!==false/);
  assert.match(css,/shared-nav-mode-button:focus-visible/);
  assert.match(css,/min-height:44px/);
});
