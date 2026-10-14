const app=document.getElementById('unplaced-payments-app');
const demo=new URLSearchParams(location.search).get('demo')==='1';
const isSupabase=location.hostname==='ludwigberglund-coder.github.io'&&!demo;
const csrfToken=sessionStorage.getItem('rollands-csrf')||'';
let session=null,payments=[],openInvoices=[],selectedId='',message='',messageError=false,busy=false;
const resolutionRequests=new Map();

function esc(value=''){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function money(value){return new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK'}).format(Number(value||0)/100)}
function initials(name){return String(name||'Användare').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
function requestId(prefix,id){return `${prefix}-${id}-${crypto.randomUUID()}`}
// Reuse the same request ID when retrying an uncertain write with unchanged details.
// The database can then return the original result instead of creating a second journal entry.
function resolutionRequestId(payment,type,counterAccount,description){
  const key=JSON.stringify([session?.company?.id||'',payment.id,type,counterAccount,description]);
  const previous=resolutionRequests.get(key);
  if(previous)return previous;
  const next=requestId('unplaced',payment.id);
  resolutionRequests.set(key,next);
  return next;
}
async function api(path,options={}){const headers={'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};if(options.method&&options.method!=='GET'&&csrfToken)headers['X-CSRF-Token']=csrfToken;const response=await fetch(`/api/v1${path}`,{credentials:'same-origin',cache:'no-store',...options,headers,body:options.body?JSON.stringify(options.body):undefined});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Begäran misslyckades.');return data}
async function supabaseContext(){const ctx=await window.LTSupabaseUat.context();if(!ctx?.authenticated||!ctx.company){location.href='./index.html';throw new Error('Ingen aktiv session.')}return ctx}
async function loadSupabase(){const ctx=await supabaseContext(),filter='company_id=eq.'+encodeURIComponent(ctx.company.id);const [bankRows,invoiceRows,customerRows]=await Promise.all([window.LTSupabase.from('bank_payments',ctx.accessToken).select('*',filter+'&status=eq.unmatched&order=booking_date.desc,created_at.desc'),window.LTSupabase.from('invoices',ctx.accessToken).select('*',filter+'&remaining_ore=gt.0'),window.LTSupabase.from('customers',ctx.accessToken).select('*',filter)]);const customers=new Map((customerRows||[]).map(r=>[String(r.id),r]));payments=(bankRows||[]).map(r=>({id:r.id,bookingDate:r.booking_date,amountOre:Number(r.amount_ore||0),companyId:r.company_id,currency:r.currency||'SEK',reference:r.reference||'',message:r.message||'',payerName:r.payer_name||'',payerAccount:r.payer_account||''}));openInvoices=(invoiceRows||[]).filter(r=>Number(r.total_ore)>0&&Number(r.remaining_ore)>0&&String(r.invoice_account||'1510')==='1510').map(r=>({id:r.id,companyId:r.company_id,invoiceNumber:r.invoice_number,ocr:r.ocr||'',remainingOre:Number(r.remaining_ore||0),customerName:customers.get(String(r.customer_id))?.name||'',customerId:r.customer_id,customerOrgNumber:customers.get(String(r.customer_id))?.org_number||''}));session={user:ctx.user,company:ctx.company,ctx}}
async function loadApi(){const state=await api('/session');if(!state.authenticated){location.href='./index.html';return}session=state;payments=((await api('/bank/payments?status=unmatched')).payments||[]);const receivables=await api('/receivables');openInvoices=(receivables.receivables||receivables.invoices||[]).filter(r=>Number(r.remainingOre||0)>0&&String(r.invoiceAccount||'1510')==='1510').map(r=>({...r,customerId:r.customerId||r.customer_id||'',customerOrgNumber:r.customerOrgNumber||r.orgNumber||r.customer_org_number||''}))}
function selected(){return payments.find(p=>p.id===selectedId)||payments[0]||null}
function sidebar(){return `<aside class="sidebar"><div class="logo"><strong>LT Studio</strong><small>LT STUDIO</small></div><div class="company-pill">${esc(session?.company?.name||session?.company?.displayName||'Företaget')}<br>Personlig session</div><div class="side-group"><span>Arbetsyta</span><a class="side-link side-link-link" href="./dashboard.html">Översikt</a></div><div class="side-group"><span>Ekonomi</span><a class="side-link side-link-link" href="./bank.html">Bank & avstämning</a><button class="side-link active">Oplacerade betalningar</button><a class="side-link side-link-link" href="./automation.html">Automationskö</a><a class="side-link side-link-link" href="./accounting.html">Bokföring</a></div><div class="sidebar-footer">Inget försvinner. Varje placering och bokföring sparas i revisionsspåret.</div></aside>`}
function table(){
  const current=selected();
  return `<div class="unplaced-table-wrap"><div class="table-scroll"><table class="res-table unplaced-table"><thead><tr><th><span class="table-heading">Datum</span></th><th><span class="table-heading">Betalare</span></th><th><span class="table-heading">Referens</span></th><th class="money"><span class="table-heading">Belopp</span></th></tr></thead><tbody>${payments.map(p=>`<tr data-select="${esc(p.id)}" class="${p.id===current?.id?'selected':''}" aria-selected="${p.id===current?.id?'true':'false'}"><td><div class="payment-date"><span class="payment-status-dot" aria-hidden="true"></span><strong>${esc(p.bookingDate)}</strong></div></td><td><div class="payment-person"><b>${esc(p.payerName||'Okänd betalare')}</b><small>${esc(p.payerAccount||'Kontouppgift saknas')}</small></div></td><td><div class="payment-reference"><b>${esc(p.reference||'Ingen referens')}</b><small>${esc(p.message||'Ingen ytterligare information')}</small></div></td><td class="money"><strong>${esc(money(p.amountOre))}</strong></td></tr>`).join('')||'<tr><td colspan="4" class="empty"><div class="empty-state"><strong>Inga oplacerade betalningar</strong><span>Alla bankhändelser är hanterade just nu.</span></div></td></tr>'}</tbody></table></div><footer class="unplaced-list-footer"><span>${payments.length===1?'1 betalning':payments.length+' betalningar'} i kön</span><span class="queue-legend"><i aria-hidden="true"></i> Kräver manuell placering</span></footer></div>`;
}
// Suggestions are read-only. Reference and amount must agree before a single invoice is highlighted.
// The user still has to choose the invoice and submit a normal reviewed proposal.
function referenceHasIdentifier(payment,value){
  const identifier=String(value??'').toLocaleLowerCase('sv').replace(/[^a-z0-9]/g,'');
  if(identifier.length<4)return false;
  return [payment?.reference,payment?.message].some(source=>{
    const raw=String(source??'').toLocaleLowerCase('sv');
    const chunks=raw.match(/[a-z0-9]+(?:[-/][a-z0-9]+)*/g)||[];
    return chunks.some(chunk=>chunk.replace(/[^a-z0-9]/g,'')===identifier)||raw.replace(/[^a-z0-9]/g,'')===identifier;
  });
}
function invoiceCandidates(payment){
  const amount=Number(payment?.amountOre);
  if(!Number.isSafeInteger(amount)||amount<=0||(payment?.currency&&payment.currency!=='SEK'))return [];
  return openInvoices.filter(invoice=>Number.isSafeInteger(Number(invoice.remainingOre))&&Number(invoice.remainingOre)>=amount
    &&(!payment?.companyId||!invoice.companyId||payment.companyId===invoice.companyId));
}
// These are explanatory UI hints only; no name or organisation number proves the payer's identity.
// The existing RPC still receives a manual selection that must be reviewed in Automationskön.
function canonicalCustomerName(value){
  const raw=String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('sv');
  const parts=raw.replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
  while(parts.length&&['ab','aktiebolag','hb','handelsbolag','kb','kommanditbolag'].includes(parts[parts.length-1]))parts.pop();
  const name=parts.join(' ');
  if(name.length<6||['bankgirot','bankgiro','plusgiro','betalning','okand betalare','swish','transfer','unknown'].includes(name))return '';
  return name;
}
function customerNameMatches(payment,invoice){
  const payer=canonicalCustomerName(payment?.payerName);
  return Boolean(payer&&payer===canonicalCustomerName(invoice?.customerName));
}
function normalizedOrganisationNumber(value){
  const raw=String(value??'').trim().replace(/\s+/g,'');
  if(!/^(?:16)?\d{6}-?\d{4}$/.test(raw))return '';
  const digits=raw.replace(/\D/g,'');
  return digits.length===12?digits.slice(2):digits;
}
function organisationMatches(payment,invoice){
  const org=normalizedOrganisationNumber(invoice?.customerOrgNumber);
  if(!org)return false;
  const pattern=/(^|[^0-9])((?:16)?[0-9]{6}[- ]?[0-9]{4})(?=$|[^0-9])/g;
  return [payment?.payerName,payment?.reference,payment?.message].some(value=>{
    const text=String(value??'').slice(0,1000);
    pattern.lastIndex=0;
    return [...text.matchAll(pattern)].some(match=>normalizedOrganisationNumber(match[2])===org);
  });
}
function sameCustomer(left,right){
  if(left.customerId&&right.customerId)return String(left.customerId)===String(right.customerId);
  const leftOrg=normalizedOrganisationNumber(left.customerOrgNumber);
  const rightOrg=normalizedOrganisationNumber(right.customerOrgNumber);
  if(leftOrg&&rightOrg)return leftOrg===rightOrg;
  const leftName=canonicalCustomerName(left.customerName);
  return Boolean(leftName&&leftName===canonicalCustomerName(right.customerName));
}
function invoiceSuggestion(payment){
  const amount=Number(payment?.amountOre);
  const candidates=invoiceCandidates(payment).map(invoice=>({
    invoice,
    reference:referenceHasIdentifier(payment,invoice.ocr)?'OCR':referenceHasIdentifier(payment,invoice.invoiceNumber)?'fakturanummer':'',
    org:organisationMatches(payment,invoice),
    name:customerNameMatches(payment,invoice)
  }));
  const references=candidates.filter(candidate=>candidate.reference);
  if(references.length>1)return{kind:'ambiguous',reason:'reference'};
  if(references.length===1){
    const only=references[0];
    if(candidates.some(candidate=>(candidate.org||candidate.name)&&!sameCustomer(candidate.invoice,only.invoice)))
      return{kind:'ambiguous',reason:'conflict'};
    return{kind:'unique',invoice:only.invoice,by:only.reference,source:'reference',partial:amount<Number(only.invoice.remainingOre)};
  }
  const byOrg=candidates.filter(candidate=>candidate.org);
  const byName=candidates.filter(candidate=>candidate.name);
  if(byOrg.length&&byName.some(candidate=>!byOrg.some(org=>sameCustomer(org.invoice,candidate.invoice))))
    return{kind:'ambiguous',reason:'conflict'};
  const identity=byOrg.length?byOrg:byName;
  if(identity.length>1)return{kind:'ambiguous',reason:'customer'};
  if(identity.length===1){
    const only=identity[0];
    if(Number(only.invoice.remainingOre)!==amount)
      return{kind:'partial',by:only.org?'organisationsnummer':'kundnamn'};
    return{kind:'unique',invoice:only.invoice,by:only.org?'organisationsnummer':'kundnamn',source:'customer',partial:false};
  }
  return{kind:'none'};
}
function invoiceOptions(payment){
  const suggestion=invoiceSuggestion(payment);
  const choices=invoiceCandidates(payment).slice().sort((a,b)=>{
    if(suggestion.kind==='unique'&&(a.id===suggestion.invoice.id||b.id===suggestion.invoice.id))return a.id===suggestion.invoice.id?-1:1;
    return String(a.invoiceNumber||'').localeCompare(String(b.invoiceNumber||''),'sv');
  });
  const label=choices.length?'Välj kundfaktura':'Ingen faktura med tillräckligt restbelopp';
  return `<option value="">${label}</option>`+choices.map(i=>`<option value="${esc(i.id)}">${esc(i.invoiceNumber)} · ${esc(i.customerName)} · ${esc(money(i.remainingOre))}</option>`).join('');
}
function invoiceSuggestionCard(payment){
  const suggestion=invoiceSuggestion(payment);
  if(suggestion.kind==='ambiguous'){
    const detail=suggestion.reason==='conflict'
      ?'Referens och kunduppgifter pekar på olika kunder. Kontrollera vem betalningen avser innan du väljer faktura.'
      :suggestion.reason==='customer'
        ?'Flera öppna fakturor passar samma kunduppgift. Kontrollera fakturanummer och betalningsunderlag.'
        :'Flera fakturor har en matchande referens. Välj själv efter att ha kontrollerat underlaget.';
    return `<div class="invoice-match-tip invoice-match-ambiguous" role="note"><strong>Flera möjliga fakturor</strong><p>${esc(detail)}</p></div>`;
  }
  if(suggestion.kind==='partial')
    return '<p class="invoice-match-hint">Kunduppgifter matchar, men beloppet är inte exakt lika med restbeloppet. Det kan vara en delbetalning. Välj faktura själv efter kontroll.</p>';
  if(suggestion.kind!=='unique')
    return `<p class="invoice-match-hint">${invoiceCandidates(payment).length?'Ingen tydlig träff på OCR eller fakturanummer. Inte heller en entydig kund- och beloppsträff. Kontrollera fakturan innan du väljer.':'Ingen öppen faktura kan ta emot hela beloppet. Kontrollera fakturorna innan du fortsätter.'}</p>`;
  const invoice=suggestion.invoice;
  const weaker=suggestion.source==='customer';
  const detail=weaker
    ?`${suggestion.by==='organisationsnummer'?'Organisationsnummer i betalningsinformationen':'Betalarnamnet'} stämmer med kundregistret, och beloppet är exakt lika med fakturans restbelopp. Bankens betalare är inte identitetsverifierad. Kontrollera underlaget.`
    :`${suggestion.by} matchar betalningens referens. ${suggestion.partial?'Beloppet kan vara en delbetalning. Kontrollera återstående saldo.':'Beloppet stämmer med fakturans restbelopp.'} Granska innan du skapar förslaget.`;
  return `<div class="invoice-match-tip ${weaker?'invoice-match-customer':''}" role="note"><span class="invoice-match-eyebrow">${weaker?'Möjlig kundträff – extra kontroll':'Möjlig fakturaträff'}</span><strong>${esc(invoice.invoiceNumber)} · ${esc(invoice.customerName||'Okänd kund')}</strong><p>${esc(detail)}</p><button type="button" class="button ghost small" data-action="use-suggestion" ${busy?'disabled':''}>Välj föreslagen faktura</button></div>`;
}

function postingType(kind){
  if(kind==='other-income')return 'other-income';
  if(kind==='outgoing'||kind==='bank-fee')return 'outgoing';
  return '';
}
function postingPreview(){
  const payment=selected();
  const kind=document.querySelector('[data-field="kind"]')?.value||'';
  if(!payment||!kind)return '<p>Välj först vad bankhändelsen gäller. Ingenting bokförs innan du bekräftar.</p>';
  if(kind==='unsure')return '<p>Vänta med bokföringen. Kontrollera kontoutdrag och underlag, eller be om hjälp med konteringen.</p>';
  const account=(document.querySelector('[data-field="account"]')?.value||'').trim();
  const description=(document.querySelector('[data-field="description"]')?.value||'').trim();
  const type=postingType(kind);
  const hint=kind==='bank-fee'
    ?'Endast avgifter för företagets egna banktjänster. Ränta, kortinlösen eller tjänster med moms kan behöva annan hantering.'
    :'Om betalningen gäller en kund- eller leverantörsfaktura ska den hanteras i fakturaflödet i stället.';
  if(!/^\d{4}$/.test(account)||['1510','1930','2440'].includes(account))
    return `<p>${esc(hint)}</p><p>Fyll i ett korrekt fyrsiffrigt motkonto innan du bokför. Inget konto gissas automatiskt för övriga händelser.</p>`;
  const amount=esc(money(payment.amountOre));
  const debit=type==='outgoing'?esc(account):'1930';
  const credit=type==='outgoing'?'1930':esc(account);
  return `<strong>Förhandskontroll · ${amount}</strong><p>${esc(hint)}</p><div class="posting-lines"><span>Debet ${debit}: ${amount}</span><span>Kredit ${credit}: ${amount}</span></div><p>${esc(description||'Beskrivning saknas.')}</p><p>Riktningen är inte automatiskt verifierad mot banken. Kontrollera själv att pengar kom in eller gick ut.</p>`;
}
function updatePostingGuide(reset=false){
  const kind=document.querySelector('[data-field="kind"]')?.value||'';
  const account=document.querySelector('[data-field="account"]');
  const description=document.querySelector('[data-field="description"]');
  const confirmation=document.querySelector('[data-field="confirmed"]');
  if(reset){
    if(account)account.value=kind==='bank-fee'?'6570':'';
    if(description)description.value=kind==='bank-fee'?'Bankavgift enligt kontoutdrag':'';
    if(confirmation)confirmation.checked=false;
  }
  if(account)account.readOnly=kind==='bank-fee';
  const preview=document.querySelector('[data-role="posting-preview"]');
  if(preview)preview.innerHTML=postingPreview();
  const button=document.querySelector('[data-action="resolve"]');
  if(button)button.disabled=busy||!postingType(kind);
}
function resolutionCard(){
  const p=selected();
  if(!p)return '<section class="panel resolution-card resolution-card-empty"><div class="empty-choice"><span class="empty-choice-icon" aria-hidden="true">✓</span><strong>Inget att hantera</strong><p>När en betalning inte kan matchas automatiskt hamnar den här.</p></div></section>';
  return `<section class="panel resolution-card"><header class="resolution-header"><div><span class="eyebrow">Hantera vald betalning</span><h3>${esc(money(p.amountOre))}</h3><p>${esc(p.payerName||'Okänd betalare')} · ${esc(p.reference||'Ingen referens')}</p></div><span class="manual-badge">Manuell kontroll</span></header><div class="resolution-meta"><div><span>Datum</span><b>${esc(p.bookingDate)}</b></div><div><span>Referens</span><b>${esc(p.reference||'—')}</b></div><div><span>Betalare</span><b>${esc(p.payerName||'Okänd')}</b></div></div><div class="resolution-actions"><div class="resolution-block resolution-block-match"><div class="resolution-block-head"><span class="resolution-icon" aria-hidden="true">↗</span><div><b>Koppla till kundfaktura</b><small>Skapa ett granskningsbart matchningsförslag</small></div></div><p>Välj rätt faktura. LT Studio skapar ett manuellt matchningsförslag som därefter granskas och bokförs i Automationskön.</p><label><span>Faktura</span><select data-field="invoice" ${!invoiceCandidates(p).length?'disabled':''}>${invoiceOptions(p)}</select></label>${invoiceSuggestionCard(p)}<p class="posting-caution invoice-direction-caution" role="note">Bankuppgifterna bevisar ännu inte att detta är en inbetalning. Kontrollera att pengarna kom in på kontot och att rätt faktura valts innan du fortsätter.</p><label class="posting-review-check invoice-review-check"><input type="checkbox" data-field="incoming-confirmed" ${!invoiceCandidates(p).length?'disabled':''}><span>Jag har kontrollerat bankutdraget och bekräftar att pengarna kom in samt att beloppet och den valda kundfakturan stämmer.</span></label><button class="button resolution-primary" data-action="invoice" disabled><span aria-hidden="true">＋</span>Skapa matchningsförslag</button></div><div class="resolution-block resolution-block-other"><div class="resolution-block-head"><span class="resolution-icon" aria-hidden="true">≡</span><div><b>Hantera annan bankhändelse</b><small>Tre steg – granska innan någon bokföring skapas</small></div></div><label><span>1. Vad gäller händelsen?</span><select data-field="kind"><option value="">Välj ett alternativ</option><option value="bank-fee">Banken har dragit en vanlig kontoavgift</option><option value="other-income">Pengar har kommit in (ingen kundfaktura)</option><option value="outgoing">Pengar har gått ut (annan utbetalning)</option><option value="unsure">Jag är osäker – bokför inte ännu</option></select></label><p class="posting-caution">Valet är inte automatiskt kontrollerat mot banken. Använd inte detta flöde för kundfakturor, leverantörsfakturor, ränta eller osäkra momshändelser.</p><label><span>2. Bokföringskonto</span><input data-field="account" inputmode="numeric" maxlength="4" placeholder="Ange motkonto – eller välj bankavgift ovan"></label><p class="posting-account-help">Vid vanlig bankavgift fylls konto 6570 i som ett förslag. För andra händelser behöver du välja ett korrekt konto eller få hjälp av en redovisningskunnig.</p><label><span>Beskrivning</span><textarea data-field="description" maxlength="240" placeholder="Beskriv vad bankhändelsen gäller"></textarea></label><div class="posting-preview" role="note" aria-live="polite"><span class="posting-preview-eyebrow">3. Så här bokförs betalningen</span><div data-role="posting-preview"><p>Välj först vad händelsen gäller. Ingenting är bokfört ännu.</p></div></div><label class="posting-review-check"><input type="checkbox" data-field="confirmed"><span>Jag har jämfört med kontoutdraget, kontrollerat om pengar gick in eller ut och granskat konto och underlag.</span></label><button type="button" class="button resolution-primary" data-action="resolve" disabled>Bokför kontrollerad bankhändelse</button><p class="posting-irreversible">När du klickar skapas en verifikation direkt. Om du är osäker – välj ”Jag är osäker” och bokför inte.</p><p class="danger-note"><span aria-hidden="true">i</span>Konto 1510, 1930 och 2440 är spärrade här eftersom de måste gå via sina särskilda reskontraflöden.</p></div></div></section>`;
}
function render(){
  const name=session?.user?.displayName||session?.user?.email||'Inloggad användare';
  const total=payments.reduce((s,p)=>s+Number(p.amountOre||0),0);
  app.innerHTML=`<div class="portal">${sidebar()}<section class="main"><header class="topbar"><div><h1>Oplacerade betalningar</h1><p>${esc(session?.company?.name||session?.company?.displayName||'Företaget')} / Ekonomi / Oplacerade betalningar</p></div><div class="user-chip"><div><b>${esc(name)}</b><br><small>Inloggad</small></div><div class="avatar">${esc(initials(name))}</div></div></header><main class="content unplaced-content"><div class="page-heading unplaced-heading"><div><span class="eyebrow">Bank & avstämning</span><h2>Oplacerade betalningar</h2><p>Bankhändelser som saknar säker automatisk träff samlas här. Välj en betalning och placera den mot rätt faktura eller bokför den manuellt.</p></div><div class="unplaced-heading-status"><span class="status-pulse" aria-hidden="true"></span><span><strong>${payments.length}</strong> att hantera</span></div></div>${message?`<div class="notice unplaced-notice" ${messageError?'role="alert"':'role="status"'}><strong>${messageError?'Kunde inte genomföra åtgärden':'Klart'}</strong><span>${esc(message)}</span></div>`:''}<section class="unplaced-summary"><article class="unplaced-summary-card"><div class="unplaced-summary-icon unplaced-summary-icon-queue" aria-hidden="true">↓</div><div><span>Oplacerade</span><strong>${payments.length}</strong><small>Betalningar som behöver hanteras</small></div></article><article class="unplaced-summary-card"><div class="unplaced-summary-icon" aria-hidden="true">kr</div><div><span>Belopp i kön</span><strong>${esc(money(total))}</strong><small>Totalt belopp att placera</small></div></article><article class="unplaced-summary-card"><div class="unplaced-summary-icon" aria-hidden="true">✓</div><div><span>Kontroll</span><strong>100 % manuellt</strong><small>Ingen automatisk bokning sker här</small></div></article></section><div class="unplaced-layout"><section class="panel unplaced-list-panel"><div class="toolbar unplaced-toolbar"><div><strong>Betalningar att placera</strong><span class="hint">Välj en betalning för att placera den.</span></div><button class="button ghost small unplaced-refresh" data-action="refresh"><span aria-hidden="true">↻</span>Uppdatera</button></div>${table()}</section>${resolutionCard()}</div></main></section></div>`;
}
function loadDemo(){session={user:{displayName:'Demoanvändare'},company:{name:'Demoföretag'}};payments=[{id:'demo-unplaced-1',bookingDate:'2026-10-07',amountOre:125000,reference:'Okänd inbetalning',message:'Saknar säker fakturaträff',payerName:'Exempelbetalare AB',payerAccount:'BG 5000-0000'}];openInvoices=[{id:'demo-invoice-1',invoiceNumber:'310101',remainingOre:125000,customerName:'Exempelkund AB'}]}
async function load(){if(demo)loadDemo();else if(isSupabase)await loadSupabase();else await loadApi();if(!selectedId&&payments[0])selectedId=payments[0].id;render()}

function updateInvoiceReviewState(){
  const p=selected();
  const invoiceId=document.querySelector('[data-field="invoice"]')?.value||'';
  const confirmed=document.querySelector('[data-field="incoming-confirmed"]')?.checked===true;
  const button=document.querySelector('[data-action="invoice"]');
  if(button)button.disabled=busy||!confirmed||!invoiceId||!p
    ||!invoiceCandidates(p).some(invoice=>String(invoice.id)===String(invoiceId));
}
async function createInvoiceProposal(){const p=selected(),invoiceId=document.querySelector('[data-field="invoice"]')?.value||'';if(!p||!invoiceId)throw new Error('Välj en kundfaktura.');if(!invoiceCandidates(p).some(i=>String(i.id)===invoiceId))throw new Error('Den valda fakturan kan inte ta emot betalningen. Välj en annan faktura.');if(document.querySelector('[data-field="incoming-confirmed"]')?.checked!==true)throw new Error('Bekräfta med bankutdraget att pengarna kom in och att du valt rätt faktura.');if(demo){message='Demo: matchningsförslaget skulle skickas till Automationskön.';render();return}if(isSupabase){const ctx=session.ctx;const target=openInvoices.find(i=>i.id===invoiceId);const saved=(await window.LTSupabase.rpc('create_bank_match_proposal',{p_company_id:ctx.company.id,p_bank_payment_id:p.id,p_target_invoice_id:invoiceId,p_confidence_ppm:500000,p_deterministic:false,p_ambiguous:true,p_reason:'Manuell placering från Oplacerade betalningar.',p_evidence:[{kind:'manual-selection',label:'Manuellt vald faktura',value:target?.invoiceNumber||invoiceId,sourceId:p.id}]},ctx.accessToken))?.[0];if(!saved?.proposal_id||!['manual-review','ready-for-approval'].includes(saved.status))throw new Error('Inget nytt matchningsförslag skapades. Uppdatera betalningarna och försök igen.')}else{await api(`/bank/payments/${encodeURIComponent(p.id)}/manual-match`,{method:'POST',body:{invoiceId}})}message='Matchningsförslaget är skapat. Öppna Automationskön för granskning och bokföring.';await load()}
async function resolveOther(){
  const p=selected();
  const kind=document.querySelector('[data-field="kind"]')?.value||'';
  const type=postingType(kind);
  const counterAccount=(document.querySelector('[data-field="account"]')?.value||'').trim();
  const description=(document.querySelector('[data-field="description"]')?.value||'').trim();
  const confirmed=document.querySelector('[data-field="confirmed"]')?.checked===true;
  if(!p)throw new Error('Välj en betalning.');
  if(!type)throw new Error('Välj vad bankhändelsen gäller, eller be om hjälp om du är osäker.');
  if(!/^\d{4}$/.test(counterAccount)||['1510','1930','2440'].includes(counterAccount))
    throw new Error('Ange ett tillåtet fyrsiffrigt bokföringskonto.');
  if(kind==='bank-fee'&&counterAccount!=='6570')
    throw new Error('För bankavgift ska konto 6570 användas i detta snabbval. Byt till annan utbetalning för ett annat konto.');
  if(description.length<3||description.length>240)throw new Error('Skriv en beskrivning på 3–240 tecken.');
  if(!confirmed)throw new Error('Kontrollera bankhändelsen och markera bekräftelserutan innan bokföring.');
  if(!Number.isSafeInteger(Number(p.amountOre))||Number(p.amountOre)<=0||p.currency&&p.currency!=='SEK')
    throw new Error('Betalningen saknar ett giltigt positivt SEK-belopp.');
  const rid=resolutionRequestId(p,type,counterAccount,description);
  if(demo){
    message=type==='outgoing'?'Demo: kontrollerad utbetalning skulle bokföras.':'Demo: kontrollerad inbetalning skulle bokföras.';
    render();
    return;
  }
  if(isSupabase){
    const result=await window.LTSupabase.functions.invoke('resolve-unplaced-payment',{
      companyId:session.ctx.company.id,bankPaymentId:p.id,resolutionType:type,
      counterAccount,description,requestId:rid
    },session.ctx.accessToken);
    if(!result?.journal_number)throw new Error('Betalningen kunde inte bekräftas som bokförd.');
    message=`Klart. Verifikation ${result.journal_number} skapades.`;
  }else{
    const data=await api(`/bank/payments/${encodeURIComponent(p.id)}/resolve-other`,{
      method:'POST',body:{resolutionType:type,counterAccount,description,requestId:rid}
    });
    message=data.message||'Betalningen är bokförd.';
  }
  selectedId='';
  await load();
}
document.addEventListener('change',event=>{
  if(busy)return;
  if(event.target?.dataset?.field==='kind')updatePostingGuide(true);
  if(event.target?.dataset?.field==='confirmed')updatePostingGuide();
  if(event.target?.dataset?.field==='invoice'){
    const confirmation=document.querySelector('[data-field="incoming-confirmed"]');
    if(confirmation)confirmation.checked=false;
    updateInvoiceReviewState();
  }
  if(event.target?.dataset?.field==='incoming-confirmed')updateInvoiceReviewState();
});
document.addEventListener('input',event=>{
  if(busy)return;
  if(['account','description'].includes(event.target?.dataset?.field))updatePostingGuide();
});
document.addEventListener('click',async event=>{
  // Keep entered invoice/account/description values in the DOM until the action reads them.
  // Re-rendering before createInvoiceProposal/resolveOther resets the form to defaults.
  if(busy)return;
  const row=event.target.closest('[data-select]');
  if(row){selectedId=row.dataset.select;render();return}
  const button=event.target.closest('[data-action]');
  if(!button)return;
  const action=button.dataset.action;
  if(action==='use-suggestion'){
    const suggestion=invoiceSuggestion(selected());
    const input=document.querySelector('[data-field="invoice"]');
    if(suggestion.kind==='unique'&&input){
      input.value=String(suggestion.invoice.id);
      const confirmed=document.querySelector('[data-field="incoming-confirmed"]');
      if(confirmed)confirmed.checked=false;
      updateInvoiceReviewState();
      input.focus?.();
    }
    return;
  }
  const fields=['invoice','kind','account','description'];
  const draft=Object.fromEntries(fields.map(field=>[field,document.querySelector(`[data-field="${field}"]`)?.value??'']));
  draft.confirmed=document.querySelector('[data-field="confirmed"]')?.checked===true;
  draft.incomingConfirmed=document.querySelector('[data-field="incoming-confirmed"]')?.checked===true;
  let failed=false;
  try{
    if(action==='refresh'){await load();return}
    if(!['invoice','resolve'].includes(action))return;
    messageError=false;
    busy=true;
    app.querySelectorAll('button[data-action]').forEach(control=>{control.disabled=true});
    if(action==='invoice')await createInvoiceProposal();
    if(action==='resolve')await resolveOther();
  }catch(error){
    failed=true;
    messageError=true;
    message=String(error?.message||'Åtgärden kunde inte slutföras.');
  }finally{
    busy=false;
    render();
    // A failed request must not erase the user's values: they can safely retry.
    if(failed)for(const [field,value] of Object.entries(draft)){
      const input=document.querySelector(`[data-field="${field}"]`);
      if(input)input.value=value;
    }
    if(failed){
      const confirmed=document.querySelector('[data-field="confirmed"]');
      if(confirmed)confirmed.checked=draft.confirmed;
      const incoming=document.querySelector('[data-field="incoming-confirmed"]');
      if(incoming)incoming.checked=draft.incomingConfirmed;
    }
    updatePostingGuide();
    updateInvoiceReviewState();
  }
});
load().catch(error=>{app.innerHTML=`<main class="boot"><strong>Kunde inte ladda oplacerade betalningar</strong><span>${esc(error.message)}</span></main>`});
