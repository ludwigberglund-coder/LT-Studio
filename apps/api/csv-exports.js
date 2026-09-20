'use strict';

const Reports=require('./reports.js');

function exportError(message,code='EXPORT_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(v){return String(v??'').trim()}
function validateRange(from,to){if(!Reports.validDate(from)||!Reports.validDate(to)||from>to)throw exportError('Exportperioden är ogiltig.','INVALID_EXPORT_RANGE')}
function dangerousText(value){return /^[=+\-@\t\r]/.test(String(value??''))}
function csvCell(value){
  if(value===null||value===undefined)return '';
  if(typeof value==='number'&&Number.isFinite(value))return String(value);
  if(typeof value==='boolean')return value?'true':'false';
  let s=String(value);
  if(dangerousText(s))s="'"+s;
  if(/[;"\r\n]/.test(s))s='"'+s.replaceAll('"','""')+'"';
  return s;
}
function csvDocument(columns,rows){
  const head=columns.map(col=>csvCell(col.label)).join(';');
  const body=rows.map(row=>columns.map(col=>csvCell(typeof col.value==='function'?col.value(row):row[col.value])).join(';')).join('\r\n');
  return Buffer.from('\uFEFF'+head+'\r\n'+body+(body?'\r\n':''),'utf8');
}
function customerInvoices(db,companyId,{from,to}){
  return db.prepare(`SELECT i.invoice_date AS invoiceDate,i.due_date AS dueDate,i.invoice_number AS invoiceNumber,c.customer_number AS customerNumber,c.name AS customerName,
    i.total_ore AS totalOre,i.vat_ore AS vatOre,i.remaining_ore AS remainingOre,i.status,i.ocr
    FROM invoices i JOIN customers c ON c.id=i.customer_id AND c.company_id=i.company_id
    WHERE i.company_id=? AND i.invoice_date BETWEEN ? AND ? ORDER BY i.invoice_date,i.invoice_number`).all(companyId,from,to);
}
function supplierInvoices(db,companyId,{from,to}){
  return db.prepare(`SELECT i.invoice_date AS invoiceDate,i.due_date AS dueDate,i.supplier_invoice_number AS supplierInvoiceNumber,s.supplier_number AS supplierNumber,s.name AS supplierName,
    i.total_ore AS totalOre,i.vat_ore AS vatOre,i.open_amount_ore AS openAmountOre,i.status,i.currency
    FROM supplier_invoices i JOIN suppliers s ON s.id=i.supplier_id AND s.company_id=i.company_id
    WHERE i.company_id=? AND i.invoice_date BETWEEN ? AND ? AND i.status<>'rejected'
    ORDER BY i.invoice_date,i.supplier_invoice_number`).all(companyId,from,to);
}
function incomingPayments(db,companyId,{from,to}){
  return db.prepare(`SELECT COALESCE(t.payment_date,t.posting_date,substr(t.created_at,1,10)) AS paymentDate,i.invoice_number AS invoiceNumber,c.customer_number AS customerNumber,c.name AS customerName,
    t.amount_ore AS amountOre,t.payment_method AS paymentMethod,t.account,t.bank_reference AS bankReference,t.journal_number AS journalNumber
    FROM invoice_transactions t JOIN invoices i ON i.id=t.invoice_id AND i.company_id=t.company_id
    JOIN customers c ON c.id=i.customer_id AND c.company_id=i.company_id
    WHERE t.company_id=? AND t.transaction_type='payment' AND COALESCE(t.payment_date,t.posting_date,substr(t.created_at,1,10)) BETWEEN ? AND ?
    ORDER BY paymentDate,t.created_at,t.id`).all(companyId,from,to);
}
function outgoingPayments(db,companyId,{from,to}){
  return db.prepare(`SELECT p.payment_date AS paymentDate,i.supplier_invoice_number AS supplierInvoiceNumber,s.supplier_number AS supplierNumber,COALESCE(p.recipient_name,s.name) AS supplierName,
    p.amount_ore AS amountOre,p.account,p.status,p.recipient_bankgiro AS bankgiro,p.recipient_plusgiro AS plusgiro,p.released_at AS releasedAt
    FROM supplier_payments p JOIN supplier_invoices i ON i.id=p.supplier_invoice_id AND i.company_id=p.company_id
    JOIN suppliers s ON s.id=i.supplier_id AND s.company_id=i.company_id
    WHERE p.company_id=? AND p.payment_date BETWEEN ? AND ? ORDER BY p.payment_date,supplierName,p.id`).all(companyId,from,to);
}
function entries(db,companyId,{from,to}){
  return db.prepare(`SELECT number,posting_date AS postingDate,description,source_type AS sourceType,source_id AS sourceId,created_by AS createdBy,created_at AS createdAt
    FROM accounting_entries WHERE company_id=? AND posting_date BETWEEN ? AND ? ORDER BY posting_date,series,sequence`).all(companyId,from,to);
}
function accountTransactions(db,companyId,{from,to}){
  return Reports.generalLedger(db,companyId,{from,to}).rows;
}
function vatBasis(db,companyId,{from,to}){
  const customer=db.prepare(`SELECT i.invoice_date AS date,'customer-invoice' AS sourceType,i.invoice_number AS reference,i.vat_ore AS expectedVatOre,
    COALESCE(SUM(CASE WHEN l.account IN ('2611','2621','2631') THEN l.credit_ore-l.debit_ore ELSE 0 END),0) AS bookedVatOre
    FROM invoices i LEFT JOIN accounting_entries e ON e.company_id=i.company_id AND e.source_type IN ('customer-invoice','customer-credit-note') AND e.source_id=i.id
    LEFT JOIN accounting_entry_lines l ON l.entry_id=e.id
    WHERE i.company_id=? AND i.posting_date BETWEEN ? AND ?
    GROUP BY i.id,i.invoice_date,i.invoice_number,i.vat_ore`).all(companyId,from,to);
  const supplier=db.prepare(`SELECT i.invoice_date AS date,'supplier-invoice' AS sourceType,i.supplier_invoice_number AS reference,i.vat_ore AS expectedVatOre,
    COALESCE(SUM(CASE WHEN l.account='2641' THEN l.debit_ore-l.credit_ore ELSE 0 END),0) AS bookedVatOre
    FROM supplier_invoices i LEFT JOIN accounting_entries e ON e.company_id=i.company_id AND e.source_type='supplier-invoice' AND e.source_id=i.id
    LEFT JOIN accounting_entry_lines l ON l.entry_id=e.id
    WHERE i.company_id=? AND i.invoice_date BETWEEN ? AND ? AND i.status<>'rejected'
    GROUP BY i.id,i.invoice_date,i.supplier_invoice_number,i.vat_ore`).all(companyId,from,to);
  return [...customer,...supplier].map(row=>({...row,differenceOre:Number(row.bookedVatOre||0)-Number(row.expectedVatOre||0)})).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.reference).localeCompare(String(b.reference)));
}
function payments(db,companyId,{from,to}){
  const incoming=incomingPayments(db,companyId,{from,to}).map(row=>({date:row.paymentDate,direction:'in',reference:row.invoiceNumber,counterparty:row.customerName,amountOre:row.amountOre,account:row.account,status:'registered'}));
  const outgoing=outgoingPayments(db,companyId,{from,to}).map(row=>({date:row.paymentDate,direction:'out',reference:row.supplierInvoiceNumber,counterparty:row.supplierName,amountOre:row.amountOre,account:row.account,status:row.status}));
  return [...incoming,...outgoing].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.direction).localeCompare(String(b.direction))||String(a.reference).localeCompare(String(b.reference)));
}
const DEFINITIONS=Object.freeze({
  'receivables':{filename:'kundreskontra',rows:customerInvoices,columns:[
    ['Fakturadatum','invoiceDate'],['Förfallodatum','dueDate'],['Fakturanummer','invoiceNumber'],['Kundnummer','customerNumber'],['Kund','customerName'],['Belopp öre','totalOre'],['Moms öre','vatOre'],['Utestående öre','remainingOre'],['Status','status'],['OCR','ocr']
  ]},
  'customer-invoices':{filename:'kundfakturor',rows:customerInvoices,columns:[
    ['Fakturadatum','invoiceDate'],['Förfallodatum','dueDate'],['Fakturanummer','invoiceNumber'],['Kundnummer','customerNumber'],['Kund','customerName'],['Belopp öre','totalOre'],['Moms öre','vatOre'],['Utestående öre','remainingOre'],['Status','status'],['OCR','ocr']
  ]},
  'payables':{filename:'leverantorsreskontra',rows:supplierInvoices,columns:[
    ['Fakturadatum','invoiceDate'],['Förfallodatum','dueDate'],['Leverantörsfaktura','supplierInvoiceNumber'],['Leverantörsnummer','supplierNumber'],['Leverantör','supplierName'],['Belopp öre','totalOre'],['Moms öre','vatOre'],['Utestående öre','openAmountOre'],['Status','status'],['Valuta','currency']
  ]},
  'supplier-invoices':{filename:'leverantorsfakturor',rows:supplierInvoices,columns:[
    ['Fakturadatum','invoiceDate'],['Förfallodatum','dueDate'],['Leverantörsfaktura','supplierInvoiceNumber'],['Leverantörsnummer','supplierNumber'],['Leverantör','supplierName'],['Belopp öre','totalOre'],['Moms öre','vatOre'],['Utestående öre','openAmountOre'],['Status','status'],['Valuta','currency']
  ]},
  'incoming-payments':{filename:'inbetalningar',rows:incomingPayments,columns:[
    ['Betalningsdatum','paymentDate'],['Fakturanummer','invoiceNumber'],['Kundnummer','customerNumber'],['Kund','customerName'],['Belopp öre','amountOre'],['Betalningssätt','paymentMethod'],['Konto','account'],['Bankreferens','bankReference'],['Verifikation','journalNumber']
  ]},
  'outgoing-payments':{filename:'utbetalningar',rows:outgoingPayments,columns:[
    ['Betalningsdatum','paymentDate'],['Leverantörsfaktura','supplierInvoiceNumber'],['Leverantörsnummer','supplierNumber'],['Leverantör','supplierName'],['Belopp öre','amountOre'],['Konto','account'],['Status','status'],['Bankgiro','bankgiro'],['Plusgiro','plusgiro'],['Frisläppt','releasedAt']
  ]},
  'payments':{filename:'betalningar',rows:payments,columns:[
    ['Datum','date'],['Riktning','direction'],['Referens','reference'],['Motpart','counterparty'],['Belopp öre','amountOre'],['Konto','account'],['Status','status']
  ]},
  'entries':{filename:'verifikationer',rows:entries,columns:[
    ['Nummer','number'],['Bokföringsdatum','postingDate'],['Beskrivning','description'],['Källtyp','sourceType'],['Käll-ID','sourceId'],['Skapad av','createdBy'],['Skapad','createdAt']
  ]},
  'account-transactions':{filename:'kontotransaktioner',rows:accountTransactions,columns:[
    ['Verifikation','number'],['Bokföringsdatum','postingDate'],['Beskrivning','description'],['Konto','account'],['Radtext','lineText'],['Debet öre','debitOre'],['Kredit öre','creditOre'],['Källtyp','sourceType'],['Käll-ID','sourceId']
  ]},
  'vat-basis':{filename:'momsunderlag',rows:vatBasis,columns:[
    ['Datum','date'],['Källtyp','sourceType'],['Referens','reference'],['Förväntad moms öre','expectedVatOre'],['Bokförd moms öre','bookedVatOre'],['Differens öre','differenceOre']
  ]}
});
function buildExport(db,companyId,{dataset,from,to}){
  validateRange(from,to);
  const key=text(dataset).toLowerCase();
  const def=DEFINITIONS[key];
  if(!def)throw exportError('Exporttypen stöds inte.','UNSUPPORTED_EXPORT_DATASET',404);
  const rows=def.rows(db,companyId,{from,to});
  const columns=def.columns.map(([label,value])=>({label,value}));
  const bytes=csvDocument(columns,rows);
  return{dataset:key,from,to,count:rows.length,filename:`${def.filename}-${from}-${to}.csv`,bytes};
}
module.exports=Object.freeze({csvCell,csvDocument,buildExport,DEFINITIONS,validateRange});
