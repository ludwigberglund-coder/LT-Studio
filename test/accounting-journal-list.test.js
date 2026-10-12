'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../apps/portal/accounting.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../apps/portal/accounting.css'),'utf8');
const withoutStartup=source.slice(0,source.indexOf('async function init(){'));

function journalView(documentOverride,{supabase=false}={}){
  assert.ok(withoutStartup.length>0 && withoutStartup.length<source.length,'test must exclude only the startup call');
  const document=documentOverride||{getElementById:()=>({})};
  const exposed='\n({ setCoverage(coverage){monthCoverage=coverage;session={company:{id:"company-a"}}}, setRows(rows){entries=rows;selectedEntry=sortedJournalEntries()[0]||null}, setExpanded(value){journalExpanded=value}, setQuery(value){journalQuery=value}, setSuggestions(open,index=-1){journalSuggestionsOpen=open;journalSuggestionIndex=index}, setSelected(value){selectedEntry=entries.find(row=>row.id===value)||null}, sortedJournalEntries,entryTable,bind })';
  return vm.runInNewContext(withoutStartup+exposed,{
    document,location:{search:'',hostname:supabase?'ludwigberglund-coder.github.io':'localhost'},sessionStorage:{getItem:()=>null},
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


test('sökning hittar verifikation på nummer, datum, text, källa och konteringskonto',()=>{
  const view=journalView();
  view.setRows([
    {id:'rent',number:'A43',postingDate:'2026-10-12',description:'Lokalhyra',
      sourceType:'supplier-payment',createdAt:'2026-10-12T08:00:00Z',
      lines:[{account:'5010',text:'Kontorshyra',debitOre:10000,creditOre:0}]},
    {id:'bank',number:'B17',postingDate:'2026-09-07',description:'Inbetalning KUND AB',
      sourceType:'bank-payment',createdAt:'2026-10-11T08:00:00Z',
      lines:[{account:'1930',text:'Kundfordran',debitOre:10000,creditOre:0}]}
  ]);
  for(const term of ['a43','2026-10-12','LOKALHYRA','supplier-payment','5010','kontorsHYRA']){
    view.setQuery(term);
    assert.deepEqual(ids(view.entryTable()),['rent'],term);
    assert.match(view.entryTable(),/1 träff av 2 inlästa/);
  }
  for(const term of ['b17','2026-09-07','kund ab','bank-payment','1930','kundfordran']){
    view.setQuery(term);
    assert.deepEqual(ids(view.entryTable()),['bank'],term);
  }
  view.setQuery('');
  assert.deepEqual(ids(view.entryTable()),['rent','bank']);
  assert.match(view.entryTable(),/Senaste verifikationerna/);
});

test('inga sökträffar visas tydligt med säker escaped söktext',()=>{
  const view=journalView();
  view.setRows([row('recent','2026-10-12T08:00:00Z','2026-10-12','A300')]);
  view.setQuery('Finns inte');
  const missing=view.entryTable();
  assert.deepEqual(ids(missing),[]);
  assert.match(missing,/0 träffar av 1 inlästa/);
  assert.match(missing,/Inga verifikationer matchar sökningen/);
  assert.match(missing,/Rensa sökning/);
  assert.doesNotMatch(missing,/data-action="toggle-journals"/);
  view.setQuery('"><img src=x onerror=alert(1)>');
  const escaped=view.entryTable();
  assert.match(escaped,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(escaped,/<img src=x/);
});

test('sökning byter endast verifikationslistan och behåller andra utkast och månadsavstämning',()=>{
  assert.match(source,/function bindJournalControls\(\)/);
  assert.match(source,/existing\.outerHTML=entryTable\(\)/);
  assert.match(source,/journalList\.before\(journalDetail\)/);
  assert.match(source,/journalQuery=String\(field\.value\|\|""\)\.slice\(0,100\)/);
  const searchHandler=source.split('document.querySelector("#journal-search-field")?.addEventListener("input"')[1]?.split('document.querySelector(\'[data-action="clear-journal-search"]\')?.addEventListener')[0]||'';
  assert.ok(searchHandler.includes('updateJournalList'),'input updates just the journal list');
  assert.doesNotMatch(searchHandler,/\brender\(\)/,'typing does not destroy correction/opening-balance forms');
  assert.match(source,/function monthlyGuide\(current\)/);
  assert.match(source,/function beginnerGuide\(\)/);
  assert.match(css,/\.journal-search-controls input\[type="search"\]/);
  assert.match(css,/html\[data-lt-theme="dark"\] \.journal-search/);
  assert.match(css,/@media\(max-width:620px\)\{\.journal-search-controls/);
});


test('sökförslagen har verkliga tillgängliga roller, säker text och aktivt tangentbordsval',()=>{
  const view=journalView();
  view.setRows([
    {id:'first',number:'A102',postingDate:'2026-10-12',description:'Hyra "lokal" <test>',sourceType:'manual',
     lines:[{account:'5010',text:'Kontorshyra',debitOre:1000,creditOre:0}]},
    {id:'second',number:'A101',postingDate:'2026-10-11',description:'Andra lokalen',sourceType:'manual',
     lines:[{account:'5010',text:'Kontorshyra',debitOre:1000,creditOre:0}]}
  ]);
  view.setQuery('lokal');
  view.setSuggestions(true,1);
  const html=view.entryTable();
  assert.match(html,/role="combobox"/);
  assert.match(html,/aria-controls="journal-search-suggestions"/);
  assert.match(html,/aria-autocomplete="list"/);
  assert.match(html,/aria-expanded="true"/);
  assert.match(html,/aria-activedescendant="journal-suggestion-1"/);
  assert.match(html,/role="listbox"/);
  assert.equal((html.match(/role="option"/g)||[]).length,2);
  assert.match(html,/id="journal-suggestion-1"[^>]*aria-selected="true"/);
  assert.match(html,/Hyra &quot;lokal&quot; &lt;test&gt;/);
  assert.doesNotMatch(html,/<test>/);
  view.setSuggestions(false);
  assert.match(view.entryTable(),/aria-expanded="false"/);
  assert.match(view.entryTable(),/role="listbox"[^>]*hidden/);
  assert.match(source,/journalSuggestionIndex=journalSuggestionIndex<0/);
  assert.match(source,/key==="ArrowDown"/);
  assert.match(source,/key==="ArrowUp"/);
  assert.match(source,/key==="Enter"/);
  assert.match(source,/key==="Escape"/);
});

test('journal search explains missing coverage evidence without claiming zero results are complete',()=>{
  const view=journalView(undefined,{supabase:true});
  view.setRows([row('one','2026-10-12T08:00:00Z','2026-10-12','A1')]);
  assert.match(view.entryTable(),/Vi kan inte kontrollera hur många bokförda poster/);
  view.setCoverage({status:'unavailable',companyId:'company-a'});
  assert.match(view.entryTable(),/Sökresultatet kan vara ofullständigt/);
  view.setCoverage({status:'checked',companyId:'another-company',totalEntries:1,totalLines:1,loadedEntries:1,loadedLines:1});
  assert.match(view.entryTable(),/Vi kan inte kontrollera/,'evidence for another company must never be trusted');
});

test('journal search warns when only some entries or journal lines are loaded',()=>{
  const view=journalView(undefined,{supabase:true});
  view.setRows([row('one','2026-10-12T08:00:00Z','2026-10-12','A1')]);
  const integrity={duplicateEntryIds:0,duplicateLineIds:0,orphanLines:0,wrongCompanyLines:0};
  view.setCoverage({status:'checked',companyId:'company-a',totalEntries:4,totalLines:8,loadedEntries:1,loadedLines:2,integrity});
  view.setQuery('not-found');
  const html=view.entryTable();
  assert.match(html,/0 träffar av 1 inlästa/);
  assert.match(html,/Vi har läst in 1 av 4 verifikationer och 2 av 8 konteringsrader/);
  assert.match(html,/Sökresultatet kan därför vara ofullständigt/);
  view.setCoverage({status:'checked',companyId:'company-a',totalEntries:1,totalLines:8,loadedEntries:1,loadedLines:2,integrity});
  assert.match(view.entryTable(),/1 av 1 verifikationer och 2 av 8 konteringsrader/);
});

test('journal search does not equate matching counts with validated accounting',()=>{
  const view=journalView(undefined,{supabase:true});
  view.setRows([row('one','2026-10-12T08:00:00Z','2026-10-12','A1')]);
  const coverage={status:'checked',companyId:'company-a',totalEntries:1,totalLines:1,loadedEntries:1,loadedLines:1,integrity:{duplicateEntryIds:0,duplicateLineIds:0,orphanLines:0,wrongCompanyLines:0}};
  view.setCoverage(coverage);
  assert.doesNotMatch(view.entryTable(),/journal-coverage-warning/,'count parity does not warrant a misleading success badge');
  view.setCoverage({...coverage,integrity:{...coverage.integrity,orphanLines:1}});
  assert.match(view.entryTable(),/avvikelse i de inlästa bokföringsraderna/);
  assert.match(css,/journal-coverage-warning/);
  assert.doesNotMatch(journalView().entryTable(),/journal-coverage-warning/,'demo and legacy should not get false warnings');
});
