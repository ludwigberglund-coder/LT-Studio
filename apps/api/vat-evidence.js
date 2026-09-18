'use strict';

const crypto=require('node:crypto');
const {protectAppendOnly}=require('./history-guards.js');

const OUTPUT_ACCOUNTS=Object.freeze({2500:'2611',1200:'2621',600:'2631'});
const OUTPUT_BOXES=Object.freeze({2500:'10',1200:'11',600:'12'});
const VAT_ACCOUNTS=Object.freeze(new Set(['2611','2621','2631','2641']));

function vatError(message,code='VAT_EVIDENCE_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(value){return String(value??'').trim()}
function safeOre(value,label){if(!Number.isSafeInteger(value))throw vatError(`${label} måste vara ett heltalsbelopp i ören.`,'INVALID_VAT_AMOUNT');return value}
function initialize(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_vat_evidence(
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      entry_id TEXT NOT NULL REFERENCES accounting_entries(id) ON DELETE RESTRICT,
      evidence_type TEXT NOT NULL CHECK(evidence_type IN ('output-domestic','input-domestic')),
      vat_code TEXT NOT NULL,
      vat_rate_basis_points INTEGER,
      taxable_base_ore INTEGER NOT NULL,
      vat_ore INTEGER NOT NULL,
      vat_account TEXT NOT NULL,
      declaration_base_box TEXT,
      declaration_vat_box TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(company_id,entry_id,evidence_type,vat_code)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_vat_evidence_company_entry ON accounting_vat_evidence(company_id,entry_id);
  `);
  protectAppendOnly(db,'accounting_vat_evidence');
}
function normalize(row,index){
  const evidenceType=text(row?.evidenceType),vatCode=text(row?.vatCode),vatAccount=text(row?.vatAccount);
  const taxableBaseOre=safeOre(row?.taxableBaseOre??0,`Momsunderlag rad ${index+1}`);
  const vatOre=safeOre(row?.vatOre??0,`Momsbelopp rad ${index+1}`);
  const rate=row?.vatRateBasisPoints==null?null:Number(row.vatRateBasisPoints);
  if(!['output-domestic','input-domestic'].includes(evidenceType))throw vatError(`Momsbevis rad ${index+1} har ogiltig typ.`,'INVALID_VAT_EVIDENCE');
  if(!/^[A-Z0-9_-]{3,60}$/.test(vatCode))throw vatError(`Momsbevis rad ${index+1} saknar giltig momskod.`,'INVALID_VAT_CODE');
  if(!/^\d{4}$/.test(vatAccount)||!VAT_ACCOUNTS.has(vatAccount))throw vatError(`Momsbevis rad ${index+1} har ogiltigt momskonto.`,'INVALID_VAT_ACCOUNT');
  if(evidenceType==='output-domestic'){
    if(!Number.isInteger(rate)||!OUTPUT_ACCOUNTS[rate])throw vatError('Utgående moms måste ha 25, 12 eller 6 procents verifierad momssats.','UNSUPPORTED_OUTPUT_VAT_RATE',409);
    if(OUTPUT_ACCOUNTS[rate]!==vatAccount)throw vatError('Momssatsen och kontot för utgående moms stämmer inte överens.','VAT_ACCOUNT_RATE_MISMATCH',409);
    if(text(row.declarationBaseBox)!=='05'||text(row.declarationVatBox)!==OUTPUT_BOXES[rate])throw vatError('Momsrutorna för svensk försäljning stämmer inte med momssatsen.','INVALID_VAT_BOX',409);
  }else{
    if(rate!==null)throw vatError('Vanlig svensk ingående moms ska inte gissa leverantörens momssats i detta flöde.','INVALID_INPUT_VAT_RATE',409);
    if(vatAccount!=='2641'||text(row.declarationVatBox)!=='48'||text(row.declarationBaseBox)!=='')throw vatError('Ingående svensk moms måste avstämmas mot konto 2641 och ruta 48.','INVALID_INPUT_VAT_EVIDENCE',409);
  }
  return Object.freeze({evidenceType,vatCode,vatRateBasisPoints:rate,taxableBaseOre,vatOre,vatAccount,declarationBaseBox:text(row.declarationBaseBox)||null,declarationVatBox:text(row.declarationVatBox)});
}
function vatMovementForAccount(entry,account){
  const lines=entry.lines.filter(line=>line.account===account);
  const signed=account==='2641'?lines.reduce((sum,line)=>sum+line.debitOre-line.creditOre,0):lines.reduce((sum,line)=>sum+line.creditOre-line.debitOre,0);
  const gross=lines.reduce((sum,line)=>sum+line.debitOre+line.creditOre,0);
  return{signed,gross};
}
function validateAgainstEntry(entry,evidence){
  const normalized=(evidence||[]).map(normalize);
  const expected=new Map(),grossExpected=new Map();
  for(const row of normalized){expected.set(row.vatAccount,(expected.get(row.vatAccount)||0)+row.vatOre);grossExpected.set(row.vatAccount,(grossExpected.get(row.vatAccount)||0)+Math.abs(row.vatOre));}
  for(const account of VAT_ACCOUNTS){
    const ledger=vatMovementForAccount(entry,account),supported=expected.get(account)||0,supportedGross=grossExpected.get(account)||0;
    if(ledger.signed!==supported||ledger.gross!==supportedGross)throw vatError(`Momskonto ${account} stämmer inte med verifikationens momsbevis. Bokföring stoppades.`,'VAT_LEDGER_EVIDENCE_MISMATCH',409);
  }
  const output=normalized.filter(row=>row.evidenceType==='output-domestic');
  if(output.length&&entry.sourceType==='customer-invoice'){
    const evidenceBase=output.reduce((sum,row)=>sum+row.taxableBaseOre,0);
    const ledgerBase=entry.lines.filter(line=>/^3\d{3}$/.test(line.account)&&line.account!=='3740').reduce((sum,line)=>sum+line.creditOre-line.debitOre,0);
    if(evidenceBase!==ledgerBase)throw vatError('Försäljningens momsunderlag stämmer inte med kundfakturans bokförda intäktsrader.','VAT_BASE_EVIDENCE_MISMATCH',409);
  }
  const input=normalized.filter(row=>row.evidenceType==='input-domestic');
  if(input.length&&entry.sourceType==='supplier-invoice'){
    const evidenceBase=input.reduce((sum,row)=>sum+row.taxableBaseOre,0);
    const ledgerBase=entry.lines.filter(line=>!['2440','2641'].includes(line.account)).reduce((sum,line)=>sum+line.debitOre-line.creditOre,0);
    if(evidenceBase!==ledgerBase)throw vatError('Leverantörsfakturans momsunderlag stämmer inte med bokförda kostnads-/tillgångsrader.','VAT_BASE_EVIDENCE_MISMATCH',409);
  }
  return normalized;
}
function saveForEntry(db,{companyId,entry,evidence}){
  initialize(db);
  const owned=db.prepare('SELECT 1 FROM accounting_entries WHERE company_id=? AND id=?').get(companyId,entry?.id);
  if(!owned)throw vatError('Verifikationen för momsbeviset finns inte i företaget.','VAT_ENTRY_NOT_FOUND',404);
  const normalized=validateAgainstEntry(entry,evidence);
  const statement=db.prepare(`INSERT INTO accounting_vat_evidence(id,company_id,entry_id,evidence_type,vat_code,vat_rate_basis_points,taxable_base_ore,vat_ore,vat_account,declaration_base_box,declaration_vat_box,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const createdAt=new Date().toISOString();
  for(const row of normalized)statement.run(`vat_${crypto.randomUUID()}`,companyId,entry.id,row.evidenceType,row.vatCode,row.vatRateBasisPoints,row.taxableBaseOre,row.vatOre,row.vatAccount,row.declarationBaseBox,row.declarationVatBox,createdAt);
  return normalized;
}
function forEntry(db,companyId,entryId){initialize(db);return db.prepare(`SELECT id,entry_id AS entryId,evidence_type AS evidenceType,vat_code AS vatCode,vat_rate_basis_points AS vatRateBasisPoints,taxable_base_ore AS taxableBaseOre,vat_ore AS vatOre,vat_account AS vatAccount,declaration_base_box AS declarationBaseBox,declaration_vat_box AS declarationVatBox,created_at AS createdAt FROM accounting_vat_evidence WHERE company_id=? AND entry_id=? ORDER BY declaration_vat_box,vat_code`).all(companyId,entryId)}

function semantic(row){return {evidenceType:row.evidenceType,vatCode:row.vatCode,vatRateBasisPoints:row.vatRateBasisPoints,taxableBaseOre:row.taxableBaseOre,vatOre:row.vatOre,vatAccount:row.vatAccount,declarationBaseBox:row.declarationBaseBox||null,declarationVatBox:row.declarationVatBox}}
function assertRetry(db,companyId,entry,evidence){
  initialize(db);
  const stored=forEntry(db,companyId,entry.id).map(semantic).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const requested=Array.isArray(evidence)?validateAgainstEntry(entry,evidence).map(semantic).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):[];
  if(JSON.stringify(stored)!==JSON.stringify(requested))throw vatError('Källan är redan bokförd med ett annat momsunderlag. Ingen ny bokföring gjordes.','VAT_IDEMPOTENCY_CONFLICT',409);
  return stored;
}

function periodEvidence(db,companyId,from,to){initialize(db);return db.prepare(`SELECT v.entry_id AS entryId,v.evidence_type AS evidenceType,v.vat_code AS vatCode,v.vat_rate_basis_points AS vatRateBasisPoints,v.taxable_base_ore AS taxableBaseOre,v.vat_ore AS vatOre,v.vat_account AS vatAccount,v.declaration_base_box AS declarationBaseBox,v.declaration_vat_box AS declarationVatBox,e.number,e.posting_date AS postingDate,e.source_type AS sourceType,e.source_id AS sourceId FROM accounting_vat_evidence v JOIN accounting_entries e ON e.id=v.entry_id AND e.company_id=v.company_id WHERE v.company_id=? AND e.posting_date BETWEEN ? AND ? ORDER BY e.posting_date,e.series,e.sequence,v.declaration_vat_box`).all(companyId,from,to)}
function ledgerVatActivity(db,companyId,from,to){
  const rows=db.prepare(`SELECT l.account,COALESCE(SUM(l.debit_ore),0) AS debitOre,COALESCE(SUM(l.credit_ore),0) AS creditOre FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l.entry_id WHERE e.company_id=? AND e.posting_date BETWEEN ? AND ? AND l.account IN ('2611','2621','2631','2641') GROUP BY l.account ORDER BY l.account`).all(companyId,from,to);
  return Object.fromEntries([...VAT_ACCOUNTS].map(account=>{const row=rows.find(item=>item.account===account)||{debitOre:0,creditOre:0};const signed=account==='2641'?Number(row.debitOre||0)-Number(row.creditOre||0):Number(row.creditOre||0)-Number(row.debitOre||0);return[account,{account,debitOre:Number(row.debitOre||0),creditOre:Number(row.creditOre||0),signedVatOre:signed}]}));
}
function periodControl(db,companyId,from,to){
  const rows=periodEvidence(db,companyId,from,to),ledger=ledgerVatActivity(db,companyId,from,to),evidenceByAccount={2611:0,2621:0,2631:0,2641:0},boxes={'05':0,'10':0,'11':0,'12':0,'48':0};
  for(const row of rows){evidenceByAccount[row.vatAccount]=(evidenceByAccount[row.vatAccount]||0)+row.vatOre;if(row.declarationBaseBox)boxes[row.declarationBaseBox]=(boxes[row.declarationBaseBox]||0)+row.taxableBaseOre;boxes[row.declarationVatBox]=(boxes[row.declarationVatBox]||0)+row.vatOre;}
  const differences=Object.fromEntries(Object.keys(ledger).map(account=>[account,ledger[account].signedVatOre-(evidenceByAccount[account]||0)]));
  const ledgerReconciled=Object.values(differences).every(value=>value===0);
  boxes['49']=boxes['10']+boxes['11']+boxes['12']-boxes['48'];
  return{rows,ledger,evidenceByAccount,differences,boxes,ledgerReconciled};
}
module.exports=Object.freeze({OUTPUT_ACCOUNTS,OUTPUT_BOXES,VAT_ACCOUNTS,initialize,normalize,validateAgainstEntry,saveForEntry,forEntry,assertRetry,periodEvidence,ledgerVatActivity,periodControl});
