'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Nav=require('../apps/portal/portal-nav.js');
test('alla inloggade företagsmedlemmar ser samma privata verktyg',()=>{
  const ids=Nav.visibleGroups({authenticated:true}).flatMap(g=>g.items.map(i=>i[0]));
  for(const id of ['receivables','accounting','reports','website','payables','documents'])assert.ok(ids.includes(id));
  for(const id of ['access','legacy','res-tools'])assert.equal(ids.includes(id),false);
  assert.deepEqual(Nav.visibleGroups(),[]);
});
test('demo är uttryckligt avskild från privat navigation',()=>{
  const ids=Nav.visibleGroups({demo:true}).flatMap(g=>g.items.map(i=>i[0]));
  assert.ok(ids.includes('legacy'));
});
