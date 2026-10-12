'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {normalized,inspect}=require('../apps/portal/book-close-cutoff.js');
const sql=fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/20261012180000_book_close_ledger_cutoff.sql'),'utf8');
const html=fs.readFileSync(path.resolve(__dirname,'../apps/portal/bokslut.html'),'utf8');
function sample(){
 const accounts={};
 for(const a of ['1510','1630','1930','1940','2440','2650'])
   accounts[a]={prior_net_ore:'10000',period_net_ore:'-4200',through_end_net_ore:'5800',prior_lines:'1401',period_lines:'2011'};
 return {
   version:1,scope:'ledger-cutoff-from-available-history-not-reconciled',company_id:'TENANT_A',
   start_date:'2026-01-01',end_exclusive:'2027-01-01',observed_at:'2026-10-12T16:00:00Z',
   status:'not_reconciled',history_coverage:'not_verified',external_statement:'not_verified',asof_subledger:'not_verified',
   counts:{undated_entries:'0',earlier_entries:'1501',period_entries:'3001',first_known_posting_date:'2024-02-03',invalid_tracked_lines:'0'},
   accounts
 };
}
test('historical & period sums are checked with precision-safe BigInt and no reconciliation',()=>{
 const s=sample();s.accounts['1930']={prior_net_ore:'900719925474099300',period_net_ore:'-900719925474099299',through_end_net_ore:'1',prior_lines:'1450',period_lines:'3400'};
 const d=normalized(s,'TENANT_A','2026-01-01','2027-01-01');
 assert.equal(d.accounts['1930'].throughEndNetOre,'1');
 assert.equal(d.accounts['1930'].priorLines,'1450');
 assert.equal(d.status,'not_reconciled');
 assert.equal(d.hasWarnings,false);
});
test('foreign company, year and optimistic status cannot pass validation',()=>{
 assert.throws(()=>normalized(sample(),'TENANT_B','2026-01-01','2027-01-01'));
 assert.throws(()=>normalized(sample(),'TENANT_A','2025-01-01','2026-01-01'));
 const claimed=sample();claimed.history_coverage='verified';
 assert.throws(()=>normalized(claimed,'TENANT_A','2026-01-01','2027-01-01'));
});
test('wrong sums, rounded numbers, missing six accounts and gaps fail closed',()=>{
 const wrong=sample();wrong.accounts['1510'].through_end_net_ore='5801';
 assert.throws(()=>normalized(wrong,'TENANT_A','2026-01-01','2027-01-01'));
 const rounded=sample();rounded.accounts['1510'].period_net_ore=4.2;
 assert.throws(()=>normalized(rounded,'TENANT_A','2026-01-01','2027-01-01'));
 const missing=sample();delete missing.accounts['1930'];
 assert.throws(()=>normalized(missing,'TENANT_A','2026-01-01','2027-01-01'));
 const incomplete=sample();incomplete.counts.undated_entries=null;
 assert.throws(()=>normalized(incomplete,'TENANT_A','2026-01-01','2027-01-01'));
});
test('undated entries and invalid lines require attention, not approval',()=>{
 const bad=sample();bad.counts.undated_entries='1';bad.counts.invalid_tracked_lines='2';
 assert.equal(normalized(bad,'TENANT_A','2026-01-01','2027-01-01').hasWarnings,true);
});
test('RPC call uses personal token, current company and exclusive end date',async()=>{
 const calls=[];
 const a=await inspect({companyId:'TENANT_A',year:'2026',token:'synthetic-token',client:{
   rpc:async(...args)=>{calls.push(args);return sample();}
 }});
 assert.equal(a.status,'not_reconciled');
 assert.deepEqual(calls,[['book_close_ledger_cutoff',{p_company_id:'TENANT_A',p_start:'2026-01-01',p_end:'2027-01-01'},'synthetic-token']]);
 await assert.rejects(inspect({companyId:'TENANT_B',year:'2026',token:'synthetic-token',client:{rpc:async()=>sample()}}));
});
test('SQL uses one read-only tenant and MFA guarded invoker statement',()=>{
 assert.match(sql,/security invoker/i);
 assert.doesNotMatch(sql,/security definer/i);
 assert.match(sql,/request_has_aal2_personal_session/);
 assert.match(sql,/m.auth_user_id = auth.uid\(\)/);
 assert.match(sql,/l.company_id = e.company_id/);
 assert.match(sql,/p_end <= \(p_start \+ interval '18 months'\)::date/);
 assert.match(sql,/revoke all on function public.book_close_ledger_cutoff/);
 assert.match(sql,/grant execute on function public.book_close_ledger_cutoff.*authenticated/);
 assert.doesNotMatch(sql,/\b(update|delete|insert)\s+(?:into|from|public\.)/i);
});
test('portal keeps clearly unverified status and accessible horizontal table',()=>{
 assert.match(html,/id="book-close-cutoff-rows"/);
 assert.match(html,/book-close-cutoff-ui\.js/);
 assert.match(html,/bokföringen före systemstart|Bokföring före systemstart/);
 assert.match(html,/Bokslut inte verifierat/);
 assert.match(html,/role="region" aria-label="Kontorörelser/);
});
