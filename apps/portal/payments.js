const app=document.getElementById('payments-app');
const pageParams=new URLSearchParams(location.search);
const isDemo=pageParams.get('demo')==='1';
const isSupabase=location.hostname==='ludwigberglund-coder.github.io'&&!isDemo;
let session=null,mode='month',anchor=today(),direction='',status='',query='',account='',sort='date',order='asc',data=null,message='',refreshing=false,searchOpen=false,searchActiveIndex=-1,searchSourceRows=[],manualPaymentModal=null,invoiceSearch='',invoiceSearchIndex=-1,openInvoices=[],paymentAccounts=[];

function today(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function paymentStatusLabel(direction,value){
  const key=String(direction||'')+':'+String(value||'').trim().toLowerCase();
  return ({
    'in:unmatched':'Ej matchad',
    'in:proposal-created':'Matchningsförslag skapat',
    'in:reviewed':'Granskad',
    'in:posted':'Bokförd inbetalning',
    'in:ignored':'Ignorerad',
    'in:pending-approval':'Väntar på godkännande',
    'in:rejected':'Avvisad',
    'out:prepared':'Förberedd – ej frisläppt',
    'out:released':'Frisläppt – väntar bankbekräftelse',
    'out:paid':'Betald & bokförd',
    'out:cancelled':'Avbruten'
  })[key]||String(value||'');
}
const PAYMENT_STATUS_OPTIONS=[
  ['','Alla statusar'],
  ['unmatched','Inbetalning · ej matchad'],
  ['proposal-created','Inbetalning · matchningsförslag skapat'],
  ['reviewed','Inbetalning · granskad'],
  ['posted','Inbetalning · bokförd'],
  ['ignored','Inbetalning · ignorerad'],
  ['pending-approval','Inbetalning · väntar på godkännande'],
  ['rejected','Inbetalning · avvisad'],
  ['prepared','Utbetalning · förberedd, ej frisläppt'],
  ['released','Utbetalning · frisläppt, väntar bankbekräftelse'],
  ['paid','Utbetalning · betald & bokförd'],
  ['cancelled','Utbetalning · avbruten']
];
function statusOptions(){return PAYMENT_STATUS_OPTIONS.map(([value,label])=>`<option value="${esc(value)}" ${status===value?'selected':''}>${esc(label)}</option>`).join('')}
function ore(v){return new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK',minimumFractionDigits:2}).format(Number(v||0)/100)}
async function api(path){const r=await fetch('/api/v1'+path,{credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||'Begäran misslyckades.');return body}
function demo(){return{period:{mode,from:'2026-09-01',to:'2026-09-30',label:'2026-09'},filters:{direction:null,status:null},summary:{incomingOre:627500,outgoingOre:209600,netOre:417900,count:4},rows:[
{id:'demo-in-1',direction:'in',paymentDate:'2026-09-10',amountOre:392500,status:'posted',reference:'BG-1041',counterparty:'Nordic Office Göteborg AB',counterpartyAccount:'',invoiceNumber:'310002',account:'1930'},
{id:'demo-in-2',direction:'in',paymentDate:'2026-09-12',amountOre:235000,status:'posted',reference:'BG-1042',counterparty:'Majorna Fastigheter AB',counterpartyAccount:'',invoiceNumber:'310004',account:'1930'},
{id:'demo-out-1',direction:'out',paymentDate:'2026-09-14',amountOre:84600,status:'paid',reference:'987-6543',counterparty:'Göteborgs Fruktimport AB',counterpartyAccount:'987-6543',invoiceNumber:'GF-8821',account:'1930'},
{id:'demo-out-2',direction:'out',paymentDate:'2026-09-18',amountOre:125000,status:'prepared',reference:'555-2200',counterparty:'Lokal Grossist AB',counterpartyAccount:'555-2200',invoiceNumber:'LG-1020',account:'1930'}]}}
function exportUrl(){return `/api/v1/exports/payments-overview?mode=${encodeURIComponent(mode)}&date=${encodeURIComponent(anchor)}&direction=${encodeURIComponent(direction)}&status=${encodeURIComponent(status)}&query=${encodeURIComponent(query)}&account=${encodeURIComponent(account)}&sort=${encodeURIComponent(sort)}&order=${encodeURIComponent(order)}`}
function sidebar(){return '<aside class="sidebar"></aside>'}
function normalized(value){return String(value||'').trim().toLocaleLowerCase('sv-SE')}
function parsePositiveOre(value){const normalizedValue=String(value??'').replace(/\s/g,'').replace(',','.');if(!/^\d+(?:\.\d{1,2})?$/.test(normalizedValue))throw new Error('Beloppet måste anges med högst två decimaler.');const amountOre=Math.round(Number(normalizedValue)*100);if(!Number.isSafeInteger(amountOre)||amountOre<=0)throw new Error('Beloppet måste vara större än 0 kr.');return amountOre}
function liquidityOptions(selected=''){return paymentAccounts.map(row=>`<option value="${esc(row.number)}" ${String(row.number)===String(selected)?'selected':''}>${esc(row.number)} · ${esc(row.name)}</option>`).join('')}

function isoDate(date){return date.toISOString().slice(0,10)}
function dateFromIso(value){const date=new Date(String(value||'')+'T12:00:00Z');return Number.isNaN(date.getTime())?new Date(today()+'T12:00:00Z'):date}
function periodInfo(){
  const date=dateFromIso(anchor),year=date.getUTCFullYear(),month=date.getUTCMonth();
  if(mode==='day'){const day=isoDate(date);return{mode,from:day,to:day,label:day}}
  if(mode==='week'){
    const weekday=(date.getUTCDay()+6)%7,start=new Date(date);start.setUTCDate(date.getUTCDate()-weekday);
    const end=new Date(start);end.setUTCDate(start.getUTCDate()+6);
    return{mode,from:isoDate(start),to:isoDate(end),label:`Vecka ${new Intl.DateTimeFormat('sv-SE',{timeZone:'UTC',month:'short',day:'numeric'}).format(start)}–${new Intl.DateTimeFormat('sv-SE',{timeZone:'UTC',month:'short',day:'numeric'}).format(end)}`};
  }
  if(mode==='quarter'){
    const quarter=Math.floor(month/3),start=new Date(Date.UTC(year,quarter*3,1,12)),end=new Date(Date.UTC(year,quarter*3+3,0,12));
    return{mode,from:isoDate(start),to:isoDate(end),label:`${year} · Q${quarter+1}`};
  }
  const start=new Date(Date.UTC(year,month,1,12)),end=new Date(Date.UTC(year,month+1,0,12));
  return{mode:'month',from:isoDate(start),to:isoDate(end),label:`${year}-${String(month+1).padStart(2,'0')}`};
}
function sortRows(rows){
  const factor=order==='desc'?-1:1;
  return [...rows].sort((a,b)=>{
    if(sort==='amount')return (Number(a.amountOre||0)-Number(b.amountOre||0))*factor;
    if(sort==='counterparty')return String(a.counterparty||'').localeCompare(String(b.counterparty||''),'sv')*factor;
    return String(a.paymentDate||'').localeCompare(String(b.paymentDate||''))*factor;
  });
}
function filterConfiguredRows(rows){
  const period=periodInfo();
  const filtered=(rows||[]).filter(row=>{
    if(row.paymentDate<period.from||row.paymentDate>period.to)return false;
    if(direction&&row.direction!==direction)return false;
    if(status&&row.status!==status)return false;
    if(account&&String(row.account||'')!==String(account).trim())return false;
    return true;
  });
  return{period,rows:sortRows(filtered)};
}
async function supabasePayments(){
  const ctx=await window.LTSupabaseUat.context();
  if(!ctx.authenticated||!ctx.company){location.href='./index.html';throw new Error('Ingen aktiv Supabase-session.')}
  session={user:ctx.user,company:ctx.company};
  const filter='company_id=eq.'+encodeURIComponent(ctx.company.id);
  const [bankRows,supplierPaymentRows,manualPaymentRows,executionRows,invoiceRows,customerRows,supplierInvoiceRows,supplierRows,batchRows]=await Promise.all([
    window.LTSupabase.from('bank_payments',ctx.accessToken).select('*',filter),
    window.LTSupabase.from('supplier_payments',ctx.accessToken).select('*',filter),
    window.LTSupabase.from('customer_manual_payments',ctx.accessToken).select('*',filter),
    window.LTSupabase.from('customer_payment_executions',ctx.accessToken).select('*',filter),
    window.LTSupabase.from('invoices',ctx.accessToken).select('id,invoice_number,customer_id,total_ore,remaining_ore,invoice_date,due_date,status,journal_number',filter),
    window.LTSupabase.from('customers',ctx.accessToken).select('id,name,customer_number',filter),
    window.LTSupabase.from('supplier_invoices',ctx.accessToken).select('id,supplier_invoice_number,supplier_id',filter),
    window.LTSupabase.from('suppliers',ctx.accessToken).select('id,name,bankgiro,plusgiro',filter),
    window.LTSupabase.from('financial_batches',ctx.accessToken).select('id,batch_number,status',filter)
  ]);
  const executionByBank=new Map((executionRows||[]).map(row=>[String(row.bank_payment_id),row]));
  const invoiceById=new Map((invoiceRows||[]).map(row=>[String(row.id),row]));
  const customerById=new Map((customerRows||[]).map(row=>[String(row.id),row]));
  const supplierInvoiceById=new Map((supplierInvoiceRows||[]).map(row=>[String(row.id),row]));
  const supplierById=new Map((supplierRows||[]).map(row=>[String(row.id),row]));
  const batchById=new Map((batchRows||[]).map(row=>[String(row.id),row]));
  const pendingByInvoice=new Map();for(const payment of manualPaymentRows||[]){if(payment.status!=='pending')continue;const key=String(payment.invoice_id);pendingByInvoice.set(key,(pendingByInvoice.get(key)||0)+Number(payment.amount_ore||0));}
  openInvoices=(invoiceRows||[]).map(invoice=>{const customer=customerById.get(String(invoice.customer_id))||{},pendingOre=pendingByInvoice.get(String(invoice.id))||0;return{id:invoice.id,invoiceNumber:invoice.invoice_number,customerId:invoice.customer_id,customerName:customer.name||'',customerNumber:customer.customer_number||'',totalOre:Number(invoice.total_ore||0),remainingOre:Number(invoice.remaining_ore||0),pendingOre,availableOre:Math.max(0,Number(invoice.remaining_ore||0)-pendingOre),invoiceDate:invoice.invoice_date,dueDate:invoice.due_date,status:invoice.status,journalNumber:invoice.journal_number}}).filter(invoice=>invoice.totalOre>0&&invoice.remainingOre>0&&invoice.availableOre>0&&invoice.journalNumber&&invoice.status!=='Väntar på bunt');
  const incoming=(bankRows||[]).map(row=>{
    const execution=executionByBank.get(String(row.id)),invoice=execution?invoiceById.get(String(execution.invoice_id)):null,customer=invoice?customerById.get(String(invoice.customer_id)):null;
    return{
      id:'in:'+row.id,direction:'in',paymentDate:row.booking_date,amountOre:Number(row.amount_ore||0),status:row.status,
      reference:row.reference||row.external_id||'',counterparty:row.payer_name||customer?.name||'Okänd inbetalare',
      counterpartyAccount:row.payer_account||'',invoiceNumber:invoice?.invoice_number||'',account:'1930'
    };
  });
  const manualIncoming=(manualPaymentRows||[]).map(row=>{const invoice=invoiceById.get(String(row.invoice_id)),customer=invoice?customerById.get(String(invoice.customer_id)):null,batch=batchById.get(String(row.batch_id));return{id:'manual:'+row.id,direction:'in',paymentDate:row.payment_date,amountOre:Number(row.amount_ore||0),status:row.status==='pending'?'pending-approval':row.status==='approved'?'posted':'rejected',statusLabel:row.status==='pending'?'Väntar på godkännande':row.status==='approved'?'Bokförd inbetalning':'Avvisad',reference:row.reference||'',counterparty:customer?.name||'Okänd kund',counterpartyAccount:'',invoiceNumber:invoice?.invoice_number||'',account:row.bank_account||'',batchNumber:batch?.batch_number||null};});
  const outgoing=(supplierPaymentRows||[]).map(row=>{
    const invoice=supplierInvoiceById.get(String(row.supplier_invoice_id)),supplier=invoice?supplierById.get(String(invoice.supplier_id)):null;
    const destination=row.recipient_bankgiro||row.recipient_plusgiro||supplier?.bankgiro||supplier?.plusgiro||'';
    return{
      id:'out:'+row.id,direction:'out',paymentDate:row.payment_date,amountOre:Number(row.amount_ore||0),status:row.status,
      reference:row.confirmation_reference||destination,counterparty:row.recipient_name||supplier?.name||'Okänd mottagare',
      counterpartyAccount:destination,invoiceNumber:invoice?.supplier_invoice_number||'',account:row.account||''
    };
  });
  const filtered=filterConfiguredRows([...incoming,...manualIncoming,...outgoing]);
  const summary=visibleSummary(filtered.rows);
  return{period:filtered.period,filters:{direction:direction||null,status:status||null},summary,rows:filtered.rows};
}

function paymentMatches(row,needle=query){
  const q=normalized(needle);if(!q)return true;
  return [row.counterparty,row.counterpartyAccount,row.invoiceNumber,row.reference,row.statusLabel||paymentStatusLabel(row.direction,row.status),row.paymentDate,row.account].some(value=>normalized(value).includes(q));
}
function visibleRows(){const source=searchSourceRows.length?searchSourceRows:(data?.rows||[]);return source.filter(row=>paymentMatches(row))}
function visibleSummary(rows=visibleRows()){
  const incomingOre=rows.filter(row=>row.direction==='in').reduce((sum,row)=>sum+Number(row.amountOre||0),0);
  const outgoingOre=rows.filter(row=>row.direction==='out').reduce((sum,row)=>sum+Number(row.amountOre||0),0);
  return{incomingOre,outgoingOre,netOre:incomingOre-outgoingOre,count:rows.length};
}
function paymentSearchSuggestions(){return query.trim()?visibleRows().slice(0,8):[]}
function paymentSearchResults(){
  const rows=paymentSearchSuggestions();
  if(!rows.length)return '<div class="shared-search-empty">Inga betalningar matchar sökningen.</div>';
  return rows.map((row,index)=>`<button type="button" class="shared-search-option ${index===searchActiveIndex?'active':''}" role="option" aria-selected="${index===searchActiveIndex?'true':'false'}" data-payment-search-id="${esc(row.id)}"><span><b>${esc(row.counterparty||'Okänd motpart')}</b><small>${esc(row.invoiceNumber||row.reference||'Ingen fakturareferens')} · ${esc(row.paymentDate)}</small></span><strong>${row.direction==='out'?'-':''}${ore(row.amountOre)}</strong></button>`).join('');
}
function updateSearchUi(){
  const field=document.querySelector('[data-field="query"]'),results=document.getElementById('payments-search-results'),body=document.querySelector('.report-table tbody'),summaryEl=document.querySelector('.report-summary');
  if(body)body.innerHTML=tableRows(visibleRows());
  if(summaryEl)summaryEl.outerHTML=summary();
  if(!field||!results)return;
  const open=Boolean(searchOpen&&query.trim());
  field.setAttribute('aria-expanded',open?'true':'false');
  results.hidden=!open;
  if(open)results.innerHTML=paymentSearchResults();
}
function closeSearch(){
  searchOpen=false;searchActiveIndex=-1;
  const field=document.querySelector('[data-field="query"]'),results=document.getElementById('payments-search-results');
  field?.setAttribute('aria-expanded','false');if(results)results.hidden=true;
}
function exportControl(){
  if(isDemo)return '<a class="button" data-action="export" href="#" aria-disabled="true" title="Export är avstängd i den fristående demon">Exportera CSV</a>';
  if(isSupabase)return '<a class="button" data-action="export" href="#" title="Exportera filtrerade Supabase-UAT-betalningar">Exportera CSV</a>';
  return `<a class="button" data-action="export" href="${esc(exportUrl())}" download>Exportera CSV</a>`;
}
function toolbar(){return `<div class="payments-primary-actions"><button class="button" type="button" data-action="manual-payment-open">+ Registrera manuell inbetalning</button><span>Välj en kundfaktura, registrera betalningen och skicka den till Buntar för godkännande.</span></div><section class="report-toolbar payments-toolbar"><label>Period<select data-field="mode"><option value="day" ${mode==='day'?'selected':''}>Dag</option><option value="week" ${mode==='week'?'selected':''}>Vecka</option><option value="month" ${mode==='month'?'selected':''}>Månad</option><option value="quarter" ${mode==='quarter'?'selected':''}>Kvartal</option></select></label><label>Datum<input type="date" data-field="anchor" value="${esc(anchor)}"></label><label>Riktning<select data-field="direction"><option value="">Alla</option><option value="in" ${direction==='in'?'selected':''}>Inbetalningar</option><option value="out" ${direction==='out'?'selected':''}>Utbetalningar</option></select></label><label>Status<select data-field="status">${statusOptions()}</select></label><label class="payment-search-label">Sök<div class="shared-search-shell payments-search-shell"><input type="search" role="combobox" aria-autocomplete="list" aria-controls="payments-search-results" aria-expanded="${searchOpen&&query.trim()?'true':'false'}" autocomplete="off" data-field="query" value="${esc(query)}" placeholder="Motpart, faktura, referens"><div id="payments-search-results" class="shared-search-results" role="listbox" ${searchOpen&&query.trim()?'':'hidden'}>${searchOpen&&query.trim()?paymentSearchResults():''}</div></div></label><label>Konto<input data-field="account" value="${esc(account)}" inputmode="numeric" maxlength="4" placeholder="t.ex. 1930"></label><label>Sortera<select data-field="sort"><option value="date" ${sort==='date'?'selected':''}>Datum</option><option value="amount" ${sort==='amount'?'selected':''}>Belopp</option><option value="counterparty" ${sort==='counterparty'?'selected':''}>Motpart</option></select></label><label>Ordning<select data-field="order"><option value="asc" ${order==='asc'?'selected':''}>Stigande</option><option value="desc" ${order==='desc'?'selected':''}>Fallande</option></select></label><button class="button" type="button" data-action="reload" ${refreshing?'disabled':''}>${refreshing?'Uppdaterar…':'Uppdatera'}</button>${exportControl()}</section>`}
function summary(){if(!data)return'';const current=visibleSummary();return `<section class="report-summary payments-summary"><article><span>Inbetalningar</span><strong>${ore(current.incomingOre)}</strong></article><article><span>Utbetalningar</span><strong>${ore(current.outgoingOre)}</strong></article><article><span>Netto</span><strong>${ore(current.netOre)}</strong></article><article><span>Betalningar</span><strong>${current.count}</strong></article></section>`}
function tableRows(rows=visibleRows()){return rows.map(row=>`<tr class="payment-table-row payment-row-${esc(row.direction)}"><td class="numeric">${esc(row.paymentDate)}</td><td>${row.direction==='in'?'Inbetalning':'Utbetalning'}</td><td>${esc(row.counterparty||'—')}</td><td class="numeric">${esc(row.invoiceNumber||'—')}</td><td>${esc(row.statusLabel||paymentStatusLabel(row.direction,row.status)||'—')}</td><td class="numeric">${esc(row.reference||'—')}</td><td class="money">${row.direction==='out'?'-':''}${ore(row.amountOre)}</td></tr>`).join('')||'<tr><td colspan="7" class="report-empty">Inga betalningar i vald period.</td></tr>'}
function table(){if(!data)return'<div class="report-empty">Laddar…</div>';return `<section class="report-panel payments-panel-view"><div class="report-head"><div><span class="eyebrow">${esc(data.period.label)}</span><h2>In- och utbetalningar</h2><p>${esc(data.period.from)} – ${esc(data.period.to)}</p></div></div><div class="report-table-wrap"><table class="report-table financial-table"><thead><tr><th>Datum</th><th>Typ</th><th>Motpart</th><th>Faktura</th><th>Status</th><th>Referens</th><th>Belopp</th></tr></thead><tbody>${tableRows()}</tbody></table></div></section>`}
function invoicePickerMatches(invoice){const q=normalized(invoiceSearch);if(!q)return true;return [invoice.invoiceNumber,invoice.customerName,invoice.customerNumber].some(value=>normalized(value).includes(q))}
function invoicePickerRows(){return openInvoices.filter(invoicePickerMatches).slice(0,10)}
function manualPaymentModalHtml(){
  if(!manualPaymentModal)return '';
  if(manualPaymentModal.step==='search'){
    const rows=invoicePickerRows();
    return `<div class="modal-backdrop" data-action="manual-payment-close"><section class="modal manual-payment-modal" data-stop><header class="modal-head"><div><span class="eyebrow">Manuell kundinbetalning</span><h3>Välj faktura</h3></div><button data-action="manual-payment-close" aria-label="Stäng">×</button></header><div class="modal-body"><p>Sök på fakturanummer, kundnamn eller kundnummer. Endast bokförda debetfakturor med tillgängligt öppet saldo visas.</p><div class="shared-search-shell manual-invoice-search-shell"><input id="manual-invoice-search" type="search" role="combobox" aria-autocomplete="list" aria-controls="manual-invoice-results" value="${esc(invoiceSearch)}" placeholder="Fakturanummer, kund eller kundnummer" autocomplete="off"><div id="manual-invoice-results" class="shared-search-results manual-invoice-results" role="listbox">${rows.length?rows.map((invoice,index)=>`<button type="button" class="shared-search-option ${index===invoiceSearchIndex?'active':''}" data-action="manual-payment-select" data-invoice-id="${esc(invoice.id)}"><span><b>Faktura ${esc(invoice.invoiceNumber)}</b><small>${esc(invoice.customerName)} · ${esc(invoice.customerNumber)}</small></span><strong>${ore(invoice.availableOre)}</strong></button>`).join(''):'<div class="shared-search-empty">Ingen öppen faktura matchar sökningen.</div>'}</div></div><div class="modal-actions"><button type="button" class="button ghost" data-action="manual-payment-close">Avbryt</button></div></div></section></div>`;
  }
  const invoice=openInvoices.find(row=>String(row.id)===String(manualPaymentModal.invoiceId));
  if(!invoice)return '';
  const v=manualPaymentModal.values||{},defaultAccount=paymentAccounts.find(row=>row.number==='1930')||paymentAccounts[0]||{};
  return `<div class="modal-backdrop" data-action="manual-payment-close"><section class="modal manual-payment-modal" data-stop><header class="modal-head"><div><span class="eyebrow">Manuell kundinbetalning</span><h3>Registrera inbetalning</h3></div><button data-action="manual-payment-close" aria-label="Stäng">×</button></header><div class="modal-body"><div class="notice">Inbetalningen blir inte bokförd direkt. En bunt skapas och fakturans saldo ändras först när bunten godkänns.</div><div class="manual-payment-summary"><span>Kund</span><strong>${esc(invoice.customerName)}</strong><span>Kundnummer</span><strong>${esc(invoice.customerNumber)}</strong><span>Faktura</span><strong>${esc(invoice.invoiceNumber)}</strong><span>Fakturabelopp</span><strong>${ore(invoice.totalOre)}</strong><span>Återstår bokfört</span><strong>${ore(invoice.remainingOre)}</strong>${invoice.pendingOre?'<span>Väntar på godkännande</span><strong>'+ore(invoice.pendingOre)+'</strong>':''}<span>Tillgängligt att registrera</span><strong>${ore(invoice.availableOre)}</strong></div><form id="manual-payment-form"><label class="field">Betaldatum<input name="paymentDate" type="date" value="${esc(v.paymentDate||today())}" required></label><label class="field">Betalt belopp<input name="amount" inputmode="decimal" value="${esc(v.amount||((invoice.availableOre/100).toFixed(2).replace('.',',')))}" required></label><label class="field">Bank-/likvidkonto<select name="bankAccount" required>${liquidityOptions(v.bankAccount||defaultAccount.number||'')}</select></label><label class="field">Betalningsreferens<input name="reference" maxlength="160" value="${esc(v.reference||'')}"></label><label class="field">Kommentar<textarea name="comment" maxlength="1000" rows="3">${esc(v.comment??'Manuellt registrerad bankbetalning')}</textarea></label><p class="form-error">${esc(manualPaymentModal.error||'')}</p><div class="modal-actions"><button type="button" class="button ghost" data-action="manual-payment-back">Byt faktura</button><button type="submit" class="button" ${manualPaymentModal.submitting?'disabled':''}>${manualPaymentModal.submitting?'Registrerar…':'Registrera inbetalning'}</button></div></form></div></section></div>`;
}
function environmentBanner(){
  if(isDemo)return '<div class="demo-banner"><b>Fristående demo.</b> Betalningarna är fiktiva och sparas inte i Supabase.</div>';
  if(isSupabase)return '<div class="payments-live-banner"><span class="payments-live-dot" aria-hidden="true"></span><div><b>Supabase UAT</b><small>Gemensam testdata · MFA-skyddad företagsmiljö</small></div></div>';
  return '';
}
function render(){app.innerHTML=`<div class="reports-shell">${sidebar()}<section class="reports-main"><header class="topbar"><div><h1>Betalningar</h1><p>Inbetalningar · utbetalningar · periodfilter</p></div><div class="user-chip"><b>${esc(session?.user?.displayName||'Demoanvändare')}</b></div></header><main class="content payments-content">${environmentBanner()}${message?`<div class="notice" role="status" aria-live="polite">${esc(message)}</div>`:''}${toolbar()}${summary()}${table()}</main></section></div>${manualPaymentModalHtml()}`;globalThis.RollandsNavigation?.mount?.();updateSearchUi();if(manualPaymentModal?.step==='search')requestAnimationFrame(()=>document.getElementById('manual-invoice-search')?.focus())}
async function loadData({feedback=false}={}){
  refreshing=true;if(feedback){message='';render()}
  try{
    const next=isDemo?demo():(isSupabase?await supabasePayments():await api(`/reports/payments-overview?mode=${encodeURIComponent(mode)}&date=${encodeURIComponent(anchor)}&direction=${encodeURIComponent(direction)}&status=${encodeURIComponent(status)}&query=&account=${encodeURIComponent(account)}&sort=${encodeURIComponent(sort)}&order=${encodeURIComponent(order)}`));
    data=next;searchSourceRows=(next.rows||[]).map(row=>({...row}));
    if(feedback)message=`Betalningarna är uppdaterade ${new Intl.DateTimeFormat('sv-SE',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date())}.`;
  }finally{refreshing=false;render()}
}
function syncFields(){
  const value=name=>document.querySelector(`[data-field="${name}"]`)?.value??'';
  mode=value('mode')||mode;anchor=value('anchor')||anchor;direction=value('direction');status=value('status');query=value('query');account=value('account');sort=value('sort')||'date';order=value('order')||'asc';
}
function csvCell(value){const text=String(value??'');return /[;"\n\r]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text}
function exportSupabaseCsv(){
  const rows=visibleRows();
  const header=['Datum','Typ','Motpart','Faktura','Status','Referens','Konto','Belopp öre'];
  const body=rows.map(row=>[
    row.paymentDate,row.direction==='in'?'Inbetalning':'Utbetalning',row.counterparty||'',row.invoiceNumber||'',
    row.statusLabel||paymentStatusLabel(row.direction,row.status),row.reference||'',row.account||'',row.direction==='out'?-Number(row.amountOre||0):Number(row.amountOre||0)
  ]);
  const csv='\ufeff'+[header,...body].map(line=>line.map(csvCell).join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='betalningsoversikt-uat.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
}
document.addEventListener('change',event=>{if(event.target.dataset.field&&event.target.dataset.field!=='query')syncFields()});
document.addEventListener('input',event=>{if(event.target.id==='manual-invoice-search'){invoiceSearch=event.target.value;invoiceSearchIndex=-1;render();return}if(event.target.dataset.field!=='query')return;query=event.target.value;searchOpen=Boolean(query.trim());searchActiveIndex=-1;updateSearchUi()});
document.addEventListener('focusin',event=>{if(event.target.dataset.field==='query'&&query.trim()){searchOpen=true;updateSearchUi()}});
document.addEventListener('keydown',event=>{
  if(event.target.dataset.field!=='query')return;
  const rows=paymentSearchSuggestions();
  if(event.key==='Escape'){closeSearch();return}
  if(!rows.length)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();searchOpen=true;const step=event.key==='ArrowDown'?1:-1;searchActiveIndex=(searchActiveIndex+step+rows.length)%rows.length;updateSearchUi();return}
  if(event.key==='Enter'&&searchOpen){event.preventDefault();const row=rows[Math.max(0,searchActiveIndex)];if(row){query=String(row.invoiceNumber||row.reference||row.counterparty||'');closeSearch();render()}}
});
document.addEventListener('click',async event=>{
  const manualAction=event.target.closest('[data-action]');
  if(manualAction){const action=manualAction.dataset.action;if(action==='manual-payment-open'){if(isDemo){message='Manuella inbetalningar registreras i Supabase-UAT, inte i den fristående demon.';render();return}if(!isSupabase){location.href='./index.html';return}manualPaymentModal={step:'search',requestId:crypto.randomUUID(),submitting:false,error:''};invoiceSearch='';invoiceSearchIndex=-1;render();return}if(action==='manual-payment-close'){manualPaymentModal=null;render();return}if(action==='manual-payment-back'){manualPaymentModal={step:'search',requestId:manualPaymentModal?.requestId||crypto.randomUUID(),submitting:false,error:''};render();return}if(action==='manual-payment-select'){const invoice=openInvoices.find(row=>String(row.id)===String(manualAction.dataset.invoiceId));if(invoice){manualPaymentModal={step:'form',invoiceId:invoice.id,requestId:manualPaymentModal?.requestId||crypto.randomUUID(),submitting:false,error:'',values:{paymentDate:today(),amount:(invoice.availableOre/100).toFixed(2).replace('.',','),bankAccount:(paymentAccounts.find(row=>row.number==='1930')||paymentAccounts[0]||{}).number||'',reference:'',comment:'Manuellt registrerad bankbetalning'}};render()}return}}
  const suggestion=event.target.closest('[data-payment-search-id]');
  if(suggestion){const row=searchSourceRows.find(item=>String(item.id)===suggestion.dataset.paymentSearchId);if(row){query=String(row.invoiceNumber||row.reference||row.counterparty||'');closeSearch();render()}return}
  if(searchOpen&&!event.target.closest('.payments-search-shell'))closeSearch();
  const exportButton=event.target.closest('[data-action="export"]');
  if(exportButton&&isDemo){event.preventDefault();return}
  if(exportButton&&isSupabase){event.preventDefault();exportSupabaseCsv();return}
  if(event.target.closest('[data-action="reload"]')){syncFields();void loadData({feedback:true}).catch(error=>{refreshing=false;message=error.message;render()})}
});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='manual-payment-form')return;
  event.preventDefault();
  if(!manualPaymentModal||manualPaymentModal.submitting)return;
  const invoice=openInvoices.find(row=>String(row.id)===String(manualPaymentModal.invoiceId)),values=Object.fromEntries(new FormData(event.target));
  try{
    if(!isSupabase||!invoice)throw new Error('Den valda fakturan är inte längre tillgänglig.');
    const amountOre=parsePositiveOre(values.amount);
    if(amountOre>invoice.availableOre)throw new Error('Beloppet är större än fakturans återstående belopp ('+ore(invoice.availableOre)+').');
    const paymentDate=String(values.paymentDate||''),bankAccount=String(values.bankAccount||''),reference=String(values.reference||'').trim(),comment=String(values.comment||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate))throw new Error('Ange ett giltigt betaldatum.');
    if(!paymentAccounts.some(row=>row.number===bankAccount))throw new Error('Välj ett likvidkonto från kontoplanen.');
    manualPaymentModal={...manualPaymentModal,submitting:true,error:'',values:{paymentDate,amount:String(values.amount||''),bankAccount,reference,comment}};render();
    const ctx=await window.LTSupabaseUat.context();
    const staged=(await window.LTSupabase.rpc('stage_manual_customer_payment',{p_company_id:ctx.company.id,p_request_id:manualPaymentModal.requestId,p_invoice_id:invoice.id,p_payment_date:paymentDate,p_amount_ore:amountOre,p_bank_account:bankAccount,p_reference:reference||null,p_comment:comment||null},ctx.accessToken))?.[0];
    if(!staged)throw new Error('Inbetalningen kunde inte registreras.');
    manualPaymentModal=null;message='Inbetalningen '+ore(amountOre)+' har registrerats i bunt #'+String(staged.batch_number||'').padStart(5,'0')+' och väntar på godkännande.';await loadData();
  }catch(error){const raw=String(error?.message||error||'');let msg=raw;if(raw.includes('PAYMENT_EXCEEDS_AVAILABLE_BALANCE:'))msg='Beloppet är större än fakturans återstående belopp ('+ore(Number(raw.split(':').pop()||0))+').';else if(raw.includes('PAYMENT_ALREADY_PENDING'))msg='Det finns redan en väntande inbetalning som täcker fakturans saldo.';else if(raw.includes('PERIOD_LOCKED'))msg='Bokföringsperioden för betaldatumet är låst.';manualPaymentModal={...(manualPaymentModal||{}),step:'form',invoiceId:invoice?.id,requestId:manualPaymentModal?.requestId||crypto.randomUUID(),submitting:false,error:msg,values:{paymentDate:String(values.paymentDate||today()),amount:String(values.amount||''),bankAccount:String(values.bankAccount||''),reference:String(values.reference||''),comment:String(values.comment||'')}};render()}
});
async function load(){
  if(isSupabase){const accountConfig=await fetch('../config/accounting-accounts.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('Kontoplanen kunde inte laddas.');return response.json()});paymentAccounts=(accountConfig.accounts||[]).filter(row=>row.group==='Likvida medel'&&/^19[0-9]{2}$/.test(String(row.number||'')));}
  if(isDemo){session={user:{displayName:'Demo Ekonomi'}};return loadData()}
  if(isSupabase){
    const ctx=await window.LTSupabaseUat.context();
    if(!ctx.authenticated||!ctx.company){location.href='./index.html';return}
    session={user:ctx.user,company:ctx.company};
    return loadData();
  }
  const s=await api('/session');if(!s.authenticated){location.href='./index.html';return}session=s;await loadData();
}
load().catch(error=>{app.innerHTML=`<main class="boot"><strong>Betalningsöversikten kunde inte laddas</strong><span>${esc(error.message)}</span></main>`});
