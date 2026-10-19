'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Nav=require('../apps/portal/portal-nav.js');
const policy=require('../config/access-control.json');
const permissions=role=>policy.roles.find(entry=>entry.id===role).permissions;
const flat=groups=>groups.flatMap(group=>group.items);

test('fakturering, inbetalningar och kunder är en gemensam behörig arbetsyta',()=>{
  for(const role of ['admin','accountant','approver','readonly']){
    const allowed=Nav.visibleGroups({authenticated:true,permissions:permissions(role)});
    const sales=Nav.workspaceForRoute(allowed,'/LT-Studio/portal/invoices.html');
    assert.ok(sales,role);
    assert.equal(sales.id,'sales');
    assert.equal(sales.label,'Fakturor & kunder');
    for(const target of ['/LT-Studio/portal/index.html','/LT-Studio/portal/customers.html']){
      const tab=Nav.workspaceForRoute(allowed,target);
      assert.deepEqual(tab,sales,role+': related screen should offer identical tabs');
    }
    const originals=new Map(flat(allowed).map(item=>[item[0],item[2]]));
    assert.deepEqual(sales.items.map(([id,label,route])=>[id,route]),
      ['invoices','receivables','customers'].map(id=>[id,originals.get(id)]));
  }
});

test('inköp, PDF-underlag, att betala och leverantörer delar en arbetsyta',()=>{
  for(const role of ['admin','accountant','approver','readonly']){
    const allowed=Nav.visibleGroups({authenticated:true,permissions:permissions(role)});
    const original=new Map(flat(allowed).map(item=>[item[0],item[2]]));
    const purchases=Nav.workspaceForRoute(allowed,'/LT-Studio/portal/payables.html');
    assert.ok(purchases,role);
    assert.equal(purchases.id,'purchases');
    for(const item of purchases.items){
      assert.equal(item[2],original.get(item[0]),role+': workspace link changed route');
      assert.deepEqual(Nav.workspaceForRoute(allowed,'/LT-Studio/'+item[2]),purchases);
    }
    assert.deepEqual(purchases.items.map(item=>item[0]),
      ['documents','payables','supplier-ledger','suppliers'].filter(id=>original.has(id)));
  }
});

test('en inloggad användare får inga extra funktioner via arbetsyteflikar',()=>{
  assert.equal(Nav.workspaceForRoute([], '/LT-Studio/portal/invoices.html'),null);
  assert.equal(Nav.workspaceForRoute(Nav.visibleGroups(),'/LT-Studio/portal/invoices.html'),null);
  const limited=Nav.visibleGroups({authenticated:true,permissions:['customer-invoice.view']});
  const sales=Nav.workspaceForRoute(limited,'/LT-Studio/portal/invoices.html');
  assert.deepEqual(sales.items.map(item=>item[0]),['invoices','receivables','customers']);
  assert.equal(Nav.workspaceForRoute(limited,'/LT-Studio/portal/payables.html'),null);
  assert.equal(Nav.workspaceForRoute(limited,'/legacy/portal/payables.htm'),null);
  assert.equal(Nav.workspaceForRoute(limited,'/LT-Studio/portal/ai-assistant.html'),null);
});

test('tekniska underflikar finns kvar via tillåtna länkar, direktlänkar och menysökning',()=>{
  assert.deepEqual([...Nav.integratedSubpages].sort(),['receivables','supplier-ledger']);
  for(const role of ['admin','accountant','approver','readonly']){
    const original=flat(Nav.visibleGroups({authenticated:true,permissions:permissions(role)}));
    const projected=flat(Nav.unifiedGroups(Nav.visibleGroups({authenticated:true,permissions:permissions(role)})));
    assert.deepEqual(new Set(projected.map(item=>item[0])),new Set(original.map(item=>item[0])));
  }
  const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','portal-nav.js'),'utf8');
  const styles=fs.readFileSync(path.join(__dirname,'..','apps','portal','shared-nav.css'),'utf8');
  assert.match(source,/if\(integratedSubpages\.has\(id\)\)/);
  assert.match(source,/a\.dataset\.navSearch=normalizeNavigationSearch\(label/);
  assert.match(source,/main\.prepend\(section\)/);
  assert.match(source,/mountCombinedWorkspace\(lastNavigationContext\)/);
  assert.match(source,/tabs\.setAttribute\('aria-label'/);
  assert.match(source,/link\.setAttribute\('aria-current','page'\)/);
  assert.match(styles,/\.lt-workspace-switcher-links>a:focus-visible/);
  assert.match(styles,/html\[data-lt-theme="dark"\] \.lt-workspace-switcher/);
  assert.match(styles,/min-height:44px/);
  assert.match(styles,/\.lt-workspace-switcher\{[^}]*border-radius:8px/s);
  assert.match(styles,/\.lt-workspace-switcher-links>a\{[^}]*border-radius:8px/s);
  assert.match(styles,/\.lt-workspace-switcher-heading>span\{[^}]*letter-spacing:0[;}]/s);
  assert.match(styles,/\.lt-workspace-switcher-heading>strong\{[^}]*letter-spacing:0[;}]/s);
});
