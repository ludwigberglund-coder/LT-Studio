'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {inspect,normalized}=require('../apps/portal/book-close-ledger.js');
const sql=fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/20261012154500_book_close_ledger_integrity.sql'),'utf8');
const html=fs.readFileSync(path.resolve(__dirname,'../apps/portal/bokslut.html'),'utf8');
const base={company_id:'TENANT_A',version:1,scope:'ledger-integrity-not-reconciled',start_date:'2026-01-01',end_exclusive:'2027-01-01',observed_at:'2026-10-12T13:43:00Z',
  counts:{entries:'1801',lines:'3602',entries_without_two_lines:'0',unbalanced_entries:'0',invalid_lines:'0',duplicate_number_groups:'0',orphan_company_lines_all_dates:'0'},
  period_totals:{debit_ore:'90071992547409930',credit_ore:'90071992547409930'},
  account_movements:{'1930':{debit_ore:'90071992547409930',credit_ore:'0',net_ore:'90071992547409930'}}};
const clone=()=>structuredClone(base);

test('P1B reads all server-aggregated rows, even when >1000, and preserves large money as strings',()=>{
  const value=normalized(clone(),'TENANT_A','2026-01-01','2027-01-01');
  assert.equal(value.counts.entries,'1801');
  assert.equal(value.counts.lines,'3602');
  assert.equal(value.periodTotals.debit,'90071992547409930');
  assert.equal(value.accountMovements['1930'],'90071992547409930');
  assert.equal(value.status,'not-yet-reconciled');
  assert.equal(value.detected,false);
});
test('ledger anomalies never count as a reconciled book close',()=>{
  for(const field of ['unbalanced_entries','invalid_lines','duplicate_number_groups','orphan_company_lines_all_dates','entries_without_two_lines']){
    const input=clone();input.counts[field]='1';
    assert.equal(normalized(input,'TENANT_A','2026-01-01','2027-01-01').status,'attention',field);
  }
  const badTotals=clone();badTotals.period_totals.credit_ore='90071992547409929';
  assert.equal(normalized(badTotals,'TENANT_A','2026-01-01','2027-01-01').detected,true);
});
test('cross-company snapshot cannot be displayed under a different company',()=>{
  assert.throws(()=>normalized(clone(),'TENANT_B','2026-01-01','2027-01-01'));
  assert.throws(()=>normalized(clone(),'TENANT_A','2025-01-01','2026-01-01'));
});
test('fail closed on missing, malformed or rounded counters',()=>{
  for(const bad of [null,[],{}])assert.throws(()=>normalized(bad,'TENANT_A','2026-01-01','2027-01-01'));
  const rounded=clone();rounded.counts.entries=1801;assert.throws(()=>normalized(rounded,'TENANT_A','2026-01-01','2027-01-01'));
  const missing=clone();delete missing.counts.lines;assert.throws(()=>normalized(missing,'TENANT_A','2026-01-01','2027-01-01'));
  const unknown=clone();unknown.account_movements['9999']={net_ore:'1'};assert.throws(()=>normalized(unknown,'TENANT_A','2026-01-01','2027-01-01'));
});
test('RPC sends only logged-in company and exact period boundaries',async()=>{
  const calls=[];
  const report=await inspect({companyId:'TENANT_A',token:'synthetic-token-only',year:'2026',client:{
    rpc:async(name,params,token)=>{calls.push({name,params,token});return clone();}
  }});
  assert.equal(report.status,'not-yet-reconciled');
  assert.deepEqual(calls,[{name:'book_close_ledger_integrity',params:{p_company_id:'TENANT_A',p_start:'2026-01-01',p_end:'2027-01-01'},token:'synthetic-token-only'}]);
  await assert.rejects(inspect({companyId:'TENANT_B',token:'synthetic-token-only',year:'2026',client:{rpc:async()=>clone()}}));
  await assert.rejects(inspect({companyId:'TENANT_A',token:'synthetic-token-only',year:'2026-01-01',client:{rpc:async()=>clone()}}));
});
test('migration preserves RLS and explicit tenant membership for invoker RPC',()=>{
  assert.match(sql,/security invoker/i);
  assert.doesNotMatch(sql,/security definer/i);
  assert.match(sql,/lt_security\.request_has_aal2_personal_session\(\)/);
  assert.match(sql,/from public\.company_memberships m/);
  assert.match(sql,/m\.company_id = p_company_id/);
  assert.match(sql,/m\.auth_user_id = auth\.uid\(\)/);
  assert.match(sql,/join access_guard/);
  assert.match(sql,/l\.company_id = e\.company_id/);
  assert.match(sql,/revoke all on function public\.book_close_ledger_integrity/);
  assert.match(sql,/grant execute on function public\.book_close_ledger_integrity.*authenticated/);
  assert.match(sql,/sum\(l\.debit_ore::numeric\)/);
  assert.match(sql,/group by e\.id/);
  assert.match(sql,/p_end <= \(p_start \+ interval '18 months'\)::date/);
});
test('portal keeps unverified accounting status and renders new annual evidence panel',()=>{
  assert.match(html,/id="year-ledger-results"/);
  assert.match(html,/book-close-ledger-ui\.js/);
  assert.match(html,/book-close-ledger\.js/);
  assert.match(html,/periodens nettorrörelser/);
  assert.match(html,/Bokslut inte verifierat/);
  assert.doesNotMatch(html,/Bokslut klart|Årsredovisning inlämnad/);
});
