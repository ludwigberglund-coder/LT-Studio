/* P1C: A review list, not an approval, reconciliation or financial write. */
(function(root){
'use strict';
const form=document.getElementById('year-close-form');
const list=document.getElementById('book-close-evidence-results');
const message=document.getElementById('book-close-evidence-message');
if(!form||!list||!message)return;
const labels={
 bank:{
  period_records:'Bankhändelser med datum under perioden',
  unmatched:'Oplacerade bankhändelser',
  pending_proposal:'Bankhändelser med väntande förslag',
  missing_status:'Bankhändelser utan tydlig status',
  non_sek:'Bankhändelser som inte är i SEK',
  zero_or_missing_amount:'Bankhändelser utan belopp eller med nollbelopp',
  duplicate_external_id_groups:'Grupper med återanvänt externt bank-ID',
  undated_company_records:'Bankhändelser utan datum (alla år)'
 },
 customer:{
  period_posted_invoices:'Bokföringsdaterade kundfakturor i perioden',
  missing_pdf_reference:'Kundfakturor utan dokumentreferens',
  zero_or_missing_amount:'Kundfakturor med ofullständiga belopp',
  undated_invoices_with_period_invoice_date:'Kundfakturor med fakturadatum i perioden men utan bokföringsdatum'
 },
 supplier:{
  period_posted_invoices:'Bokföringsdaterade leverantörsfakturor i perioden',
  missing_pdf_reference:'Leverantörsfakturor utan dokumentreferens',
  missing_liability_reference:'Leverantörsfakturor utan referens till skuldverifikation',
  non_sek:'Leverantörsfakturor som inte är i SEK',
  zero_or_missing_amount:'Leverantörsfakturor med ofullständiga belopp',
  undated_invoices_with_period_invoice_date:'Leverantörsfakturor med fakturadatum i perioden men utan bokföringsdatum'
 }
};
const headings={bank:'BANK',customer:'KUNDFORDRINGAR',supplier:'LEVERANTÖRSSKULDER'};
const basicFields={bank:'period_records',customer:'period_posted_invoices',supplier:'period_posted_invoices'};
let requestNo=0;
if(new URLSearchParams(location.search).get('demo')==='1')
  message.textContent='Kontrollen av underlag kräver inloggning. Demoläget visar inga riktiga bank- eller fakturauppgifter.';
form.addEventListener('submit',async function(){
 const ticket=++requestNo;
 list.hidden=true;
 list.replaceChildren();
 if(new URLSearchParams(location.search).get('demo')==='1')return;
 const year=String(document.getElementById('year-close-year').value);
 message.textContent='Kontrollerar bank- och fakturaunderlag på servern…';
 try{
   const session=await root.LTSupabaseUat.context();
   if(!session?.authenticated||!session.company?.id||!session.accessToken)throw Error('SESSION_REQUIRED');
   const companyId=session.company.id;
   const data=await root.LTBookCloseEvidence.inspect({
     companyId,token:session.accessToken,year,client:root.LTSupabase
   });
   const fresh=await root.LTSupabaseUat.context();
   if(!fresh?.authenticated||fresh.company?.id!==companyId||
      document.getElementById('year-close-year').value!==year||ticket!==requestNo)
     throw Error('SESSION_OR_PERIOD_CHANGED');
   for(const [area,entry] of Object.entries(data.areas)){
     const head=document.createElement('dt');
     head.className='book-close-evidence-subheading';
     head.textContent=headings[area]+' – underlag inte avstämda';
     const empty=document.createElement('dd');empty.className='book-close-evidence-subheading';
     empty.textContent=entry.needsReview?'Granska poster':'Inga indikatorer i de kontrollerade fälten';
     list.append(head,empty);
     for(const [key,description] of Object.entries(labels[area])){
       const dt=document.createElement('dt');dt.textContent=description;
       const count=BigInt(entry.counts[key]);
       const dd=document.createElement('dd');
       dd.textContent=new Intl.NumberFormat('sv-SE').format(count);
       if(key!==basicFields[area]&&count>0n)dd.className='year-close-flag';
       list.append(dt,dd);
     }
   }
   list.hidden=false;
   message.textContent='Underlagen är kontrollerade för möjliga luckor. Bank, kundfordringar och leverantörsskulder är fortfarande INTE avstämda.';
 }catch{
   if(ticket!==requestNo)return;
   message.textContent='Underlagskontrollen kunde inte verifieras. Inga bank- eller reskontrasaldon är avstämda.';
 }
});
})(globalThis);
