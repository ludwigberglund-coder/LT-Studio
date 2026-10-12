/* Bokslut P1D: historical ledger movements, never proof of opening or closing balance. */
(function(root){
'use strict';
const tracked=['1510','1630','1930','1940','2440','2650'];
const integer=/^-?(?:0|[1-9]\d{0,35})$/;
const count=/^(?:0|[1-9]\d{0,19})$/;
function parseNumber(value,pattern){
  if(typeof value!=='string'||!pattern.test(value))throw new Error('Kontrollresultatet innehåller felaktigt belopp eller antal.');
  return BigInt(value);
}
function normalized(snapshot,companyId,start,end){
  if(!snapshot||Array.isArray(snapshot)||snapshot.version!==1||
     snapshot.scope!=='ledger-cutoff-from-available-history-not-reconciled'||
     snapshot.company_id!==companyId||snapshot.start_date!==start||snapshot.end_exclusive!==end||
     snapshot.status!=='not_reconciled'||snapshot.history_coverage!=='not_verified'||
     snapshot.external_statement!=='not_verified'||snapshot.asof_subledger!=='not_verified')
    throw new Error('Serverresultatet kan inte verifieras för detta företag och denna period.');
  if(!snapshot.counts||typeof snapshot.counts!=='object'||!snapshot.accounts||
      typeof snapshot.accounts!=='object'||Array.isArray(snapshot.accounts))
    throw new Error('Ofullständigt huvudboksresultat.');
  if(!snapshot.observed_at||!Number.isFinite(Date.parse(snapshot.observed_at)))
    throw new Error('Tidpunkt för kontrollen saknas.');
  const counts={};
  for(const key of ['undated_entries','earlier_entries','period_entries','invalid_tracked_lines']){
    parseNumber(snapshot.counts[key],count);
    counts[key]=snapshot.counts[key];
  }
  if(snapshot.counts.first_known_posting_date!==null &&
    (typeof snapshot.counts.first_known_posting_date!=='string'||
      !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.counts.first_known_posting_date)))
    throw new Error('Bokföringens första datum kan inte verifieras.');
  counts.firstKnownPostingDate=snapshot.counts.first_known_posting_date;
  const accounts={};
  if(Object.keys(snapshot.accounts).length!==tracked.length)
    throw new Error('Kontrollresultatet saknar konton.');
  for(const account of tracked){
    const src=snapshot.accounts[account];
    if(!src||typeof src!=='object'||Array.isArray(src))throw new Error('Kontodata saknas.');
    const prior=parseNumber(src.prior_net_ore,integer);
    const movement=parseNumber(src.period_net_ore,integer);
    const cumulative=parseNumber(src.through_end_net_ore,integer);
    if(prior+movement!==cumulative)throw new Error('Kontosummeringen stämmer inte.');
    parseNumber(src.prior_lines,count);
    parseNumber(src.period_lines,count);
    accounts[account]={
      priorNetOre:src.prior_net_ore,periodNetOre:src.period_net_ore,
      throughEndNetOre:src.through_end_net_ore,priorLines:src.prior_lines,periodLines:src.period_lines
    };
  }
  return {counts,accounts,status:'not_reconciled',companyId,start,end,
    observedAt:snapshot.observed_at,hasWarnings:BigInt(counts.undated_entries)>0n||
      BigInt(counts.invalid_tracked_lines)>0n,
    explanation:'Rörelserna bygger endast på tillgängliga verifikationer; ingående balans och externa underlag är inte verifierade.'};
}
async function inspect({companyId,token,year,client}){
  if(typeof companyId!=='string'||!companyId.trim()||typeof token!=='string'||!token.trim()||
    !client||typeof client.rpc!=='function')throw new Error('Inloggad företagssession saknas.');
  const yearDates=root.LTYearCloseCounts?.yearDates||
    (typeof module==='object'&&module.exports?require('./year-close-counts.js').yearDates:null);
  if(!yearDates)throw new Error('Årskontrollen saknas.');
  const {start,end}=yearDates(year);
  const result=await client.rpc('book_close_ledger_cutoff',
    {p_company_id:companyId,p_start:start,p_end:end},token);
  return normalized(result,companyId,start,end);
}
if(typeof module==='object'&&module.exports){module.exports={normalized,inspect};return;}
root.LTBookCloseCutoff=Object.freeze({inspect});
})(globalThis);
