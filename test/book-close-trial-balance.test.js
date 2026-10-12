'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const mod=require('../apps/portal/book-close-trial-balance.js');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261012214000_book_close_trial_balance.sql'),'utf8');
const sample=()=>({
  version:1,scope:'all-account-trial-balance-not-reconciled',company_id:'company-a',
  start_date:'2026-07-01',end_exclusive:'2027-07-01',observed_at:'2026-10-12T12:00:00Z',
  status:'not_reconciled',history_coverage:'not_verified',opening_balance:'not_verified',
  external_reconciliation:'not_verified',
  counts:{account_count:'2',prior_lines:'1',period_lines:'2',invalid_lines:'0'},
  totals:{period_debit_ore:'12000',period_credit_ore:'12000',prior_net_ore:'0',period_net_ore:'0'},
  accounts:[
    {account:'1930',prior_net_ore:'5000',period_debit_ore:'12000',period_credit_ore:'0',period_net_ore:'12000',
      through_end_net_ore:'17000',prior_lines:'1',period_lines:'1',invalid_lines:'0'},
    {account:'3010',prior_net_ore:'-5000',period_debit_ore:'0',period_credit_ore:'12000',period_net_ore:'-12000',
      through_end_net_ore:'-17000',prior_lines:'0',period_lines:'1',invalid_lines:'0'}
  ]
});
test('supports broken fiscal years and rejects invalid or overlong periods',()=>{
  assert.deepEqual(mod.bounds('2026-07-01','2027-07-01'),{start:'2026-07-01',endExclusive:'2027-07-01'});
  assert.throws(()=>mod.bounds('2026-02-30','2027-02-01'));
  assert.throws(()=>mod.bounds('2026-01-01','2028-01-01'));
  assert.throws(()=>mod.bounds('2027-01-01','2026-01-01'));
});
test('reads all-account trial balance without treating it as reconciled',()=>{
  const x=mod.normalize(sample(),'company-a','2026-07-01','2027-07-01');
  assert.equal(x.accounts.length,2);
  assert.equal(x.status,'not_reconciled');
  assert.match(x.caveat,/inte verifierade/);
});
test('rejects cross-tenant or modified date-bound snapshots',()=>{
  assert.throws(()=>mod.normalize(sample(),'company-b','2026-07-01','2027-07-01'));
  assert.throws(()=>mod.normalize(sample(),'company-a','2026-01-01','2027-07-01'));
});
test('rejects tampered totals and duplicated accounts',()=>{
  const a=sample();a.totals.period_debit_ore='11999';
  assert.throws(()=>mod.normalize(a,'company-a','2026-07-01','2027-07-01'));
  const b=sample();b.accounts[1].account='1930';
  assert.throws(()=>mod.normalize(b,'company-a','2026-07-01','2027-07-01'));
});
test('does not round amounts outside JS safe integer range',()=>{
  const a=sample(),big='900719925474099300000';
  a.accounts[0].period_debit_ore=big;a.accounts[0].period_net_ore=big;
  a.accounts[0].through_end_net_ore=(BigInt(big)+5000n).toString();
  a.totals.period_debit_ore=big;
  a.totals.period_net_ore=(BigInt(big)-12000n).toString();
  const x=mod.normalize(a,'company-a','2026-07-01','2027-07-01');
  assert.equal(x.totals.period_debit_ore,big);
});
test('server function is company-scoped read-only invoker and AAL2-checked',()=>{
  assert.match(sql,/security invoker/i);assert.match(sql,/request_has_aal2_personal_session/);
  assert.match(sql,/e\.company_id=p_company_id/);
  assert.match(sql,/revoke all on function public\.book_close_trial_balance[\s\S]*public,anon/);
  assert.match(sql,/grant execute on function public\.book_close_trial_balance[\s\S]*authenticated/);
  assert.doesNotMatch(sql,/\b(insert into|update public\.|delete from public\.)\b/i);
});
test('RPC requires matching company session and uses explicit dates',async()=>{
  const calls=[];
  const out=await mod.inspect({companyId:'company-a',token:'token',start:'2026-07-01',end:'2027-07-01',client:{
    rpc:async(name,args,token)=>{calls.push({name,args,token});return sample();}
  }});
  assert.equal(out.status,'not_reconciled');
  assert.equal(calls[0].name,'book_close_trial_balance');
  assert.equal(calls[0].args.p_company_id,'company-a');
});
