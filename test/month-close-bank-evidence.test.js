'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'apps/portal/month-close-guide.js'),'utf8');
const accounting=fs.readFileSync(path.join(root,'apps/portal/accounting.js'),'utf8');
function makeGuide(){
  const context={};
  vm.runInNewContext(source,context,{filename:'month-close-guide.js'});
  return context.LTMonthCloseGuide;
}
test('oplacerade bankbetalningar visas för rätt företag, utan att bank eller månad godkänns',()=>{
  const guide=makeGuide();
  const evidence={status:'checked',companyId:'synthetic-a',count:2,checkedAt:new Date().toISOString()};
  const state={companyId:'synthetic-a',period:'2026-10',unmatchedBankEvidence:evidence};
  const html=guide.render(state);
  assert.match(html,/2 oplacerade betalningar behöver granskas/);
  assert.match(html,/hela företaget, inte enbart vald månad/);
  assert.match(html,/Övriga bankhändelser behöver fortfarande stämmas av/);
  assert.match(html,/href="\.\/unplaced-payments\.html"/);
  assert.equal((html.match(/Kontrollera manuellt/g)||[]).length,7);
  assert.doesNotMatch(html,/Banken är avstämd|Månaden är klar/);
  assert.match(guide.renderBankReview({...state,unmatchedBankEvidence:{...evidence,count:1}}),/1 oplacerad betalning behöver granskas/);
  assert.match(guide.renderBankReview({...state,unmatchedBankEvidence:{...evidence,count:0}}),/Inga oplacerade betalningar hittades/);
});
test('frånvarande, osäker, gammal eller annan tenants bankräkning är alltid okänd',()=>{
  const guide=makeGuide();
  const evidence={status:'checked',companyId:'synthetic-a',count:3,checkedAt:new Date().toISOString()};
  const state={companyId:'synthetic-a',unmatchedBankEvidence:evidence};
  for(const sample of [
    {...state,companyId:'synthetic-b'},
    {...state,unmatchedBankEvidence:{...evidence,checkedAt:new Date(Date.now()-6*60*1000).toISOString()}},
    {...state,unmatchedBankEvidence:{...evidence,checkedAt:'invalid'}},
    {...state,unmatchedBankEvidence:{...evidence,count:-1}},
    {...state,unmatchedBankEvidence:{...evidence,count:1.5}},
    {...state,unmatchedBankEvidence:{status:'unavailable',companyId:'synthetic-a'}},
    {companyId:'synthetic-a'}
  ]){
    const html=guide.renderBankReview(sample);
    assert.match(html,/kunde inte kontrolleras eller behöver uppdateras/);
    assert.doesNotMatch(html,/3 oplacerade betalningar behöver granskas/);
  }
  assert.match(guide.renderBankReview({demo:true}),/verifieras inte mot Supabase i demon/);
});
test('bankantal hämtas enbart läsbart med personlig token, company-filter och unmatched-status',()=>{
  assert.match(accounting,/from\('bank_payments',ctx.accessToken\)/);
  assert.match(accounting,/countExact\(filter\+'&status=eq\.unmatched'\)/);
  assert.match(accounting,/unmatchedBankEvidence=\{status:'unavailable',companyId:ctx.company.id\}/);
  assert.match(accounting,/unmatchedBankEvidence=null/);
  assert.match(accounting,/guide\.renderBankReview\(state\)/);
  assert.match(accounting,/visibilitychange/);
  assert.doesNotMatch(source,/\bfetch\s*\(/);
});
