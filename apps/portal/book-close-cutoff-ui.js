/* Bokslut P1D: display only. The snapshot is never an approval or adjustment. */
(function(root){
'use strict';
const form=document.getElementById('year-close-form');
const block=document.getElementById('book-close-cutoff-results');
const rows=document.getElementById('book-close-cutoff-rows');
const summary=document.getElementById('book-close-cutoff-coverage');
const status=document.getElementById('book-close-cutoff-message');
if(!form||!block||!rows||!summary||!status)return;
const labels={'1510':'1510 Kundfordringar','1630':'1630 Skattekonto','1930':'1930 Bank','1940':'1940 Bank','2440':'2440 Leverantörsskulder','2650':'2650 Moms'};
let request=0;
function ore(value){
 const x=BigInt(value),abs=x<0n?-x:x;
 return (x<0n?'−':'')+new Intl.NumberFormat('sv-SE').format(abs/100n)+','+
   String(abs%100n).padStart(2,'0')+' kr';
}
if(new URLSearchParams(location.search).get('demo')==='1')
  status.textContent='Kontrollen kräver inloggning i ett testföretag.';
form.addEventListener('submit',async function(){
 const id=++request;
 rows.replaceChildren();
 block.hidden=true;
 const year=String(document.getElementById('year-close-year').value);
 if(new URLSearchParams(location.search).get('demo')==='1')return;
 status.textContent='Hämtar bokföringens historiska rörelser…';
 try{
   const first=await root.LTSupabaseUat.context();
   if(!first?.authenticated||!first.company?.id||!first.accessToken)throw Error('SESSION');
   const report=await root.LTBookCloseCutoff.inspect({
     companyId:first.company.id,token:first.accessToken,
     year,client:root.LTSupabase
   });
   const second=await root.LTSupabaseUat.context();
   if(id!==request||!second?.authenticated||second.company?.id!==first.company.id||
      String(document.getElementById('year-close-year').value)!==year)
     throw Error('STALE');
   for(const [account,label] of Object.entries(labels)){
     const info=report.accounts[account];
     const tr=document.createElement('tr');
     const heading=document.createElement('th');
     heading.scope='row';heading.textContent=label;tr.append(heading);
     for(const key of ['priorNetOre','periodNetOre','throughEndNetOre']){
       const td=document.createElement('td');
       td.textContent=ore(info[key]);tr.append(td);
     }
     rows.append(tr);
   }
   summary.textContent='Tidigare verifikationer: '+new Intl.NumberFormat('sv-SE').format(BigInt(report.counts.earlier_entries))+
     '. Under kalenderåret: '+new Intl.NumberFormat('sv-SE').format(BigInt(report.counts.period_entries))+
     '. Första kända bokföringsdatum: '+(report.counts.firstKnownPostingDate||'okänt')+'.';
   block.hidden=false;
   status.textContent=report.hasWarnings
     ?'Möjliga kvalitetsproblem: odaterade verifikationer eller ogiltiga kontorader. Beloppen är preliminära och inte avstämda.'
     :'Bokförda rörelser är beräknade, men tidigare historik och externa underlag är fortfarande inte verifierade.';
 }catch{
   if(id!==request)return;
   status.textContent='Kontrollen kunde inte verifieras. Inget saldo har godkänts.';
 }
});
})(globalThis);
