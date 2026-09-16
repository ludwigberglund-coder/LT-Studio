'use strict';

const Payables=require('../payables/supplier-invoices.js');

function text(v){return String(v??'').trim()}
function mode(values){const counts=new Map();for(const value of values.filter(Boolean))counts.set(value,(counts.get(value)||0)+1);return [...counts.entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])))[0]?.[0]||null}
function extractCostAccount(coding){return (coding||[]).find(line=>Number(line.debitOre)>0&&!['2641','2440'].includes(String(line.account)))?.account||null}
function suggestSupplierCoding(invoice,{supplier=null,history=[]}={}){
  if(!invoice)throw new Error('Leverantörsfaktura saknas.');
  const historyAccounts=history.filter(item=>item?.status==='approved'||item?.status==='payment-prepared'||item?.status==='paid').map(item=>extractCostAccount(item.coding));
  const historical=mode(historyAccounts);
  const defaultAccount=text(supplier?.defaultCostAccount);
  const costAccount=historical||defaultAccount||'4010';
  const sameCount=historyAccounts.filter(account=>account===costAccount).length;
  const considered=historyAccounts.filter(Boolean).length;
  const confidence=historical&&considered?Math.min(.98,.72+(sameCount/considered)*.24):defaultAccount?.length===4?.82:.62;
  const coding=Payables.buildCoding({totalOre:invoice.totalOre,vatOre:invoice.vatOre||0,costAccount,vatAccount:'2641',liabilityAccount:'2440',description:`Leverantörsfaktura ${invoice.supplierInvoiceNumber||''}`.trim()});
  const evidence=[];
  if(historical)evidence.push({kind:'supplier-history',label:'Historiskt kostnadskonto',value:`${costAccount} användes ${sameCount} av ${considered} jämförbara gånger`,sourceId:invoice.supplierId||invoice.id});
  if(!historical&&defaultAccount)evidence.push({kind:'supplier-default',label:'Leverantörens standardkonto',value:defaultAccount,sourceId:invoice.supplierId||invoice.id});
  evidence.push({kind:'invoice-amounts',label:'Belopp och moms',value:`Total ${invoice.totalOre} öre, moms ${invoice.vatOre||0} öre`,sourceId:invoice.id});
  return Object.freeze({confidence,deterministic:Boolean(historical&&sameCount===considered&&considered>=3),ambiguous:Boolean(considered>0&&sameCount/considered<.6),reason:historical?`Tidigare attesterade fakturor från leverantören pekar främst på konto ${costAccount}.`:`Leverantörens standardkonto ${costAccount} används som första förslag.`,coding:coding.lines,evidence:Object.freeze(evidence)});
}
module.exports=Object.freeze({extractCostAccount,suggestSupplierCoding});
