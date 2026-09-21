'use strict';

const Reports=require('./reports.js');
const Accounting=require('./accounting-store.js');
const Payables=require('./payables.js');
const PaymentOverview=require('./payment-overview.js');

function exportError(message,code='EXPORT_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(value){return String(value??'').trim()}
function validOptionalDate(value){return value===''||Reports.validDate(value)}
function validateRange(from,to){
  if(!validOptionalDate(from)||!validOptionalDate(to)||(from&&to&&from>to))throw exportError('Datumfiltret är ogiltigt.','INVALID_EXPORT_RANGE');
}
function safeText(value){
  const raw=String(value??'');
  if(/^[=+\-@\t\r]/.test(raw))return `'${raw}`;
  return raw;
}
function csvCell(value){
  const raw=typeof value==='number'?String(value):safeText(value);
  return `"${raw.replaceAll('"','""')}"`;
}
function toCsv(columns,rows){
  const lines=[columns.map(column=>csvCell(column.label)).join(';')];
  for(const row of rows)lines.push(columns.map(column=>csvCell(row[column.key])).join(';'));
  return '\uFEFF'+lines.join('\r\n')+'\r\n';
}
function matchesDate(value,from,to){return (!from||value>=from)&&(!to||value<=to)}
function matchesStatus(value,status){return !status||String(value||'').toLowerCase()===status.toLowerCase()}

function receivables(db,companyId,{from='',to='',status=''}={}){
  validateRange(from,to);
  const rows=[];
  for(const invoice of require('./database.js').listReceivables(db,companyId)){
    if(!matchesDate(invoice.invoiceDate,from,to)||!matchesStatus(invoice.status,status))continue;
    rows.push({
      customerNumber:invoice.customerNumber,customerName:invoice.customerName,invoiceNumber:invoice.invoiceNumber,
      invoiceDate:invoice.invoiceDate,dueDate:invoice.dueDate,status:invoice.status,totalOre:invoice.totalOre,
      remainingOre:invoice.remainingOre,vatOre:invoice.vatOre,ocr:invoice.ocr||'',journalNumber:invoice.journalNumber||''
    });
  }
  return {filename:'kundreskontra.csv',rows,columns:[
    ['customerNumber','Kundnummer'],['customerName','Kund'],['invoiceNumber','Fakturanummer'],['invoiceDate','Fakturadatum'],
    ['dueDate','Förfallodatum'],['status','Status'],['totalOre','Belopp öre'],['remainingOre','Utestående öre'],
    ['vatOre','Moms öre'],['ocr','OCR'],['journalNumber','Verifikation']
  ]};
}
function receipts(db,companyId,{from='',to=''}={}){
  validateRange(from,to);
  const rows=db.prepare(`SELECT t.payment_date AS paymentDate,t.posting_date AS postingDate,t.amount_ore AS amountOre,t.payment_method AS paymentMethod,
    t.account,t.bank_reference AS bankReference,t.journal_number AS journalNumber,i.invoice_number AS invoiceNumber,
    c.customer_number AS customerNumber,c.name AS customerName
    FROM invoice_transactions t
    JOIN invoices i ON i.id=t.invoice_id AND i.company_id=t.company_id
    JOIN customers c ON c.id=i.customer_id AND c.company_id=i.company_id
    WHERE t.company_id=? AND t.transaction_type='payment'
    ORDER BY COALESCE(t.payment_date,t.posting_date),t.created_at,t.id`).all(companyId)
    .filter(row=>matchesDate(row.paymentDate||row.postingDate,from,to));
  return {filename:'inbetalningar.csv',rows,columns:[
    ['paymentDate','Betalningsdatum'],['postingDate','Bokföringsdatum'],['customerNumber','Kundnummer'],['customerName','Kund'],
    ['invoiceNumber','Fakturanummer'],['amountOre','Belopp öre'],['paymentMethod','Betalsätt'],['account','Konto'],
    ['bankReference','Bankreferens'],['journalNumber','Verifikation']
  ]};
}
function payables(db,companyId,{from='',to='',status=''}={}){
  validateRange(from,to);
  const rows=Payables.listInvoices(db,companyId).filter(row=>matchesDate(row.invoiceDate,from,to)&&matchesStatus(row.status,status));
  return {filename:'leverantorsreskontra.csv',rows,columns:[
    ['supplierNumber','Leverantörsnummer'],['supplierName','Leverantör'],['supplierInvoiceNumber','Fakturanummer'],
    ['invoiceDate','Fakturadatum'],['dueDate','Förfallodatum'],['status','Status'],['totalOre','Belopp öre'],
    ['openAmountOre','Utestående öre'],['vatOre','Moms öre'],['currency','Valuta']
  ]};
}
function paymentOverview(db,companyId,filters={}){
  const report=PaymentOverview.paymentOverview(db,companyId,filters);
  return {filename:'betalningsoversikt.csv',rows:report.rows.map(row=>({
    paymentDate:row.paymentDate,
    direction:row.direction==='in'?'Inbetalning':'Utbetalning',
    counterparty:row.counterparty||'',
    invoiceNumber:row.invoiceNumber||'',
    status:row.status||'',
    reference:row.reference||'',
    paymentAccount:row.paymentAccount||'',
    counterpartyAccount:row.counterpartyAccount||'',
    amountOre:row.direction==='out'?-Number(row.amountOre||0):Number(row.amountOre||0)
  })),columns:[
    ['paymentDate','Betalningsdatum'],['direction','Typ'],['counterparty','Motpart'],['invoiceNumber','Fakturanummer'],
    ['status','Status'],['reference','Referens'],['paymentAccount','Konto'],['counterpartyAccount','Motpartskonto'],['amountOre','Belopp öre']
  ]};
}
function payments(db,companyId,{from='',to='',status=''}={}){
  validateRange(from,to);
  const rows=Payables.listPayments(db,companyId).filter(row=>matchesDate(row.paymentDate,from,to)&&matchesStatus(row.status,status));
  return {filename:'utbetalningar.csv',rows,columns:[
    ['paymentDate','Betalningsdatum'],['supplierNumber','Leverantörsnummer'],['supplierName','Leverantör'],
    ['supplierInvoiceNumber','Fakturanummer'],['status','Status'],['amountOre','Belopp öre'],['account','Konto'],
    ['bankgiro','Bankgiro'],['plusgiro','Plusgiro']
  ]};
}
function journal(db,companyId,{from='',to=''}={}){
  validateRange(from,to);
  const rows=Accounting.listEntries(db,companyId,{limit:1000}).filter(row=>matchesDate(row.postingDate,from,to));
  return {filename:'verifikationer.csv',rows,columns:[
    ['number','Verifikation'],['postingDate','Bokföringsdatum'],['description','Beskrivning'],['sourceType','Källtyp'],
    ['sourceId','Käll-ID'],['createdBy','Skapad av'],['createdAt','Skapad tid']
  ]};
}
function ledger(db,companyId,{from,to,account=''}={}){
  if(!from||!to)throw exportError('Huvudboksexport kräver från- och tilldatum.','EXPORT_RANGE_REQUIRED');
  const report=Reports.generalLedger(db,companyId,{from,to,account});
  return {filename:'kontotransaktioner.csv',rows:report.rows,columns:[
    ['number','Verifikation'],['postingDate','Bokföringsdatum'],['account','Konto'],['lineText','Radtext'],
    ['description','Beskrivning'],['debitOre','Debet öre'],['creditOre','Kredit öre'],['sourceType','Källtyp'],['sourceId','Käll-ID']
  ]};
}
function sales(db,companyId,{from='',to=''}={}){
  if(!from||!to)throw exportError('Försäljningsexport kräver från- och tilldatum.','EXPORT_RANGE_REQUIRED');
  const report=Reports.salesReport(db,companyId,{from,to});
  return {filename:'forsaljningsrapport.csv',rows:report.customers,columns:[
    ['customerNumber','Kundnummer'],['customerName','Kund'],['invoiceCount','Antal fakturor'],
    ['netOre','Netto öre'],['vatOre','Moms öre'],['grossOre','Brutto öre'],
    ['paidOre','Betalt öre'],['outstandingOre','Utestående öre']
  ]};
}
function receivablesAging(db,companyId,{asOf='',to=''}={}){
  const date=asOf||to;
  if(!date)throw exportError('Åldersanalysen kräver rapportdatum.','EXPORT_AGING_DATE_REQUIRED');
  const report=Reports.receivablesAging(db,companyId,{asOf:date});
  return {filename:`kundfordringar-alder-${date}.csv`,rows:report.customers,columns:[
    ['customerNumber','Kundnummer'],['customerName','Kund'],['invoiceCount','Öppna fakturor'],['openOre','Netto öppet öre'],
    ['notDueOre','Ej förfallet öre'],['dueTodayOre','Förfaller idag öre'],['overdue1to30Ore','1-30 dagar öre'],
    ['overdue31to60Ore','31-60 dagar öre'],['overdue61to90Ore','61-90 dagar öre'],['overdue91PlusOre','91+ dagar öre'],['creditOre','Kreditsaldo öre']
  ]};
}
function payablesAging(db,companyId,{asOf='',to=''}={}){
  const date=asOf||to;
  if(!date)throw exportError('Åldersanalysen kräver rapportdatum.','EXPORT_AGING_DATE_REQUIRED');
  const report=Reports.payablesAging(db,companyId,{asOf:date});
  return {filename:`leverantorsskulder-alder-${date}.csv`,rows:report.suppliers,columns:[
    ['supplierNumber','Leverantörsnummer'],['supplierName','Leverantör'],['invoiceCount','Öppna fakturor'],['openOre','Netto öppet öre'],
    ['postedOpenOre','Bokfört öppet öre'],['unpostedOpenOre','Ej bokfört öppet öre'],['notDueOre','Ej förfallet öre'],
    ['dueTodayOre','Förfaller idag öre'],['overdue1to30Ore','1-30 dagar öre'],['overdue31to60Ore','31-60 dagar öre'],
    ['overdue61to90Ore','61-90 dagar öre'],['overdue91PlusOre','91+ dagar öre'],['creditOre','Kreditsaldo öre']
  ]};
}
function supplierPurchases(db,companyId,{from='',to=''}={}){
  if(!from||!to)throw exportError('Inköpsexport kräver från- och tilldatum.','EXPORT_RANGE_REQUIRED');
  const report=Reports.supplierPurchasesReport(db,companyId,{from,to});
  return {filename:'inkop-per-leverantor.csv',rows:report.suppliers,columns:[
    ['supplierNumber','Leverantörsnummer'],['supplierName','Leverantör'],['invoiceCount','Antal fakturor'],
    ['netOre','Netto öre'],['vatOre','Moms öre'],['grossOre','Brutto öre'],['openOre','Utestående öre']
  ]};
}
function vat(db,companyId,{period}={}){
  if(!period)throw exportError('Momsexport kräver period ÅÅÅÅ-MM.','EXPORT_PERIOD_REQUIRED');
  const report=Reports.vatControl(db,companyId,{period});
  const rows=[
    ...Object.entries(report.outputVatByRate).map(([rate,amountOre])=>({kind:'utgående',rate,amountOre})),
    {kind:'ingående',rate:'',amountOre:report.inputVatOre},
    {kind:'netto',rate:'',amountOre:report.netVatOre}
  ];
  return {filename:`momsunderlag-${period}.csv`,rows,columns:[['kind','Typ'],['rate','Momssats'],['amountOre','Belopp öre']]};
}
function buildCsv(dataset){return toCsv(dataset.columns.map(([key,label])=>({key,label})),dataset.rows)}
function select(db,companyId,type,filters){
  if(type==='receivables')return receivables(db,companyId,filters);
  if(type==='customer-invoices')return {...receivables(db,companyId,filters),filename:'kundfakturor.csv'};
  if(type==='receipts')return receipts(db,companyId,filters);
  if(type==='payables')return payables(db,companyId,filters);
  if(type==='supplier-invoices')return {...payables(db,companyId,filters),filename:'leverantorsfakturor.csv'};
  if(type==='payments')return payments(db,companyId,filters);
  if(type==='payments-overview')return paymentOverview(db,companyId,filters);
  if(type==='journal')return journal(db,companyId,filters);
  if(type==='ledger')return ledger(db,companyId,filters);
  if(type==='sales')return sales(db,companyId,filters);
  if(type==='receivables-aging')return receivablesAging(db,companyId,filters);
  if(type==='payables-aging')return payablesAging(db,companyId,filters);
  if(type==='supplier-purchases')return supplierPurchases(db,companyId,filters);
  if(type==='vat')return vat(db,companyId,filters);
  throw exportError('Exporttypen stöds inte.','EXPORT_NOT_FOUND',404);
}
module.exports=Object.freeze({safeText,csvCell,toCsv,receivables,receipts,payables,payments,paymentOverview,journal,ledger,sales,receivablesAging,payablesAging,supplierPurchases,vat,buildCsv,select,validateRange});
