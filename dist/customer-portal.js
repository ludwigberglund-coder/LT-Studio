let customerQuery='',selectedCustomer='';
function customerPortal() {
  const all=F.items(state,'customer'), total=F.totals(all);
  const groups=F.customerGroups(state,customerQuery);
  const selected=groups.find(g=>g.key===selectedCustomer) || (customerQuery && groups.length===1?groups[0]:null);
  const drill=ledgerFilters.customer.status || 'all';
  const visible=drill==='all'?groups:groups.filter(g=>g.invoices.some(i=>F.items(state,'customer',{status:drill}).some(x=>x.id===i.id)));
  const cards=visible.map(g=>`<button class="customer-card" data-action="select-customer" data-key="${escapeHtml(g.key)}"><b>${escapeHtml(g.number)} · ${escapeHtml(g.party)}</b><span>${g.invoices.length} avier · Netto ${money(F.totals(g.invoices).open)}</span><small>Visa hela kundreskontran →</small></button>`).join('');
  let detail='';
  if(selected) {
    const sort=ledgerSort.customer;
    const value=(i,key)=>({invoiceDate:i.invoiceDate,aviNumber:i.aviNumber,invoiceAmount:i.total,due:i.dueDate,transactionAmount:i.paidAmount,remaining:i.remaining,bookingType:i.credit?'Kreditfaktura':i.status}[key] ?? '');
    const invoices=[...selected.invoices].sort((a,b)=>{const av=value(a,sort.key),bv=value(b,sort.key);const cmp=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'sv',{numeric:true});return sort.dir==='asc'?cmp:-cmp;});
    const visible=ledgerColumns.customer.map((show,index)=>show?index:null).filter(index=>index!==null);
    const body=invoices.map(i=>`<tbody><tr class="invoice-group" data-credit-invoice="${i.remaining<0?'true':'false'}" data-invoice-id="${i.id}"><th colspan="${visible.length}"><div><b>${escapeHtml(i.aviNumber)} · ${escapeHtml(i.status)} · Rest ${money(i.remaining)}</b><button class="button ghost sm" data-action="res-detail" data-kind="customer" data-id="${i.id}">Öppna & registrera betalning</button></div></th></tr>${F.rows(i).map(r=>`<tr data-action="res-detail" data-kind="customer" data-id="${i.id}" tabindex="0" role="button">${F.values(r).map((v,n)=>ledgerColumns.customer[n]?`<td class="${[5,11,12].includes(n)?'number-cell':''}">${v==null || v===''?'—':[5,11,12].includes(n)?decimal(v):escapeHtml(v)}</td>`:'').join('')}</tr>`).join('')}</tbody>`).join('');
    const hkeys=['invoiceDate','bookingType','method','aviNumber','invoiceDate','invoiceAmount','due','batch','transactionDate','bookingType','transactionNumber','transactionAmount','remaining'];
    const headers=F.headers.map((h,index)=>{if(!ledgerColumns.customer[index])return '';const key=hkeys[index],active=sort.key===key;return `<th><button class="sort-heading" data-action="sort-res" data-kind="customer" data-key="${key}">${h}${active?` <span>${sort.dir==='asc'?'↑':'↓'}</span>`:''}</button></th>`}).join('');
    const picker=`<details class="column-picker"><summary>Välj kolumner</summary><div>${F.headers.map((h,index)=>`<label><input type="checkbox" data-column-toggle data-kind="customer" data-index="${index}" ${ledgerColumns.customer[index]?'checked':''}>${h}</label>`).join('')}</div></details>`;
    detail=`<section class="panel"><div class="panel-head"><div><h2>${escapeHtml(selected.number)} · ${escapeHtml(selected.party)}</h2><p class="hint">Hela kundreskontran. Restbeloppet visar aktuellt saldo på varje rad för fakturan.</p></div><button class="button ghost" data-action="export-customer" data-party="${escapeHtml(selected.party)}" data-number="${escapeHtml(selected.number)}">Exportera kund</button></div>${picker}<div class="table-wrap"><table class="data-table res-table"><thead><tr>${headers}</tr></thead>${body}</table></div></section>`;
  }
  return workspaceChrome(`${heading('Kundreskontra','Överblick över alla kunder. Sök på kund, kundnummer, avinummer, OCR eller betalningsreferens.','<button class="button" data-action="manual-payment">+ Registrera inbetalning utan fil</button>')}<section class="metrics res-metrics"><article class="metric"><span>Fordringar</span><div class="number">${money(F.sum(all.filter(i=>i.remaining>0),'remaining'))}</div></article><article class="metric"><span>Kunder har tillgodo</span><div class="number">${money(-F.sum(all.filter(i=>i.remaining<0),'remaining'))}</div></article><article class="metric"><span>Netto kundreskontra</span><div class="number">${money(total.open)}</div></article><article class="metric"><span>Förfallet</span><div class="number">${money(total.overdue)}</div></article></section><section class="panel"><form data-form="customer-search" class="res-filters"><label>Sök kund eller avinummer<input name="query" type="search" value="${escapeHtml(customerQuery)}" placeholder="Kundnamn, K-1001, 2026-1005 eller OCR"></label><button class="button" type="submit">Sök</button><button class="button ghost" type="button" data-action="reset-customers">Visa alla kunder</button></form><p class="hint">${visible.length} kunder${drill!=='all'?' med poster i valt dashboardurval':''}. En träff på en avi visar kundens hela reskontra. Vid flera kunder väljer du rätt bolag nedan. Högerklicka på ett negativt restbelopp för kvittning eller återbetalning.</p><div class="customer-cards">${cards || '<p>Inga kunder matchar sökningen.</p>'}</div></section>${detail}`);
}
function manualPaymentChooser() {
  const invoices=F.items(state,'customer').filter(i=>!i.credit && i.total>0);
  return modalShell('Registrera inbetalning utan fil',`<p>Välj kundfaktura. Ange sedan en genomförd betalning, datum och referens. En överbetalning blir ett negativt restbelopp som kunden har tillgodo.</p><form data-form="choose-payment"><label class="field">Kund och faktura<select name="invoiceId" required><option value="">Välj faktura</option>${invoices.map(i=>`<option value="${i.id}">${escapeHtml(i.partyNumber)} · ${escapeHtml(i.party)} · ${escapeHtml(i.aviNumber)} · ${money(i.remaining)}</option>`).join('')}</select></label><div class="modal-foot"><button class="button" type="submit">Fortsätt</button></div></form>`);
}
function supplierWarnings() {
  const invoices=F.items(state,'supplier').filter(i=>F.supplierAlert(i)).sort((a,b)=>(a.booked-b.booked)||a.dueDate.localeCompare(b.dueDate));
  if(!invoices.length)return '';
  return `<section class="supplier-alert" role="status"><h2>⚑ ${invoices.length} leverantörsfakturor kräver uppmärksamhet</h2><p>Förfallna, förfaller idag eller inom 1–5 dagar. Ej attesterade visas först.</p>${invoices.map(i=>`<div><span><b>${escapeHtml(F.supplierAlert(i))}</b><br>${escapeHtml(i.party)} · ${escapeHtml(i.aviNumber)} · ${i.dueDate} · ${money(i.total)}</span><button class="button ghost" data-action="res-detail" data-kind="supplier" data-id="${i.id}">${i.booked?'Visa betalning':'Öppna attest'}</button></div>`).join('')}</section>`;
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  if(b.dataset.action==='select-customer'){selectedCustomer=b.dataset.key;render();}
  if(b.dataset.action==='reset-customers'){customerQuery='';selectedCustomer='';ledgerFilters.customer={status:'all'};render();}
  if(b.dataset.action==='manual-payment'){activeModal={type:'manual-payment'};render();}
  if(b.dataset.action==='export-customer')location.href='/api/export/reskontra?'+new URLSearchParams({kind:'customer',party:b.dataset.party,partyNumber:b.dataset.number});
});
document.addEventListener('submit',e=>{
  if(e.target.dataset.form==='customer-search'){e.preventDefault();customerQuery=new FormData(e.target).get('query').trim();selectedCustomer='';ledgerFilters.customer={status:'all'};render();}
  if(e.target.dataset.form==='choose-payment'){e.preventDefault();activeModal={type:'payment',kind:'customer',id:new FormData(e.target).get('invoiceId'),key:crypto.randomUUID()};render();}
});
document.addEventListener('contextmenu',e=>{
  const row=e.target.closest('[data-credit-invoice="true"]');
  if(!row)return;
  e.preventDefault();
  activeModal={type:'credit-menu',id:row.dataset.invoiceId};
  render();
});
