const app=document.getElementById('reports-app');
const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
let session=null,reportType='trial',fromDate='2026-09-01',toDate='2026-09-30',period='2026-09',report=null,message='',refreshing=false;
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function ore(v){return new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK',minimumFractionDigits:2}).format(Number(v||0)/100)}
function url(path){return `${path}${isDemo?'?demo=1':''}`}
function isAgingReport(){return reportType==='receivables-aging'||reportType==='payables-aging'}
async function api(path){const r=await fetch(`/api/v1${path}`,{credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Begäran misslyckades.');return data}
function sidebar(){return `<aside class="sidebar reports-nav"><div class="logo"><strong>${esc(isDemo?'Rollands':session?.company?.name||'Företaget')}</strong><small>LT STUDIO</small></div><div class="company-pill">${esc(session?.company?.name||(isDemo?'Rollands Frukt o Grönt AB':'Företaget'))}<br>${isDemo?'Demoföretag':'Skyddad företagsmiljö'}</div><div class="side-group"><span>Arbetsyta</span><a class="side-link" href="${url('./dashboard.html')}">Översikt</a></div><div class="side-group"><span>Ekonomi</span><a class="side-link" href="${url('./payables.html')}">Leverantörsfakturor</a><a class="side-link" href="${url('./bank.html')}">Bank & avstämning</a><a class="side-link" href="${url('./inventory.html')}">Lager</a><a class="side-link active" href="${url('./reports.html')}">Rapporter</a><a class="side-link" href="${url('./automation.html')}">Automationskö</a></div><div class="sidebar-footer">Rapporter bygger på bokförda verifikationer. Momsrutan är ännu avstämningsunderlag.</div></aside>`}
function demoReport(){
  if(reportType==='trial')return{rows:[{account:'1510',openingOre:0,debitOre:1260000,creditOre:235000,closingOre:1025000},{account:'1930',openingOre:820000,debitOre:627500,creditOre:209600,closingOre:1237900},{account:'2440',openingOre:-315000,debitOre:84600,creditOre:437500,closingOre:-667900},{account:'2611',openingOre:0,debitOre:0,creditOre:239000,closingOre:-239000},{account:'2641',openingOre:0,debitOre:104420,creditOre:0,closingOre:104420},{account:'3010',openingOre:0,debitOre:0,creditOre:956000,closingOre:-956000},{account:'4010',openingOre:0,debitOre:417680,creditOre:0,closingOre:417680}],totals:{debitOre:2493780,creditOre:1838100}};
  if(reportType==='ledger')return{rows:[{postingDate:'2026-09-05',number:'A30',account:'1510',description:'Kundfaktura 310003',lineText:'Kundfordran',debitOre:1260000,creditOre:0},{postingDate:'2026-09-08',number:'A31',account:'4010',description:'Leverantörsfaktura GF-8821',lineText:'Varuinköp',debitOre:67680,creditOre:0},{postingDate:'2026-09-08',number:'A31',account:'2641',description:'Leverantörsfaktura GF-8821',lineText:'Ingående moms',debitOre:16920,creditOre:0},{postingDate:'2026-09-08',number:'A31',account:'2440',description:'Leverantörsfaktura GF-8821',lineText:'Leverantörsskuld',debitOre:0,creditOre:84600}]};
  if(reportType==='pl')return{rows:[{account:'3010',amountOre:956000},{account:'4010',amountOre:-417680},{account:'5510',amountOre:-350000}],resultOre:188320};
  if(reportType==='sales')return{
    basis:'customer-invoice-operational',from:fromDate,to:toDate,
    rows:[
      {invoiceDate:'2026-09-05',invoiceCount:2,netOre:1200000,vatOre:60000,grossOre:1260000,paidOre:235000,outstandingOre:1025000},
      {invoiceDate:'2026-09-18',invoiceCount:2,netOre:1350000,vatOre:85000,grossOre:1435000,paidOre:0,outstandingOre:1435000}
    ],
    customers:[
      {customerNumber:'K-1001',customerName:'Västra Hamnen Logistik AB',invoiceCount:2,netOre:1500000,vatOre:90000,grossOre:1590000,paidOre:235000,outstandingOre:1355000},
      {customerNumber:'K-1002',customerName:'Göteborg Mat AB',invoiceCount:2,netOre:1050000,vatOre:55000,grossOre:1105000,paidOre:0,outstandingOre:1105000}
    ],
    totals:{invoiceCount:4,netOre:2550000,vatOre:145000,grossOre:2695000,paidOre:235000,outstandingOre:2460000,averageInvoiceOre:673750},
    warning:'Försäljningsrapporten bygger på kundfakturornas fakturadatum och visar operativ försäljning. Bokföringsmässig omsättning och periodisering följs i Resultatrapporten.'
  };
  if(reportType==='receivables-aging')return{
    basis:'current-open-receivables-aging',asOf:toDate,
    customers:[
      {customerNumber:'K-1001',customerName:'Västra Hamnen Logistik AB',invoiceCount:2,openOre:1355000,notDueOre:650000,dueTodayOre:0,overdue1to30Ore:705000,overdue31to60Ore:0,overdue61to90Ore:0,overdue91PlusOre:0,creditOre:0},
      {customerNumber:'K-1002',customerName:'Göteborg Mat AB',invoiceCount:1,openOre:1105000,notDueOre:1105000,dueTodayOre:0,overdue1to30Ore:0,overdue31to60Ore:0,overdue61to90Ore:0,overdue91PlusOre:0,creditOre:0}
    ],
    totals:{invoiceCount:3,openOre:2460000,notDueOre:1755000,dueTodayOre:0,overdue1to30Ore:705000,overdue31to60Ore:0,overdue61to90Ore:0,overdue91PlusOre:0,creditOre:0},
    warning:'Rapporten visar nuvarande öppna kundfordringar grupperade efter förfallodatum mot valt rapportdatum.'
  };
  if(reportType==='payables-aging')return{
    basis:'current-open-payables-aging',asOf:toDate,
    suppliers:[
      {supplierNumber:'L-1001',supplierName:'Grönsaksgrossisten AB',invoiceCount:2,openOre:230000,postedOpenOre:180000,unpostedOpenOre:50000,notDueOre:50000,dueTodayOre:0,overdue1to30Ore:120000,overdue31to60Ore:60000,overdue61to90Ore:0,overdue91PlusOre:0,creditOre:0},
      {supplierNumber:'L-1002',supplierName:'Kylservice Väst AB',invoiceCount:1,openOre:84600,postedOpenOre:84600,unpostedOpenOre:0,notDueOre:84600,dueTodayOre:0,overdue1to30Ore:0,overdue31to60Ore:0,overdue61to90Ore:0,overdue91PlusOre:0,creditOre:0}
    ],
    totals:{invoiceCount:3,openOre:314600,postedOpenOre:264600,unpostedOpenOre:50000,notDueOre:134600,dueTodayOre:0,overdue1to30Ore:120000,overdue31to60Ore:60000,overdue61to90Ore:0,overdue91PlusOre:0,creditOre:0},
    warning:'Rapporten visar nuvarande öppna leverantörsfakturor grupperade efter förfallodatum mot valt rapportdatum.'
  };
  if(reportType==='supplier-purchases')return{
    basis:'supplier-invoice-operational',from:fromDate,to:toDate,
    suppliers:[
      {supplierNumber:'L-1001',supplierName:'Grönsaksgrossisten AB',invoiceCount:5,netOre:420000,vatOre:50400,grossOre:470400,openOre:230000},
      {supplierNumber:'L-1002',supplierName:'Kylservice Väst AB',invoiceCount:1,netOre:67680,vatOre:16920,grossOre:84600,openOre:84600}
    ],
    totals:{invoiceCount:6,netOre:487680,vatOre:67320,grossOre:555000,openOre:314600,averageInvoiceOre:92500},
    warning:'Inköpsrapporten bygger på registrerade leverantörsfakturors fakturadatum. Bokföringsmässiga kostnader följs i Resultatrapporten.'
  };
  return{outputVatOre:239000,inputVatOre:104420,netVatOre:134580,customerInvoiceCount:4,supplierInvoiceCount:3,customerGrossOre:2695000,supplierGrossOre:522100,declarationReady:false,warning:'Detta är ett avstämningsunderlag från fakturaregistren. Full momsdeklaration kräver momskoder och kontroll mot bokförda verifikationer.'};
}
async function loadReport({feedback=false}={}){
  refreshing=true;if(feedback){message='';render()}
  try{
    if(isDemo)report=demoReport();
    else if(reportType==='trial')report=await api(`/reports/trial-balance?from=${fromDate}&to=${toDate}`);
    else if(reportType==='ledger')report=await api(`/reports/general-ledger?from=${fromDate}&to=${toDate}`);
    else if(reportType==='pl')report=await api(`/reports/profit-loss?from=${fromDate}&to=${toDate}`);
    else if(reportType==='sales')report=await api(`/reports/sales?from=${fromDate}&to=${toDate}`);
    else if(reportType==='receivables-aging')report=await api(`/reports/receivables-aging?asOf=${toDate}`);
    else if(reportType==='payables-aging')report=await api(`/reports/payables-aging?asOf=${toDate}`);
    else if(reportType==='supplier-purchases')report=await api(`/reports/supplier-purchases?from=${fromDate}&to=${toDate}`);
    else report=await api(`/reports/vat-control?period=${period}`);
    if(feedback)message=`Rapporten är uppdaterad ${new Intl.DateTimeFormat('sv-SE',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date())}.`;
  }finally{refreshing=false;render()}
}
function exportAction(){
  if(isDemo)return '';
  const params=new URLSearchParams();
  let type='';
  if(reportType==='sales'||reportType==='supplier-purchases'){type=reportType;params.set('from',fromDate);params.set('to',toDate)}
  else if(reportType==='receivables-aging'||reportType==='payables-aging'){type=reportType;params.set('asOf',toDate)}
  else return '';
  return `<a class="button ghost" href="/api/v1/exports/${type}?${params.toString()}">Exportera CSV för Excel</a>`;
}
function toolbar(){
  const aging=isAgingReport();
  return `<section class="report-toolbar">
    <label>Från<input type="date" data-field="from" value="${esc(fromDate)}" ${reportType==='vat'||aging?'disabled':''}></label>
    <label>${aging?'Rapportdatum':'Till'}<input type="date" data-field="to" value="${esc(toDate)}" ${reportType==='vat'?'disabled':''}></label>
    <label>Momsperiod<input type="month" data-field="period" value="${esc(period)}" ${reportType!=='vat'?'disabled':''}></label>
    <button class="button" type="button" data-action="reload" ${refreshing?'disabled':''}>${refreshing?'Uppdaterar…':'Uppdatera'}</button>${exportAction()}
    <div class="report-tabs">
      <button class="report-tab ${reportType==='sales'?'active':''}" data-report="sales">Försäljning</button>
      <button class="report-tab ${reportType==='supplier-purchases'?'active':''}" data-report="supplier-purchases">Inköp</button>
      <button class="report-tab ${reportType==='receivables-aging'?'active':''}" data-report="receivables-aging">Kundfordringar</button>
      <button class="report-tab ${reportType==='payables-aging'?'active':''}" data-report="payables-aging">Leverantörsskulder</button>
      <button class="report-tab ${reportType==='trial'?'active':''}" data-report="trial">Balanslista</button>
      <button class="report-tab ${reportType==='ledger'?'active':''}" data-report="ledger">Huvudbok</button>
      <button class="report-tab ${reportType==='pl'?'active':''}" data-report="pl">Resultat</button>
      <button class="report-tab ${reportType==='vat'?'active':''}" data-report="vat">Momsavstämning</button>
    </div>
  </section>`;
}
function summary(){
  if(!report)return '';
  if(reportType==='sales')return `<section class="report-summary"><article><span>Nettoförsäljning</span><strong>${ore(report.totals?.netOre)}</strong></article><article><span>Brutto</span><strong>${ore(report.totals?.grossOre)}</strong></article><article><span>Fakturor</span><strong>${report.totals?.invoiceCount||0}</strong></article><article><span>Snittfaktura</span><strong>${ore(report.totals?.averageInvoiceOre)}</strong></article></section>`;
  if(reportType==='supplier-purchases')return `<section class="report-summary"><article><span>Nettoinköp</span><strong>${ore(report.totals?.netOre)}</strong></article><article><span>Brutto</span><strong>${ore(report.totals?.grossOre)}</strong></article><article><span>Leverantörsfakturor</span><strong>${report.totals?.invoiceCount||0}</strong></article><article><span>Utestående</span><strong>${ore(report.totals?.openOre)}</strong></article></section>`;
  if(reportType==='receivables-aging')return `<section class="report-summary"><article><span>Öppet totalt</span><strong>${ore(report.totals?.openOre)}</strong></article><article><span>Ej förfallet</span><strong>${ore(report.totals?.notDueOre)}</strong></article><article><span>1–30 dagar</span><strong>${ore(report.totals?.overdue1to30Ore)}</strong></article><article><span>31+ dagar</span><strong>${ore((report.totals?.overdue31to60Ore||0)+(report.totals?.overdue61to90Ore||0)+(report.totals?.overdue91PlusOre||0))}</strong></article></section>`;
  if(reportType==='payables-aging')return `<section class="report-summary"><article><span>Öppet totalt</span><strong>${ore(report.totals?.openOre)}</strong></article><article><span>Bokfört öppet</span><strong>${ore(report.totals?.postedOpenOre)}</strong></article><article><span>Ej bokfört</span><strong>${ore(report.totals?.unpostedOpenOre)}</strong></article><article><span>Förfallet 31+ dagar</span><strong>${ore((report.totals?.overdue31to60Ore||0)+(report.totals?.overdue61to90Ore||0)+(report.totals?.overdue91PlusOre||0))}</strong></article></section>`;
  if(reportType==='trial')return `<section class="report-summary"><article><span>Debet perioden</span><strong>${ore(report.totals?.debitOre)}</strong></article><article><span>Kredit perioden</span><strong>${ore(report.totals?.creditOre)}</strong></article><article><span>Antal konton</span><strong>${report.rows?.length||0}</strong></article><article><span>Kontroll</span><strong>${report.totals?.debitOre===report.totals?.creditOre?'Balanserar':'Avvikelse'}</strong></article></section>`;
  if(reportType==='pl')return `<section class="report-summary"><article><span>Periodens resultat</span><strong>${ore(report.resultOre)}</strong></article><article><span>Resultatkonton</span><strong>${report.rows?.length||0}</strong></article></section>`;
  if(reportType==='vat')return `<section class="report-summary"><article><span>Utgående moms</span><strong>${ore(report.outputVatOre)}</strong></article><article><span>Ingående moms</span><strong>${ore(report.inputVatOre)}</strong></article><article><span>Netto moms</span><strong>${ore(report.netVatOre)}</strong></article><article><span>Status</span><strong>Avstämning</strong></article></section>`;
  return `<section class="report-summary"><article><span>Rader</span><strong>${report.rows?.length||0}</strong></article><article><span>Period</span><strong>${esc(fromDate)} – ${esc(toDate)}</strong></article></section>`;
}
function content(){
  if(!report)return '<div class="report-empty">Laddar rapport…</div>';
  if(reportType==='sales')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Operativ försäljning</span><h2>Försäljning per dag</h2></div><strong>${ore(report.totals?.grossOre)}</strong></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Fakturadatum</th><th>Fakturor</th><th>Netto</th><th>Moms</th><th>Brutto</th><th>Betalt</th><th>Utestående</th></tr></thead><tbody>${report.rows.map(r=>`<tr><td>${esc(r.invoiceDate)}</td><td>${r.invoiceCount}</td><td class="money">${ore(r.netOre)}</td><td class="money">${ore(r.vatOre)}</td><td class="money">${ore(r.grossOre)}</td><td class="money">${ore(r.paidOre)}</td><td class="money">${ore(r.outstandingOre)}</td></tr>`).join('')||'<tr><td colspan="7" class="report-empty">Inga kundfakturor i perioden.</td></tr>'}</tbody></table></div></section><section class="report-panel"><div class="report-head"><div><span class="eyebrow">Kunder</span><h2>Försäljning per kund</h2></div></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Kund</th><th>Fakturor</th><th>Netto</th><th>Brutto</th><th>Utestående</th></tr></thead><tbody>${report.customers.map(r=>`<tr><td><b>${esc(r.customerName)}</b><br><small>${esc(r.customerNumber)}</small></td><td>${r.invoiceCount}</td><td class="money">${ore(r.netOre)}</td><td class="money">${ore(r.grossOre)}</td><td class="money">${ore(r.outstandingOre)}</td></tr>`).join('')||'<tr><td colspan="5" class="report-empty">Inga kunder i perioden.</td></tr>'}</tbody></table></div><div class="notice warning vat-warning"><b>Operativ rapport.</b> ${esc(report.warning||'')}</div></section>`;
  if(reportType==='supplier-purchases')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Leverantörer</span><h2>Inköp per leverantör</h2></div><strong>${ore(report.totals?.grossOre)}</strong></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Leverantör</th><th>Fakturor</th><th>Netto</th><th>Moms</th><th>Brutto</th><th>Utestående</th></tr></thead><tbody>${report.suppliers.map(r=>`<tr><td><b>${esc(r.supplierName)}</b><br><small>${esc(r.supplierNumber)}</small></td><td>${r.invoiceCount}</td><td class="money">${ore(r.netOre)}</td><td class="money">${ore(r.vatOre)}</td><td class="money">${ore(r.grossOre)}</td><td class="money">${ore(r.openOre)}</td></tr>`).join('')||'<tr><td colspan="6" class="report-empty">Inga leverantörsfakturor i perioden.</td></tr>'}</tbody></table></div><div class="notice warning vat-warning"><b>Operativ rapport.</b> ${esc(report.warning||'')}</div></section>`;
  if(reportType==='receivables-aging')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Per ${esc(report.asOf)}</span><h2>Kundfordringar efter förfalloålder</h2></div><strong>${ore(report.totals?.openOre)}</strong></div><div class="report-table-wrap"><table class="report-table aging-table"><thead><tr><th>Kund</th><th>Öppet</th><th>Ej förfallet</th><th>Idag</th><th>1–30</th><th>31–60</th><th>61–90</th><th>91+</th></tr></thead><tbody>${report.customers.map(r=>`<tr><td><b>${esc(r.customerName)}</b><br><small>${esc(r.customerNumber)} · ${r.invoiceCount} fakturor</small></td><td class="money"><b>${ore(r.openOre)}</b></td><td class="money">${ore(r.notDueOre)}</td><td class="money">${ore(r.dueTodayOre)}</td><td class="money">${ore(r.overdue1to30Ore)}</td><td class="money">${ore(r.overdue31to60Ore)}</td><td class="money">${ore(r.overdue61to90Ore)}</td><td class="money">${ore(r.overdue91PlusOre)}</td></tr>`).join('')||'<tr><td colspan="8" class="report-empty">Inga öppna kundfordringar.</td></tr>'}</tbody></table></div><div class="notice warning vat-warning">${esc(report.warning||'')}</div></section>`;
  if(reportType==='payables-aging')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Per ${esc(report.asOf)}</span><h2>Leverantörsskulder efter förfalloålder</h2></div><strong>${ore(report.totals?.openOre)}</strong></div><div class="report-table-wrap"><table class="report-table aging-table"><thead><tr><th>Leverantör</th><th>Öppet</th><th>Ej förfallet</th><th>Idag</th><th>1–30</th><th>31–60</th><th>61–90</th><th>91+</th></tr></thead><tbody>${report.suppliers.map(r=>`<tr><td><b>${esc(r.supplierName)}</b><br><small>${esc(r.supplierNumber)} · ${r.invoiceCount} fakturor</small></td><td class="money"><b>${ore(r.openOre)}</b></td><td class="money">${ore(r.notDueOre)}</td><td class="money">${ore(r.dueTodayOre)}</td><td class="money">${ore(r.overdue1to30Ore)}</td><td class="money">${ore(r.overdue31to60Ore)}</td><td class="money">${ore(r.overdue61to90Ore)}</td><td class="money">${ore(r.overdue91PlusOre)}</td></tr>`).join('')||'<tr><td colspan="8" class="report-empty">Inga öppna leverantörsskulder.</td></tr>'}</tbody></table></div><div class="notice warning vat-warning">${esc(report.warning||'')}</div></section>`;
  if(reportType==='trial')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Bokföring</span><h2>Balanslista</h2></div></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Konto</th><th>Ingående</th><th>Debet</th><th>Kredit</th><th>Utgående</th></tr></thead><tbody>${report.rows.map(r=>`<tr><td class="account">${esc(r.account)}</td><td class="money">${ore(r.openingOre)}</td><td class="money">${ore(r.debitOre)}</td><td class="money">${ore(r.creditOre)}</td><td class="money">${ore(r.closingOre)}</td></tr>`).join('')}</tbody></table></div></section>`;
  if(reportType==='ledger')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Bokföring</span><h2>Huvudbok</h2></div></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Datum</th><th>Ver.nr</th><th>Konto</th><th>Beskrivning</th><th>Debet</th><th>Kredit</th></tr></thead><tbody>${report.rows.map(r=>`<tr><td>${esc(r.postingDate)}</td><td>${esc(r.number)}</td><td class="account">${esc(r.account)}</td><td>${esc(r.description)}<br><small>${esc(r.lineText||'')}</small></td><td class="money">${r.debitOre?ore(r.debitOre):'—'}</td><td class="money">${r.creditOre?ore(r.creditOre):'—'}</td></tr>`).join('')||'<tr><td colspan="6" class="report-empty">Inga verifikationer i perioden.</td></tr>'}</tbody></table></div></section>`;
  if(reportType==='pl')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Resultat</span><h2>Resultatrapport</h2></div><strong>${ore(report.resultOre)}</strong></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Konto</th><th>Periodbelopp</th></tr></thead><tbody>${report.rows.map(r=>`<tr><td class="account">${esc(r.account)}</td><td class="money">${ore(r.amountOre)}</td></tr>`).join('')}</tbody></table></div></section>`;
  return `<section class="vat-panel"><div class="report-head"><div><span class="eyebrow">${esc(period)}</span><h2>Momsavstämning</h2></div><strong>${ore(report.netVatOre)}</strong></div><div class="vat-grid"><article><span>Utgående moms</span><strong>${ore(report.outputVatOre)}</strong><small>${report.customerInvoiceCount} kundfakturor</small></article><article><span>Ingående moms</span><strong>${ore(report.inputVatOre)}</strong><small>${report.supplierInvoiceCount} leverantörsfakturor</small></article><article><span>Netto</span><strong>${ore(report.netVatOre)}</strong></article></div><div class="notice warning vat-warning"><b>Kontrollunderlag – inte färdig momsdeklaration.</b> ${esc(report.warning||'')}</div></section>`;
}
function render(){app.innerHTML=`<div class="reports-shell">${sidebar()}<section class="reports-main"><header class="topbar"><div><h1>Rapporter</h1><p>Försäljning · inköp · reskontra · bokföring · moms</p></div><div class="user-chip"><b>${esc(session?.user?.displayName||'Demoanvändare')}</b></div></header><main class="content">${isDemo?'<div class="demo-banner"><b>GitHub Pages-demo.</b> Rapporterna visar exempeldata.</div>':''}${message?`<div class="notice" role="status" aria-live="polite">${esc(message)}</div>`:''}${toolbar()}${summary()}${content()}</main></section></div>`}
document.addEventListener('change',e=>{if(e.target.dataset.field==='from')fromDate=e.target.value;if(e.target.dataset.field==='to')toDate=e.target.value;if(e.target.dataset.field==='period')period=e.target.value});
document.addEventListener('click',e=>{const tab=e.target.closest('[data-report]');if(tab){reportType=tab.dataset.report;report=null;void loadReport().catch(err=>{message=err.message;render()});return}if(e.target.closest('[data-action="reload"]')){report=null;void loadReport({feedback:true}).catch(err=>{refreshing=false;message=err.message;render()})}});
async function load(){if(isDemo){session={user:{displayName:'Demo Ekonomi'},company:{name:'Rollands Frukt o Grönt AB'}};return loadReport()}const s=await api('/session');if(!s.authenticated){location.href='./index.html';return}session=s;await loadReport()}
load().catch(err=>{app.innerHTML=`<main class="boot"><strong>Rapporter kunde inte laddas</strong><span>${esc(err.message)}</span></main>`});
