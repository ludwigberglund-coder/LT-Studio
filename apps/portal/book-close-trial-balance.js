/* #745 P1E: server-originated trial balance for an explicit fiscal period. */
(function(root){
'use strict';
const ore=/^-?(?:0|[1-9][0-9]{0,35})$/;
const count=/^(?:0|[1-9][0-9]{0,19})$/;
const date=/^\d{4}-\d{2}-\d{2}$/;
function bounds(start,end){
  if(typeof start!=='string'||typeof end!=='string'||!date.test(start)||!date.test(end))
    throw new Error('Ange giltigt start- och slutdatum.');
  const a=new Date(start+'T00:00:00Z'),b=new Date(end+'T00:00:00Z');
  if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||
     a.toISOString().slice(0,10)!==start||b.toISOString().slice(0,10)!==end)
    throw new Error('Datumen är ogiltiga.');
  const days=(b-a)/86400000;
  if(days<1||days>550)throw new Error('Bokslutsperioden måste vara högst 18 månader.');
  return {start,endExclusive:end};
}
function integer(value,pattern){
  if(typeof value!=='string'||!pattern.test(value))throw new Error('Ogiltig summa eller antal från servern.');
  return BigInt(value);
}
function normalize(payload,companyId,start,end){
  bounds(start,end);
  if(!payload||Array.isArray(payload)||payload.version!==1||
      payload.scope!=='all-account-trial-balance-not-reconciled'||
      payload.company_id!==companyId||payload.start_date!==start||
      payload.end_exclusive!==end||payload.status!=='not_reconciled'||
      payload.history_coverage!=='not_verified'||payload.opening_balance!=='not_verified'||
      payload.external_reconciliation!=='not_verified')
    throw new Error('Bokslutsresultatet matchar inte företag och period.');
  if(!Number.isFinite(Date.parse(payload.observed_at))||
      !payload.counts||!payload.totals||!Array.isArray(payload.accounts))
    throw new Error('Ofullständigt underlag från servern.');
  const counts={};
  for(const k of ['account_count','prior_lines','period_lines','invalid_lines']){
    integer(payload.counts[k],count);counts[k]=payload.counts[k];
  }
  const totals={};
  for(const k of ['period_debit_ore','period_credit_ore','prior_net_ore','period_net_ore']){
    integer(payload.totals[k],ore);totals[k]=payload.totals[k];
  }
  const accounts=[];
  const seen=new Set();
  let deb=0n,cred=0n,prior=0n,period=0n,priorLines=0n,periodLines=0n,invalid=0n;
  for(const row of payload.accounts){
    const account=row?.account;
    if(typeof account!=='string'||!/^[0-9]{4}$/.test(account)||seen.has(account))
      throw new Error('Huvudboken innehåller felaktiga eller upprepade konton.');
    seen.add(account);
    const fields=['prior_net_ore','period_debit_ore','period_credit_ore','period_net_ore','through_end_net_ore'];
    for(const k of fields)integer(row[k],ore);
    for(const k of ['prior_lines','period_lines','invalid_lines'])integer(row[k],count);
    if(integer(row.period_debit_ore,ore)-integer(row.period_credit_ore,ore)!==integer(row.period_net_ore,ore)||
       integer(row.prior_net_ore,ore)+integer(row.period_net_ore,ore)!==integer(row.through_end_net_ore,ore))
      throw new Error('Kontots summering stämmer inte.');
    deb+=BigInt(row.period_debit_ore);cred+=BigInt(row.period_credit_ore);
    prior+=BigInt(row.prior_net_ore);period+=BigInt(row.period_net_ore);
    priorLines+=BigInt(row.prior_lines);periodLines+=BigInt(row.period_lines);
    invalid+=BigInt(row.invalid_lines);
    accounts.push({...row});
  }
  if(BigInt(counts.account_count)!==BigInt(accounts.length)||
     priorLines!==BigInt(counts.prior_lines)||periodLines!==BigInt(counts.period_lines)||
     invalid!==BigInt(counts.invalid_lines)||
     deb!==BigInt(totals.period_debit_ore)||cred!==BigInt(totals.period_credit_ore)||
     prior!==BigInt(totals.prior_net_ore)||period!==BigInt(totals.period_net_ore))
     throw new Error('Totalerna motsvarar inte kontoraderna.');
  return {status:'not_reconciled',start,endExclusive:end,companyId,observedAt:payload.observed_at,
    counts,totals,accounts,hasWarnings:invalid>0n||deb!==cred||period!==0n,
    caveat:'Preliminär saldobalans utifrån tillgänglig huvudbok. Ingående balans, historik och externa underlag är inte verifierade.'};
}
async function inspect({companyId,token,start,end,client}){
  if(!companyId||!token||typeof client?.rpc!=='function')throw new Error('Säker företagssession krävs.');
  bounds(start,end);
  const result=await client.rpc('book_close_trial_balance',
    {p_company_id:companyId,p_start:start,p_end:end},token);
  return normalize(result,companyId,start,end);
}
if(typeof module==='object'&&module.exports){module.exports={bounds,normalize,inspect};return;}
root.LTBookCloseTrialBalance=Object.freeze({bounds,inspect});
})(globalThis);
