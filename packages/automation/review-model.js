'use strict';

const ACCOUNT_NAMES=Object.freeze({
  '1510':'Kundfordringar','1910':'Kassa','1930':'Företagskonto / bank','2440':'Leverantörsskulder',
  '2611':'Utgående moms 25 %','2621':'Utgående moms 12 %','2631':'Utgående moms 6 %','2641':'Ingående moms',
  '2710':'Personalskatt','2731':'Avräkning sociala avgifter','2910':'Upplupna löner / löneskuld',
  '4010':'Inköp varor och material','4056':'Inköp varor inom EU','4535':'Inköp tjänster från annat EU-land',
  '5010':'Lokalhyra','5410':'Förbrukningsinventarier','5460':'Förbrukningsmaterial','5611':'Drivmedel personbil',
  '5800':'Resekostnader','5910':'Annonsering','6071':'Representation avdragsgill','6110':'Kontorsmaterial',
  '6212':'Mobiltelefon','6230':'Datakommunikation / internet','6540':'IT-tjänster','6570':'Bankkostnader',
  '7010':'Löner','7510':'Arbetsgivaravgifter','8310':'Ränteintäkter','8410':'Räntekostnader'
});
function text(v){return String(v??'').trim()}
function accountName(number){return ACCOUNT_NAMES[text(number)]||'Annat konto'}
function line(account,{debitOre=0,creditOre=0,label='',editable=true}={}){return Object.freeze({account:text(account),accountName:accountName(account),debitOre:Number(debitOre||0),creditOre:Number(creditOre||0),label:text(label),editable:Boolean(editable)})}
function amountOre(proposal){return Number(proposal?.suggestion?.amountOre||proposal?.suggestion?.totalOre||0)}
function codingLines(proposal){
  const suggestion=proposal?.suggestion||{};
  if(Array.isArray(suggestion.coding)&&suggestion.coding.length)return suggestion.coding.map(row=>line(row.account,{debitOre:row.debitOre,creditOre:row.creditOre,label:row.text||row.label,editable:true}));
  if(Array.isArray(suggestion.lines)&&suggestion.lines.length)return suggestion.lines.map(row=>line(row.account,{debitOre:row.debitOre,creditOre:row.creditOre,label:row.text||row.label,editable:true}));
  if(proposal?.type==='bank-payment-match'){
    const amount=amountOre(proposal);return [line(suggestion.bankAccount||'1930',{debitOre:amount,label:'Inbetalning till bank',editable:true}),line(suggestion.receivableAccount||'1510',{creditOre:amount,label:'Minska kundfordran',editable:true})];
  }
  if(proposal?.type==='supplier-payment-preparation'){
    const amount=amountOre(proposal);return [line(suggestion.liabilityAccount||'2440',{debitOre:amount,label:'Minska leverantörsskuld',editable:true}),line(suggestion.bankAccount||suggestion.account||'1930',{creditOre:amount,label:'Utbetalning från bank',editable:true})];
  }
  if(proposal?.type==='booking-account-suggestion'){
    const amount=amountOre(proposal);const vat=Number(suggestion.vatOre||0);const net=Math.max(0,amount-vat);const rows=[];if(net)rows.push(line(suggestion.debitAccount||suggestion.account||'5460',{debitOre:net,label:'Kostnad',editable:true}));if(vat)rows.push(line(suggestion.vatAccount||'2641',{debitOre:vat,label:'Ingående moms',editable:true}));if(amount)rows.push(line(suggestion.creditAccount||'1930',{creditOre:amount,label:'Motkonto',editable:true}));return rows;
  }
  if(proposal?.type==='supplier-invoice-coding'){
    const amount=amountOre(proposal);const vat=Number(suggestion.vatOre||0);const net=Math.max(0,amount-vat);const rows=[];if(net||!amount)rows.push(line(suggestion.account||suggestion.costAccount||'4010',{debitOre:net,label:'Kostnad/inköp',editable:true}));if(vat)rows.push(line(suggestion.vatAccount||'2641',{debitOre:vat,label:'Ingående moms',editable:true}));if(amount)rows.push(line(suggestion.liabilityAccount||'2440',{creditOre:amount,label:'Leverantörsskuld',editable:true}));return rows;
  }
  return [];
}
function actionLabel(type){return ({'bank-payment-match':'Omför inbetalning till kundfaktura','supplier-invoice-coding':'Kontera leverantörsfaktura','supplier-payment-preparation':'Förbered utbetalning','booking-account-suggestion':'Föreslå bokföring'})[type]||'Granska automatiskt förslag'}
function actionDescription(proposal){const s=proposal?.suggestion||{};switch(proposal?.type){case'bank-payment-match':return `Matcha inbetalningen mot ${s.invoiceNumber?`kundfaktura ${s.invoiceNumber}`:'vald kundfaktura'} och föreslå bokföring av bank mot kundfordran.`;case'supplier-invoice-coding':return `Fördela leverantörsfakturan på kostnads-/inköpskonto, ingående moms och leverantörsskuld. Kontona kan ändras före godkännande.`;case'supplier-payment-preparation':return `Förbered en utbetalning av leverantörsskulden. Detta skickar inte pengar till banken.`;case'booking-account-suggestion':return `Föreslå vilka bokföringskonton underlaget ska använda. Kontona kan ändras före godkännande.`;default:return text(proposal?.reason)||'Granska vad systemet föreslår innan något godkänns.'}}
function buildReviewModel(proposal){return Object.freeze({actionKind:proposal?.type||'',actionLabel:actionLabel(proposal?.type),actionDescription:actionDescription(proposal),target:Object.freeze({invoiceId:text(proposal?.suggestion?.invoiceId),invoiceNumber:text(proposal?.suggestion?.invoiceNumber),bankPaymentId:text(proposal?.suggestion?.bankPaymentId),supplierInvoiceId:text(proposal?.suggestion?.supplierInvoiceId),paymentId:text(proposal?.suggestion?.paymentId)}),amountOre:amountOre(proposal),bookingDate:text(proposal?.suggestion?.bookingDate||proposal?.suggestion?.paymentDate),accountingLines:Object.freeze(codingLines(proposal)),editable:Object.freeze({accounts:true,targetInvoice:proposal?.type==='bank-payment-match'})})}
function validateEditedSuggestion(proposal,input){
  if(!proposal||!['manual-review','ready-for-approval'].includes(proposal.status)){const e=new Error('Endast öppna förslag kan ändras.');e.code='INVALID_PROPOSAL_STATUS';e.statusCode=409;throw e}
  const current=structuredClone(proposal.suggestion||{});const edited=input&&typeof input==='object'?input:{};
  if(Array.isArray(edited.accountingLines)){
    if(!edited.accountingLines.length||edited.accountingLines.length>20){const e=new Error('Konteringen måste innehålla 1–20 rader.');e.code='INVALID_ACCOUNTING_LINES';throw e}
    const lines=edited.accountingLines.map((row,index)=>{const account=text(row?.account);if(!/^\d{4}$/.test(account)){const e=new Error(`Konteringsrad ${index+1} har ogiltigt konto.`);e.code='INVALID_ACCOUNT';throw e}const debitOre=Number(row?.debitOre||0),creditOre=Number(row?.creditOre||0);if(!Number.isSafeInteger(debitOre)||!Number.isSafeInteger(creditOre)||debitOre<0||creditOre<0||(debitOre&&creditOre)){const e=new Error(`Konteringsrad ${index+1} har ogiltigt belopp.`);e.code='INVALID_ACCOUNTING_AMOUNT';throw e}return{account,debitOre,creditOre,text:text(row?.text||row?.label).slice(0,240)}});
    const debit=lines.reduce((s,r)=>s+r.debitOre,0),credit=lines.reduce((s,r)=>s+r.creditOre,0);if(debit!==credit||debit<=0){const e=new Error('Den föreslagna konteringen måste balansera i debet och kredit.');e.code='UNBALANCED_SUGGESTION';throw e}current.accountingLines=lines;
  }
  if(proposal.type==='bank-payment-match'&&Object.hasOwn(edited,'invoiceId')){const invoiceId=text(edited.invoiceId);if(!invoiceId){const e=new Error('En kundfaktura måste väljas.');e.code='MISSING_TARGET_INVOICE';throw e}current.invoiceId=invoiceId;if(Object.hasOwn(edited,'invoiceNumber'))current.invoiceNumber=text(edited.invoiceNumber)}
  current.reviewEdited=true;return current;
}
module.exports=Object.freeze({ACCOUNT_NAMES,accountName,codingLines,actionLabel,actionDescription,buildReviewModel,validateEditedSuggestion});
