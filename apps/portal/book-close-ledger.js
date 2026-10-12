/* Bokslut P1B: säker tolkning av serverns huvudbokskontroll. Ingen attest. */
(function(root){
'use strict';
const keys=['entries','lines','entries_without_two_lines','unbalanced_entries','invalid_lines','duplicate_number_groups','orphan_company_lines_all_dates'];
const defectKeys=keys.slice(2);
function normalized(snapshot,companyId,start,end){
  if(!snapshot||Array.isArray(snapshot)||snapshot.version!==1||snapshot.scope!=='ledger-integrity-not-reconciled'
    ||snapshot.company_id!==companyId||snapshot.start_date!==start||snapshot.end_exclusive!==end)throw new Error('Serverkontrollens uppgifter kunde inte verifieras.');
  if(!snapshot.counts||typeof snapshot.counts!=='object')throw new Error('Serverkontrollens antal saknas.');
  const counts={};
  for(const key of keys){
    const value=snapshot.counts[key];
    if(typeof value!=='string'||!/^\d{1,20}$/.test(value))throw new Error('Kontrollsiffror saknas eller är felaktiga.');
    counts[key]=value;
  }
  const debit=snapshot.period_totals?.debit_ore,credit=snapshot.period_totals?.credit_ore;
  if(typeof debit!=='string'||typeof credit!=='string'||!/^\d{1,32}$/.test(debit)||!/^\d{1,32}$/.test(credit))throw new Error('Huvudbokssummor saknas.');
  const accounts={};
  for(const [account,values] of Object.entries(snapshot.account_movements||{})){
    if(!['1510','1630','1930','1940','2440','2650'].includes(account))throw new Error('Okänt konto i kontrollresultatet.');
    if(!values||typeof values.net_ore!=='string'||!/^[-]?\d{1,32}$/.test(values.net_ore))throw new Error('Kontorörelse saknas.');
    accounts[account]=values.net_ore;
  }
  const detected=defectKeys.some(key=>BigInt(counts[key])>0n)||BigInt(debit)!==BigInt(credit);
  return {counts,periodTotals:{debit,credit},accountMovements:accounts,detected,observedAt:String(snapshot.observed_at||''),status:detected?'attention':'not-yet-reconciled'};
}
async function inspect({companyId,token,year,client}){
  if(typeof companyId!=='string'||!companyId||typeof token!=='string'||!token||!client?.rpc)throw new Error('Säker företagssession krävs.');
  const dates=root.LTYearCloseCounts?.yearDates?.(year)||(typeof require==='function'?require('./year-close-counts.js').yearDates(year):null);
  if(!dates)throw new Error('Årsvalet är ogiltigt.');
  const result=await client.rpc('book_close_ledger_integrity',{p_company_id:companyId,p_start:dates.start,p_end:dates.end},token);
  return normalized(result,companyId,dates.start,dates.end);
}
if(typeof module==='object'&&module.exports){module.exports={inspect,normalized};return;}
root.LTBookCloseLedger=Object.freeze({inspect});
})(globalThis);
