'use strict';

// Legacy Node API: conservative, review-only historical supplier coding.
// The active shared UAT uses Supabase and its separate posted-history engine.
const Payables=require('../payables/supplier-invoices.js');
const ACCOUNTS=new Set(['4010','6110','5460','6540']);
const RATES=[0,6,12,25];
const SHA=/^[a-f0-9]{64}$/i;
function text(v){return typeof v==='string'?v.trim():''}
function ore(v){return Number.isSafeInteger(v)&&v>=0&&v<=99999999999}
function vatRate(total,vat){
  if(!ore(total)||!ore(vat)||vat>=total||total===0)return null;
  const net=total-vat;
  const choices=RATES.filter(rate=>Math.abs(vat*100-net*rate)<=100);
  return choices.length===1?choices[0]:null;
}
function mode(values){
  const counts=new Map();
  for(const value of values.filter(Boolean))counts.set(value,(counts.get(value)||0)+1);
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])))[0]?.[0]||null;
}
function extractCostAccount(coding){
  if(!Array.isArray(coding))return null;
  return coding.find(line=>line&&ore(line.debitOre)&&line.debitOre>0&&line.creditOre===0&&
    ACCOUNTS.has(String(line.account)))?.account||null;
}
function postedCostAccount(invoice,row,expectedRate){
  // Only original, posted, personally approved, same-tenant evidence is usable.
  if(!row||typeof row.id!=='string'||!row.id||row.id===invoice.id||
     row.companyId!==invoice.companyId||row.supplierId!==invoice.supplierId||
     !['approved','payment-prepared','paid'].includes(row.status)||
     !text(row.approvedBy)||!text(row.approvedAt)||
     !text(row.liabilityAccountingEntryId)||!text(row.liabilityPostedAt)||
     !SHA.test(row.documentSha256||'')||row.currency!=='SEK'||
     row.vatTreatment!=='se-domestic-full-input-vat'||
     vatRate(row.totalOre,row.vatOre)!==expectedRate||
     !Array.isArray(row.coding))return null;
  const net=row.totalOre-row.vatOre,rows=row.coding;
  if(rows.length!==(row.vatOre?3:2)||rows.some(line=>!line||typeof line!=='object'||
     !ore(line.debitOre)||!ore(line.creditOre)||
     (line.debitOre===0&&line.creditOre===0)||
     (line.debitOre>0&&line.creditOre>0)))return null;
  const expense=rows.filter(line=>ACCOUNTS.has(String(line.account))&&line.debitOre===net&&line.creditOre===0);
  const vat=rows.filter(line=>String(line.account)==='2641'&&line.debitOre===row.vatOre&&line.creditOre===0);
  const payable=rows.filter(line=>String(line.account)==='2440'&&line.debitOre===0&&line.creditOre===row.totalOre);
  if(expense.length!==1||vat.length!==(row.vatOre?1:0)||payable.length!==1||
    rows.reduce((sum,line)=>sum+line.debitOre-line.creditOre,0)!==0)return null;
  return String(expense[0].account);
}
function suggestSupplierCoding(invoice,{supplier=null,history=[]}={}){
  if(!invoice)throw new Error('Leverantörsfaktura saknas.');
  if(supplier?.companyId&&invoice.companyId&&supplier.companyId!==invoice.companyId)
    throw new Error('Leverantören tillhör ett annat företag.');
  const expectedRate=invoice.currency==='SEK'&&
    invoice.vatTreatment==='se-domestic-full-input-vat'?vatRate(invoice.totalOre,invoice.vatOre||0):null;
  const seenIds=new Set(),seenHashes=new Map(),historyAccounts=[];
  let collision=false;
  if(Array.isArray(history)&&history.length<=100&&expectedRate!==null){
    for(const row of history){
      const account=postedCostAccount(invoice,row,expectedRate);
      if(!account||seenIds.has(row.id))continue;
      seenIds.add(row.id);
      const digest=row.documentSha256.toLowerCase();
      if(seenHashes.has(digest)){
        if(seenHashes.get(digest)!==account)collision=true;
        continue;
      }
      seenHashes.set(digest,account);
      historyAccounts.push(account);
    }
  }
  // A single prior coding (or three copies of the same PDF) is never high
  // confidence. The legacy source is also a limited recent-history snapshot.
  const historical=historyAccounts.length>=3&&!collision?mode(historyAccounts):null;
  const defaultValue=text(supplier?.defaultCostAccount);
  const defaultAccount=/^\d{4}$/.test(defaultValue)&&
    !['1910','1930','2440','2641'].includes(defaultValue)?defaultValue:'';
  const costAccount=historical||defaultAccount||'4010';
  const considered=historyAccounts.length,sameCount=historyAccounts.filter(a=>a===costAccount).length;
  const unanimous=Boolean(historical&&sameCount===considered&&considered>=3);
  const ambiguous=Boolean(collision||(historical&&sameCount!==considered));
  const confidence=collision?0.55:historical?
    Math.min(0.96,0.72+sameCount/considered*0.24):
    defaultAccount?0.72:0.55;
  const coding=Payables.buildCoding({
    totalOre:invoice.totalOre,vatOre:invoice.vatOre||0,
    costAccount,vatAccount:'2641',liabilityAccount:'2440',
    description:`Leverantörsfaktura ${invoice.supplierInvoiceNumber||''}`.trim()
  });
  const evidence=[];
  if(historical)evidence.push({kind:'supplier-history',label:'Bokförda original från leverantören',
    value:`${costAccount} användes på ${sameCount} av ${considered} oberoende, attesterade och bokförda original`,
    sourceId:invoice.supplierId||invoice.id});
  if(!historical&&defaultAccount)evidence.push({kind:'supplier-default',label:'Leverantörens standardkonto',
    value:defaultAccount,sourceId:invoice.supplierId||invoice.id});
  if(!historical&&considered>0)evidence.push({kind:'history-insufficient',label:'Historik behöver granskas',
    value:`Endast ${considered} fristående, bokförda original hittades eller historiken var motsägelsefull`,
    sourceId:invoice.supplierId||invoice.id});
  evidence.push({kind:'invoice-amounts',label:'Belopp och moms',
    value:`Total ${invoice.totalOre} öre, moms ${invoice.vatOre||0} öre`,sourceId:invoice.id});
  return Object.freeze({
    confidence,deterministic:unanimous,ambiguous,
    reason:historical?
      `Minst tre fristående, attesterade och bokförda fakturor från leverantören visar konto ${costAccount}. Förslaget kräver fortfarande personlig granskning.`:
      `Inget tillräckligt bokfört historikunderlag finns. Konto ${costAccount} visas endast som ett manuellt granskningsförslag.`,
    coding:coding.lines,evidence:Object.freeze(evidence)
  });
}
module.exports=Object.freeze({extractCostAccount,suggestSupplierCoding});