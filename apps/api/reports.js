'use strict';

const VatEvidence=require('./vat-evidence.js');

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
function vatControl(db,companyId,{period}){
  const {from,to}=periodBounds(period);
  const control=VatEvidence.periodControl(db,companyId,from,to);
  const customer=db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(i.total_ore),0) AS totalOre FROM accounting_entries e JOIN invoices i ON i.company_id=e.company_id AND i.id=e.source_id WHERE e.company_id=? AND e.source_type='customer-invoice' AND e.posting_date BETWEEN ? AND ?`).get(companyId,from,to)||{};
  let supplier={count:0,totalOre:0};
  try{supplier=db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(i.total_ore),0) AS totalOre FROM accounting_entries e JOIN supplier_invoices i ON i.company_id=e.company_id AND i.id=e.source_id WHERE e.company_id=? AND e.source_type='supplier-invoice' AND e.posting_date BETWEEN ? AND ?`).get(companyId,from,to)||supplier}catch{}
  const outputVatOre=Number(control.boxes['10']||0)+Number(control.boxes['11']||0)+Number(control.boxes['12']||0),inputVatOre=Number(control.boxes['48']||0);
  const warning=control.ledgerReconciled
    ? 'Bokförda momskonton är avstämda mot spårbara momsbevis för stödda svenska fakturaflöden. Underlaget är ännu inte en full momsdeklaration eftersom övriga momsfall och deklarationsrutor måste verifieras separat.'
    : 'Momsavstämningen innehåller bokförda belopp på 2611/2621/2631/2641 som saknar matchande momsbevis. Perioden får inte användas som deklarationsunderlag innan avvikelsen är utredd.';
  return{period,from,to,outputVatOre,inputVatOre,netVatOre:outputVatOre-inputVatOre,customerInvoiceCount:Number(customer.count||0),supplierInvoiceCount:Number(supplier.count||0),customerGrossOre:Number(customer.totalOre||0),supplierGrossOre:Number(supplier.totalOre||0),basis:'ledger-vat-evidence',ledgerReconciled:control.ledgerReconciled,declarationBoxes:control.boxes,vatAccountDifferences:control.differences,evidenceCount:control.rows.length,declarationReady:false,warning};
}

function reportSummary(db,companyId,{from,to,period}){const trial=trialBalance(db,companyId,{from,to}),pl=profitLoss(db,companyId,{from,to}),vat=vatControl(db,companyId,{period});return{from,to,trialTotals:trial.totals,profitLoss:pl.resultOre,vat}}

module.exports=Object.freeze({validDate,validPeriod,periodBounds,trialBalance,generalLedger,profitLoss,vatControl,reportSummary});
