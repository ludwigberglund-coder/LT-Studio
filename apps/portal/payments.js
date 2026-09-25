const app=document.getElementById('payments-app');
const isDemo=location.hostname==='ludwigberglund-coder.github.io'||new URLSearchParams(location.search).has('demo');
let session=null,mode='month',anchor=today(),direction='',status='',query='',account='',sort='date',order='asc',data=null,message='',refreshing=false,searchOpen=false,searchActiveIndex=-1,searchSourceRows=[];
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
  ['prepared','Utbetalning · förberedd, ej frisläppt'],
  ['released','Utbetalning · frisläppt, väntar bankbekräftelse'],
  ['paid','Utbetalning · betald & bokförd'],
  ['cancelled','Utbetalning · avbruten']
];
function statusOptions(){return PAYMENT_STATUS_OPTIONS.map(([value,label])=>`<option value="${esc(value)}" ${status===value?'selected':''}>${esc(label)}</option>`).join('')}
function ore(v){return new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK',minimumFractionDigits:2}).format(Number(v||0)/100)}
async function api(path){const r=await fetch('/api/v1'+path,{credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||'Begäran misslyckades.');return body}
function demo(){return{period:{mode,from:'2026-09-01',to:'2026-09-30',label:'2026-09'},filters:{direction:null,status:null},summary:{incomingOre:627500,outgoingOre:209600,netOre:417900,count:4},rows:[
{id:'demo-in-1',direction:'in',paymentDate:'2026-09-10',amountOre:392500,status:'posted',reference:'BG-1041',counterparty:'Nordic Office Göteborg AB',counterpartyAccount:'',invoiceNumber:'310002'},
{id:'demo-in-2',direction:'in',paymentDate:'2026-09-12',amountOre:235000,status:'posted',reference:'BG-1042',counterparty:'Majorna Fastigheter AB',counterpartyAccount:'',invoiceNumber:'310004'},
{id:'demo-out-1',direction:'out',paymentDate:'2026-09-14',amountOre:84600,status:'paid',reference:'987-6543',counterparty:'Göteborgs Fruktimport AB',counterpartyAccount:'987-6543',invoiceNumber:'GF-8821'},
{id:'demo-out-2',direction:'out',paymentDate:'2026-09-18',amountOre:125000,status:'prepared',reference:'555-2200',counterparty:'Lokal Grossist AB',counterpartyAccount:'555-2200',invoiceNumber:'LG-1020'}]}}
function exportUrl(){return `/api/v1/exports/payments-overview?mode=${encodeURIComponent(mode)}&date=${encodeURIComponent(anchor)}&direction=${encodeURIComponent(direction)}&status=${encodeURIComponent(status)}&query=${encodeURIComponent(query)}&account=${encodeURIComponent(account)}&sort=${encodeURIComponent(sort)}&order=${encodeURIComponent(order)}`}
function sidebar(){return '<aside class="sidebar"></aside>'}
function normalized(value){return String(value||'').trim().toLocaleLowerCase('sv-SE')}
function paymentMatches(row,needle=query){
  const q=normalized(needle);if(!q)return true;
  return [row.counterparty,row.counterpartyAccount,row.invoiceNumber,row.reference,row.statusLabel||paymentStatusLabel(row.direction,row.status),row.paymentDate].some(value=>normalized(value).includes(q));
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
function toolbar(){return `<section class="report-toolbar"><label>Period<select data-field="mode"><option value="day" ${mode==='day'?'selected':''}>Dag</option><option value="week" ${mode==='week'?'selected':''}>Vecka</option><option value="month" ${mode==='month'?'selected':''}>Månad</option><option value="quarter" ${mode==='quarter'?'selected':''}>Kvartal</option></select></label><label>Datum<input type="date" data-field="anchor" value="${esc(anchor)}"></label><label>Riktning<select data-field="direction"><option value="">Alla</option><option value="in" ${direction==='in'?'selected':''}>Inbetalningar</option><option value="out" ${direction==='out'?'selected':''}>Utbetalningar</option></select></label><label>Status<select data-field="status">${statusOptions()}</select></label><label class="payment-search-label">Sök<div class="shared-search-shell payments-search-shell"><input type="search" role="combobox" aria-autocomplete="list" aria-controls="payments-search-results" aria-expanded="${searchOpen&&query.trim()?'true':'false'}" autocomplete="off" data-field="query" value="${esc(query)}" placeholder="Motpart, faktura, referens"><div id="payments-search-results" class="shared-search-results" role="listbox" ${searchOpen&&query.trim()?'':'hidden'}>${searchOpen&&query.trim()?paymentSearchResults():''}</div></div></label><label>Konto<input data-field="account" value="${esc(account)}" inputmode="numeric" maxlength="4" placeholder="t.ex. 1930"></label><label>Sortera<select data-field="sort"><option value="date" ${sort==='date'?'selected':''}>Datum</option><option value="amount" ${sort==='amount'?'selected':''}>Belopp</option><option value="counterparty" ${sort==='counterparty'?'selected':''}>Motpart</option></select></label><label>Ordning<select data-field="order"><option value="asc" ${order==='asc'?'selected':''}>Stigande</option><option value="desc" ${order==='desc'?'selected':''}>Fallande</option></select></label><button class="button" type="button" data-action="reload" ${refreshing?'disabled':''}>${refreshing?'Uppdaterar…':'Uppdatera'}</button><a class="button" data-action="export" href="${isDemo?'#':esc(exportUrl())}" ${isDemo?'aria-disabled="true" title="Export är endast tillgänglig i den privata portalen"':'download'}>Exportera CSV</a></section>`}
function summary(){if(!data)return'';const current=visibleSummary();return `<section class="report-summary"><article><span>Inbetalningar</span><strong>${ore(current.incomingOre)}</strong></article><article><span>Utbetalningar</span><strong>${ore(current.outgoingOre)}</strong></article><article><span>Netto</span><strong>${ore(current.netOre)}</strong></article><article><span>Betalningar</span><strong>${current.count}</strong></article></section>`}
function tableRows(rows=visibleRows()){return rows.map(row=>`<tr><td class="numeric">${esc(row.paymentDate)}</td><td>${row.direction==='in'?'Inbetalning':'Utbetalning'}</td><td>${esc(row.counterparty||'—')}</td><td class="numeric">${esc(row.invoiceNumber||'—')}</td><td>${esc(row.statusLabel||paymentStatusLabel(row.direction,row.status)||'—')}</td><td class="numeric">${esc(row.reference||'—')}</td><td class="money">${row.direction==='out'?'-':''}${ore(row.amountOre)}</td></tr>`).join('')||'<tr><td colspan="7" class="report-empty">Inga betalningar i vald period.</td></tr>'}
function table(){if(!data)return'<div class="report-empty">Laddar…</div>';return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">${esc(data.period.label)}</span><h2>In- och utbetalningar</h2><p>${esc(data.period.from)} – ${esc(data.period.to)}</p></div></div><div class="report-table-wrap"><table class="report-table financial-table"><thead><tr><th>Datum</th><th>Typ</th><th>Motpart</th><th>Faktura</th><th>Status</th><th>Referens</th><th>Belopp</th></tr></thead><tbody>${tableRows()}</tbody></table></div></section>`}
function render(){app.innerHTML=`<div class="reports-shell">${sidebar()}<section class="reports-main"><header class="topbar"><div><h1>Betalningar</h1><p>Inbetalningar · utbetalningar · periodfilter</p></div><div class="user-chip"><b>${esc(session?.user?.displayName||'Demoanvändare')}</b></div></header><main class="content">${isDemo?'<div class="demo-banner"><b>GitHub Pages-demo.</b> Betalningarna är fiktiva.</div>':''}${message?`<div class="notice" role="status" aria-live="polite">${esc(message)}</div>`:''}${toolbar()}${summary()}${table()}</main></section></div>`;globalThis.RollandsNavigation?.mount?.();updateSearchUi()}
async function loadData({feedback=false}={}){
  refreshing=true;if(feedback){message='';render()}
  try{
    const next=isDemo?demo():await api(`/reports/payments-overview?mode=${encodeURIComponent(mode)}&date=${encodeURIComponent(anchor)}&direction=${encodeURIComponent(direction)}&status=${encodeURIComponent(status)}&query=&account=${encodeURIComponent(account)}&sort=${encodeURIComponent(sort)}&order=${encodeURIComponent(order)}`);
    data=next;searchSourceRows=(next.rows||[]).map(row=>({...row}));
    if(feedback)message=`Betalningarna är uppdaterade ${new Intl.DateTimeFormat('sv-SE',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date())}.`;
  }finally{refreshing=false;render()}
}
function syncFields(){
  const value=name=>document.querySelector(`[data-field="${name}"]`)?.value??'';
  mode=value('mode')||mode;anchor=value('anchor')||anchor;direction=value('direction');status=value('status');query=value('query');account=value('account');sort=value('sort')||'date';order=value('order')||'asc';
}
document.addEventListener('change',event=>{if(event.target.dataset.field&&event.target.dataset.field!=='query')syncFields()});
document.addEventListener('input',event=>{if(event.target.dataset.field!=='query')return;query=event.target.value;searchOpen=Boolean(query.trim());searchActiveIndex=-1;updateSearchUi()});
document.addEventListener('focusin',event=>{if(event.target.dataset.field==='query'&&query.trim()){searchOpen=true;updateSearchUi()}});
document.addEventListener('keydown',event=>{
  if(event.target.dataset.field!=='query')return;
  const rows=paymentSearchSuggestions();
  if(event.key==='Escape'){closeSearch();return}
  if(!rows.length)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();searchOpen=true;const step=event.key==='ArrowDown'?1:-1;searchActiveIndex=(searchActiveIndex+step+rows.length)%rows.length;updateSearchUi();return}
  if(event.key==='Enter'&&searchOpen){event.preventDefault();const row=rows[Math.max(0,searchActiveIndex)];if(row){query=String(row.invoiceNumber||row.reference||row.counterparty||'');closeSearch();render()}}
});
document.addEventListener('click',event=>{
  const suggestion=event.target.closest('[data-payment-search-id]');
  if(suggestion){const row=searchSourceRows.find(item=>String(item.id)===suggestion.dataset.paymentSearchId);if(row){query=String(row.invoiceNumber||row.reference||row.counterparty||'');closeSearch();render()}return}
  if(searchOpen&&!event.target.closest('.payments-search-shell'))closeSearch();
  if(event.target.closest('[data-action="reload"]')){syncFields();void loadData({feedback:true}).catch(error=>{refreshing=false;message=error.message;render()})}
});
async function load(){if(isDemo){session={user:{displayName:'Demo Ekonomi'}};return loadData()}const s=await api('/session');if(!s.authenticated){location.href='./index.html';return}session=s;await loadData()}
load().catch(error=>{app.innerHTML=`<main class="boot"><strong>Betalningsöversikten kunde inte laddas</strong><span>${esc(error.message)}</span></main>`});
