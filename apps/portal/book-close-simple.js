/* Read-only annual preflight. This is not AI advice, financial reconciliation or an attestation. */
(function(root){
'use strict';
const doc=root.document;
const button=doc.getElementById('book-close-start');
const status=doc.getElementById('book-close-simple-status');
const actions=doc.getElementById('book-close-simple-actions');
const yearInput=doc.getElementById('book-close-simple-year');
const detailYear=doc.getElementById('year-close-year');
if(!button||!status||!actions||!yearInput||!detailYear)return;
let request=0;
const allowedYears=/^(19|20|21)\d{2}$/;
const allowedLinks=new Set(['./bank.html','./invoices.html','./payables.html','./accounting.html','./reports.html','./documents.html']);
function addAction(message,href,label){
 const item=doc.createElement('li');
 const description=doc.createElement('span');
 description.textContent=message;
 item.append(description);
 if(href&&allowedLinks.has(href)){
  const link=doc.createElement('a');
  link.href=href;
  link.textContent=label||'Visa vad du kan göra';
  item.append(link);
 }
 actions.append(item);
}
function resetMessage(){
 ++request;
 button.disabled=false;
 actions.replaceChildren();
 status.textContent='Året har ändrats. Starta förkontrollen igen.';
}
yearInput.value=detailYear.value||String(new Date().getFullYear());
detailYear.value=yearInput.value;
yearInput.addEventListener('input',()=>{detailYear.value=yearInput.value;resetMessage();});
detailYear.addEventListener('input',()=>{yearInput.value=detailYear.value;resetMessage();});
if(new URLSearchParams(root.location?.search||'').get('demo')==='1'){
 button.disabled=true;
 status.textContent='Logga in i ett testföretag för att köra förkontrollen.';
 return;
}
button.addEventListener('click',async()=>{
 const year=String(yearInput.value);
 if(!allowedYears.test(year)||Number(year)>2198){
  actions.replaceChildren();
  status.textContent='Välj ett giltigt kalenderår mellan 1900 och 2198.';
  return;
 }
 const ticket=++request;
 actions.replaceChildren();
 button.disabled=true;
 status.textContent='Systemet läser bokföringen och söker efter sådant som behöver din hjälp…';
 try{
  const session=await root.LTSupabaseUat.context();
  if(!session?.authenticated||!session.company?.id||!session.accessToken)throw Error('SESSION_REQUIRED');
  const companyId=session.company.id;
  const args={companyId,year,token:session.accessToken,client:root.LTSupabase};
  const [counts,ledger,evidence,cutoff]=await Promise.allSettled([
   root.LTYearCloseCounts.scan(args),
   root.LTBookCloseLedger.inspect(args),
   root.LTBookCloseEvidence.inspect(args),
   root.LTBookCloseCutoff.inspect(args)
  ]);
  const fresh=await root.LTSupabaseUat.context();
  if(ticket!==request||!fresh?.authenticated||fresh.company?.id!==companyId||
     yearInput.value!==year||detailYear.value!==year)throw Error('STALE_SESSION_OR_YEAR');
  let questions=0,unknown=0;
  function needsHelp(message,href,label){questions++;addAction(message,href,label);}
  function notChecked(message){unknown++;addAction(message);}
  if(counts.status==='fulfilled'){
   const data=counts.value;
   if(!data.reliable)notChecked('Några bokföringsuppgifter kunde inte hämtas. Försök igen eller be om hjälp.');
   if(data.counts.openBatches?.status==='attention')
    needsHelp('Det finns bokföringsunderlag som väntar på godkännande.','./accounting.html','Öppna bokföringen');
   if(data.counts.unplacedBank?.status==='attention')
    needsHelp('Vissa betalningar har ännu inte kopplats till rätt händelse.','./bank.html','Öppna bankhändelser');
  }else notChecked('Antalet bokföringsposter kunde inte kontrolleras.');
  if(ledger.status==='fulfilled'){
   if(ledger.value.detected)needsHelp('Vi hittade skillnader i bokföringen som behöver granskas.','./accounting.html','Öppna bokföringen');
  }else notChecked('Bokföringens kvalitet kunde inte kontrolleras.');
  if(evidence.status==='fulfilled'){
   const areas=evidence.value.areas;
   if(areas.bank.needsReview)needsHelp('Några bankhändelser behöver kompletteras eller granskas.','./bank.html','Öppna banken');
   if(areas.customer.needsReview)needsHelp('Några kundfakturor saknar underlag eller behöver granskas.','./invoices.html','Öppna kundfakturor');
   if(areas.supplier.needsReview)needsHelp('Några leverantörsfakturor behöver kompletteras.','./payables.html','Öppna leverantörsfakturor');
  }else notChecked('Bank- och fakturaunderlagen kunde inte kontrolleras.');
  if(cutoff.status==='fulfilled'){
   if(cutoff.value.hasWarnings)needsHelp('Det kan finnas fel i tidigare bokföringsposter som behöver granskas.','./accounting.html','Öppna bokföringen');
  }else notChecked('Historiska kontorörelser kunde inte kontrolleras.');
  if(questions===0&&unknown===0)
   addAction('Inga tydliga avvikelser hittades i de kontrollerade posterna. Det innebär inte att bokslutet är klart.');
  addAction('Bankkontoutdrag, ingående balans och företagets verkliga räkenskapsår har ännu inte stämts av. En redovisningskunnig kan behöva kontrollera dessa uppgifter.');
  status.textContent='Förkontroll för '+year+': '+questions+' möjliga frågor att hantera, '+unknown+' kontroller utan säkert resultat. Bokslutet är inte verifierat.';
 }catch{
  if(ticket!==request)return;
  actions.replaceChildren();
  addAction('Kontrollen kunde inte genomföras. Kontrollera anslutningen och den aktiva företagssessionen och försök igen.');
  status.textContent='Förkontrollen kunde inte slutföras. Bokslutet är inte verifierat.';
 }finally{
  if(ticket===request)button.disabled=false;
 }
});
})(globalThis);
