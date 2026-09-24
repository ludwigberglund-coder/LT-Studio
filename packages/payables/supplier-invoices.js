'use strict';

const crypto = require('node:crypto');

function domainError(message,code='SUPPLIER_INVOICE_ERROR',statusCode=422){const error=new Error(message);error.code=code;error.statusCode=statusCode;return error}
function text(value){return String(value??'').trim()}
function assertOre(value,label){if(!Number.isSafeInteger(value))throw domainError(`${label} måste vara ett heltalsbelopp i ören.`,'INVALID_AMOUNT');return value}
function assertAccount(value){const account=text(value);if(!/^\d{4}$/.test(account))throw domainError(`Ogiltigt konto: ${account||'saknas'}.`,'INVALID_ACCOUNT');return account}
function canonicalCoding(lines){
  if(!Array.isArray(lines)||!lines.length)throw domainError('Konteringen måste innehålla minst en rad.','MISSING_CODING');
  return lines.map((line,index)=>{
    const debitOre=assertOre(Number(line?.debitOre??0),`Debet rad ${index+1}`);
    const creditOre=assertOre(Number(line?.creditOre??0),`Kredit rad ${index+1}`);
    if(debitOre<0||creditOre<0||(!debitOre&&!creditOre)||(debitOre&&creditOre))throw domainError(`Konteringsrad ${index+1} måste ha antingen debet eller kredit.`,'INVALID_CODING_LINE');
    return Object.freeze({account:assertAccount(line?.account),debitOre,creditOre,text:text(line?.text),vatCode:text(line?.vatCode)});
  });
}
function totals(lines){return lines.reduce((sum,line)=>({debitOre:sum.debitOre+line.debitOre,creditOre:sum.creditOre+line.creditOre}),{debitOre:0,creditOre:0})}
function validateCoding({totalOre,lines}){
  assertOre(totalOre,'Fakturabelopp');
  if(totalOre<=0)throw domainError('Leverantörsfakturan måste ha ett positivt totalbelopp.','INVALID_TOTAL');
  const normalized=canonicalCoding(lines);
  const sum=totals(normalized);
  if(sum.debitOre!==sum.creditOre)throw domainError('Konteringen balanserar inte: debet och kredit måste vara lika.','UNBALANCED_CODING');
  if(sum.debitOre!==totalOre)throw domainError('Konteringen måste balansera till fakturans totalbelopp.','CODING_TOTAL_MISMATCH');
  return Object.freeze({lines:Object.freeze(normalized),...sum});
}
function buildCoding({totalOre,vatOre=0,costAccount='4010',vatAccount='2641',liabilityAccount='2440',description=''}){
  assertOre(totalOre,'Fakturabelopp');assertOre(vatOre,'Moms');
  if(totalOre<=0||vatOre<0||vatOre>totalOre)throw domainError('Belopp eller moms är ogiltigt.','INVALID_TOTAL');
  const netOre=totalOre-vatOre;
  const lines=[];
  if(netOre)lines.push({account:assertAccount(costAccount),debitOre:netOre,creditOre:0,text:text(description)||'Kostnad',vatCode:vatOre?'INPUT_VAT':''});
  if(vatOre)lines.push({account:assertAccount(vatAccount),debitOre:vatOre,creditOre:0,text:'Ingående moms',vatCode:'INPUT_VAT'});
  lines.push({account:assertAccount(liabilityAccount),debitOre:0,creditOre:totalOre,text:'Leverantörsskuld',vatCode:''});
  return validateCoding({totalOre,lines});
}
function codingHash(lines){
  const normalized=canonicalCoding(lines).map(line=>({account:line.account,debitOre:line.debitOre,creditOre:line.creditOre,text:line.text,vatCode:line.vatCode}));
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
function assertApproval(invoice,actorId,lines,{allowSameActor=false}={}){
  const actor=text(actorId);
  if(!actor)throw domainError('Personlig användaridentitet krävs för attest.','PERSONAL_IDENTITY_REQUIRED',401);
  if(!invoice)throw domainError('Leverantörsfakturan saknas.','INVOICE_NOT_FOUND',404);
  if(invoice.registeredBy===actor&&!allowSameActor)throw domainError('Den som registrerade fakturan får inte ensam attestera samma faktura.','SEPARATION_OF_DUTIES_FAILED',409);
  if(!['registered','coding-review','coded'].includes(invoice.status))throw domainError('Fakturan kan inte attesteras i nuvarande status.','INVALID_INVOICE_STATUS',409);
  const coding=validateCoding({totalOre:invoice.totalOre,lines});
  return Object.freeze({coding,codingHash:codingHash(coding.lines),sameActor:invoice.registeredBy===actor});
}
function paymentSummary(payments,date){
  const target=text(date);
  const selected=(payments||[]).filter(item=>item.paymentDate===target&&['prepared','released','paid'].includes(item.status));
  const totalOre=selected.reduce((sum,item)=>sum+Number(item.amountOre||0),0);
  const byStatus=Object.fromEntries(['prepared','released','paid'].map(status=>[status,selected.filter(item=>item.status===status).reduce((sum,item)=>sum+Number(item.amountOre||0),0)]));
  return Object.freeze({date:target,count:selected.length,totalOre,byStatus:Object.freeze(byStatus),payments:Object.freeze(selected)});
}
module.exports=Object.freeze({canonicalCoding,totals,validateCoding,buildCoding,codingHash,assertApproval,paymentSummary});
