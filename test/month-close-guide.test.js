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
  assert.match(html,/1 möjliga avvikelser/);
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
