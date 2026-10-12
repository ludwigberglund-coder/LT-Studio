/* Bokslut #745 P1C: validate bounded evidence, never conclude reconciliation. */
(function(root){
'use strict';
const keys=Object.freeze({
  bank:['period_records','unmatched','pending_proposal','missing_status','non_sek','zero_or_missing_amount','duplicate_external_id_groups','undated_company_records'],
  customer:['period_posted_invoices','missing_pdf_reference','zero_or_missing_amount','undated_invoices_with_period_invoice_date'],
  supplier:['period_posted_invoices','missing_pdf_reference','missing_liability_reference','non_sek','zero_or_missing_amount','undated_invoices_with_period_invoice_date']
});
const exceptions=Object.freeze({
  bank:keys.bank.slice(1),
  customer:keys.customer.slice(1),
  supplier:keys.supplier.slice(1)
});
function normalize(payload,companyId,start,end){
  if(!payload||Array.isArray(payload)||payload.version!==1||
    payload.scope!=='book-close-evidence-preflight-not-reconciled'||
    payload.company_id!==companyId||payload.start_date!==start||payload.end_exclusive!==end){
    throw new Error('Kontrollen matchar inte företag och period.');
  }
  const limits=payload.reconciliation;
  if(!limits||limits.bank_to_external_statement!=='not_verified'||
    limits.customer_1510_as_of!=='not_verified'||limits.supplier_2440_as_of!=='not_verified'){
    throw new Error('Avstämningsunderlag saknas eller har fel status.');
  }
  const areas={};
  for(const [area,fields] of Object.entries(keys)){
    const source=payload[area];
    if(!source||Array.isArray(source)||typeof source!=='object')throw new Error('Kontrollens underlag saknas.');
    const counts={};
    for(const field of fields){
      const value=source[field];
      if(typeof value!=='string'||!/^\d{1,30}$/.test(value))throw new Error('Ogiltigt antal i kontrollresultatet.');
      counts[field]=value;
    }
    areas[area]={counts,needsReview:exceptions[area].some(field=>BigInt(counts[field])>0n),reconciled:false};
  }
  const observedAt=payload.observed_at;
  if(typeof observedAt!=='string'||!Number.isFinite(Date.parse(observedAt)))throw new Error('Kontrolltidpunkt saknas.');
  return {areas,observedAt,companyId,period:{start,end},status:'not_reconciled',
    description:'Resultatet visar indikativa underlagsluckor, aldrig ett färdigt bokslut.'};
}
async function inspect({companyId,token,year,client}){
  if(typeof companyId!=='string'||!companyId.trim()||typeof token!=='string'||!token.trim()||!client||typeof client.rpc!=='function')
    throw new Error('Säker företagssession krävs.');
  const yearDates=root.LTYearCloseCounts?.yearDates||
    (typeof module==='object'&&module.exports?require('./year-close-counts.js').yearDates:null);
  if(!yearDates)throw new Error('Årsmodulen saknas.');
  const {start,end}=yearDates(year);
  const result=await client.rpc('book_close_evidence_preflight',
    {p_company_id:companyId,p_start:start,p_end:end},token);
  return normalize(result,companyId,start,end);
}
if(typeof module==='object'&&module.exports){module.exports={normalize,inspect,keys};return;}
root.LTBookCloseEvidence=Object.freeze({inspect});
})(globalThis);
