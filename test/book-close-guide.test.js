const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const portal = path.join(__dirname, '../apps/portal');
const html = fs.readFileSync(path.join(portal, 'bokslut.html'), 'utf8');
const js = fs.readFileSync(path.join(portal, 'book-close-simple.js'), 'utf8');

test('bokslut leads with one-click automatic preflight, not a manual accounting checklist', () => {
  assert.match(html, /Låt systemet börja med bokslutet/);
  assert.match(html, /id="book-close-start"/);
  assert.match(html, /id="book-close-simple-year"/);
  assert.match(html, /Bokslut inte verifierat/);
  assert.match(html, /AI-genererade bokslutsförslag och automatiska bokslutsbokningar är ännu inte aktiverade/);
  assert.doesNotMatch(html, /book-close-guide\.js|data-book-close-area=|book-close-guide-reset/);
  assert.ok(html.indexOf('id="book-close-start"') < html.indexOf('year-close-form'), 'simple action must precede technical controls');
  assert.equal((html.match(/<details\b/g) || []).length, (html.match(/<\/details>/g) || []).length);
  assert.match(html, /id="book-close-simple-status" role="status" aria-live="polite"/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|\.insert\(|\.update\(|\.upsert\(|ai-bookkeeping-suggest|service_role/);
  for (const method of ['LTYearCloseCounts.scan', 'LTBookCloseLedger.inspect', 'LTBookCloseEvidence.inspect', 'LTBookCloseCutoff.inspect'])
    assert.ok(js.includes(method), method);
  assert.match(js, /Promise\.allSettled/);
  assert.match(js, /fresh\.company\?\.id!==companyId/);
});

function harness(overrides = {}) {
  function element() {
    return {
      listeners: {},
      children: [],
      textContent: '',
      value: '',
      disabled: false,
      addEventListener(type, callback) { this.listeners[type] = callback; },
      append(child) { this.children.push(child); },
      replaceChildren() { this.children.length = 0; }
    };
  }
  const refs = Object.fromEntries([
    'book-close-start',
    'book-close-simple-status',
    'book-close-simple-actions',
    'book-close-simple-year',
    'year-close-year'
  ].map(id => [id, element()]));
  refs['year-close-year'].value = '2026';
  const calls = [];
  const session = {authenticated: true, company: {id: 'company-A'}, accessToken: 'sample-access-token'};
  let contexts = 0;
  const context = overrides.context || (async () => { contexts++; return session; });
  const counts = overrides.counts || (async args => {
    calls.push({type: 'counts', ...args});
    return {reliable: true, counts: {journal: {status:'counted',count:12}, openBatches: {status:'counted'}, unplacedBank: {status:'attention'}}};
  });
  const ledger = overrides.ledger || (async args => {calls.push({type:'ledger', ...args}); return {detected:false};});
  const evidence = overrides.evidence || (async args => {
    calls.push({type:'evidence', ...args});
    return {areas:{bank:{needsReview:false},customer:{needsReview:true},supplier:{needsReview:false}}};
  });
  const cutoff = overrides.cutoff || (async args => {calls.push({type:'cutoff', ...args}); return {hasWarnings:false};});
  const sandbox = {
    document: {
      getElementById(id) {return refs[id] || null;},
      createElement() {return element();}
    },
    location: {search: overrides.search || ''},
    LTSupabaseUat: {context},
    LTSupabase: {stub:true},
    LTYearCloseCounts: {scan:counts},
    LTBookCloseLedger: {inspect:ledger},
    LTBookCloseEvidence: {inspect:evidence},
    LTBookCloseCutoff: {inspect:cutoff},
    URLSearchParams
  };
  vm.runInNewContext(js, sandbox, {filename:'book-close-simple.js'});
  return {refs, calls, contexts:()=>contexts,
    click:()=>refs['book-close-start'].listeners.click(),
    year:newYear=>{refs['book-close-simple-year'].value=newYear;refs['book-close-simple-year'].listeners.input();},
    texts:()=>refs['book-close-simple-actions'].children.map(node=>node.children[0]?.textContent||'')
  };
}

test('one click checks existing data and shows safe Swedish actions with relevant links', async () => {
  const h = harness();
  await h.click();
  assert.equal(h.calls.length, 4);
  assert.ok(h.calls.every(entry=>entry.companyId==='company-A' && entry.year==='2026'));
  assert.match(h.refs['book-close-simple-status'].textContent,/2 möjliga frågor/);
  assert.match(h.refs['book-close-simple-status'].textContent,/Bokslutet är inte verifierat/);
  assert.ok(h.texts().some(x=>x.includes('betalningar')));
  assert.ok(h.texts().some(x=>x.includes('kundfakturor')));
  assert.ok(h.refs['book-close-simple-actions'].children.some(li=>li.children[1]?.href==='./bank.html'));
  assert.ok(h.refs['book-close-simple-actions'].children.some(li=>li.children[1]?.href==='./invoices.html'));
  assert.equal(h.refs['book-close-start'].disabled,false);
  assert.ok(h.contexts()>=2);
});

test('failed source remains unknown, never an approved reconciliation', async () => {
  const h = harness({
    cutoff: async () => {throw Error('UNAVAILABLE');},
    counts: async () => ({reliable:true,counts:{openBatches:{status:'counted'},unplacedBank:{status:'counted'}}}),
    evidence: async () => ({areas:{bank:{needsReview:false},customer:{needsReview:false},supplier:{needsReview:false}}})
  });
  await h.click();
  assert.match(h.refs['book-close-simple-status'].textContent,/1 kontroller utan säkert resultat/);
  assert.ok(h.texts().some(x=>x.includes('kunde inte kontrolleras')));
  assert.doesNotMatch(h.refs['book-close-simple-status'].textContent,/bokslut (klart|godkänt)/i);
});

test('a changed company session cannot display results from another company', async () => {
  let turn=0;
  const h = harness({context:async () => {
    turn++;
    return {authenticated:true,company:{id: turn===1?'company-A':'company-B'},accessToken:'sample'};
  }});
  await h.click();
  assert.match(h.refs['book-close-simple-status'].textContent,/kunde inte slutföras/);
  assert.ok(h.texts().every(x=>!x.includes('kundfakturor')&&!x.includes('betalningar')));
});

test('changing the selected year invalidates old results and syncs the advanced selector', async () => {
  const h = harness();
  h.year('2025');
  assert.equal(h.refs['year-close-year'].value,'2025');
  assert.match(h.refs['book-close-simple-status'].textContent,/Starta förkontrollen igen/);
  await h.click();
  assert.ok(h.calls.every(x=>x.year==='2025'));
});

test('demo does not call the secure server or pretend checks ran', () => {
  const h = harness({search:'?demo=1'});
  assert.equal(h.refs['book-close-start'].disabled,true);
  assert.equal(h.refs['book-close-start'].listeners.click,undefined);
  assert.match(h.refs['book-close-simple-status'].textContent,/Logga in i ett testföretag/);
});

test('an empty year triggers a real review task instead of a reassuring all-clear', async () => {
  const h=harness({
    counts:async()=>({reliable:true,counts:{
      journal:{status:'counted',count:0},
      openBatches:{status:'counted'},unplacedBank:{status:'counted'}
    }}),
    ledger:async()=>({counts:{entries:'0'},detected:false}),
    evidence:async()=>({areas:{
      bank:{needsReview:false},customer:{needsReview:false},supplier:{needsReview:false}
    }})
  });
  await h.click();
  assert.ok(h.texts().some(x=>x.includes('Inga bokföringsposter hittades')));
  assert.ok(!h.texts().some(x=>x.includes('Inga tydliga tekniska avvikelser')));
  assert.match(h.refs['book-close-simple-status'].textContent,/1 möjliga frågor/);
  assert.ok(h.texts().some(x=>x.includes('Återstår innan bokslutet')));
});

test('higher-risk ledger problems appear before simpler issues', async () => {
  const h=harness({ledger:async()=>({detected:true,counts:{entries:'12'}})});
  await h.click();
  assert.match(h.texts()[0],/Behöver din hjälp: Vi hittade skillnader i bokföringen/);
  assert.ok(h.texts().findIndex(x=>x.includes('skillnader')) <
    h.texts().findIndex(x=>x.includes('betalningar')));
  assert.ok(h.refs['book-close-simple-actions'].children.some(li=>
    li.className==='book-close-task book-close-task--next'));
});

test('partial failure is labeled unknown and comes before optional next steps',async()=>{
  const h=harness({
    cutoff:async()=>{throw Error('OFFLINE');},
    ledger:async()=>({counts:{entries:'12'},detected:false}),
    counts:async()=>({reliable:true,counts:{journal:{status:'counted',count:12},openBatches:{status:'counted'},unplacedBank:{status:'counted'}}}),
    evidence:async()=>({areas:{bank:{needsReview:false},customer:{needsReview:false},supplier:{needsReview:false}}})
  });
  await h.click();
  assert.match(h.texts()[0],/Kunde inte kontrolleras/);
  assert.ok(h.texts().some(x=>x.includes('Historiska kontorörelser')));
  assert.match(h.refs['book-close-simple-status'].textContent,/1 kontroller utan säkert resultat/);
  assert.match(h.texts().at(-1),/Nästa steg/);
});

test('all available checks without exceptions still require external reconciliation',async()=>{
  const h=harness({
    counts:async()=>({reliable:true,counts:{journal:{status:'counted',count:4},openBatches:{status:'counted'},unplacedBank:{status:'counted'}}}),
    ledger:async()=>({counts:{entries:'4'},detected:false}),
    evidence:async()=>({areas:{bank:{needsReview:false},customer:{needsReview:false},supplier:{needsReview:false}}})
  });
  await h.click();
  assert.match(h.refs['book-close-simple-status'].textContent,/0 möjliga frågor att hantera, 0 kontroller utan säkert resultat/);
  assert.ok(h.texts().some(x=>x.includes('Återstår innan bokslutet')));
  assert.ok(h.texts().some(x=>x.includes('Inga tydliga tekniska avvikelser')));
});

test('responses for an old year cannot overwrite the new year prompt',async()=>{
  let release;
  const waiting=new Promise(resolve=>{release=resolve;});
  const h=harness({counts:async()=>waiting});
  const pending=h.click();
  h.year('2025');
  release({reliable:true,counts:{journal:{status:'counted',count:16},openBatches:{status:'counted'},unplacedBank:{status:'counted'}}});
  await pending;
  assert.match(h.refs['book-close-simple-status'].textContent,/Året har ändrats/);
  assert.equal(h.refs['book-close-simple-actions'].children.length,0);
});

test('priority labels remain accessible and navigation targets stay fixed',()=>{
  assert.match(html,/Nästa steg och sådant som kan behöva din hjälp/);
  assert.match(js,/Behöver din hjälp:/);
  assert.match(js,/Kunde inte kontrolleras:/);
  assert.match(js,/textContent=item.description/);
  assert.match(js,/allowedLinks\.has\(item.href\)/);
  assert.doesNotMatch(js,/\.innerHTML\s*=|new URL\(.*href/);
});
