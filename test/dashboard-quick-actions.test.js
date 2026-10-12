'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Nav=require('../apps/portal/portal-nav.js');
const access=require('../config/access-control.json');

const role=key=>access.roles.find(entry=>entry.id===key).permissions;
const groups=permissions=>Nav.visibleGroups({authenticated:true,permissions});
const linkIds=links=>links.map(link=>link.id);

test('quick actions never add a destination that the navigation role cannot access',()=>{
  for(const name of ['admin','accountant','approver','readonly']){
    const authorized=groups(role(name));
    const allowed=new Map(authorized.flatMap(group=>group.items.map(([id,,url])=>[id,url])));
    const links=Nav.quickActionLinks(authorized);
    assert.equal(new Set(linkIds(links)).size,links.length,name);
    assert.ok(links.length>0,name);
    for(const link of links){
      assert.ok(allowed.has(link.id),name+': unexpected action '+link.id);
      assert.equal(link.href,'./'+allowed.get(link.id).slice('portal/'.length));
      assert.match(link.href,/^\.\/[a-z-]+\.html$/);
      assert.ok(link.label.length>0&&link.description.length>0);
    }
  }
  assert.deepEqual(Nav.quickActionLinks(groups([])),[]);
  assert.deepEqual(Nav.quickActionLinks([]),[]);
  assert.deepEqual(Nav.quickActionLinks(),[]);
});

test('common tasks have real, permission-filtered paths and no sensitive demo/admin modules',()=>{
  const links=Nav.quickActionLinks(groups(role('admin')));
  assert.deepEqual(linkIds(links),[
    'invoices','payables','documents','unplaced-payments','accounting'
  ]);
  const list=links.map(l=>l.href);
  assert.ok(list.includes('./unplaced-payments.html'),'unplaced payments must remain visible');
  assert.equal(list.some(l=>/admin|legacy|\.\.\//.test(l)),false);
});

test('dashboard shortcuts only navigate; never mutate bookkeeping',()=>{
  const dashboard=fs.readFileSync(path.join(__dirname,'..','apps/portal/dashboard.js'),'utf8');
  const nav=fs.readFileSync(path.join(__dirname,'..','apps/portal/portal-nav.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'..','apps/portal/dashboard.css'),'utf8');
  assert.match(nav,/quickActions:async\(\)=>quickActionLinks\(\(await navigationContext\(\)\)\.groups\)/);
  assert.match(dashboard,/const \[metrics,actions\]=await Promise\.all\(\[loadMetrics\(\),getQuickActions\(\)\]\)/);
  assert.match(dashboard,/function quickActionPanel\(actions\)/);
  assert.match(dashboard,/Ingenting bokförs när du väljer en snabbväg/);
  assert.match(dashboard,/href:'\.\/unplaced-payments\.html',count:m\.bank\.reviewCount/);
  assert.match(dashboard,/function pendingTaskCount\(m\)/);
  assert.match(css,/\.quick-action-link:focus-visible/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});
