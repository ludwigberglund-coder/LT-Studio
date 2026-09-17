'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Nav=require('../apps/portal/portal-nav.js');
const access=require('../config/access-control.json');

test('privat navigation visar bara verktyg som rollen har behörighet till',()=>{
  const accountant=Nav.visibleGroups(access,['accountant']);
  const ids=accountant.flatMap(group=>group.items.map(item=>item[0]));
  assert.ok(ids.includes('receivables'));
  assert.ok(ids.includes('accounting'));
  assert.ok(ids.includes('reports'));
  assert.equal(ids.includes('website'),false);
  assert.equal(ids.includes('access'),false);
  assert.equal(ids.includes('legacy'),false);
  assert.equal(ids.includes('res-tools'),false);
});

test('systemadministratör får administration men inte kundreskontra',()=>{
  const admin=Nav.visibleGroups(access,['system-admin']);
  const ids=admin.flatMap(group=>group.items.map(item=>item[0]));
  assert.ok(ids.includes('website'));
  assert.ok(ids.includes('access'));
  assert.ok(ids.includes('reports'));
  assert.equal(ids.includes('receivables'),false);
});

test('demo behåller referensverktygen',()=>{
  const ids=Nav.visibleGroups(access,[],{demo:true}).flatMap(group=>group.items.map(item=>item[0]));
  assert.ok(ids.includes('legacy'));
  assert.ok(ids.includes('res-tools'));
});
