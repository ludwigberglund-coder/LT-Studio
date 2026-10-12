/* Läsbaserad serverräknad förhandskontroll. Inga slutsatser om fullständigt bokslut. */
(function(root){
'use strict';
function isYear(value){return /^(19|20|21)\d{2}$/.test(String(value));}
function yearDates(year){if(!isYear(year))throw new Error('Välj ett giltigt kalenderår.');return {start:year+'-01-01',end:(Number(year)+1)+'-01-01'};}
function summary(result){
  const errors=Object.entries(result).filter(([,v])=>v.status==='unknown').map(([k])=>k);
  return {reliable:errors.length===0,hasExceptions:Object.values(result).some(v=>v.status==='attention'),unknown:errors};
}
async function scan({companyId,token,year,client}){
  if(typeof companyId!=='string'||!companyId.trim()||typeof token!=='string'||!token.trim()||!client?.from)throw new Error('Inloggad företagssession saknas.');
  const {start,end}=yearDates(year);
  const filter='company_id=eq.'+encodeURIComponent(companyId);
  const bounds='&posting_date=gte.'+start+'&posting_date=lt.'+end;
  const requests={
    journal:()=>client.from('journal_entries',token).countExact(filter+bounds),
    allJournal:()=>client.from('journal_entries',token).countExact(filter),
    allLines:()=>client.from('journal_lines',token).countExact(filter),
    openBatches:()=>client.from('financial_batches',token).countExact(filter+'&status=eq.ready'),
    unplacedBank:()=>client.from('bank_payments',token).countExact(filter+'&status=eq.unmatched&booking_date=lt.'+end)
  };
  const entries=await Promise.all(Object.entries(requests).map(async([key,fetchCount])=>{
    try{
      const value=await fetchCount();
      if(!Number.isSafeInteger(value)||value<0)throw new Error('Exakt antal saknas');
      return [key,{status:(key==='openBatches'||key==='unplacedBank')&&value>0?'attention':'counted',count:value}];
    }catch{return [key,{status:'unknown',count:null}];}
  }));
  const counts=Object.fromEntries(entries);
  return {year:String(year),start,end,counts,...summary(counts),note:'Serverantal bekräftar inte fullständighet, saldo, kontorader för valt år eller bokslut.'};
}
if(typeof module==='object'&&module.exports){module.exports={scan,yearDates};return;}
root.LTYearCloseCounts=Object.freeze({scan,yearDates});
})(globalThis);
