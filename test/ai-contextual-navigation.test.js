'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const portal=path.join(__dirname,'..','apps','portal');
const nav=require(path.join(portal,'portal-nav.js'));
const guide=require(path.join(portal,'ai-process-guides.js'));
const source=fs.readFileSync(path.join(portal,'portal-nav.js'),'utf8');
const css=fs.readFileSync(path.join(portal,'design-system.css'),'utf8');
const policy=require('../config/access-control.json');

const workflowPages=[
  'invoices.html','payables.html','supplier-ledger.html','documents.html',
  'bank.html','unplaced-payments.html','payments.html','accounting.html',
  'automation.html','batches.html','bokslut.html','payroll.html','inventory.html'
];

test('AI stays available in one unified role-filtered navigation',()=>{
  const aiGroup=nav.groups.find(group=>group.id==='ai');
  assert.ok(aiGroup);
  assert.deepEqual(aiGroup.items.map(item=>item[0]),['ai-assistant']);
  assert.match(source,/'ai-assistant':'reports\.view'/);
  for(const role of ['admin','accountant','approver','readonly']){
    const permissions=policy.roles.find(item=>item.id===role).permissions;
    const allowed=nav.visibleGroups({authenticated:true,permissions});
    const originals=allowed.flatMap(group=>group.items);
    const links=nav.unifiedGroups(allowed).flatMap(group=>group.items);
    assert.ok(originals.some(item=>item[0]==='ai-assistant'),role);
    assert.ok(links.some(item=>item[0]==='ai-assistant'),role);
    assert.deepEqual(links.map(item=>item[0]).sort(),originals.map(item=>item[0]).sort(),role);
    if(permissions.includes('accounting.view'))
      assert.ok(links.some(item=>item[0]==='ai-bookkeeping'),role+' should retain AI bookkeeping');
  }
  assert.deepEqual(nav.visibleGroups(),[]);
});

test('each bookkeeping-source surface offers safe and contextual AI guidance',()=>{
  for(const route of workflowPages){
    assert.ok(fs.existsSync(path.join(portal,route)),route);
    assert.ok(source.includes("'"+route+"':["),route+' is missing its contextual entry point');
    assert.notEqual(guide.contextForPage(route),'all',route+' lacks guide context');
  }
  assert.match(source,/assistantHrefForCurrentPage/);
  assert.match(source,/url\.searchParams\.set\('from',page\)/);
  assert.match(source,/\^\[a-z-\]\{1,60\}\\\.html/);
});

test('AI guidance survives page rerenders, including alternative accounting layouts',()=>{
  assert.match(source,/\.content, \.accounting-content, \.bokslut-shell, \.batch-shell/);
  assert.match(source,/if\(lastNavigationContext\)\{\s*mountContextualAi\(lastNavigationContext\);\s*mountCombinedWorkspace\(lastNavigationContext\);/);
  assert.match(source,/document\.getElementById\('lt-contextual-ai'\)/);
  assert.match(source,/section\.className='lt-contextual-ai'/);
  assert.match(source,/content\.prepend\(section\)/);
  assert.match(css,/\.lt-contextual-ai/);
  assert.match(css,/\.lt-contextual-ai-action:focus-visible/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(css,/html\[data-lt-theme="dark"\].*ai-assistant/s);
});

test('contextual help is read-only and cannot send customer data or post bookings',()=>{
  const start=source.indexOf('function mountContextualAi(context)');
  const end=source.indexOf('let lastNavigationContext=null;',start);
  assert.ok(start>0&&end>start);
  const widget=source.slice(start,end);
  assert.doesNotMatch(widget,/\bfetch\s*\(|\.functions\.invoke\s*\(|\.rpc\s*\(/);
  assert.doesNotMatch(widget,/service_role|CLOUDFLARE_AI_TOKEN|journal_entries/);
  assert.match(widget,/AI-analys av verkliga underlag är ännu inte aktiverad/);
  assert.match(widget,/Ingenting bokförs utan granskning/);
});
