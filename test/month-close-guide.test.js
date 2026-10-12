'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','month-close-guide.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','apps','portal','month-close-guide.css'),'utf8');

function guide(){
  const context={};
  vm.runInNewContext(source,context,{filename:'month-close-guide.js'});
  assert.equal(typeof context.LTMonthCloseGuide.render,'function');
  return context.LTMonthCloseGuide;
}

test('månadschecklistan har verkliga länkar utan automatiskt godkända steg',()=>{
  const html=guide().render({period:'2026-10',periodExists:true,periodStatus:'open',visibleEntries:4,demo:true});
  assert.match(html,/Förbered 2026-10/);
  assert.match(html,/4 verifikationer för perioden visas/);
  assert.match(html,/inte ett bevis på att alla poster är med/);
  assert.match(html,/Kontrollera manuellt/);
  assert.equal((html.match(/Kontrollera manuellt/g)||[]).length,7);
  assert.match(html,/href="\.\/bank\.html\?demo=1"/);
  assert.match(html,/href="\.\/unplaced-payments\.html\?demo=1"/);
  assert.match(html,/href="\.\/documents\.html\?demo=1"/);
  assert.match(html,/href="\.\/invoices\.html\?demo=1"/);
  assert.match(html,/href="\.\/payables\.html\?demo=1"/);
  assert.match(html,/href="\.\/reports\.html\?demo=1"/);
  assert.doesNotMatch(html,/(?:Alla kontroller klara|Redo att låsa|Allt avstämt)/);
});

test('låst period påstås inte automatiskt vara avstämd',()=>{
  const html=guide().render({period:'2026-10',periodExists:true,periodStatus:'locked',visibleEntries:2,demo:false});
  assert.match(html,/Perioden är låst\. Ett lås bevisar inte/);
  assert.match(html,/status-pill locked/);
  assert.match(html,/href="\.\/bank\.html"/);
  assert.doesNotMatch(html,/href="\.\/bank\.html\?demo=1"/);
});

test('okänd period och ogiltigt visningsantal kan inte förfalska status eller html',()=>{
  const html=guide().render({period:'<img src=x>',periodExists:false,periodStatus:'locked',visibleEntries:-8});
  assert.match(html,/Okänd period/);
  assert.match(html,/Status behöver kontrolleras/);
  assert.match(html,/0 verifikationer/);
  assert.doesNotMatch(html,/<img/);
});

test('guiden fungerar i mobil mörkt läge och med tangentbord',()=>{
  assert.match(css,/html\[data-lt-theme="dark"\]/);
  assert.match(css,/@media\(max-width:780px\)/);
  assert.match(css,/:focus-visible/);
});

test('bokföringsvyn visar läsguiden för den aktuella perioden och bekräftar före låsning',()=>{
  const accounting=fs.readFileSync(path.join(__dirname,'..','apps','portal','accounting.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'..','apps','portal','accounting.html'),'utf8');
  assert.match(accounting,/function monthlyGuide\(current\)/);
  assert.match(accounting,/periodExists:periods\.some\(p=>p\.period===current\.period\)/);
  assert.match(accounting,/visibleEntries:entries\.filter/);
  assert.match(accounting,/\$\{monthlyGuide\(current\)\}/);
  assert.match(accounting,/LTStudioDialog\.confirm/);
  assert.match(accounting,/if\(!confirmed\)return/);
  assert.match(accounting,/Jag har kontrollerat – lås perioden/);
  assert.match(html,/month-close-guide\.css/);
  assert.match(html,/month-close-guide\.js/);
  assert.ok(html.indexOf('month-close-guide.js')<html.indexOf('accounting.js'),'guiden laddas före bokföringsvyn');
});

test('guiden har inga nätverksanrop eller bokföringsskrivningar',()=>{
  assert.doesNotMatch(source,/\bfetch\s*\(/);
  assert.doesNotMatch(source,/LTSupabase/);
  assert.doesNotMatch(source,/\blocalStorage\b/);
  assert.doesNotMatch(source,/\bpostEntry\b|\block_accounting_period\b/);
  const accounting=fs.readFileSync(path.join(__dirname,'..','apps','portal','accounting.js'),'utf8');
  assert.match(accounting,/lock_accounting_period/,'befintlig server-RPC finns kvar');
  assert.match(accounting,/accounting\/periods\/\$\{period\}\/lock/,'äldre privata serverflödet finns kvar');
});


test('snabbkontroll granskar bara aktuell månads inlästa verifikationer',()=>{
  const check=guide().inspectEntries([
    {number:'A12',postingDate:'2026-10-01',description:'Hyra',lines:[
      {debitOre:10000,creditOre:0},{debitOre:0,creditOre:10000}
    ]},
    {number:'A13',postingDate:'2026-09-03',description:'Gammal felpost',lines:[
      {debitOre:10000,creditOre:0},{debitOre:0,creditOre:9000}
    ]}
  ],'2026-10');
  assert.equal(check.loadedCount,1);
  assert.equal(check.findings.length,0);
});

test('snabbkontroll skiljer saknad text, otillgängliga detaljer och obalans',()=>{
  const report=guide().inspectEntries([
    {number:'A21',postingDate:'2026-10-04',description:'',lines:[
      {debitOre:600,creditOre:0},{debitOre:0,creditOre:500}
    ]},
    {number:'A22',postingDate:'2026-10-05',description:'Källa som saknar laddade rader'},
    {number:'A23',postingDate:'2026-10-06',description:'Fel beloppsvärde',lines:[
      {debitOre:'okänd',creditOre:0},{debitOre:0,creditOre:500}
    ]}
  ],'2026-10');
  assert.equal(report.loadedCount,3);
  assert.equal(report.findings.length,4);
  assert.ok(report.findings.some(x=>x.kind==='Beskrivning saknas'));
  assert.ok(report.findings.some(x=>x.kind==='Debet och kredit stämmer inte'));
  assert.ok(report.findings.some(x=>x.kind==='Kontorader kunde inte kontrolleras'));
  assert.ok(report.findings.some(x=>x.kind==='Beloppsuppgifter kunde inte kontrolleras'));
});

test('snabbkontroll undviker falska klarsignaler och skyddar verifikationsnumret',()=>{
  const sample=guide();
  const entry={number:'<script>alert(1)</script>',postingDate:'2026-10-12',description:'Prov',lines:[
    {debitOre:100,creditOre:0},{debitOre:0,creditOre:99}
  ]};
  const html=sample.render({period:'2026-10',periodExists:true,periodStatus:'open',visibleEntries:1,journalEntries:[entry]});
  assert.match(html,/1 möjlig avvikelse/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>alert/);
  assert.match(html,/href="#journal-entries"/);
  assert.match(html,/ersätter inte fullständig avstämning/);
  const clean=sample.render({period:'2026-10',periodExists:true,periodStatus:'open',visibleEntries:1,journalEntries:[{
    number:'A25',postingDate:'2026-10-10',description:'Korrekt post',lines:[
      {debitOre:100,creditOre:0},{debitOre:0,creditOre:100}
    ]
  }]});
  assert.match(clean,/Inga avvikelser hittades bland de inlästa verifikationerna/);
  assert.doesNotMatch(clean,/(?:Månaden är avstämd|Allt klart|Godkänd avstämning)/);
  const absent=sample.render({period:'2026-10',periodExists:true,visibleEntries:0});
  assert.match(absent,/Ingen automatisk kontroll har kunnat göras/);
  const empty=sample.render({period:'2026-10',journalEntries:[],visibleEntries:0});
  assert.match(empty,/Inga verifikationer finns i den inlästa listan/);
});

test('bokföringsvyn tillför enbart read-only inläst journaldata till guidens kontroller',()=>{
  const accounting=fs.readFileSync(path.join(__dirname,'..','apps','portal','accounting.js'),'utf8');
  assert.match(accounting,/journalEntries:entries\.filter/);
  assert.match(accounting,/id="journal-entries"/);
  assert.doesNotMatch(source,/\bfetch\s*\(/);
  assert.doesNotMatch(source,/LTSupabase|postEntry|accounting\.correct/);
});


test('månadsavstämningen visar serverantal endast när företag och period stämmer',()=>{
  const g=guide();
  const state={companyId:'company-a',coverage:{
    status:'checked',companyId:'company-a',period:'2026-10',
    totalEntries:12,totalLines:25,periodEntries:4,
    loadedEntries:12,loadedLines:25,loadedPeriodEntries:4,
    integrity:{duplicateEntryIds:0,duplicateLineIds:0,orphanLines:0,wrongCompanyLines:0,checkedEntries:12,checkedLines:25}
  }};
  assert.equal(g.evaluateCoverage(state,'2026-10').status,'matched');
  const html=g.render({...state,period:'2026-10',journalEntries:[]});
  assert.match(html,/Antalen stämmer med de företagsspecifika databassvaren/);
  assert.match(html,/Verifikationer för 2026-10: 4 av 4/);
  assert.match(html,/Det verifierar inte varje post, bank, moms/);
  assert.doesNotMatch(html,/Hela månaden är godkänd/);
  assert.equal(g.evaluateCoverage({...state,companyId:'company-b'},'2026-10').status,'unavailable');
  assert.equal(g.evaluateCoverage(state,'2026-09').status,'unavailable');
});

test('ofullständig inläsning visar varning även om de inlästa posterna balanserar',()=>{
  const g=guide();
  const state={
    companyId:'company-a',period:'2026-10',
    journalEntries:[{number:'A1',postingDate:'2026-10-01',description:'Syntetisk',lines:[
      {debitOre:100,creditOre:0},{debitOre:0,creditOre:100}
    ]}],
    coverage:{status:'checked',companyId:'company-a',period:'2026-10',
      totalEntries:20,totalLines:45,periodEntries:8,
      loadedEntries:10,loadedLines:18,loadedPeriodEntries:1,
      integrity:{duplicateEntryIds:0,duplicateLineIds:0,orphanLines:0,wrongCompanyLines:0,checkedEntries:10,checkedLines:18}}
  };
  const h=g.render(state);
  assert.equal(g.evaluateCoverage(state,'2026-10').status,'mismatch');
  assert.match(h,/Antalen stämmer inte/);
  assert.match(h,/Verifikationer för 2026-10: 1 av 8/);
  assert.match(h,/Kontorader för företaget: 18 av 45/);
  assert.match(h,/Inga avvikelser hittades bland de inlästa verifikationerna/);
  assert.doesNotMatch(h,/Alla uppgifter har kontrollerats/);
});

test('misslyckade, felaktiga och saknade serverantal kan inte ge en klarsignal',()=>{
  const g=guide();
  const make=coverage=>g.render({companyId:'company-a',period:'2026-10',journalEntries:[],
    coverage});
  for(const coverage of [
    null,{status:'unavailable',companyId:'company-a',period:'2026-10'},
    {status:'checked',companyId:'company-a',period:'2026-10',
      totalEntries:NaN,totalLines:0,periodEntries:0,loadedEntries:0,loadedLines:0,loadedPeriodEntries:0},
    {status:'checked',companyId:'company-a',period:'2026-10',
      totalEntries:-1,totalLines:0,periodEntries:0,loadedEntries:0,loadedLines:0,loadedPeriodEntries:0}
  ])assert.match(make(coverage),/Inläsningen behöver kontrolleras/);
});

test('bokföringsvyn använder endast företagets session och avgränsar månad vid läskontrollen',()=>{
  const accounting=fs.readFileSync(path.join(__dirname,'../apps/portal/accounting.js'),'utf8');
  assert.match(accounting,/from\('journal_entries',ctx.accessToken\)\.countExact\(filter\)/);
  assert.match(accounting,/from\('journal_lines',ctx.accessToken\)\.countExact\(filter\)/);
  assert.match(accounting,/posting_date=gte\./);
  assert.match(accounting,/posting_date=lt\./);
  assert.match(accounting,/monthCoverage=\{status:'unavailable',companyId:ctx.company.id,period\}/);
  assert.match(accounting,/companyId:session\?\.company\?\.id/);
  assert.match(accounting,/function monthBounds\(period\)/);
  const client=fs.readFileSync(path.join(__dirname,'../apps/portal/supabase-client.js'),'utf8');
  assert.match(client,/countExact:/);
  assert.match(client,/Prefer:'count=exact'/);
});


test('matchade radantal räcker inte om kontorader saknar verifikation eller återkommer',()=>{
  const g=guide();
  const base={status:'checked',companyId:'company-a',period:'2026-10',
    totalEntries:2,totalLines:4,periodEntries:2,
    loadedEntries:2,loadedLines:4,loadedPeriodEntries:2,
    integrity:{duplicateEntryIds:0,duplicateLineIds:1,orphanLines:1,wrongCompanyLines:0,
      checkedEntries:2,checkedLines:4}};
  const state={companyId:'company-a',period:'2026-10',coverage:base,journalEntries:[]};
  assert.equal(g.evaluateCoverage(state,'2026-10').status,'mismatch');
  const html=g.render(state);
  assert.match(html,/Samma kontorad förekommer flera gånger: 1/);
  assert.match(html,/Kontorader saknar inläst verifikation: 1/);
  assert.match(html,/Antalen stämmer inte/);
  assert.equal(g.evaluateCoverage({...state,coverage:{...base,integrity:null}},'2026-10').status,'unavailable');
});
