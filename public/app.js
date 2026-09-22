const app = document.getElementById('app');
let state = null;
let view = location.hash === '#/website' ? 'public' : 'admin';
let page = location.hash.startsWith('#/') && location.hash !== '#/website' ? location.hash.slice(2) : 'overview';
let activeModal = null;
let demoMode = false;
let accountPlanQuery = '';
const DEMO_STORAGE_KEY = 'rollands-demo-state-v2';

const icon = {
  overview: '◫', invoices: '▤', supplier: '▥', bank: '⇄', ledger: '▦', accounts: '≡', review: '✦', settings: '⚙'
};
const pages = [
  ['overview', 'Översikt'], ['invoices', 'Kundfakturor'], ['supplier', 'Leverantörsfakturor'], ['bank', 'Bank & avstämning'], ['ledger', 'Bokföring'], ['accounts', 'Kontoplan'], ['review', 'AI-granskning'], ['settings', 'Inställningar']
];

function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function money(value) { return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(value || 0)); }
function decimal(value) { return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(Math.round(value || 0)); }
function date(value) { return new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`)); }
function statusClass(status) { return ({ 'Betald':'paid','Matchad':'matched','Bokförd':'booked','Skickad':'sent','Attest väntar':'pending','Granska':'review','Utkast':'draft','Delbetald':'pending','Förfallen':'review' }[status] || 'draft'); }
function status(status) { return `<span class="status ${statusClass(status)}">${escapeHtml(status)}</span>`; }
function reviewCount() { return state.bankTransactions.filter(item => item.status === 'Granska').length; }
function openSupplierAmount() { return state.supplierInvoices.filter(item => item.status === 'Attest väntar').reduce((sum,item) => sum + item.total, 0); }
function outstandingAmount() { return F.totals(F.items(state,'customer')).open; }
function persistDemoState() { if (demoMode && state) { try { localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state)); } catch {} } }
function syncStore(data) { state = data.store || data; persistDemoState(); render(); }
function toast(message) { const el = document.getElementById('toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3400); }
function openDemoInvoice(invoice) {
  if (!invoice) return;
  const popup = window.open('', '_blank');
  if (!popup) { toast('Tillåt popup-fönster för att öppna PDF-fakturan.'); return; }
  const rows = (invoice.lines || []).map(line => `<tr><td>${escapeHtml(line.description || '')}</td><td>${Math.round(line.net || line.amount || 0)} kr</td><td>${line.vatRate || 0} %</td></tr>`).join('');
  popup.document.write(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Faktura ${escapeHtml(invoice.number)}</title><style>body{font:14px Arial;color:#153b2e;margin:48px}header{display:flex;justify-content:space-between;border-bottom:3px solid #153b2e;padding-bottom:18px}table{width:100%;border-collapse:collapse;margin-top:35px}th,td{text-align:left;padding:10px;border-bottom:1px solid #d9e2d4}footer{margin-top:50px;border-top:1px solid #153b2e;padding-top:15px}</style></head><body><header><div><h1>Demo Handel AB</h1><p>${escapeHtml(invoice.customer || '')}</p><p>${escapeHtml(invoice.address || '')}</p></div><div><h1>${invoice.credit ? 'KREDITFAKTURA' : 'FAKTURA'}</h1><p>Fakturanummer: <b>${escapeHtml(invoice.number)}</b></p><p>OCR: <b>${escapeHtml(invoice.ocr || invoice.number)}</b></p><p>Bokföringsdag: ${escapeHtml(invoice.postingDate || invoice.date || '')}</p></div></header><table><thead><tr><th>Fakturatext</th><th>Belopp</th><th>Moms</th></tr></thead><tbody>${rows}</tbody></table><h2>Att betala: ${Math.round(invoice.total || 0)} kr</h2><footer>Vid betalning efter förfallodagen debiteras dröjsmålsränta med referensränta + 8 %.</footer></body></html>`);
  popup.document.close();
  setTimeout(() => popup.print(), 100);
}
async function api(path, options = {}, mayAuthenticate = true) {
  if (demoMode && options.method === 'POST') return demoApi(path, options.body || {});
  let response;
  const request = {credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, ...options, body: options.body ? JSON.stringify(options.body) : undefined};
  try { response = await fetch(path, request); }
  catch (error) { if (demoMode && path === '/api/state') return {store: window.ROLLANDS_DEMO}; throw error; }
  if (response.status === 401 && mayAuthenticate && path !== '/api/session') {
    const token = window.prompt('Ange administratörsnyckeln för LT Studio Demo. Nyckeln sparas inte i webbläsaren.');
    if (!token) throw new Error('Autentisering avbröts.');
    const login = await fetch('/api/session', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token})});
    const loginData = await login.json().catch(() => ({}));
    if (!login.ok) throw new Error(loginData.error || 'Inloggningen misslyckades.');
    return api(path, options, false);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Något gick fel.');
  return data;
}

function demoApi(path, body) {
  const now = F.localToday();
  if (path === '/api/receivables/reclassify' || path === '/api/receivables/offset' || path === '/api/bank/resolve') {
    const draft = structuredClone(state);
    const addPosting = posting => {
      const used = new Set([...(draft.journal || []).map(j => j.batchNumber), ...[...(draft.invoices || []), ...(draft.supplierInvoices || [])].flatMap(i => [i.batchNumber, ...(i.payments || []).map(p => p.batch)])]);
      let batchNumber;
      for (let n = 1000; n <= 9999; n++) if (!used.has(String(n))) { batchNumber = String(n); break; }
      if (!batchNumber) throw new Error('Alla fyrsiffriga buntnummer är upptagna.');
      const highest = Math.max(0, ...(draft.journal || []).map(j => Number(String(j.number || 'A0').slice(1)) || 0));
      const entry = {...posting, id: crypto.randomUUID(), postingDate: posting.date, number: `A${highest + 1}`, batchNumber};
      draft.journal.unshift(entry);
      (draft.auditLog ||= []).unshift({id: crypto.randomUUID(), at: new Date().toISOString(), actor: 'Demoanvändare', action: 'VERIFIKATION_SKAPAD', details: `${entry.number} · bunt ${batchNumber}: ${posting.description}`});
      return entry;
    };
    const result = path === '/api/bank/resolve' ? demoResolveBank(draft, body, addPosting) : ReceivablesTools.execute(draft, path.endsWith('offset') ? 'offset' : 'reclassify', body, addPosting, () => crypto.randomUUID());
    // Save atomically: a storage error must not report successful bookkeeping.
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(draft));
    state = draft;
    return {store: draft, reclassification: result};
  }
  let createdInvoice = null;
  const batch = () => { const used=(state.journal||[]).map(j=>Number(j.batchNumber)||0); let n=Math.max(999,...used)+1; if(n>9999)n=1000; while(used.includes(n)) n=n>=9999?1000:n+1; return String(n).padStart(4,'0'); };
  const journal = (description, rows, source, date=now) => { const highest=Math.max(0,...(state.journal||[]).map(j=>Number(String(j.number||'A0').slice(1))||0)); const entry={id:`demo_local_${Date.now()}`,date,postingDate:date,number:`A${highest+1}`,batchNumber:batch(),description,source,rows}; state.journal.unshift(entry); return entry; };
  if (path === '/api/invoice-settings') Object.assign(state.business, body);
  else if (path === '/api/settings') Object.assign(state.settings, body);
  else if (path === '/api/period-locks') { state.settings.lockedPeriods ||= []; state.settings.lockedPeriods = body.action === 'lock' ? [...new Set([...state.settings.lockedPeriods,body.period])].sort() : state.settings.lockedPeriods.filter(p=>p!==body.period); }
  else if (path === '/api/invoices') {
    const calc=InvoiceModel.calculate(body.lines || [{description:body.reference||'Varor och tjänster',amount:body.net,account:'3010',vatRate:body.vatRate||25}], body.invoiceType==='credit');
    const used=(state.invoices||[]).map(i=>Number(String(i.number||'').replace(/\D/g,''))).filter(n=>n>=100000&&n<=999999); const number=String(Math.max(100000,...used)+1).padStart(6,'0');
    const invoice={id:`demo_local_inv_${Date.now()}`,number,ocr:number,customerNumber:body.customerNumber||`K-${1000+state.invoices.length}`,customer:body.customer,address:body.address,reference:body.reference,ourContact:body.ourContact||state.business.invoiceContact,date:body.date||now,postingDate:body.postingDate||body.date||now,dueDate:body.dueDate||body.date||now,paymentTerms:Number(body.paymentTerms||30),...calc,credit:body.invoiceType==='credit',status:body.invoiceType==='credit'?'Kredit':'Bokförd',paid:false,payments:[],pdfReady:false}; const entry=journal(`${invoice.credit?'Kreditfaktura':'Kundfaktura'} ${number} – ${invoice.customer}`,calc.rows,invoice.credit?'Kreditfaktura':'Kundfaktura',invoice.postingDate); invoice.journalNumber=entry.number; invoice.batchNumber=entry.batchNumber; state.invoices.unshift(invoice); createdInvoice=invoice;
  } else if (path === '/api/payments') { const list=body.kind==='supplier'?state.supplierInvoices:state.invoices; const invoice=list.find(i=>i.id===body.invoiceId); if(invoice){ const amount=Math.round(Number(body.amount)||0); const entry=journal(`Inbetalning ${invoice.number} · ${body.reference||''}`,[{account:'1930 Företagskonto',debit:amount,credit:0},{account:body.kind==='supplier'?'2440 Leverantörsskulder':'1510 Kundfordringar',debit:0,credit:amount}],'Registrerad betalning',body.date||now); invoice.payments ||= []; invoice.payments.push({id:`demo_local_pay_${Date.now()}`,amount,date:body.date||now,method:body.method,reference:body.reference,batch:entry.batchNumber,journalNumber:entry.number}); F.updateStatus(invoice,body.kind||'customer'); } }
  else if (path === '/api/supplier-invoices') state.supplierInvoices.unshift({...body,id:`demo_local_sup_${Date.now()}`,received:body.received||now,status:'Attest väntar',payments:[],net:Math.round(Number(body.net)||0),vat:Math.round((Number(body.net)||0)*Number(body.vatRate||25)/100),total:Math.round((Number(body.net)||0)*(1+Number(body.vatRate||25)/100)),source:body.source||'Manuell registrering'});
  else if (path === '/api/supplier-invoices/approve') { const invoice=state.supplierInvoices.find(i=>i.id===body.id); if(invoice){ invoice.status='Bokförd'; const entry=journal(`Inköp ${invoice.supplier}, ${invoice.invoiceNumber}`,[{account:invoice.suggestedAccount,debit:invoice.net,credit:0},{account:'2641 Ingående moms',debit:invoice.vat,credit:0},{account:'2440 Leverantörsskulder',debit:0,credit:invoice.total}],invoice.source,body.postingDate||now); invoice.journalNumber=entry.number; invoice.batchNumber=entry.batchNumber; invoice.postingDate=entry.postingDate; } }
  persistDemoState(); return {store:state, ...(createdInvoice ? {invoice:createdInvoice} : {})};
}

function demoResolveBank(draft, body, addPosting) {
  const tx = draft.bankTransactions.find(t => t.id === body.id);
  if (!tx || tx.status !== 'Granska') throw new Error('Bankhändelsen saknas eller är redan bokförd.');
  if (!F.validDate(tx.date) || tx.date > F.localToday() || (draft.settings.lockedPeriods || []).includes(tx.date.slice(0,7))) throw new Error('Bankhändelsen måste ha en giltig bokföringsdag i en öppen period.');
  if (tx.currency && tx.currency !== 'SEK') throw new Error('Valutahantering kräver manuell granskning.');
  if (!Number.isSafeInteger(tx.amount) || !tx.amount) throw new Error('Bankbeloppet måste anges i hela kronor.');
  let invoice, account;
  const kind = tx.amount > 0 ? 'customer' : 'supplier';
  if (body.action === 'match') {
    invoice = (kind === 'customer' ? draft.invoices : draft.supplierInvoices).find(i => i.id === body.invoiceId);
    if (!invoice) throw new Error(kind === 'customer' ? 'Välj en kundfaktura.' : 'Välj en leverantörsfaktura.');
    F.validatePayment(invoice,kind,{amount:Math.abs(tx.amount),date:tx.date,method:'Bank',reference:tx.transactionRef});
    if ([...draft.invoices,...draft.supplierInvoices].some(i=>(i.payments || []).some(p=>p.reference===tx.transactionRef))) throw new Error('Bankreferensen är redan registrerad.');
    account = kind === 'customer' ? '1510 Kundfordringar' : '2440 Leverantörsskulder';
  } else {
    const pattern = tx.amount > 0 ? /^3\d{3}(?=\s|$)/ : /^(?:[4-7]\d{3}|84\d{2})(?=\s|$)/;
    const code = String(body.account || '').match(pattern)?.[0];
    const choice = code && window.RollandsAccountPlan.byCode[code];
    if (body.action !== 'book' || !choice) throw new Error(tx.amount > 0 ? 'Välj ett intäktskonto ur kontoplanen.' : 'Välj ett kostnadskonto ur kontoplanen.');
    account = `${choice.code} ${choice.name}`;
  }
  const amount = Math.abs(tx.amount);
  const rows = tx.amount < 0 ? [{account,debit:amount,credit:0},{account:'1930 Företagskonto',debit:0,credit:amount}] : [{account:'1930 Företagskonto',debit:amount,credit:0},{account,debit:0,credit:amount}];
  const entry = addPosting({date:tx.date,rows,description:`${tx.text} · ${tx.transactionRef}${invoice ? ' · ' + F.invoiceNumber(invoice) : ''}`,source:'Bankavstämning'});
  Object.assign(tx,{status:invoice?'Matchad':'Bokförd',account,journalNumber:entry.number,batch:entry.batchNumber,proposal:`Bokförd på ${account}`});
  if (invoice) {
    (invoice.payments ||= []).push({id:crypto.randomUUID(),amount,date:tx.date,method:'Bank',reference:tx.transactionRef,bankId:tx.id,batch:entry.batchNumber,journalNumber:entry.number});
    tx.invoiceId=invoice.id;tx.invoiceKind=kind;F.updateStatus(invoice,kind);
  }
  return {entry};
}

function publicPage() {
  const b = state?.business || {};
  return `
  <div class="site-shell">
    <header class="public-nav">
      <a class="brand" href="#/website" data-action="public">LT Studio<small>SYNTETISK DEMO</small></a>
      <nav class="public-links" aria-label="Huvudmeny">
        <a href="#butiken">Butiken</a><a href="#foretagsfrukt">Företagsfrukt</a><a href="#catering">Catering</a><a href="#kontakt">Kontakt</a>
      </nav>
      <button class="button ghost sm" data-action="admin">Öppna ekonomi</button>
    </header>
    <main>
      <section class="hero" id="butiken">
        <div>
          <div class="eyebrow">Din lokala saluhallsbutik i väst</div>
          <h1>Smak som gör vardagen lite bättre.</h1>
          <p>Frukt och grönt, ost och chark, bröd, presenter och delikatesser – noga utvalt för att det ska smaka riktigt gott.</p>
          <div class="hero-actions"><a class="button" href="#kontakt">Besök vår butik</a><a class="button alt" href="#foretagsfrukt">Företagsfrukt</a></div>
        </div>
        <div class="hero-art" aria-label="Illustration av frukt och grönt">
          <div class="art-panel"></div><div class="fruit orange"></div><div class="fruit pear"></div><div class="fruit berry"></div><div class="fruit berry two"></div><div class="leaf"></div>
          <div class="hero-note"><b>God smak först.</b>Varje produkt behöver klara vårt eget smaktest.</div>
        </div>
      </section>
      <section class="public-section tinted" id="foretagsfrukt"><div class="section-inner">
        <div class="section-title"><div class="eyebrow">Demo för företag</div><h2>Färsk energi till arbetsplatsen.</h2><p>Vi levererar företagsfrukt och frukosttillbehör till företag i Göteborg och Kungsbacka.</p></div>
        <div class="service-grid"><article class="service-card"><div class="mark">◉</div><h3>Frukt på jobbet</h3><p>Välfyllda fruktleveranser som passar kontorets rytm och säsong.</p></article><article class="service-card"><div class="mark">✦</div><h3>Delibrickor</h3><p>Väl valda ostar, charkuterier och tillbehör för möten och firanden.</p></article><article class="service-card" id="catering"><div class="mark">⌁</div><h3>Catering</h3><p>Mat med bra råvaror och omsorg för små och stora tillfällen.</p></article></div>
      </div></section>
      <section class="public-section"><div class="section-inner values"><p class="quote">"Kvalitet och kunskap är våra <span>ledord.</span>"</p><ul class="check-list"><li><b>01</b>Handplockat från producenter och grossister</li><li><b>02</b>Frukt, grönt och delikatesser med kvalitet i fokus</li><li><b>03</b>Personlig hjälp – från vardagsmiddag till present</li></ul></div></section>
      <section class="public-section contact" id="kontakt"><div class="section-inner contact-grid"><div><div class="eyebrow" style="color:#dbe59a">Välkommen förbi</div><h2>Detta är en syntetisk demo.</h2><p>Butiken är fylld av godsaker. Välkommen till vår värld av god smak – vi hjälper gärna till med allt från vardagsinköp till företagsleveranser.</p></div><div class="contact-details"><b>Besöksadress</b>${escapeHtml(b.address || 'Exempelgatan 1, 411 00 Göteborg')}<br><br><b>Kontakt</b>${escapeHtml(b.phone || '')}<br>${escapeHtml(b.email || '')}<br><br><b>Öppettider</b>Måndag–Fredag 10.00–18.00<br>Lördag 10.00–15.00<br>Söndag stängt</div></div>
        <footer class="footer"><span>© ${new Date().getFullYear()} ${escapeHtml(b.displayName || 'Demo Saluhall')}</span><span>Frukt & grönt · delikatesser · catering</span></footer>
      </section>
    </main>
  </div>`;
}

function adminChrome(content) {
  return workspaceChrome(content);
}

function heading(title, description, action = '') { return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div>${action}</div>`; }
function dashboardPage() {
  return commandCenter();
}

function invoicePage() {
  const invoices = F.items(state,'customer',{status:invoiceFilter});
  const rows = invoices.map(i=>`<tr data-action="res-detail" data-kind="customer" data-id="${i.id}" data-export-kind="customer" data-export-party="${escapeHtml(i.party)}" data-export-party-number="${escapeHtml(i.partyNumber || '')}" tabindex="0" role="button"><td><b>${escapeHtml(i.aviNumber)}</b><br><span class="muted">OCR ${escapeHtml(i.ocr || i.aviNumber)} · ${i.invoiceDate}</span></td><td><b>${escapeHtml(i.partyNumber || '—')}</b><br><span class="muted">${escapeHtml(i.party)}</span></td><td>${i.dueDate}</td><td class="number-cell">${money(i.total)}</td><td class="number-cell">${money(i.remaining)}</td><td>${status(i.status)}</td><td><button class="row-action" data-action="res-detail" data-kind="customer" data-id="${i.id}">Visa reskontra</button> <button class="row-action" data-action="pdf-invoice" data-id="${i.id}">PDF</button></td></tr>`).join('');
  return adminChrome(`${heading('Kundfakturor','Skapa fakturor och följ betalningarna i kundreskontran.','<button class="button" data-action="new-invoice">+ Ny kundfaktura</button>')}<div class="toolbar"><div class="tabs">${[['all','Alla'],['open','Obetalda'],['paid','Betalda']].map(([v,l])=>`<button class="${invoiceFilter===v?'active':''}" data-action="invoice-filter" data-filter="${v}">${l} ${F.items(state,'customer',{status:v}).length}</button>`).join('')}</div><input class="search" placeholder="Sök faktura eller kund" aria-label="Sök faktura eller kund" data-search="invoices"></div><article class="panel table-wrap"><table class="data-table"><thead><tr><th>Faktura</th><th>Kund</th><th>Förfaller</th><th class="align-right">Belopp</th><th class="align-right">Restbelopp</th><th>Status</th><th></th></tr></thead><tbody data-table="invoices">${rows || '<tr><td colspan="7" class="empty">Inga fakturor i urvalet.</td></tr>'}</tbody></table></article>`);
}
function supplierPage() {
  const rows = state.supplierInvoices.map(item => `<tr data-action="res-detail" data-kind="supplier" data-id="${item.id}" data-export-kind="supplier" data-export-party="${escapeHtml(item.supplier)}" tabindex="0" role="button"><td><b>${escapeHtml(item.supplier)}</b><br><span style="color:var(--muted);font-size:11px">${escapeHtml(item.invoiceNumber)} · ${escapeHtml(item.source)}</span></td><td>${date(item.dueDate)}</td><td><span style="font-size:12px">${escapeHtml(item.suggestedAccount)}</span></td><td class="number-cell">${money(item.total)}</td><td><div class="confidence ${item.confidence < .8 ? 'low' : ''}"><i style="--score:${Math.round(item.confidence*100)}%"></i>${Math.round(item.confidence * 100)}%</div></td><td>${status(item.status)}</td><td class="align-right">${item.status === 'Attest väntar' ? `<button class="row-action" data-action="approve-supplier-modal" data-id="${item.id}">Attestera</button>` : '<button class="row-action" data-action="show-supplier" data-id="'+item.id+'">Visa</button>'}</td></tr>`).join('');
  return adminChrome(`${supplierWarnings()}${heading('Leverantörsfakturor', 'Registrera underlag, attestera och följ betalningen i leverantörsreskontran.', '<button class="button" data-action="new-supplier">+ Registrera faktura</button>')}<div class="integration">E-post och PDF-tolkning är ännu inte anslutna. Registrera fakturauppgifterna manuellt i denna version. Äldre säkerhetsvärden nedan är demonstrationsdata.</div><article class="panel table-wrap"><table class="data-table"><thead><tr><th>Leverantör / faktura</th><th>Förfaller</th><th>Föreslaget konto</th><th class="align-right">Belopp</th><th>Demovärde</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></article>`);
}
function bankPage() {
  const rows = state.bankTransactions.map(item => `<tr><td>${date(item.date)}<br><span style="color:var(--muted);font-size:11px">${escapeHtml(item.transactionRef)}</span><br><span class="muted">Bunt ${escapeHtml(item.batch || (state.journal || []).find(j => j.number === item.journalNumber)?.batchNumber || '—')}${item.reclassificationBatch ? ' · omföringsbunt ' + escapeHtml(item.reclassificationBatch) : ''}</span></td><td><b>${escapeHtml(item.text)}</b><br><span style="color:var(--muted);font-size:11px">${escapeHtml(item.reference || 'Ingen referens')}</span></td><td class="number-cell" style="color:${item.amount < 0 ? '#a4432b' : '#286044'}">${item.amount < 0 ? '−' : '+'}${money(Math.abs(item.amount))}</td><td><span style="font-size:12px">${escapeHtml(item.proposal)}</span></td><td>${status(item.status)}</td><td class="align-right">${item.status === 'Granska' ? `<button class="row-action" data-action="review-tx" data-id="${item.id}">Granska</button>` : `<button class="row-action" data-action="review-tx" data-id="${item.id}">Visa</button>`}</td></tr>`).join('');
  return adminChrome(`${heading('Bank & avstämning', 'Prova enkel CAMT.054 eller textimport (datum;beskrivning;belopp). Bankformat behöver verifieras inför drift.', '<div style="display:flex;gap:10px"><button class="button ghost" data-action="sample-camt">Testa CAMT.054</button><label class="button" for="camt-file">Importera fil<input hidden type="file" id="camt-file" accept=".xml,.camt,.054,.bam,text/xml,application/xml,text/plain"></label></div>')}<section class="bank-summary"><div class="mini"><span style="color:var(--muted);font-size:12px">Importerade händelser</span><b>${state.bankTransactions.length}</b></div><div class="mini"><span style="color:var(--muted);font-size:12px">Automatiskt matchade</span><b>${state.bankTransactions.filter(item=>item.status === 'Matchad').length}</b></div><div class="mini"><span style="color:var(--muted);font-size:12px">Manuell granskning</span><b style="color:#a96c24">${reviewCount()}</b></div></section><article class="panel table-wrap"><table class="data-table"><thead><tr><th>Datum</th><th>Bankhändelse</th><th class="align-right">Belopp</th><th>AI-förslag</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></article>`);
}
function ledgerPage() {
  const audit = F.reconciliationAudit(state);
  const tabs = `<div class="ledger-tabs" role="tablist"><button class="${ledgerSection==='journal'?'active':''}" data-action="ledger-tab" data-tab="journal">Verifikationer</button><button class="${ledgerSection==='reconcile'?'active':''}" data-action="ledger-tab" data-tab="reconcile">Avstämning${audit.suggestions.length ? `<span class="nav-count">${audit.suggestions.length}</span>` : ''}</button></div>`;
  if (ledgerSection === 'reconcile') {
    const checks = audit.checks.map(check => `<article class="reconcile-check ${check.difference ? 'has-diff' : 'ok'}"><div><b>${escapeHtml(check.label)}</b><p>${escapeHtml(check.action)}</p></div><div class="reconcile-values"><span>Huvudbok <b>${money(check.ledger)}</b></span><span>Underlag <b>${money(check.subledger)}</b></span><strong>${check.difference ? `Diff ${check.difference > 0 ? '+' : ''}${money(check.difference)}` : 'Avstämt'}</strong></div></article>`).join('');
    const aiSuggestions = audit.suggestions.map((suggestion, index) => `<article class="ai-reconcile-card"><div class="ai-reconcile-head"><span class="eyebrow">A-förslag ${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(suggestion.label)}</b><strong>${money(suggestion.difference || 0)}</strong></div><p><b>Varför diffen kan ha uppstått:</b> ${escapeHtml(suggestion.reason || suggestion.detail)}</p><p><b>Kontrollerade verifikationer/underlag:</b> ${escapeHtml((suggestion.evidence || []).join(' · ') || 'Ingen entydig träff hittades – kontrollera originalunderlaget.')}</p><p><b>Konkreta steg:</b> ${escapeHtml(suggestion.solution || 'Kontrollera underlaget och skapa en balanserad korrigeringsverifikation.')}</p><div class="ai-posting"><b>Föreslagen balansering:</b> ${escapeHtml(suggestion.posting || 'Välj korrekt motkonto efter kontroll.')}</div></article>`).join('');
    const accountRows = audit.accounts.map(account => `<tr><td><b>${escapeHtml(account.account)}</b></td><td>${escapeHtml(account.name)}</td><td class="number-cell">${money(account.debit)}</td><td class="number-cell">${money(account.credit)}</td><td class="number-cell ${account.balance ? 'negative' : 'incoming'}">${money(account.balance)}</td></tr>`).join('');
    const unbalanced = audit.unbalanced.map(entry => `<tr><td>${escapeHtml(entry.number)}</td><td>${entry.date}</td><td>${escapeHtml(entry.description)}</td><td class="number-cell negative">${money(entry.difference)}</td></tr>`).join('');
    return adminChrome(`${heading('Bokföring', 'Avstämning av reskontra, bank och debet/kredit innan period eller bokslut stängs.')} ${tabs}<section class="metrics report-metrics"><article class="metric"><span>Total debet</span><div class="number">${money(audit.totalDebit)}</div></article><article class="metric"><span>Total kredit</span><div class="number">${money(audit.totalCredit)}</div></article><article class="metric ${audit.totalDifference ? 'attention' : ''}"><span>Debet − kredit</span><div class="number">${money(audit.totalDifference)}</div><small>${audit.totalDifference ? 'Åtgärd krävs' : 'Alla verifikationer balanserar'}</small></article><article class="metric ${audit.suggestions.length ? 'attention' : ''}"><span>Förslag att hantera</span><div class="number">${audit.suggestions.length}</div><small>Visas även i priolistan</small></article></section><section class="panel reconciliation-panel"><div class="panel-head"><div><h2>Kontrollpunkter</h2><p class="hint">Varje differens får ett åtgärdsförslag. Kontrollkontona är 1510, 2440 och 1930.</p></div></div>${checks || '<p class="empty">Inga kontrollpunkter.</p>'}</section><section class="panel ai-reconciliation"><div class="panel-head"><div><h2>AI-förslag: hitta och nolla differensen</h2><p class="hint">Förslagen bygger på alla verifikationer, reskontraposter och importerade bankhändelser. Bokför aldrig ett förslag utan att kontrollera originalunderlaget.</p></div></div>${aiSuggestions || '<p class="empty">Inga differenser att analysera.</p>'}</section><section class="panel"><div class="panel-head"><div><h2>Alla konton</h2><p class="hint">Saldo = debet minus kredit. Sök och analysera konton under fliken Verifikationer.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Konto</th><th>Benämning</th><th class="align-right">Debet</th><th class="align-right">Kredit</th><th class="align-right">Saldo</th></tr></thead><tbody>${accountRows || '<tr><td colspan="5" class="empty">Inga konton.</td></tr>'}</tbody></table></div></section>${audit.unbalanced.length ? `<section class="panel"><div class="panel-head"><div><h2>Obalanserade verifikationer</h2><p class="hint">Dessa behöver rättas innan perioden kan stängas.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Ver.</th><th>Datum</th><th>Beskrivning</th><th class="align-right">Differens</th></tr></thead><tbody>${unbalanced}</tbody></table></div></section>` : ''}`);
  }
  const query = String(ledgerSearch || '').toLocaleLowerCase('sv');
  const entries = state.journal.filter(entry => !query || `${entry.number} ${entry.description} ${entry.source} ${(entry.rows || []).map(row => row.account).join(' ')}`.toLocaleLowerCase('sv').includes(query));
  const rows = entries.flatMap(entry => entry.rows.map((row, index) => `<tr data-export-kind="ledger"><td>${index ? '' : date(entry.date)}</td><td><b>${index ? '' : entry.number}</b></td><td>${index ? '' : escapeHtml(entry.description)}${index ? '' : `<br><span class="muted">${escapeHtml(entry.source)}</span>`}</td><td><b>${escapeHtml(row.account.slice(0,4))}</b> ${escapeHtml(row.account.replace(/^\d{4}\s*/, ''))}</td><td class="number-cell">${row.debit ? money(row.debit) : ''}</td><td class="number-cell">${row.credit ? money(row.credit) : ''}</td><td class="number-cell">${money((row.debit || 0) - (row.credit || 0))}</td></tr>`)).join('');
  return adminChrome(`${heading('Bokföring', 'Verifikationer som skapats från fakturor, bankavstämning och manuella bokningar.', '<button class="button" data-action="download">Exportera till Excel</button>')} ${tabs}<form data-form="ledger-search" class="ledger-toolbar"><label>Sök konto eller kund<input name="query" value="${escapeHtml(ledgerSearch)}" placeholder="1510, 2440, kundnamn eller fakturanummer"></label><button class="button" type="submit">Sök</button><button class="button ghost" type="button" data-action="clear-ledger-search">Nollställ</button></form><div class="integration">Sökningen omfattar konto, kund/fakturabeskrivning, verifikationsnummer och källa. Debet och kredit visas rad för rad, som i ett kontrollregister.</div><article class="panel table-wrap"><table class="data-table ledger-table"><thead><tr><th>Datum</th><th>Ver.</th><th>Beskrivning</th><th>Konto</th><th class="align-right">Debet</th><th class="align-right">Kredit</th><th class="align-right">Rad-diff</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">Inga verifikationer matchar sökningen.</td></tr>'}</tbody></table></article>`);
}
function reviewPage() {
  const items = state.bankTransactions.filter(item => item.status === 'Granska');
  const rows = items.map(item => `<tr><td>${date(item.date)}</td><td><b>${escapeHtml(item.text)}</b><br><span style="color:var(--muted);font-size:11px">${escapeHtml(item.reason || '')}</span></td><td class="number-cell">${item.amount < 0 ? '−' : '+'}${money(Math.abs(item.amount))}</td><td><div class="confidence low"><i style="--score:${Math.round(item.confidence*100)}%"></i>${Math.round(item.confidence * 100)}%</div></td><td><span style="font-size:12px">${escapeHtml(item.proposal)}</span></td><td class="align-right"><button class="button sm" data-action="review-tx" data-id="${item.id}">Bedöm & boka</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Allt är granskat. Bra jobbat!</td></tr>';
  return adminChrome(`${heading('Granska & åtgärda', 'Bankhändelser som kräver din bedömning.')}<section class="ai-card"><h2>Från bankhändelse till rätt faktura.</h2><p>Denna version använder regler: exakt fakturareferens och restbelopp krävs för automatisk matchning. Delbetalningar kan kopplas manuellt och uppdaterar reskontran. AI-tolkning är ännu inte ansluten.</p><div class="ai-rules"><div class="ai-rule"><b>Entydig träff</b><span>En öppen, bokförd faktura med rätt referens, belopp och betalningsriktning.</span></div><div class="ai-rule"><b>Delbetalning</b><span>Betalningen kopplas till fakturan, resten står kvar som fordran eller skuld.</span></div><div class="ai-rule"><b>Oklart underlag</b><span>Granska och ange faktura eller konto innan händelsen bokförs.</span></div></div></section><article class="panel table-wrap"><div class="panel-head"><div><h2>Väntar på bedömning</h2><p class="hint">${items.length} bankhändelser har inte bokförts. Äldre procentvärden är demodata.</p></div></div><table class="data-table"><thead><tr><th>Datum</th><th>Bankhändelse</th><th class="align-right">Belopp</th><th>Demovärde</th><th>Förslag</th><th></th></tr></thead><tbody>${rows}</tbody></table></article>`);
}
function accountPlanPage() {
  const plan = window.RollandsAccountPlan;
  const accounts = plan ? plan.search(accountPlanQuery) : [];
  const grouped = accounts.reduce((map, account) => { (map[account.section] ||= []).push(account); return map; }, {});
  const rows = Object.entries(grouped).map(([section, sectionAccounts]) => `<tbody><tr class="invoice-group"><th colspan="4"><div><b>${escapeHtml(section)}</b><span class="muted">${sectionAccounts.length} konton</span></div></th></tr>${sectionAccounts.map(account => `<tr><td><b>${escapeHtml(account.code)}</b></td><td>${escapeHtml(account.name)}</td><td>${escapeHtml(account.row || '—')}</td><td><span class="account-chip">Intern lista</span></td></tr>`).join('')}</tbody>`).join('');
  return adminChrome(`${heading('Kontoplan', 'Begränsad intern kontolista för nuvarande utvecklingsflöden. Sök konto eller benämning innan du konterar.', `<span class="heading-note">${plan ? plan.accounts.length : 0} konton</span>`)}<section class="panel"><form data-form="account-plan-search" class="ledger-toolbar"><label>Sök konto eller benämning<input name="query" value="${escapeHtml(accountPlanQuery)}" placeholder="Ex. 1930, bank, moms eller försäljning"></label><button class="button" type="submit">Sök</button><button class="button ghost" type="button" data-action="clear-account-plan-search">Nollställ</button></form><div class="integration">Listan är inte en fullständig eller verifierad BAS 2026-kontoplan. Årsredovisningsrad visas endast som utvecklingsstöd; kontrollera konton och rapportkopplingar med redovisningskompetens före skarp drift.</div><div class="table-wrap account-plan-table"><table class="data-table"><thead><tr><th>Konto</th><th>Benämning</th><th>Rad</th><th>Plan</th></tr></thead>${rows || '<tbody><tr><td colspan="4" class="empty">Inga konton matchar sökningen.</td></tr></tbody>'}</table></div></section>`);
}
function auditPage() {
  const rows=(state.auditLog || []).map(item=>`<tr><td>${escapeHtml(new Date(item.at).toLocaleString('sv-SE'))}</td><td>${escapeHtml(item.actor || 'Administratör')}</td><td><b>${escapeHtml(item.action)}</b></td><td>${escapeHtml(item.details || '')}</td></tr>`).join('');
  return adminChrome(`${heading('Revisionslogg','Manipulationsupptäckande spår av verifikationer, periodlås, inställningar och motverifikationer.','<button class="button" data-action="download">Exportera till Excel</button>')}<section class="panel"><div class="integration">Senaste händelser visas först. Originalverifikationer ändras aldrig; rättelser skapar nya motverifikationer.</div><div class="table-wrap"><table class="data-table audit-table"><thead><tr><th>Tid</th><th>Användare</th><th>Händelse</th><th>Detaljer</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Inga revisionshändelser ännu.</td></tr>'}</tbody></table></div></section>`);
}
function settingsPage() {
  state.settings ||= {};
  state.settings.emailInbox ||= 'fakturor@demo.example.invalid';
  state.settings.attestResponsible ||= 'Demo Attestant';
  state.settings.attestSubstitute ||= 'Demo Ersättare';
  const locked=(state.settings.lockedPeriods || []).slice().sort().reverse();
  return adminChrome(`${heading('Inställningar', 'Företagsuppgifter, attest, periodlås och integrationsprinciper.')}<section class="settings-grid"><article class="panel"><div class="panel-head"><div><h2>Attestflöde</h2><p class="hint">Ansvarig och ersättare visas i leverantörsflödet.</p></div></div><form data-form="settings"><div class="setting-field"><label>Attestansvarig</label><input name="attestResponsible" value="${escapeHtml(state.settings.attestResponsible || '')}" required></div><div class="setting-field"><label>Ersättare</label><input name="attestSubstitute" value="${escapeHtml(state.settings.attestSubstitute || '')}" required></div><div class="setting-field"><label>Fakturamejl</label><input name="emailInbox" value="${escapeHtml(state.settings.emailInbox || '')}" required></div><button class="button" type="submit">Spara kontrollinställningar</button></form></article><article class="panel"><div class="panel-head"><div><h2>Företag</h2><p class="hint">Visas på fakturor och i ekonomirapporter.</p></div></div><div class="setting-field"><label>Företagsnamn</label><input value="${escapeHtml(state.business.name)}" readonly></div><div class="setting-field"><label>Organisationsnummer</label><input value="${escapeHtml(state.business.orgNumber)}" readonly></div><div class="setting-field"><label>Momsregistreringsnummer</label><input value="${escapeHtml(state.business.vatNumber)}" readonly></div><div class="setting-field"><label>Bankkonto</label><input value="${escapeHtml(state.settings.bankAccount)}" readonly></div></article></section><section class="panel period-locks"><div class="panel-head"><div><h2>Låsta bokföringsperioder</h2><p class="hint">Nya verifikationer och betalningar blockeras i låsta perioder. Rättelser görs i en öppen period.</p></div></div><form data-form="period-lock" class="ledger-toolbar"><label>Period (ÅÅÅÅ-MM)<input name="period" type="month" required></label><button class="button" type="submit">Lås period</button></form><div class="locked-period-list">${locked.map(period=>`<span class="period-chip">${period}<button data-action="period-unlock" data-period="${period}" aria-label="Lås upp ${period}">×</button></span>`).join('') || '<span class="muted">Inga perioder är låsta.</span>'}</div></section><section class="panel automation-plan"><div class="panel-head"><div><h2>Automation och säkerhetsgränser</h2><p class="hint">Koppla bankfil och fakturamejl stegvis. Osäkra matchningar stannar för manuell kontroll.</p></div></div><div class="automation-cards"><article><span>01</span><h3>Fakturamejl → PDF</h3><p>PDF läses in, dubbletter stoppas och fakturan hamnar i attestkön.</p><b>Behöver: säker inkorg + PDF-tolkning</b></article><article><span>02</span><h3>Bankfil → avstämning</h3><p>CAMT.054 från Handelsbanken eller BAM importeras enligt schema.</p><b>Guardrail: filkontroll och dubblettspärr</b></article><article><span>03</span><h3>AI med säkerhetsgräns</h3><p>Endast entydiga referens- och beloppsträffar kan automatiseras.</p><b>Resten flaggas i priolistan</b></article><article><span>04</span><h3>Varningar & backup</h3><p>Stoppade flöden, periodlås och revisionshändelser visas här.</p><b>Schemalagd offsite-backup krävs i produktion</b></article></div></section>${integrationGuide()}`);
}

function modal() {
  if (!activeModal) return '';
  const custom = workspaceModal();
  if (custom !== null) return custom;
  if (activeModal.type === 'invoice') return invoiceComposer();
  if (activeModal.type === 'invoice-issued') return modalShell('Fakturan är skapad', `<p>Faktura <b>${escapeHtml(activeModal.number)}</b> är bokförd och PDF:en är sparad.</p><div class="modal-foot">${demoMode ? `<button class="button" data-action="pdf-invoice" data-id="${activeModal.id}">Öppna / skriv ut PDF</button>` : `<a class="button" href="/api/invoices/${encodeURIComponent(activeModal.id)}/pdf" target="_blank" rel="noopener">Öppna PDF</a><a class="button ghost" href="/api/invoices/${encodeURIComponent(activeModal.id)}/pdf?download=1" download>Ladda ned PDF för att skicka</a>`}<button class="button ghost" data-action="close-modal">Stäng</button></div>`);
  if (activeModal.type === 'supplier') return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="supplier-title" data-stop><div class="modal-header"><h2 id="supplier-title">Registrera leverantörsfaktura</h2><button data-action="close-modal" aria-label="Stäng">×</button></div><form class="modal-body" data-form="supplier"><div class="integration">${activeModal.sourceFile ? `PDF vald: <b>${escapeHtml(activeModal.sourceFile)}</b>. Kontrollera uppgifterna mot originalfilen innan attest.` : 'Manuell registrering av fakturauppgifter. E-post och automatisk PDF-tolkning är ännu inte anslutna.'}</div><input type="hidden" name="source" value="${escapeHtml(activeModal.sourceFile ? 'PDF '+activeModal.sourceFile : 'Manuell registrering')}"><div class="form-grid"><div class="field full"><label>Leverantör</label><input name="supplier" required placeholder="Leverantörens namn"></div><div class="field"><label>Fakturanummer</label><input name="invoiceNumber" required placeholder="Fakturanummer"></div><div class="field"><label>Förfallodatum</label><input name="dueDate" type="date" value="${InvoiceModel.dueDate(F.localToday(),14)}" required></div><div class="field"><label>Belopp exkl. moms</label><input name="net" inputmode="numeric" type="number" min="1" step="1" required placeholder="0"></div><div class="field"><label>Moms</label><select name="vatRate"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select></div><div class="field full"><label>Föreslaget konto</label><select name="account"><option>4010 Inköp av varor</option><option>5020 El för belysning</option><option>5410 Förbrukningsinventarier</option><option>5800 Resekostnader</option></select></div></div><div class="modal-foot"><button type="button" class="button ghost" data-action="close-modal">Avbryt</button><button class="button" type="submit">Lägg till för attest</button></div></form></section></div>`;
  if (activeModal.type === 'transaction') {
    const item = state.bankTransactions.find(tx => tx.id === activeModal.id); if (!item) return '';
    if (item.status !== 'Granska') return invoiceInfoModal('Hanterad bankhändelse', item.text, [['Status', item.status], ['Datum', date(item.date)], ['Bankreferens', item.transactionRef], ['Belopp', `${item.amount < 0 ? '−' : '+'}${money(Math.abs(item.amount))}`], ['Bokningskonto', item.account || 'Se verifikation'], ['Hantering', item.autoBooked ? 'AI-matchad och bokförd' : 'Avstämd i bokföringen']]);
    const invoiceOptions = F.items(state,item.amount > 0 ? 'customer' : 'supplier').filter(i=>i.booked && i.remaining>0).map(i=>`<option value="${i.id}">${escapeHtml(i.party)} · ${escapeHtml(i.aviNumber)} · Rest ${money(i.remaining)}</option>`).join('');
    const costOptions = window.RollandsAccountPlan.accounts.filter(a => (item.amount > 0 ? /^3\d{3}$/ : /^(?:[4-7]\d{3}|84\d{2})$/).test(a.code)).map(a => `<option value="${escapeHtml(a.code + ' ' + a.name)}">${escapeHtml(a.code + ' ' + a.name)}</option>`).join('');
    return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="tx-title" data-stop><div class="modal-header"><h2 id="tx-title">Bedöm bankhändelse</h2><button data-action="close-modal" aria-label="Stäng">×</button></div><div class="modal-body"><div class="review-detail"><div class="detail-row"><span>Datum</span><b>${date(item.date)}</b></div><div class="detail-row"><span>Banktext</span><b>${escapeHtml(item.text)}</b></div><div class="detail-row"><span>Belopp</span><b>${item.amount < 0 ? '−' : '+'}${money(Math.abs(item.amount))}</b></div><div class="detail-row"><span>AI-förslag</span><b>${escapeHtml(item.proposal)}</b></div>${item.reason ? `<div class="detail-row"><span>Varför stoppades den?</span><b>${escapeHtml(item.reason)}</b></div>` : ''}</div><form data-form="resolve" style="margin-top:18px"><input type="hidden" name="id" value="${item.id}"><div class="field"><label>Matcha mot ${item.amount > 0 ? 'kundfaktura' : 'leverantörsfaktura'}</label><select name="invoiceNumber"><option value="">Välj ingen faktura – bokför på konto</option>${invoiceOptions}</select></div><div class="field" style="margin-top:13px"><label>${item.amount > 0 ? 'Intäktskonto' : 'Kostnadskonto'} om du inte matchar en faktura</label><select name="account"><option value="">Välj konto</option>${costOptions}</select></div><div class="modal-foot"><button type="button" class="button ghost" data-action="close-modal">Avbryt</button><button class="button" type="submit">Bokför verifikation</button></div></form></div></section></div>`;
  }
  if (activeModal.type === 'showInvoice') { const item = state.invoices.find(inv=>inv.id===activeModal.id); return invoiceInfoModal('Kundfaktura', item ? `${item.number} · ${item.customer}` : '', item ? [['Status',item.status],['Fakturadatum',date(item.date)],['Förfaller',date(item.dueDate)],['Referens',item.reference],['Belopp exkl. moms',money(item.net)],['Moms',money(item.vat)],['Totalt',money(item.total)]] : [], item?.id); }
  if (activeModal.type === 'showSupplier') { const item = state.supplierInvoices.find(inv=>inv.id===activeModal.id); return invoiceInfoModal('Leverantörsfaktura', item ? `${item.supplier} · ${item.invoiceNumber}` : '', item ? [['Status',item.status],['Källa',item.source],['Förfaller',date(item.dueDate)],['Konto',item.suggestedAccount],['Totalt',money(item.total)]] : []); }
  return '';
}
function invoiceInfoModal(title, subtitle, rows, invoiceId) { return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" data-stop><div class="modal-header"><h2>${title}</h2><button data-action="close-modal" aria-label="Stäng">×</button></div><div class="modal-body"><p style="margin-top:0;font-weight:700">${escapeHtml(subtitle)}</p><div class="review-detail">${rows.map(([name,value])=>`<div class="detail-row"><span>${escapeHtml(name)}</span><b>${escapeHtml(value)}</b></div>`).join('')}</div><div class="modal-foot">${invoiceId ? `<button class="button" data-action="pdf-invoice" data-id="${invoiceId}">Öppna PDF</button>` : ''}<button class="button ghost" data-action="close-modal">Stäng</button></div></div></section></div>`; }

function pageContent() { if (view === 'public') return publicPage(); if (!state) return ''; return ({overview:dashboardPage,customers:()=>partyDirectoryPage('customer'),vendors:()=>partyDirectoryPage('supplier'),inbox:invoiceInboxPage,'res-tools':receivablesToolsPage,receivables:()=>reskontraPage('customer'),payables:()=>reskontraPage('supplier'),invoices:invoicePage,supplier:supplierPage,bank:bankPage,ledger:ledgerPage,batches:batchesPage,accounts:accountPlanPage,reports:reportsPage,audit:auditPage,assistant:assistantPage,review:reviewPage,settings:settingsPage}[page] || dashboardPage)(); }
function render() {
  app.innerHTML = pageContent() + modal();
  const emailInput = document.querySelector('input[name="emailInbox"]');
  if (emailInput && !emailInput.value) emailInput.value = 'fakturor@demo.example.invalid';
  document.title = (view==='public' ? 'Demo Saluhall' : ({customers:'Kunder',vendors:'Leverantörer',inbox:'Fakturainkorg',receivables:'Kundreskontra',payables:'Leverantörsreskontra',overview:'Översikt'}[page] || 'Ekonomi')) + ' | LT Studio Demo';
  document.querySelectorAll('.field, .setting-field').forEach((el,index)=>{ const label=el.querySelector('label'), input=el.querySelector('input,select,textarea'); if(label&&input&&!input.id) { input.id='field-'+index; label.htmlFor=input.id; } });
  if (activeModal) { document.querySelector('.admin-shell')?.setAttribute('inert',''); document.querySelector('.modal button, .modal input')?.focus(); }
}

const sampleCamt = `<?xml version="1.0" encoding="UTF-8"?><Document><BkToCstmrDbtCdtNtfctn><Ntfctn><Ntry><Amt Ccy="SEK">5000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>20260912</Dt></BookgDt><NtryRef>HB-DEMO-100</NtryRef><AcctSvcrRef>HB-DEMO-100</AcctSvcrRef><NtryDtls><TxDtls><Refs><EndToEndId>2026-1005</EndToEndId></Refs><RmtInf><Ustrd>Västra Hamnen Logistik 2026-1005</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry><Ntry><Amt Ccy="SEK">735.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>20260912</Dt></BookgDt><NtryRef>HB-DEMO-101</NtryRef><AcctSvcrRef>HB-DEMO-101</AcctSvcrRef><NtryDtls><TxDtls><RmtInf><Ustrd>OKÄND KORTTRANSAKTION</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]'); if (!target) return;
  if (target.hasAttribute('data-stop')) { event.stopPropagation(); return; }
  const action = target.dataset.action;
  if (action === 'public') { event.preventDefault(); navigate('website'); return; }
  if (action === 'admin') { navigate('overview'); return; }
  if (action === 'nav') { event.preventDefault(); navigate(target.dataset.page); return; }
  if (action === 'new-invoice') { activeModal = { type:'invoice' }; render(); return; }
  if (action === 'new-supplier') { activeModal = { type:'supplier' }; render(); return; }
  if (action === 'close-modal') { if (event.target === target || target.tagName === 'BUTTON') { activeModal = null; render(); } return; }
  if (action === 'show-invoice') { activeModal = { type:'showInvoice', id:target.dataset.id }; render(); return; }
  if (action === 'show-supplier') { activeModal = { type:'showSupplier', id:target.dataset.id }; render(); return; }
  if (action === 'review-tx') { activeModal = { type:'transaction', id:target.dataset.id }; render(); return; }
  if (action === 'approve-supplier') { activeModal = { type:'supplier-approve', id:target.dataset.id }; render(); return; }
  if (action === 'sample-camt') { try { const data = await api('/api/import/camt054', { method:'POST', body:{ filename:'Handelsbanken-demo-CAMT054.xml', xml:sampleCamt } }); syncStore(data); toast(`${data.imported.length} bankhändelser importerades.`); } catch(error) { toast(error.message); } return; }
  if (action === 'download') { window.location.href = '/api/export/excel'; return; }
  if (action === 'pdf-invoice') { if (demoMode) { openDemoInvoice(state.invoices.find(invoice => invoice.id === target.dataset.id)); } else window.open(`/api/invoices/${encodeURIComponent(target.dataset.id)}/pdf`, '_blank', 'noopener'); return; }
});

document.addEventListener('submit', async event => {
  const form = event.target.closest('form[data-form]'); if (!form) return; event.preventDefault();
  const values = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.form === 'invoice') {
      if(form.dataset.saving==='true') return;
      form.dataset.saving='true'; const button=form.querySelector('[type="submit"]');button.disabled=true;
      try {
        const data=await api('/api/invoices',{method:'POST',body:captureInvoiceDraft()});
        invoiceDraft=null; activeModal={type:'invoice-issued',id:data.invoice.id,number:data.invoice.number};
        page='invoices'; history.pushState(null,'','#/invoices');syncStore(data);toast('Fakturan och PDF:en är sparade.');
      } catch(error) {form.querySelector('.form-error').textContent=error.message;button.disabled=false;form.dataset.saving='false';}
    }
    if (form.dataset.form === 'supplier') { const data = await api('/api/supplier-invoices', { method:'POST', body:{...values,received:F.localToday(),source:values.source || 'Manuell registrering',confidence:0} }); activeModal = null; page = 'supplier'; history.pushState(null,'','#/supplier'); syncStore(data); toast('Fakturan ligger nu för attest.'); }
    if (form.dataset.form === 'resolve') { const match = values.invoiceNumber; const data = await api('/api/bank/resolve', { method:'POST', body:{ id:values.id, action:match ? 'match' : 'book', invoiceId:match, account:values.account } }); activeModal = null; syncStore(data); toast('Bankhändelsen är bokförd och har fått en verifikation.'); }
  } catch (error) { toast(error.message); }
});

document.addEventListener('change', async event => {
  if (event.target.id === 'supplier-pdf-file') { const file=event.target.files?.[0]; if(!file) return; if(file.type && file.type!=='application/pdf'){toast('Välj en PDF-fil.');return;} activeModal={type:'supplier',sourceFile:file.name}; render(); return; }
  if (event.target.id !== 'camt-file') return;
  const file = event.target.files?.[0]; if (!file) return;
  try { const xml = await file.text(); const data = await api('/api/import/camt054', { method:'POST', body:{ filename:file.name, xml } }); syncStore(data); toast(`${data.imported.length} nya händelser från ${file.name} importerades.`); } catch(error) { toast(error.message); }
});

document.addEventListener('input', event => {
  if (event.target.dataset.search !== 'invoices') return;
  const term = event.target.value.toLowerCase();
  document.querySelectorAll('[data-table="invoices"] tr').forEach(row => row.hidden = !row.textContent.toLowerCase().includes(term));
});

async function boot() { try { state = await api('/api/state'); state.settings ||= {}; state.settings.emailInbox ||= 'fakturor@demo.example.invalid'; state.settings.attestResponsible ||= 'Demo Attestant'; state.settings.attestSubstitute ||= 'Demo Ersättare'; render(); } catch (error) { if (window.ROLLANDS_DEMO) { demoMode = true; let saved=null; try { saved=JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY)||'null'); } catch {} state = F.normalize(saved || window.ROLLANDS_DEMO); render(); toast('Demoläge: ändringar sparas i denna webbläsare.'); } else app.innerHTML = `<main style="padding:40px;font-family:Arial"><h1>Kunde inte starta plattformen</h1><p>${escapeHtml(error.message)}</p></main>`; } }
boot();
