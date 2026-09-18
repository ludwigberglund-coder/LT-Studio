'use strict';

function reportError(message,code='REPORT_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(v){return String(v??'').trim()}
function validDate(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(text(v)))return false;const [y,m,d]=text(v).split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d}
function validPeriod(v){return /^\d{4}-(0[1-9]|1[0-2])$/.test(text(v))}
function periodBounds(period){if(!validPeriod(period))throw reportError('Perioden måste anges som ÅÅÅÅ-MM.','INVALID_PERIOD');const [y,m]=period.split('-').map(Number);const last=new Date(Date.UTC(y,m,0)).getUTCDate();return{from:`${period}-01`,to:`${period}-${String(last).padStart(2,'0')}`}}
function validateRange(from,to){if(!validDate(from)||!validDate(to)||from>to)throw reportError('Rapportperioden är ogiltig.','INVALID_REPORT_RANGE')}

function trialBalance(db,companyId,{from,to}){
  validateRange(from,to);
  const rows=db.prepare(`SELECT l.account,
    SUM(CASE WHEN e.posting_date<? THEN l.debit_ore-l.credit_ore ELSE 0 END) AS openingOre,
    SUM(CASE WHEN e.posting_date BETWEEN ? AND ? THEN l.debit_ore ELSE 0 END) AS debitOre,
    SUM(CASE WHEN e.posting_date BETWEEN ? AND ? THEN l.credit_ore ELSE 0 END) AS creditOre,
    SUM(CASE WHEN e.posting_date<=? THEN l.debit_ore-l.credit_ore ELSE 0 END) AS closingOre
    FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id
    WHERE e.company_id=? AND e.posting_date<=?
    GROUP BY l.account ORDER BY l.account`).all(from,from,to,from,to,to,companyId,to);
  const normalized=rows.map(row=>({account:row.account,openingOre:Number(row.openingOre||0),debitOre:Number(row.debitOre||0),creditOre:Number(row.creditOre||0),closingOre:Number(row.closingOre||0)}));
  return{from,to,rows:normalized,totals:{debitOre:normalized.reduce((s,r)=>s+r.debitOre,0),creditOre:normalized.reduce((s,r)=>s+r.creditOre,0)}};
}
function generalLedger(db,companyId,{from,to,account=''}){
  validateRange(from,to);const accountFilter=text(account);if(accountFilter&&!/^\d{4}$/.test(accountFilter))throw reportError('Konto måste bestå av fyra siffror.','INVALID_ACCOUNT');
  const sql=`SELECT e.id AS entryId,e.number,e.posting_date AS postingDate,e.description,e.source_type AS sourceType,e.source_id AS sourceId,l.line_number AS lineNumber,l.account,l.line_text AS lineText,l.debit_ore AS debitOre,l.credit_ore AS creditOre FROM accounting_entries e JOIN accounting_entry_lines l ON l.entry_id=e.id WHERE e.company_id=? AND e.posting_date BETWEEN ? AND ?${accountFilter?' AND l.account=?':''} ORDER BY e.posting_date,e.series,e.sequence,l.line_number`;
  return{from,to,account:accountFilter||null,rows:accountFilter?db.prepare(sql).all(companyId,from,to,accountFilter):db.prepare(sql).all(companyId,from,to)};
}
function profitLoss(db,companyId,{from,to}){
  validateRange(from,to);
  const rows=db.prepare(`SELECT l.account,SUM(l.credit_ore-l.debit_ore) AS amountOre FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id WHERE e.company_id=? AND e.posting_date BETWEEN ? AND ? AND CAST(l.account AS INTEGER) BETWEEN 3000 AND 8999 GROUP BY l.account ORDER BY l.account`).all(companyId,from,to).map(r=>({account:r.account,amountOre:Number(r.amountOre||0)}));
  return{from,to,rows,resultOre:rows.reduce((s,r)=>s+r.amountOre,0)};
}
const OUTPUT_VAT_ACCOUNTS=Object.freeze({'2611':25,'2621':12,'2631':6});
const INPUT_VAT_ACCOUNTS=Object.freeze(new Set(['2641']));
const VAT_SETTLEMENT_ACCOUNTS=Object.freeze(new Set(['2650']));

function vatLedgerRows(db,companyId,{from,to}){
  validateRange(from,to);
  return db.prepare(`SELECT l.account,
    COALESCE(SUM(l.debit_ore),0) AS debitOre,
    COALESCE(SUM(l.credit_ore),0) AS creditOre
    FROM accounting_entry_lines l
    JOIN accounting_entries e ON e.id=l.entry_id
    WHERE e.company_id=? AND e.posting_date BETWEEN ? AND ? AND l.account GLOB '26[0-9][0-9]'
    GROUP BY l.account ORDER BY l.account`).all(companyId,from,to)
    .map(row=>({account:row.account,debitOre:Number(row.debitOre||0),creditOre:Number(row.creditOre||0)}));
}

function customerVatSourceChecks(db,companyId,{from,to}){
  return db.prepare(`SELECT i.id,i.invoice_number AS invoiceNumber,i.vat_ore AS expectedVatOre,e.id AS entryId,e.number AS journalNumber,
    COALESCE(SUM(CASE WHEN l.account IN ('2611','2621','2631') THEN l.credit_ore-l.debit_ore ELSE 0 END),0) AS bookedVatOre
    FROM invoices i
    JOIN accounting_entries e ON e.company_id=i.company_id AND e.source_type='customer-invoice' AND e.source_id=i.id
    JOIN accounting_entry_lines l ON l.entry_id=e.id
    WHERE i.company_id=? AND e.posting_date BETWEEN ? AND ?
    GROUP BY i.id,i.invoice_number,i.vat_ore,e.id,e.number
    ORDER BY i.invoice_number`).all(companyId,from,to).map(row=>({
      invoiceId:row.id,invoiceNumber:row.invoiceNumber,entryId:row.entryId,journalNumber:row.journalNumber,
      expectedVatOre:Number(row.expectedVatOre||0),bookedVatOre:Number(row.bookedVatOre||0),
      differenceOre:Number(row.bookedVatOre||0)-Number(row.expectedVatOre||0)
    }));
}

function supplierVatSourceChecks(db,companyId,{from,to}){
  try{
    return db.prepare(`SELECT i.id,i.supplier_invoice_number AS invoiceNumber,i.vat_ore AS expectedVatOre,e.id AS entryId,e.number AS journalNumber,
      COALESCE(SUM(CASE WHEN l.account='2641' THEN l.debit_ore-l.credit_ore ELSE 0 END),0) AS bookedVatOre
      FROM supplier_invoices i
      JOIN accounting_entries e ON e.company_id=i.company_id AND e.source_type='supplier-invoice' AND e.source_id=i.id
      JOIN accounting_entry_lines l ON l.entry_id=e.id
      WHERE i.company_id=? AND e.posting_date BETWEEN ? AND ?
      GROUP BY i.id,i.supplier_invoice_number,i.vat_ore,e.id,e.number
      ORDER BY i.supplier_invoice_number`).all(companyId,from,to).map(row=>({
        invoiceId:row.id,invoiceNumber:row.invoiceNumber,entryId:row.entryId,journalNumber:row.journalNumber,
        expectedVatOre:Number(row.expectedVatOre||0),bookedVatOre:Number(row.bookedVatOre||0),
        differenceOre:Number(row.bookedVatOre||0)-Number(row.expectedVatOre||0)
      }));
  }catch{return[]}
}

function vatControl(db,companyId,{period}){
  const {from,to}=periodBounds(period);
  const rows=vatLedgerRows(db,companyId,{from,to});
  const outputByAccount=Object.fromEntries(Object.keys(OUTPUT_VAT_ACCOUNTS).map(account=>[account,0]));
  let inputVatOre=0;
  const unsupportedVatAccounts=[];
  for(const row of rows){
    if(Object.hasOwn(OUTPUT_VAT_ACCOUNTS,row.account)) outputByAccount[row.account]=row.creditOre-row.debitOre;
    else if(INPUT_VAT_ACCOUNTS.has(row.account)) inputVatOre+=row.debitOre-row.creditOre;
    else if(!VAT_SETTLEMENT_ACCOUNTS.has(row.account) && row.debitOre!==row.creditOre) unsupportedVatAccounts.push({...row,netOre:row.debitOre-row.creditOre});
  }
  const outputVatOre=Object.values(outputByAccount).reduce((sum,value)=>sum+value,0);
  const customerChecks=customerVatSourceChecks(db,companyId,{from,to});
  const supplierChecks=supplierVatSourceChecks(db,companyId,{from,to});
  const sourceMismatches=[
    ...customerChecks.filter(row=>row.differenceOre!==0).map(row=>({kind:'customer-invoice',...row})),
    ...supplierChecks.filter(row=>row.differenceOre!==0).map(row=>({kind:'supplier-invoice',...row}))
  ];
  const customer=db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(vat_ore),0) AS vatOre,COALESCE(SUM(total_ore),0) AS totalOre FROM invoices WHERE company_id=? AND posting_date BETWEEN ? AND ?`).get(companyId,from,to)||{};
  let supplier={count:0,vatOre:0,totalOre:0};
  try{supplier=db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(vat_ore),0) AS vatOre,COALESCE(SUM(total_ore),0) AS totalOre FROM supplier_invoices WHERE company_id=? AND invoice_date BETWEEN ? AND ? AND status<>'rejected'`).get(companyId,from,to)||supplier}catch{}
  const integrityOk=sourceMismatches.length===0&&unsupportedVatAccounts.length===0;
  const warning=integrityOk
    ? 'Momsbeloppen är avstämda mot bokförda momskonton för de källanknutna fakturorna. Underlaget är fortfarande inte en färdig momsdeklaration: full momskodning, redovisningsmetod och övriga svenska momsfall måste vara verifierade.'
    : 'Momsavstämningen innehåller differenser eller momskonton som den här versionen inte kan klassificera säkert. Perioden får inte behandlas som deklarationsklar.';
  return{
    period,from,to,basis:'booked-ledger-control',declarationReady:false,integrityOk,
    outputVatOre,inputVatOre,netVatOre:outputVatOre-inputVatOre,
    outputVatByRate:{
      '25':outputByAccount['2611'],
      '12':outputByAccount['2621'],
      '6':outputByAccount['2631']
    },
    ledgerAccounts:rows,
    sourceReconciliation:{customerInvoices:customerChecks,supplierInvoices:supplierChecks,mismatches:sourceMismatches},
    unsupportedVatAccounts,
    operationalControl:{
      customerInvoiceCount:Number(customer.count||0),supplierInvoiceCount:Number(supplier.count||0),
      customerVatOre:Number(customer.vatOre||0),supplierVatOre:Number(supplier.vatOre||0),
      customerGrossOre:Number(customer.totalOre||0),supplierGrossOre:Number(supplier.totalOre||0)
    },
    customerInvoiceCount:Number(customer.count||0),supplierInvoiceCount:Number(supplier.count||0),
    customerGrossOre:Number(customer.totalOre||0),supplierGrossOre:Number(supplier.totalOre||0),
    warning
  };
}
function reportSummary(db,companyId,{from,to,period}){const trial=trialBalance(db,companyId,{from,to}),pl=profitLoss(db,companyId,{from,to}),vat=vatControl(db,companyId,{period});return{from,to,trialTotals:trial.totals,profitLoss:pl.resultOre,vat}}

module.exports=Object.freeze({validDate,validPeriod,periodBounds,trialBalance,generalLedger,profitLoss,vatLedgerRows,customerVatSourceChecks,supplierVatSourceChecks,vatControl,reportSummary,OUTPUT_VAT_ACCOUNTS});
