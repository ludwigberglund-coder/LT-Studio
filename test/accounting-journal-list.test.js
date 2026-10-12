'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../apps/portal/accounting.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../apps/portal/accounting.css'),'utf8');
const withoutStartup=source.slice(0,source.indexOf('async function init(){'));

function journalView(documentOverride){
  assert.ok(withoutStartup.length>0 && withoutStartup.length<source.length,'test must exclude only the startup call');
  const document=documentOverride||{getElementById:()=>({})};
  const exposed='\n({ setRows(rows){entries=rows;selectedEntry=sortedJournalEntries()[0]||null}, setExpanded(value){journalExpanded=value}, setSelected(value){selectedEntry=entries.find(row=>row.id===value)||null}, sortedJournalEntries,entryTable,bind })';
  return vm.runInNewContext(withoutStartup+exposed,{
    document,location:{search:'',hostname:'localhost'},sessionStorage:{getItem:()=>null},
    URLSearchParams,Date,Intl
  });
}
function row(id,createdAt,postingDate,number){
  return {id,createdAt,postingDate,number,description:'Fiktiv testverifikation '+id,
    sourceType:'manual',lines:[{account:'1930',debitOre:10000,creditOre:0}]};
}
function ids(html){return [...html.matchAll(/<tr data-entry="([^"]+)"/g)].map(match=>match[1])}

test('fem senaste visas först även när nyregistrerad verifikation har äldre bokföringsdatum',()=>{
  const rows=[
    row('a','2026-10-10T08:00:00Z','2026-10-10','A10'),
    row('b','2026-10-09T08:00:00Z','2026-10-09','A9'),
    row('c','2026-10-08T08:00:00Z','2026-10-08','A8'),
    row('d','2026-10-07T08:00:00Z','2026-10-07','A7'),
    row('e','2026-10-06T08:00:00Z','2026-10-06','A6'),
    row('f','2026-10-05T08:00:00Z','2026-10-05','A5'),
    row('new','2026-10-12T12:30:00Z','2025-01-01','A11')
  ];
  const view=journalView();
  view.setRows(rows);
  const html=view.entryTable();
  assert.deepEqual(ids(html).slice(0,5),['new','a','b','c','d']);
  assert.equal(ids(html).length,rows.length,'all verifications remain accessible by scrolling');
  assert.match(html,/class="accounting-table-scroll journal-scroll "/);
  assert.match(html,/aria-expanded="false"/);
  assert.match(html,/Visa fler verifikationer/);
  assert.match(html,/aria-label="Verifikationer, rulla med musens hjul för att se äldre"/);
  assert.equal((html.match(/aria-current="true"/g)||[]).length,1,'selected verification is visible and highlighted');
  assert.match(html,/data-entry="new"[^>]*aria-current="true"/);
  assert.equal(rows[0].id,'a','sorting must not mutate original records');
});

test('öppna/stäng större listan utan att dölja äldre verifikationer eller markering',()=>{
  const view=journalView();
  view.setRows(Array.from({length:12},(_,i)=>row('entry-'+i,'2026-10-'+String(i+1).padStart(2,'0')+'T08:00:00Z','2026-10-01','A'+(i+1))));
  view.setSelected('entry-2');
  const collapsed=view.entryTable();
  assert.match(collapsed,/aria-expanded="false"/);
  assert.match(collapsed,/aria-current="true"/);
  assert.equal(ids(collapsed).length,12);

  view.setExpanded(true);
  const expanded=view.entryTable();
  assert.match(expanded,/class="accounting-table-scroll journal-scroll journal-scroll-expanded"/);
  assert.match(expanded,/aria-expanded="true"/);
  assert.match(expanded,/Visa färre/);
  assert.equal(ids(expanded).length,12);
  assert.match(expanded,/data-entry="entry-2"[^>]*aria-current="true"/);
});

test('fem rader ryms, tabellen scrollar med mus och rubriker ligger kvar',()=>{
  assert.match(css,/\.journal-scroll\{max-height:304px;overflow-x:auto;overflow-y:auto/);
  assert.match(css,/\.journal-scroll-expanded\{max-height:520px\}/);
  assert.match(css,/\.journal-scroll \.journal-table th\{height:42px;position:sticky;top:0/);
  assert.match(css,/\.journal-scroll \.journal-table th,\.journal-scroll \.journal-table td\{height:52px/);
  assert.match(css,/\.journal-table tr\[data-entry\]\[aria-current="true"\]/);
  assert.match(source,/journalExpanded=!journalExpanded/);
  assert.match(source,/updated\.scrollTop=scrollTop/);
  assert.match(source,/event\.key==='Enter'\|\|event\.key===' '/);
});

test('vald verifikations detalj flyttas före listan i faktisk DOM-ordning',()=>{
  const parent={};
  const calls=[];
  const list={parentNode:parent,before(value){calls.push(value)}};
  const details={parentNode:parent};
  const fakeDocument={
    getElementById:()=>null,
    querySelector:(selector)=>{
      if(selector==='.journal-list')return list;
      if(selector==='.accounting-grid > .panel:first-child > .entry-detail')return details;
      return null;
    },
    querySelectorAll:()=>[]
  };
  journalView(fakeDocument).bind();
  assert.deepEqual(calls,[details],'selected detail must be above list in visual and accessible reading order');
});

test('högst fem verifikationer behöver ingen onödig expandera-knapp',()=>{
  const view=journalView();
  view.setRows([row('one',null,'2026-10-11','A9'),row('two',null,'2026-10-12','A10')]);
  assert.deepEqual(ids(view.entryTable()),['two','one']);
  assert.doesNotMatch(view.entryTable(),/data-action="toggle-journals"/);
});
