'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Nav=require('../apps/portal/portal-nav.js');
const config=require('../config/access-control.json');

function permissions(roleId){
  return config.roles.find(role=>role.id===roleId).permissions;
}
function ids(roleId){
  return Nav.visibleGroups({authenticated:true,permissions:permissions(roleId)}).flatMap(group=>group.items.map(item=>item[0]));
}

test('navigationen följer serverns rollbehörigheter',()=>{
  const admin=ids('admin');
  for(const id of ['receivables','accounting','reports','website','payables','documents','payroll','access'])assert.ok(admin.includes(id),id);

  const accountant=ids('accountant');
  for(const id of ['receivables','accounting','reports','payables','documents','payroll'])assert.ok(accountant.includes(id),id);
  assert.equal(accountant.includes('website'),false);
  assert.equal(accountant.includes('access'),false);

  const approver=ids('approver');
  for(const id of ['receivables','accounting','reports','payables','documents'])assert.ok(approver.includes(id),id);
  assert.equal(approver.includes('payroll'),false);
  assert.equal(approver.includes('website'),false);
  assert.equal(approver.includes('access'),false);

  const readonly=ids('readonly');
  for(const id of ['receivables','accounting','reports','payables','documents'])assert.ok(readonly.includes(id),id);
  assert.equal(readonly.includes('payroll'),false);
  assert.equal(readonly.includes('website'),false);
  assert.equal(readonly.includes('access'),false);

  assert.deepEqual(Nav.visibleGroups(),[]);
});

test('demo är uttryckligt avskild från privat navigation',()=>{
  const demo=Nav.visibleGroups({demo:true}).flatMap(group=>group.items.map(item=>item[0]));
  assert.ok(demo.includes('legacy'));
});
