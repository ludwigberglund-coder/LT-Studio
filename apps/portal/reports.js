const app=document.getElementById('reports-app');
const isDemo=new URLSearchParams(location.search).get('demo')==='1';
const isSupabase=location.hostname==='ludwigberglund-coder.github.io'&&!isDemo;
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
function agingBucket(dueDate,asOf){
  if(!dueDate)return'notDueOre';const due=new Date(dueDate+'T12:00:00Z'),cut=new Date(asOf+'T12:00:00Z');
  const days=Math.floor((cut-due)/86400000);
  if(days<0)return'notDueOre';if(days===0)return'dueTodayOre';if(days<=30)return'overdue1to30Ore';if(days<=60)return'overdue31to60Ore';if(days<=90)return'overdue61to90Ore';return'overdue91PlusOre';
}
function blankAging(){return{invoiceCount:0,openOre:0,notDueOre:0,dueTodayOre:0,overdue1to30Ore:0,overdue31to60Ore:0,overdue61to90Ore:0,overdue91PlusOre:0,creditOre:0}}
async function supabaseReport(){
  const ctx=await window.LTSupabaseUat.context();if(!ctx.authenticated||!ctx.company){location.href='./index.html';throw new Error('Ingen aktiv Supabase-session.')}
  session={user:ctx.user,company:ctx.company};
  const filter='company_id=eq.'+encodeURIComponent(ctx.company.id);
  const [entryRows,lineRows,customerRows,invoiceRows,supplierRows,supplierInvoiceRows]=await Promise.all([
    window.LTSupabase.from('journal_entries',ctx.accessToken).select('*',filter),
    window.LTSupabase.from('journal_lines',ctx.accessToken).select('*',filter),
    window.LTSupabase.from('customers',ctx.accessToken).select('*',filter),
    window.LTSupabase.from('invoices',ctx.accessToken).select('*',filter),
    window.LTSupabase.from('suppliers',ctx.accessToken).select('*',filter),
    window.LTSupabase.from('supplier_invoices',ctx.accessToken).select('*',filter)
  ]);
  const entriesById=new Map((entryRows||[]).map(e=>[String(e.id),e])),customersById=new Map((customerRows||[]).map(r=>[String(r.id),r])),suppliersById=new Map((supplierRows||[]).map(r=>[String(r.id),r]));
  const joinedLines=(lineRows||[]).map(l=>{const e=entriesById.get(String(l.journal_entry_id))||{};return{postingDate:e.posting_date||'',number:String(e.series||'A')+String(e.journal_number||''),account:l.account,description:e.description||'',lineText:l.description||'',debitOre:Number(l.debit_ore||0),creditOre:Number(l.credit_ore||0)}});

  if(reportType==='ledger'){
    return{rows:joinedLines.filter(r=>r.postingDate>=fromDate&&r.postingDate<=toDate).sort((a,b)=>a.postingDate.localeCompare(b.postingDate)||a.number.localeCompare(b.number)||a.account.localeCompare(b.account))};
  }
  if(reportType==='trial'){
    const map=new Map();
    for(const r of joinedLines){const row=map.get(r.account)||{account:r.account,openingOre:0,debitOre:0,creditOre:0,closingOre:0};const signed=r.debitOre-r.creditOre;if(r.postingDate<fromDate)row.openingOre+=signed;if(r.postingDate>=fromDate&&r.postingDate<=toDate){row.debitOre+=r.debitOre;row.creditOre+=r.creditOre}map.set(r.account,row)}
    const rows=[...map.values()].map(r=>({...r,closingOre:r.openingOre+r.debitOre-r.creditOre})).filter(r=>r.openingOre||r.debitOre||r.creditOre).sort((a,b)=>a.account.localeCompare(b.account));
    return{rows,totals:{debitOre:rows.reduce((s,r)=>s+r.debitOre,0),creditOre:rows.reduce((s,r)=>s+r.creditOre,0)}};
  }
  if(reportType==='pl'){
    const map=new Map();
    for(const r of joinedLines){if(r.postingDate<fromDate||r.postingDate>toDate||!/^[3-8]/.test(r.account))continue;map.set(r.account,(map.get(r.account)||0)+r.creditOre-r.debitOre)}
    const rows=[...map].map(([account,amountOre])=>({account,amountOre})).filter(r=>r.amountOre).sort((a,b)=>a.account.localeCompare(b.account));
    return{rows,resultOre:rows.reduce((s,r)=>s+r.amountOre,0)};
  }
  if(reportType==='sales'){
    const inv=(invoiceRows||[]).filter(i=>i.invoice_date>=fromDate&&i.invoice_date<=toDate),daily=new Map(),byCustomer=new Map();
    for(const i of inv){const total=Number(i.total_ore||0),vat=Number(i.vat_ore||0),net=total-vat,remaining=Number(i.remaining_ore||0),paid=total>0?Math.max(0,total-remaining):0;const d=daily.get(i.invoice_date)||{invoiceDate:i.invoice_date,invoiceCount:0,netOre:0,vatOre:0,grossOre:0,paidOre:0,outstandingOre:0};d.invoiceCount++;d.netOre+=net;d.vatOre+=vat;d.grossOre+=total;d.paidOre+=paid;d.outstandingOre+=remaining;daily.set(i.invoice_date,d);const cust=customersById.get(String(i.customer_id))||{};const key=String(i.customer_id),x=byCustomer.get(key)||{customerNumber:cust.customer_number||'',customerName:cust.name||'Okänd kund',invoiceCount:0,netOre:0,vatOre:0,grossOre:0,paidOre:0,outstandingOre:0};x.invoiceCount++;x.netOre+=net;x.vatOre+=vat;x.grossOre+=total;x.paidOre+=paid;x.outstandingOre+=remaining;byCustomer.set(key,x)}
    const rows=[...daily.values()].sort((a,b)=>a.invoiceDate.localeCompare(b.invoiceDate)),customers=[...byCustomer.values()].sort((a,b)=>a.customerName.localeCompare(b.customerName,'sv'));
    const totals={invoiceCount:inv.length,netOre:rows.reduce((s,r)=>s+r.netOre,0),vatOre:rows.reduce((s,r)=>s+r.vatOre,0),grossOre:rows.reduce((s,r)=>s+r.grossOre,0),paidOre:rows.reduce((s,r)=>s+r.paidOre,0),outstandingOre:rows.reduce((s,r)=>s+r.outstandingOre,0)};totals.averageInvoiceOre=totals.invoiceCount?Math.round(totals.grossOre/totals.invoiceCount):0;
    return{basis:'customer-invoice-operational',from:fromDate,to:toDate,rows,customers,totals,warning:'Försäljningsrapporten bygger på fakturadatum. Bokföringsmässigt resultat följs i Resultatrapporten.'};
  }
  if(reportType==='receivables-aging'){
    const map=new Map(),totals=blankAging();
    for(const i of invoiceRows||[]){const open=Number(i.remaining_ore||0);if(!open)continue;const cust=customersById.get(String(i.customer_id))||{},key=String(i.customer_id),r=map.get(key)||{customerNumber:cust.customer_number||'',customerName:cust.name||'Okänd kund',...blankAging()};r.invoiceCount++;r.openOre+=open;if(open<0)r.creditOre+=open;else r[agingBucket(i.due_date,toDate)]+=open;map.set(key,r)}
    const customers=[...map.values()].sort((a,b)=>a.customerName.localeCompare(b.customerName,'sv'));for(const r of customers)for(const k of Object.keys(totals))totals[k]+=Number(r[k]||0);
    return{basis:'current-open-receivables-aging',asOf:toDate,customers,totals,warning:'Rapporten visar nuvarande öppna kundfordringar grupperade efter förfallodatum.'};
  }
  if(reportType==='supplier-purchases'){
    const inv=(supplierInvoiceRows||[]).filter(i=>i.invoice_date>=fromDate&&i.invoice_date<=toDate),map=new Map();
    for(const i of inv){const s=suppliersById.get(String(i.supplier_id))||{},key=String(i.supplier_id),r=map.get(key)||{supplierNumber:s.supplier_number||'',supplierName:s.name||'Okänd leverantör',invoiceCount:0,netOre:0,vatOre:0,grossOre:0,openOre:0};const gross=Number(i.total_ore||0),vat=Number(i.vat_ore||0);r.invoiceCount++;r.netOre+=gross-vat;r.vatOre+=vat;r.grossOre+=gross;r.openOre+=Number(i.remaining_ore||0);map.set(key,r)}
    const suppliers=[...map.values()].sort((a,b)=>a.supplierName.localeCompare(b.supplierName,'sv')),totals={invoiceCount:inv.length,netOre:0,vatOre:0,grossOre:0,openOre:0};for(const r of suppliers){totals.netOre+=r.netOre;totals.vatOre+=r.vatOre;totals.grossOre+=r.grossOre;totals.openOre+=r.openOre}totals.averageInvoiceOre=totals.invoiceCount?Math.round(totals.grossOre/totals.invoiceCount):0;
    return{basis:'supplier-invoice-operational',from:fromDate,to:toDate,suppliers,totals,warning:'Inköpsrapporten bygger på registrerade leverantörsfakturors fakturadatum.'};
  }
  if(reportType==='payables-aging'){
    const map=new Map(),totals={...blankAging(),postedOpenOre:0,unpostedOpenOre:0};
    for(const i of supplierInvoiceRows||[]){const open=Number(i.remaining_ore||0);if(!open)continue;const s=suppliersById.get(String(i.supplier_id))||{},key=String(i.supplier_id),r=map.get(key)||{supplierNumber:s.supplier_number||'',supplierName:s.name||'Okänd leverantör',...blankAging(),postedOpenOre:0,unpostedOpenOre:0};r.invoiceCount++;r.openOre+=open;if(i.liability_accounting_entry_id)r.postedOpenOre+=open;else r.unpostedOpenOre+=open;if(open<0)r.creditOre+=open;else r[agingBucket(i.due_date,toDate)]+=open;map.set(key,r)}
    const suppliers=[...map.values()].sort((a,b)=>a.supplierName.localeCompare(b.supplierName,'sv'));for(const r of suppliers)for(const k of Object.keys(totals))totals[k]+=Number(r[k]||0);
    return{basis:'current-open-payables-aging',asOf:toDate,suppliers,totals,warning:'Rapporten visar nuvarande öppna leverantörsfakturor grupperade efter förfallodatum.'};
  }
  const monthStart=period+'-01',monthEnd=period+'-31',customerInvoices=(invoiceRows||[]).filter(i=>i.invoice_date>=monthStart&&i.invoice_date<=monthEnd),supplierInvoices=(supplierInvoiceRows||[]).filter(i=>i.invoice_date>=monthStart&&i.invoice_date<=monthEnd);
  const outputVatOre=customerInvoices.reduce((s,i)=>s+Number(i.vat_ore||0),0),inputVatOre=supplierInvoices.reduce((s,i)=>s+Number(i.vat_ore||0),0);
  return{outputVatOre,inputVatOre,netVatOre:outputVatOre-inputVatOre,customerInvoiceCount:customerInvoices.length,supplierInvoiceCount:supplierInvoices.length,customerGrossOre:customerInvoices.reduce((s,i)=>s+Number(i.total_ore||0),0),supplierGrossOre:supplierInvoices.reduce((s,i)=>s+Number(i.total_ore||0),0),declarationReady:false,warning:'Detta är ett avstämningsunderlag från Supabase-faktura- och bokföringsdata. Full momsdeklaration kräver fortsatt momskodskontroll.'};
}
async function loadReport({feedback=false}={}){
  refreshing=true;if(feedback){message='';render()}
  try{
    if(isDemo)report=demoReport();
    else if(isSupabase)report=await supabaseReport();
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
  if(isDemo||isSupabase)return '';
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
  if(reportType==='sales')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Operativ försäljning</span><h2>Försäljning per dag</h2></div><strong>${ore(report.totals?.grossOre)}</strong></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Fakturadatum</th><th>Fakturor</th><th>Netto</th><th>Moms</th><th>Brutto</th><th>Betalt</th><th>Utestående</th></tr></thead><tbody>${report.rows.map(r=>`<tr><td class="numeric">${esc(r.invoiceDate)}</td><td class="numeric">${r.invoiceCount}</td><td class="money">${ore(r.netOre)}</td><td class="money">${ore(r.vatOre)}</td><td class="money">${ore(r.grossOre)}</td><td class="money">${ore(r.paidOre)}</td><td class="money">${ore(r.outstandingOre)}</td></tr>`).join('')||'<tr><td colspan="7" class="report-empty">Inga kundfakturor i perioden.</td></tr>'}</tbody></table></div></section><section class="report-panel"><div class="report-head"><div><span class="eyebrow">Kunder</span><h2>Försäljning per kund</h2></div></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Kund</th><th>Fakturor</th><th>Netto</th><th>Brutto</th><th>Utestående</th></tr></thead><tbody>${report.customers.map(r=>`<tr><td><b>${esc(r.customerName)}</b><br><small>${esc(r.customerNumber)}</small></td><td class="numeric">${r.invoiceCount}</td><td class="money">${ore(r.netOre)}</td><td class="money">${ore(r.grossOre)}</td><td class="money">${ore(r.outstandingOre)}</td></tr>`).join('')||'<tr><td colspan="5" class="report-empty">Inga kunder i perioden.</td></tr>'}</tbody></table></div><div class="notice warning vat-warning"><b>Operativ rapport.</b> ${esc(report.warning||'')}</div></section>`;
  if(reportType==='supplier-purchases')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Leverantörer</span><h2>Inköp per leverantör</h2></div><strong>${ore(report.totals?.grossOre)}</strong></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Leverantör</th><th>Fakturor</th><th>Netto</th><th>Moms</th><th>Brutto</th><th>Utestående</th></tr></thead><tbody>${report.suppliers.map(r=>`<tr><td><b>${esc(r.supplierName)}</b><br><small>${esc(r.supplierNumber)}</small></td><td class="numeric">${r.invoiceCount}</td><td class="money">${ore(r.netOre)}</td><td class="money">${ore(r.vatOre)}</td><td class="money">${ore(r.grossOre)}</td><td class="money">${ore(r.openOre)}</td></tr>`).join('')||'<tr><td colspan="6" class="report-empty">Inga leverantörsfakturor i perioden.</td></tr>'}</tbody></table></div><div class="notice warning vat-warning"><b>Operativ rapport.</b> ${esc(report.warning||'')}</div></section>`;
  if(reportType==='receivables-aging')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Per ${esc(report.asOf)}</span><h2>Kundfordringar efter förfalloålder</h2></div><strong>${ore(report.totals?.openOre)}</strong></div><div class="report-table-wrap"><table class="report-table aging-table"><thead><tr><th>Kund</th><th>Öppet</th><th>Ej förfallet</th><th>Idag</th><th>1–30</th><th>31–60</th><th>61–90</th><th>91+</th></tr></thead><tbody>${report.customers.map(r=>`<tr><td><b>${esc(r.customerName)}</b><br><small>${esc(r.customerNumber)} · ${r.invoiceCount} fakturor</small></td><td class="money"><b>${ore(r.openOre)}</b></td><td class="money">${ore(r.notDueOre)}</td><td class="money">${ore(r.dueTodayOre)}</td><td class="money">${ore(r.overdue1to30Ore)}</td><td class="money">${ore(r.overdue31to60Ore)}</td><td class="money">${ore(r.overdue61to90Ore)}</td><td class="money">${ore(r.overdue91PlusOre)}</td></tr>`).join('')||'<tr><td colspan="8" class="report-empty">Inga öppna kundfordringar.</td></tr>'}</tbody></table></div><div class="notice warning vat-warning">${esc(report.warning||'')}</div></section>`;
  if(reportType==='payables-aging')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Per ${esc(report.asOf)}</span><h2>Leverantörsskulder efter förfalloålder</h2></div><strong>${ore(report.totals?.openOre)}</strong></div><div class="report-table-wrap"><table class="report-table aging-table"><thead><tr><th>Leverantör</th><th>Öppet</th><th>Ej förfallet</th><th>Idag</th><th>1–30</th><th>31–60</th><th>61–90</th><th>91+</th></tr></thead><tbody>${report.suppliers.map(r=>`<tr><td><b>${esc(r.supplierName)}</b><br><small>${esc(r.supplierNumber)} · ${r.invoiceCount} fakturor</small></td><td class="money"><b>${ore(r.openOre)}</b></td><td class="money">${ore(r.notDueOre)}</td><td class="money">${ore(r.dueTodayOre)}</td><td class="money">${ore(r.overdue1to30Ore)}</td><td class="money">${ore(r.overdue31to60Ore)}</td><td class="money">${ore(r.overdue61to90Ore)}</td><td class="money">${ore(r.overdue91PlusOre)}</td></tr>`).join('')||'<tr><td colspan="8" class="report-empty">Inga öppna leverantörsskulder.</td></tr>'}</tbody></table></div><div class="notice warning vat-warning">${esc(report.warning||'')}</div></section>`;
  if(reportType==='trial')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Bokföring</span><h2>Balanslista</h2></div></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Konto</th><th>Ingående</th><th>Debet</th><th>Kredit</th><th>Utgående</th></tr></thead><tbody>${report.rows.map(r=>`<tr><td class="account">${esc(r.account)}</td><td class="money">${ore(r.openingOre)}</td><td class="money">${ore(r.debitOre)}</td><td class="money">${ore(r.creditOre)}</td><td class="money">${ore(r.closingOre)}</td></tr>`).join('')}</tbody></table></div></section>`;
  if(reportType==='ledger')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Bokföring</span><h2>Huvudbok</h2></div></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Datum</th><th>Ver.nr</th><th>Konto</th><th>Beskrivning</th><th>Debet</th><th>Kredit</th></tr></thead><tbody>${report.rows.map(r=>`<tr><td class="numeric">${esc(r.postingDate)}</td><td class="numeric">${esc(r.number)}</td><td class="account">${esc(r.account)}</td><td>${esc(r.description)}<br><small>${esc(r.lineText||'')}</small></td><td class="money">${r.debitOre?ore(r.debitOre):'—'}</td><td class="money">${r.creditOre?ore(r.creditOre):'—'}</td></tr>`).join('')||'<tr><td colspan="6" class="report-empty">Inga verifikationer i perioden.</td></tr>'}</tbody></table></div></section>`;
  if(reportType==='pl')return `<section class="report-panel"><div class="report-head"><div><span class="eyebrow">Resultat</span><h2>Resultatrapport</h2></div><strong>${ore(report.resultOre)}</strong></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Konto</th><th>Periodbelopp</th></tr></thead><tbody>${report.rows.map(r=>`<tr><td class="account">${esc(r.account)}</td><td class="money">${ore(r.amountOre)}</td></tr>`).join('')}</tbody></table></div></section>`;
  return `<section class="vat-panel"><div class="report-head"><div><span class="eyebrow">${esc(period)}</span><h2>Momsavstämning</h2></div><strong>${ore(report.netVatOre)}</strong></div><div class="vat-grid"><article><span>Utgående moms</span><strong>${ore(report.outputVatOre)}</strong><small>${report.customerInvoiceCount} kundfakturor</small></article><article><span>Ingående moms</span><strong>${ore(report.inputVatOre)}</strong><small>${report.supplierInvoiceCount} leverantörsfakturor</small></article><article><span>Netto</span><strong>${ore(report.netVatOre)}</strong></article></div><div class="notice warning vat-warning"><b>Kontrollunderlag – inte färdig momsdeklaration.</b> ${esc(report.warning||'')}</div></section>`;
}
function render(){app.innerHTML=`<div class="reports-shell">${sidebar()}<section class="reports-main"><header class="topbar"><div><h1>Rapporter</h1><p>Försäljning · inköp · reskontra · bokföring · moms</p></div><div class="user-chip"><b>${esc(session?.user?.displayName||'Demoanvändare')}</b></div></header><main class="content">${isDemo?'<div class="demo-banner"><b>GitHub Pages-demo.</b> Rapporterna visar exempeldata.</div>':''}${message?`<div class="notice" role="status" aria-live="polite">${esc(message)}</div>`:''}${toolbar()}${summary()}${content()}</main></section></div>`}
document.addEventListener('change',e=>{if(e.target.dataset.field==='from')fromDate=e.target.value;if(e.target.dataset.field==='to')toDate=e.target.value;if(e.target.dataset.field==='period')period=e.target.value});
document.addEventListener('click',e=>{const tab=e.target.closest('[data-report]');if(tab){reportType=tab.dataset.report;report=null;void loadReport().catch(err=>{message=err.message;render()});return}if(e.target.closest('[data-action="reload"]')){report=null;void loadReport({feedback:true}).catch(err=>{refreshing=false;message=err.message;render()})}});
async function load(){if(isDemo){session={user:{displayName:'Demo Ekonomi'},company:{name:'Rollands Frukt o Grönt AB'}};return loadReport()}if(isSupabase){const ctx=await window.LTSupabaseUat.context();if(!ctx.authenticated||!ctx.company){location.href='./index.html';return}session={user:ctx.user,company:ctx.company};return loadReport()}const s=await api('/session');if(!s.authenticated){location.href='./index.html';return}session=s;await loadReport()}
load().catch(err=>{app.innerHTML=`<main class="boot"><strong>Rapporter kunde inte laddas</strong><span>${esc(err.message)}</span></main>`});
