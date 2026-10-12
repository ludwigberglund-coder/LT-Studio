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
function task(kind,title,description,href,label,priority){
 return {kind,title,description,href,label,priority};
}
function renderTask(item){
 const li=doc.createElement('li');
 li.className='book-close-task book-close-task--'+item.kind;
 const title=doc.createElement('span');
 title.className='book-close-task-title';
 title.textContent=(item.kind==='attention'?'Behöver din hjälp: ':item.kind==='unknown'?'Kunde inte kontrolleras: ':'Nästa steg: ')+item.title;
 li.append(title);
 // Link targets are fixed by the application, never accepted from RPC results.
 if(item.href&&allowedLinks.has(item.href)){
  const link=doc.createElement('a');
  link.href=item.href;
  link.textContent=item.label||'Öppna området';
  li.append(link);
 }
 if(item.description){
  const description=doc.createElement('p');
  description.textContent=item.description;
  li.append(description);
 }
 actions.append(li);
}
function planFromResults(results){
 const [counts,ledger,evidence,cutoff]=results;
 const attention=[],unknown=[],next=[];
 let periodEmpty=false;
 const add=(list,title,description,href,label,priority)=>{
  list.push(task(list===attention?'attention':list===unknown?'unknown':'next',
   title,description,href,label,priority));
 };
 if(counts.status==='fulfilled'&&counts.value?.counts){
  const report=counts.value;
  if(!report.reliable)
   add(unknown,'Några uppgifter gick inte att hämta.',
    'Försök kontrollera igen. Om problemet kvarstår behöver någon hjälpa dig att undersöka underlaget.',null,null,10);
  const journal=report.counts.journal;
  if(journal?.status==='counted'&&journal.count===0){
   periodEmpty=true;
   add(attention,'Inga bokföringsposter hittades för kalenderåret.',
    'Kontrollera att du valde rätt år och att företagets bokföring har lagts in. Ett tomt år betyder inte att bokslutet är klart.',
    './accounting.html','Öppna bokföringen',10);
  }else if(!journal||journal.status==='unknown'||!Number.isSafeInteger(journal.count)){
   if(report.reliable)
    add(unknown,'Antalet bokföringsposter kunde inte bekräftas.',
     'Vi kan inte avgöra om alla poster finns med. Kontrollera uppgifterna igen.',null,null,12);
  }
  if(report.counts.openBatches?.status==='attention')
   add(attention,'Det finns bokföringsunderlag som väntar på godkännande.',
    'Granska de väntande posterna innan någon försöker färdigställa bokslutet.',
    './accounting.html','Öppna bokföringen',20);
  if(report.counts.unplacedBank?.status==='attention')
   add(attention,'Vissa betalningar har ännu inte kopplats till rätt händelse.',
    'Gå till banken och välj vad respektive betalning gäller. Systemet ska inte gissa.',
    './bank.html','Öppna bankhändelser',30);
 }else add(unknown,'Antalet bokföringsposter kunde inte kontrolleras.',
  'Förkontrollen saknar ett tillförlitligt underlag för antalen. Försök igen.',null,null,10);
 if(ledger.status==='fulfilled'&&typeof ledger.value?.detected==='boolean'){
  if(ledger.value.detected)
   add(attention,'Vi hittade skillnader i bokföringen som behöver granskas.',
    'De tekniska uppgifterna stämmer inte helt. Öppna bokföringen eller be en redovisningskunnig hjälpa dig.',
    './accounting.html','Öppna bokföringen',5);
  if(!periodEmpty&&ledger.value.counts?.entries==='0'){
   add(attention,'Huvudboken innehåller inga verifikationer för kalenderåret.',
    'Det behöver utredas om året är korrekt och om historiken saknas. Ett nollresultat är inte ett godkänt bokslut.',
    './accounting.html','Öppna bokföringen',11);
  }
 }else add(unknown,'Bokföringens kvalitet kunde inte kontrolleras.',
  'Vi kan inte bekräfta att posternas uppgifter är korrekta. Försök igen.',null,null,15);
 if(evidence.status==='fulfilled'&&evidence.value?.areas){
  const a=evidence.value.areas;
  if(a.bank?.needsReview)
   add(attention,'Några bankhändelser behöver kompletteras eller granskas.',
    'Kontrollera händelser som ännu inte har tillräckligt underlag.',
    './bank.html','Öppna banken',25);
  if(a.customer?.needsReview)
   add(attention,'Några kundfakturor saknar underlag eller behöver granskas.',
    'Kontrollera fakturornas uppgifter och komplettera dokument där det behövs.',
    './invoices.html','Öppna kundfakturor',40);
  if(a.supplier?.needsReview)
   add(attention,'Några leverantörsfakturor behöver kompletteras.',
    'Se över underlag och uppgifter så att kostnaderna går att kontrollera.',
    './payables.html','Öppna leverantörsfakturor',45);
  if(!a.bank||!a.customer||!a.supplier)
   add(unknown,'Alla bank- och fakturaområden kunde inte bedömas.',
    'Något underlag saknas i kontrollresultatet. Försök igen.',null,null,20);
 }else add(unknown,'Bank- och fakturaunderlagen kunde inte kontrolleras.',
  'De här uppgifterna behöver hämtas eller kontrolleras separat.',null,null,20);
 if(cutoff.status==='fulfilled'&&typeof cutoff.value?.hasWarnings==='boolean'){
  if(cutoff.value.hasWarnings)
   add(attention,'Det kan finnas fel i äldre bokföringsposter.',
    'Historiska datum eller kontorader behöver undersökas innan bokslutet kan godkännas.',
    './accounting.html','Öppna bokföringen',16);
 }else add(unknown,'Historiska kontorörelser kunde inte kontrolleras.',
  'Vi kan inte intyga att historiken är komplett. Försök igen.',null,null,25);
 // These prerequisites have NOT been verified by the current read-only RPCs.
 add(next,'Återstår innan bokslutet kan godkännas.',
  'Bankkontoutdrag, ingående balans, faktisk räkenskapsperiod och andra tillämpliga uppgifter behöver fortfarande stämmas av. Detta görs inte av den här förkontrollen.',
  null,null,100);
 if(attention.length===0&&unknown.length===0){
  add(next,'Inga tydliga tekniska avvikelser hittades i förkontrollen.',
   'Det innebär endast att just dessa läsbara indikatorer inte visade något problem. Bokslutet är ännu inte verifierat.',
   null,null,90);
 }
 const byPriority=(a,b)=>a.priority-b.priority;
 return {attention:attention.sort(byPriority),unknown:unknown.sort(byPriority),next:next.sort(byPriority)};
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
  const plan=planFromResults([counts,ledger,evidence,cutoff]);
  for(const item of [...plan.attention,...plan.unknown,...plan.next])renderTask(item);
  const questions=plan.attention.length,unknown=plan.unknown.length;
  status.textContent='Förkontroll för '+year+': '+(questions===1?'1 möjlig fråga':questions+' möjliga frågor')+' att hantera, '+(unknown===1?'1 kontroll':unknown+' kontroller')+' utan säkert resultat. Bokslutet är inte verifierat.';
 }catch{
  if(ticket!==request)return;
  actions.replaceChildren();
  renderTask(task('unknown','Kontrollen kunde inte genomföras.',
   'Kontrollera anslutningen och din aktiva företagssession och försök igen.',null,null,0));
  status.textContent='Förkontrollen kunde inte slutföras. Bokslutet är inte verifierat.';
 }finally{
  if(ticket===request)button.disabled=false;
 }
});
})(globalThis);
