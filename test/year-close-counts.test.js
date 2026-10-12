'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {scan,yearDates}=require('../apps/portal/year-close-counts.js');
const html=fs.readFileSync(path.resolve(__dirname,'../apps/portal/bokslut.html'),'utf8');
function makeClient(values,seen){
 return {from:(table,token)=>({countExact:async filter=>{
    seen.push({table,token,filter});
    if(values[table] instanceof Error)throw values[table];
    if(table==='journal_entries')return filter.includes('posting_date=gte.')?values.year:values.total;
    if(table==='journal_lines')return values.lines;
    if(table==='financial_batches')return values.batches;
    if(table==='bank_payments')return values.bank;
    throw new Error('unexpected table');
  }})};
}
const input={companyId:'TENANT_A',token:'fake-test-only-token',year:'2026'};
test('kalenderår använder exklusiv slutgräns och stoppar ogiltiga datum',()=>{
 assert.deepEqual(yearDates('2026'),{start:'2026-01-01',end:'2027-01-01'});
 assert.throws(()=>yearDates('2026-01-01'));
 assert.throws(()=>yearDates('2028;drop'));
});
test('serverräknade antal över 1 000 går aldrig via inlästa listor',async()=>{
 const seen=[];
 const res=await scan({...input,client:makeClient({year:1402,total:1523,lines:3100,batches:0,bank:0},seen)});
 assert.equal(res.counts.journal.count,1402);
 assert.equal(res.counts.allLines.count,3100);
 assert.equal(res.reliable,true);
 assert.equal(res.hasExceptions,false);
 assert.equal(seen.length,5);
 assert.ok(seen.every(x=>x.token==='fake-test-only-token'&&x.filter.includes('company_id=eq.TENANT_A')));
 assert.ok(seen.some(x=>x.filter.includes('posting_date=gte.2026-01-01&posting_date=lt.2027-01-01')));
 assert.doesNotMatch(res.note,/Bokslut klart/);
});
test('öppna buntar och omatchade bankposter markeras som åtgärd, inte godkända',async()=>{
 const res=await scan({...input,client:makeClient({year:1,total:1,lines:2,batches:3,bank:4},[])});
 assert.equal(res.counts.openBatches.status,'attention');
 assert.equal(res.counts.unplacedBank.status,'attention');
 assert.equal(res.hasExceptions,true);
});
test('nätverksfel, trunkerad och ogiltig count blir okänd, aldrig grön',async()=>{
 const res=await scan({...input,client:makeClient({year:1000,total:1000,lines:NaN,batches:new Error('access denied'),bank:0},[])});
 assert.equal(res.reliable,false);
 assert.equal(res.counts.allLines.status,'unknown');
 assert.equal(res.counts.openBatches.status,'unknown');
});
test('varje företag skapar egna filter och inget delas mellan körningar',async()=>{
 const a=[],b=[],values={year:1,total:1,lines:2,batches:0,bank:0};
 await scan({...input,client:makeClient(values,a)});
 await scan({...input,companyId:'TENANT_B',client:makeClient(values,b)});
 assert.ok(a.every(x=>x.filter.includes('TENANT_A')&&!x.filter.includes('TENANT_B')));
 assert.ok(b.every(x=>x.filter.includes('TENANT_B')&&!x.filter.includes('TENANT_A')));
});
test('sidan använder bara läsbaserade antal och förbjuder falsk färdigstatus',()=>{
 assert.match(html,/year-close-counts\.js/);
 assert.match(html,/LTYearCloseCounts\.scan/);
 assert.match(html,/getElementById\('year-close-form'\)/);
 assert.match(html,/Bokslut är fortfarande inte verifierat/);
 assert.match(html,/Kontorader räknas tills vidare för företaget totalt/);
 assert.doesNotMatch(html,/Bokslut klart|Årsredovisning inlämnad/);
});
