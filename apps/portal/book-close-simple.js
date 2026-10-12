/* One-click read-only preflight. Never an AI claim, reconciliation or attestation. */
(function(root){
'use strict';
const start=root.document.getElementById('book-close-start');
const status=root.document.getElementById('book-close-simple-status');
const actions=root.document.getElementById('book-close-simple-actions');
const form=root.document.getElementById('year-close-form');
if(!start||!status||!actions||!form)return;
let request=0;
const issue=(message)=>{const li=root.document.createElement('li');li.textContent=message;actions.append(li);};
start.addEventListener('click',async()=>{
 const id=++request;actions.replaceChildren();start.disabled=true;
 status.textContent='Kontrollerar företagets befintliga bokföring och underlag…';
 try{
  const session=await root.LTSupabaseUat.context();
  if(!session?.authenticated||!session.company?.id||!session.accessToken)throw Error('SESSION');
  const companyId=session.company.id;
  const year=root.document.getElementById('year-close-year').value;
  const args={companyId,year,token:session.accessToken,client:root.LTSupabase};
  const [counts,ledger,evidence,cutoff]=await Promise.allSettled([
   root.LTYearCloseCounts.scan(args),root.LTBookCloseLedger.inspect(args),
   root.LTBookCloseEvidence.inspect(args),root.LTBookCloseCutoff.inspect(args)
  ]);
  const fresh=await root.LTSupabaseUat.context();
  if(id!==request||!fresh?.authenticated||fresh.company?.id!==companyId||
     root.document.getElementById('year-close-year').value!==year)throw Error('STALE');
  let warningCount=0,unknownCount=0;
  const warn=msg=>{warningCount++;issue(msg);};
  const unknown=msg=>{unknownCount++;issue(msg);};
  if(counts.status==='fulfilled'){
   const c=counts.value;
   if(!c.reliable)unknown('Några uppgifter kunde inte hämtas. Försök igen eller be om hjälp.');
   if(c.counts.openBatches?.status==='attention')warn('Det finns bokföringsförslag som väntar på granskning.');
   if(c.counts.unplacedBank?.status==='attention')warn('Det finns betalningar som ännu inte har kopplats till rätt händelse.');
  }else unknown('Systemet kunde inte läsa alla bokföringsposter.');
  if(ledger.status==='fulfilled'){
   if(ledger.value.detected)warn('Systemet hittade skillnader i bokföringen som behöver granskas.');
  }else unknown('Systemet kunde inte kontrollera bokföringens kvalitet.');
  if(evidence.status==='fulfilled'){
   const a=evidence.value.areas;
   if(a.bank.needsReview)warn('Vissa bankhändelser behöver kompletteras eller granskas.');
   if(a.customer.needsReview)warn('Några kundfakturor saknar underlag eller behöver kontrolleras.');
   if(a.supplier.needsReview)warn('Några leverantörsfakturor behöver kompletteras eller granskas.');
  }else unknown('Systemet kunde inte kontrollera alla faktura- och bankunderlag.');
  if(cutoff.status==='fulfilled'){
   if(cutoff.value.hasWarnings)warn('Äldre bokföringsposter kan innehålla uppgifter som behöver rättas.');
  }else unknown('Systemet kunde inte räkna fram alla kontorörelser.');
  if(!warningCount&&!unknownCount)issue('Inga avvikelser hittades i de kontroller som kunde köras. Externa saldon, ingående balans och övriga bokslutssteg återstår.');
  issue('Innan bokslutet kan godkännas behöver bankkontoutdrag, fakturaskulder, tidigare ingående balans och övriga tillämpliga uppgifter verifieras.');
  status.textContent='Förkontroll genomförd: '+warningCount+' möjliga avvikelser, '+unknownCount+' kontroller med okänt resultat. Bokslut är inte verifierat.';
 }catch{
  if(id===request){actions.replaceChildren();issue('Det gick inte att kontrollera uppgifterna. Försök igen. Bokslut är inte verifierat.');status.textContent='Förkontrollen kunde inte slutföras.';}
 }finally{if(id===request)start.disabled=false;}
});
})(globalThis);
