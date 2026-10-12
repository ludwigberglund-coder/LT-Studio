/* Visning utan ekonomiska skrivningar eller grön slutattest. */
(function(root){
'use strict';
const form=document.getElementById('year-close-form');
const list=document.getElementById('year-ledger-results');
const message=document.getElementById('year-ledger-message');
if(!form||!list||!message)return;
let currentRequest=0;
const labels={
  entries:'Verifikationer under perioden',
  lines:'Kontorader under perioden',
  entries_without_two_lines:'Verifikationer med färre än två kontorader',
  unbalanced_entries:'Verifikationer där debet och kredit skiljer sig',
  invalid_lines:'Kontorader med felaktigt konto eller belopp',
  duplicate_number_groups:'Grupper med dubbla verifikationsnummer',
  orphan_company_lines_all_dates:'Kontorader utan giltig verifikation (alla år)'
};
const accountLabels={'1510':'Kundfordringar 1510','1630':'Skattekonto 1630','1930':'Bank 1930','1940':'Bank 1940','2440':'Leverantörsskulder 2440','2650':'Momsredovisning 2650'};
function money(value){
  const ore=BigInt(value),abs=ore<0n?-ore:ore;
  return (ore<0n?'−':'')+new Intl.NumberFormat('sv-SE').format(abs/100n)+','+String(abs%100n).padStart(2,'0')+' kr';
}
function row(label,value,attention){
  const dt=document.createElement('dt');dt.textContent=label;
  const dd=document.createElement('dd');dd.textContent=value;
  if(attention)dd.className='year-close-flag';
  list.append(dt,dd);
}
form.addEventListener('submit',async()=>{
  const requestId=++currentRequest;
  list.hidden=true;list.replaceChildren();
  if(new URLSearchParams(location.search).get('demo')==='1'){
    message.textContent='Kontrollen är avstängd i demoläge.';
    return;
  }
  message.textContent='Kontrollerar huvudboken på servern…';
  try{
    const session=await root.LTSupabaseUat.context();
    if(!session?.authenticated||!session.company?.id||!session.accessToken)throw new Error('SESSION_REQUIRED');
    const companyId=session.company.id;
    const report=await root.LTBookCloseLedger.inspect({
      companyId,token:session.accessToken,year:document.getElementById('year-close-year').value,client:root.LTSupabase
    });
    const still=await root.LTSupabaseUat.context();
    if(still?.company?.id!==companyId||!still?.authenticated)throw new Error('SESSION_CHANGED');
    if(requestId!==currentRequest)return;
    for(const [key,label] of Object.entries(labels)){
      const amount=BigInt(report.counts[key]);
      row(label,new Intl.NumberFormat('sv-SE').format(amount),!['entries','lines'].includes(key)&&amount>0n);
    }
    row('Periodens debet',money(report.periodTotals.debit),false);
    row('Periodens kredit',money(report.periodTotals.credit),BigInt(report.periodTotals.debit)!==BigInt(report.periodTotals.credit));
    for(const [account,label] of Object.entries(accountLabels)){
      row(label+' – periodens nettorrörelse',money(report.accountMovements[account]||'0'),false);
    }
    list.hidden=false;
    message.textContent=report.detected
      ?'Tekniska avvikelser upptäckta. Granska dessa innan bokslut.'
      :'Inga tekniska avvikelser hittades i de lästa posterna. Bokslut och separata saldokontroller återstår.';
  }catch{
    if(requestId!==currentRequest)return;
    message.textContent='Serverkontrollen är inte tillgänglig eller kan inte verifieras. Bokslutet är inte avstämt.';
  }
});
})(globalThis);
