const app=document.getElementById('invoices-app');
const Demo=globalThis.RollandsDemoScenario;
const Invoice=globalThis.RollandsInvoice;
const Money=globalThis.RollandsMoney;
const Pdf=globalThis.RollandsInvoicePdf;
const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
let company={},view='list',draft=null,preview=null,previewRecord=null,busy=false,dirty=false,search='';
const copy=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount=value=>Money.formatSek(Number(value||0));
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function plusDays(value,days){const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+Number(days));return d.toISOString().slice(0,10);}
function url(path){return path+(isDemo?(path.includes('?')?'&':'?')+'demo=1':'');}
function customers(){
  const state=Demo.state(),map=new Map();
  for(const i of state.customerInvoices||[])if(!map.has(i.customerNumber))map.set(i.customerNumber,{customerNumber:i.customerNumber,name:i.customerName,paymentTermsDays:30});
  for(const c of state.customers||[])map.set(c.customerNumber,c);
  return [...map.values()];
}
function accounts(){return Invoice.revenueAccounts(Demo.state().invoiceRevenueAccounts||[]);}
function accountOptions(value=''){return '<option value="">Välj intäktskonto</option>'+accounts().map(a=>`<option value="${esc(a.number)}" ${a.number===value?'selected':''}>${esc(a.number)} · ${esc(a.name)}</option>`).join('');}
function freshDraft(){
  const saved=Demo.state().invoiceDraft;if(saved)return copy(saved);
  const pref=Demo.state().invoiceDefaults||{};
  return {
    customerNumber:'',buyer:{name:'',address:'',orgNumber:'',vatNumber:'',phone:'',email:''},
    seller:{name:company.legalName||'',address:company.address?.full||'',orgNumber:company.orgNumber||'',vatNumber:company.vatNumber||'',phone:company.contact?.phone||'',email:company.contact?.email||'',website:'rollands.se',registeredOffice:company.registeredOffice||'',bankgiro:'',plusgiro:'',iban:'',bic:'',swish:'',taxStatus:'',...(pref.seller||{})},
    invoiceDate:today(),postingDate:today(),dueDate:plusDays(today(),30),deliveryDate:today(),paymentTermsDays:30,currency:'SEK',
    ourReference:'',yourReference:'',orderNumber:'',ocr:'',interestText:'',paymentTermsText:'',deliveryTerms:'',deliveryMethod:'',deliveryAddress:'',notes:'',internalNotes:'',taxExemptionReason:'',roundToKrona:false,
    lines:[blankLine()],freight:{amount:'0,00',vatRate:'25',revenueAccount:''},administration:{amount:'0,00',vatRate:'25',revenueAccount:''}
  };
}
function blankLine(){return {articleNumber:'',description:'',quantity:'1',unit:'st',unitPrice:'0,00',discountPercent:'0',vatRate:'25',revenueAccount:''};}
function chooseCustomer(number){
  const c=customers().find(c=>c.customerNumber===number);draft.customerNumber=number;if(!c)return;
  draft.buyer={name:c.name||'',address:typeof c.address==='string'?c.address:(c.address?.full||''),orgNumber:c.orgNumber||'',vatNumber:c.vatNumber||'',email:c.email||'',phone:c.phone||''};
  draft.paymentTermsDays=c.paymentTermsDays??30;draft.dueDate=plusDays(draft.invoiceDate,draft.paymentTermsDays);
}
function get(name){return name.split('.').reduce((value,key)=>value?.[key],draft);}
function set(name,value){const parts=name.split('.');if(parts.length===1)draft[name]=value;else draft[parts[0]][parts[1]]=value;}
function field(label,name,options={}){
  const v=get(name)??'',required=options.required?'required':'',wide=options.wide?'wide':'';
  if(options.textarea)return `<label class="${wide}">${esc(label)}${options.required?' *':''}<textarea name="${name}" rows="${options.rows||3}" maxlength="${options.max||600}" ${required}>${esc(v)}</textarea></label>`;
  return `<label class="${wide}">${esc(label)}${options.required?' *':''}<input name="${name}" type="${options.type||'text'}" value="${esc(v)}" maxlength="${options.max||120}" ${required} ${options.type==='number'?'min="0" max="365" step="1"':''}></label>`;
}
function section(title,body){return `<details class="invoice-section" open><summary>${title}</summary><div class="invoice-section-body">${body}</div></details>`;}
function vatOptions(value){return [25,12,6,0].map(v=>`<option value="${v}" ${Number(value)===v?'selected':''}>${v} %</option>`).join('');}
function lineHtml(row,index){
  const input=(label,key,type='text')=>`<label>${label}<input data-row-field="${key}" value="${esc(row[key])}" type="${type}" ${['quantity','unitPrice','discountPercent'].includes(key)?'inputmode="decimal"':''} ${['description','quantity','unit','unitPrice'].includes(key)?'required':''} maxlength="${key==='articleNumber'?60:120}"></label>`;
  return `<div class="invoice-line-editor" data-row="${index}"><div class="invoice-line-head"><h3>Fakturarad ${index+1}</h3><button class="button ghost small" type="button" data-remove-row="${index}" ${draft.lines.length===1?'disabled':''}>Ta bort rad</button></div><div class="invoice-grid invoice-line-fields">${input('Artikelnummer','articleNumber')}<label class="description-field">Benämning / beskrivning *<textarea data-row-field="description" maxlength="1200" rows="2" required>${esc(row.description)}</textarea></label>${input('Antal *','quantity')}${input('Enhet *','unit')}${input('À-pris exkl. moms, SEK *','unitPrice')}${input('Rabatt, %','discountPercent')}<label>Momssats<select data-row-field="vatRate">${vatOptions(row.vatRate)}</select></label><label class="account-field">Intäktskonto för denna rad *<select data-revenue-select data-row-field="revenueAccount" required>${accountOptions(row.revenueAccount)}</select></label></div></div>`;
}
function feeHtml(key,label){const row=draft[key];return `<div class="invoice-grid"><label>${label}, exkl. moms (SEK)<input name="${key}.amount" inputmode="decimal" value="${esc(row.amount)}"></label><label>Moms för ${label.toLowerCase()}<select name="${key}.vatRate">${vatOptions(row.vatRate)}</select></label><label class="wide">Intäktskonto för ${label.toLowerCase()} (krävs om avgiften är större än noll)<select name="${key}.revenueAccount" data-revenue-select>${accountOptions(row.revenueAccount)}</select></label></div>`;}
function editor(){
  const list=customers();
  return `<div class="invoice-toolbar"><div><span class="eyebrow">Fakturautställning</span><h2>Ny kundfaktura</h2><p>Fyll i underlaget, välj intäktskonto per rad och granska den riktiga PDF-fakturan före bokföring. Stjärna markerar obligatoriska uppgifter.</p></div><button class="button ghost" data-action="list">Till fakturalistan</button></div><form id="invoice-form">
  ${section('1. Mottagare & kund',`<div class="invoice-grid"><label class="wide">Kund *<select name="customerNumber" required><option value="">Välj kund</option>${list.map(c=>`<option value="${esc(c.customerNumber)}" ${c.customerNumber===draft.customerNumber?'selected':''}>${esc(c.customerNumber)} · ${esc(c.name)}</option>`).join('')}</select></label>${field('Mottagarens namn','buyer.name',{required:true})}${field('Mottagarens organisationsnummer','buyer.orgNumber')}${field('Fakturaadress, postnummer och ort','buyer.address',{required:true,textarea:true,wide:true,max:500})}${field('Mottagarens VAT-nummer','buyer.vatNumber')}${field('Mottagarens e-post','buyer.email',{type:'email'})}${field('Mottagarens telefon','buyer.phone')}</div><p class="invoice-help">Adress och kontaktuppgifter kan kompletteras för just denna faktura. En bokförd faktura behåller sin ursprungliga information.</p>`)}
  ${section('2. Datum, referenser & leverans',`<div class="invoice-grid">${field('Fakturadatum','invoiceDate',{required:true,type:'date'})}${field('Bokföringsdatum','postingDate',{required:true,type:'date'})}${field('Förfallodatum','dueDate',{required:true,type:'date'})}${field('Leveransdatum / utförandedatum','deliveryDate',{type:'date'})}${field('Betalningsvillkor, dagar','paymentTermsDays',{type:'number',required:true})}${field('Betalningsvillkor, tilläggstext','paymentTermsText')}${field('Vår referens','ourReference')}${field('Er referens','yourReference')}${field('Ordernummer','orderNumber')}${field('OCR / betalningsreferens (tomt = fakturanumret)','ocr',{max:80})}${field('Dröjsmålsränta / villkor i text','interestText',{max:600})}${field('Leveransvillkor','deliveryTerms')}${field('Leveranssätt','deliveryMethod')}${field('Avvikande leveransadress','deliveryAddress',{textarea:true,wide:true,max:600})}</div><p class="invoice-help">Fakturanumret tilldelas automatiskt som nästa unika sexsiffriga nummer vid bokföring. Valuta: SEK. Ränta anges enligt avtal; inget räntekrav skickas från demon.</p>`)}
  ${section('3. Fakturarader & valfri intäktskontering',`<p class="invoice-help"><strong>Ni väljer intäktskonto själva för varje rad.</strong> Olika rader kan använda olika konton. Moms bokförs separat efter vald momssats. <a href="${url('./accounts.html')}" target="_blank" rel="noopener">Öppna kontoplan / lägg till eget intäktskonto</a>.</p>${draft.lines.map(lineHtml).join('')}<button class="button ghost" type="button" data-action="add-row">+ Lägg till fakturarad</button>`)}
  ${section('4. Avgifter, momsfrihet & öresutjämning',`${feeHtml('administration','Expeditionsavgift')}<hr>${feeHtml('freight','Frakt')}<hr><div class="invoice-grid">${field('Förklaring / rättslig grund vid 0 % moms','taxExemptionReason',{textarea:true,wide:true,max:1000})}<label class="wide checkbox-label"><input name="roundToKrona" type="checkbox" ${draft.roundToKrona?'checked':''}> Avrunda slutsumman till hela kronor (öresutjämning visas separat)</label></div><p class="invoice-help">Avgifter blir egna fakturarader och räknas med exakt en gång. Öresutjämning bokförs separat på 3740.</p>`)}
  ${section('5. Avsändare, kontakt & betalningsuppgifter',`<div class="invoice-grid">${field('Avsändarens juridiska namn','seller.name',{required:true,max:160})}${field('Organisationsnummer','seller.orgNumber',{required:true})}${field('Avsändarens adress, postnummer och ort','seller.address',{textarea:true,wide:true,required:true,max:500})}${field('VAT-nummer / momsregistreringsnummer','seller.vatNumber',{required:true})}${field('Styrelsens säte','seller.registeredOffice')}${field('Telefon','seller.phone')}${field('E-post','seller.email',{type:'email'})}${field('Webbplats','seller.website',{max:300})}${field('Skattestatus, exempelvis godkänd för F-skatt','seller.taxStatus')}${field('Bankgiro','seller.bankgiro')}${field('Plusgiro','seller.plusgiro')}${field('IBAN','seller.iban')}${field('SWIFT / BIC','seller.bic')}${field('Swish','seller.swish')}</div><p class="invoice-help"><strong>Minst ett betalningssätt måste anges.</strong> Okända bankuppgifter fylls inte i automatiskt. Använd bara fiktiva uppgifter i denna öppna demo.</p>`)}
  ${section('6. Meddelanden & interna uppgifter',`<div class="invoice-grid">${field('Meddelande på kundfakturan','notes',{textarea:true,wide:true,max:3000})}${field('Interna anteckningar – endast på internt underlag','internalNotes',{textarea:true,wide:true,max:3000})}</div>`)}
  <div class="invoice-panel-footer"><div class="invoice-actions"><button class="button ghost" type="button" data-action="save-draft">Spara utkast</button><button class="button ghost" type="button" data-action="preview-draft">Granska faktura / PDF</button><button class="button" type="submit">Skapa och bokför faktura</button></div><span class="invoice-muted">Inget skickas till kund eller bank.</span></div></form>`;
}
function readForm(){
  const form=document.getElementById('invoice-form');if(!form)return;
  for(const [name,value] of new FormData(form).entries())if(name!=='roundToKrona')set(name,value);
  draft.roundToKrona=form.elements.roundToKrona.checked;
  draft.lines=[...form.querySelectorAll('[data-row]')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-row-field]')].map(input=>[input.dataset.rowField,input.value])));
}
function input(){
  const value=copy(draft);
  for(const [key,label] of [['administration','Expeditionsavgift'],['freight','Frakt']]){
    const fee=value[key];const ore=Money.parseOre(fee.amount||'0',{allowNegative:false,label});
    if(ore)value.lines.push({kind:key,articleNumber:'',description:label,quantity:'1',unit:'st',unitPrice:fee.amount,discountPercent:'0',vatRate:fee.vatRate,revenueAccount:fee.revenueAccount});
  }
  return value;
}
function listHtml(){
  const records=Demo.section('customerInvoices')||[];
  const filtered=records.filter(r=>(r.invoiceNumber+' '+r.customerName+' '+r.customerNumber).toLocaleLowerCase('sv-SE').includes(search.toLocaleLowerCase('sv-SE')));
  return `<div class="invoice-toolbar"><div><span class="eyebrow">Försäljning</span><h2>Kundfakturor</h2><p>Fullständiga fakturor med sparade originaluppgifter, valda intäktskonton och separat kund-PDF respektive internt underlag.</p></div><button class="button" data-action="new">+ Ny kundfaktura</button></div><input class="invoice-search" type="search" aria-label="Sök fakturor" placeholder="Sök fakturanummer eller kund" value="${esc(search)}"><div class="sales-panel"><div class="table-scroll"><table class="sales-table"><thead><tr><th>Faktura / OCR</th><th>Kund</th><th>Fakturadatum</th><th>Förfallodatum</th><th>Belopp</th><th>Restbelopp</th><th>Åtgärd</th></tr></thead><tbody>${filtered.slice().reverse().map(r=>`<tr><td><b>${esc(r.invoiceNumber)}</b><br>${esc(r.ocr)}</td><td>${esc(r.customerName)}<br><small>${esc(r.customerNumber)}</small></td><td>${esc(r.invoiceDate)}</td><td>${esc(r.dueDate)}</td><td class="money">${amount(r.totalOre)}</td><td class="money">${amount(r.remainingOre)}</td><td><button class="button ghost small" data-preview="${esc(r.id)}">Visa / skriv ut</button></td></tr>`).join('')||'<tr><td colspan="7">Inga fakturor matchar sökningen.</td></tr>'}</tbody></table></div></div>`;
}
function previewHtml(){
  const d=preview;
  return `<div class="invoice-toolbar"><div><span class="eyebrow">Granskning & utskrift</span><h2>Faktura ${esc(d.invoiceNumber)}</h2><p>Kundfakturan innehåller alla externa uppgifter. Hela underlaget lägger dessutom till vald kontering, bokföringsspår och interna anteckningar.</p></div><button class="button ghost" data-action="${previewRecord?'list':'edit'}">${previewRecord?'Till fakturalistan':'Tillbaka till utkast'}</button></div>${d.warnings?.length?`<div class="invoice-alert">${d.warnings.map(esc).join('<br>')}</div>`:''}<div class="invoice-preview-card"><h3>${esc(d.buyer.name)}</h3><div class="invoice-preview-meta"><p><b>Avsändare</b><br>${esc(d.seller.name)}<br>${esc(d.seller.address)}<br>Org.nr: ${esc(d.seller.orgNumber)}<br>VAT: ${esc(d.seller.vatNumber)}</p><p><b>Mottagare</b><br>${esc(d.buyer.name)}<br>${esc(d.buyer.address||'Adress saknas i äldre underlag')}<br>Fakturadatum: ${esc(d.invoiceDate)}<br>Förfallodatum: ${esc(d.dueDate)}<br>OCR: ${esc(d.ocr)}</p></div><div class="table-scroll"><table class="sales-table"><thead><tr><th>Artikel / beskrivning</th><th>Antal</th><th>Enhet</th><th>À-pris</th><th>Moms</th><th>Intäktskonto (internt)</th><th>Netto</th></tr></thead><tbody>${d.lines.map(r=>`<tr><td>${esc(r.articleNumber)}<br>${esc(r.description)}</td><td>${Money.formatQuantity(r.quantityMilli)}</td><td>${esc(r.unit)}</td><td class="money">${amount(r.unitPriceOre)}</td><td>${r.vatRate==null?'Ej specificerad':esc(r.vatRate)+' %'}</td><td><b>${esc(r.revenueAccount||'Saknas i äldre underlag')}</b><br><small>${esc(r.revenueAccountName||'')}</small></td><td class="money">${amount(r.netOre)}</td></tr>`).join('')}</tbody></table></div><div class="invoice-totals"><div><span>Belopp före moms</span><strong>${amount(d.netOre)}</strong></div><div><span>Total moms</span><strong>${amount(d.vatOre)}</strong></div><div><span>Öresutjämning</span><strong>${amount(d.roundingOre)}</strong></div><div><span>Att betala</span><strong>${amount(d.totalOre)}</strong></div></div></div><div class="invoice-panel-footer"><div class="invoice-actions"><button class="button" data-action="download-pdf">Hämta faktura (PDF)</button><button class="button ghost" data-action="print-pdf">Öppna utskriftsvy</button><button class="button ghost" data-action="download-internal">Hämta hela underlaget (PDF)</button></div><p class="invoice-help">Utskriftsvyn öppnar endast PDF-filen, inte menyn eller fakturalistan. Skriv ut från PDF-läsaren med Ctrl+P / Cmd+P. DEMO-markeringen följer med vid utskrift.</p></div>`;
}
function render(){
  app.innerHTML=`<div class="portal"><aside class="sidebar"></aside><section class="main"><header class="topbar"><div><h1>Kundfakturor</h1><p>Ekonomi / Fakturautställning</p></div><span class="user-chip">Demoföretag</span></header><main class="content invoice-workspace"><div class="demo-banner"><b>Demo med fiktiva uppgifter.</b> Fakturor sparas i denna webbläsare. Inga riktiga utskick eller betalningar sker.</div><div id="invoice-alert" class="invoice-alert" role="alert" tabindex="-1" hidden></div>${view==='edit'?editor():view==='preview'?previewHtml():listHtml()}</main></section></div>`;
  if(busy)for(const b of app.querySelectorAll('button'))b.disabled=true;
}
function notify(message){const box=document.getElementById('invoice-alert');if(box){box.textContent=message;box.hidden=false;box.focus();}}
async function outputPdf(internal=false){
  let lines=[];
  if(internal){const entry=(Demo.section('accountingEntries')||[]).find(e=>e.sourceId===previewRecord?.id);lines=entry?.lines||((preview.schemaVersion===2&&preview.lines.every(r=>r.revenueAccount))?Invoice.journalLines(preview):[]);}
  return Pdf.createInvoicePdf(preview,{internal,record:previewRecord||{},journalLines:lines});
}
async function downloadPdf(internal=false,print=false){
  const tab=print?window.open('about:blank','_blank'):null;
  if(print&&!tab)throw new Error('Webbläsaren blockerade utskriftsfönstret. Tillåt popup-fönstret eller välj Hämta faktura (PDF).');
  if(tab)tab.opener=null;
  try{
    const bytes=await outputPdf(internal),blob=new Blob([bytes],{type:'application/pdf'}),href=URL.createObjectURL(blob);
    if(tab)tab.location.href=href;
    else{const a=document.createElement('a');a.href=href;a.download=`Rollands-${internal?'underlag':'faktura'}-${preview.invoiceNumber}.pdf`;document.body.append(a);a.click();a.remove();}
    setTimeout(()=>URL.revokeObjectURL(href),120000);
  }catch(error){if(tab)tab.close();throw error;}
}
async function previewDraft(){
  readForm();const doc=Invoice.prepare(input(),{accounts:accounts()});
  await Pdf.createInvoicePdf(doc); // Check font support and complete printability before posting.
  preview=doc;previewRecord=null;view='preview';render();
}
function refreshAccounts(){
  if(view!=='edit')return;
  for(const select of app.querySelectorAll('[data-revenue-select]')){const value=select.value;select.innerHTML=accountOptions(value);}
}
document.addEventListener('input',event=>{
  if(event.target.closest('#invoice-form'))dirty=true;
  if(event.target.matches('.invoice-search')){search=event.target.value;const pos=event.target.selectionStart;render();const field=app.querySelector('.invoice-search');field.focus();if(typeof pos==='number'&&field.type!=='search')field.setSelectionRange(pos,pos);}
});
document.addEventListener('change',event=>{
  if(!event.target.closest('#invoice-form'))return;
  readForm();dirty=true;
  if(event.target.name==='customerNumber'){chooseCustomer(event.target.value);render();}
  if(['paymentTermsDays','invoiceDate'].includes(event.target.name)){
    try{draft.dueDate=plusDays(draft.invoiceDate,draft.paymentTermsDays);const due=app.querySelector('[name=dueDate]');if(due)due.value=draft.dueDate;}catch{}
  }
});
document.addEventListener('click',async event=>{
  const target=event.target.closest('button');if(!target||busy)return;
  const action=target.dataset.action;
  try{
    if(target.dataset.preview){previewRecord=(Demo.section('customerInvoices')||[]).find(i=>i.id===target.dataset.preview);preview=Invoice.documentFor(previewRecord,company);view='preview';render();return;}
    if(target.dataset.removeRow!==undefined){readForm();draft.lines.splice(Number(target.dataset.removeRow),1);dirty=true;render();return;}
    if(action==='new'){draft=freshDraft();const selected=new URLSearchParams(location.search).get('customer');if(selected)chooseCustomer(selected);view='edit';render();return;}
    if(action==='list'){if(dirty&&!confirm('Lämna det osparade utkastet? Spara utkast först för att behålla ändringarna.'))return;dirty=false;view='list';render();return;}
    if(action==='edit'){view='edit';render();return;}
    if(action==='add-row'){readForm();draft.lines.push(blankLine());dirty=true;render();return;}
    if(action==='save-draft'){readForm();Demo.patch(s=>{s.invoiceDraft=copy(draft);});dirty=false;notify('Utkastet är sparat lokalt. Det är inte bokfört.');return;}
    if(action==='preview-draft'){busy=true;target.disabled=true;await previewDraft();return;}
    if(['download-pdf','download-internal','print-pdf'].includes(action)){busy=true;target.disabled=true;await downloadPdf(action==='download-internal',action==='print-pdf');}
  }catch(error){notify(error.message);}finally{busy=false;for(const button of app.querySelectorAll('button'))button.disabled=button.hasAttribute('data-remove-row')&&draft?.lines.length===1;}
});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='invoice-form')return;event.preventDefault();if(busy)return;
  try{
    readForm();const value=input();busy=true;for(const button of app.querySelectorAll('button'))button.disabled=true;
    const preflight=Invoice.prepare(value,{accounts:accounts()});await Pdf.createInvoicePdf(preflight);
    let created;
    Demo.patch(state=>{created=Invoice.postDemoInvoice(state,value);state.invoiceDraft=null;state.invoiceDefaults={seller:copy(value.seller)};});
    previewRecord=created;preview=created.document;view='preview';dirty=false;render();
  }catch(error){notify(error.message);}finally{busy=false;for(const button of app.querySelectorAll('button'))button.disabled=button.hasAttribute('data-remove-row')&&draft?.lines.length===1;}
});
addEventListener('focus',refreshAccounts);addEventListener('storage',refreshAccounts);
addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
async function boot(){
  if(!isDemo){app.innerHTML='<div class="portal"><aside class="sidebar"></aside><main class="content"><h1>Kundfakturor</h1><p>Det utökade fakturaverktyget är en demo. Skyddad fakturering kräver anslutning till företagets backend.</p><a href="./index.html">Till säker inloggning</a></main></div>';return;}
  const response=await fetch('../content/company.json');if(!response.ok)throw new Error('Företagsinställningarna kunde inte hämtas.');company=await response.json();render();
}
boot().catch(error=>{app.innerHTML=`<div class="portal"><aside class="sidebar"></aside><main class="content"><h1>Fakturaverktyget kunde inte laddas</h1><p>${esc(error.message)}</p></main></div>`;});
