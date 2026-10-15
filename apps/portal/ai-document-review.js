'use strict';
// Review-only deterministic preview from unverified local PDF facts.
// No AI provider, storage, approvals, journal or payment API. Never auto-post.
(function(root){
  const ACCOUNTS=Object.freeze({
    '6110':'Kontorsmateriel',
    '5460':'Förbrukningsmaterial',
    '6540':'IT-tjänster'
  });
  const PAYMENT=Object.freeze({
    '1930':'Företagskonto',
    '1910':'Företagskassa'
  });
  const VAT_RATES=Object.freeze([0,6,12,25]);
  function fail(code){return Object.assign(new Error(code),{code});}
  function own(value,key){return Object.prototype.hasOwnProperty.call(value,key);}
  function validOre(value){return Number.isSafeInteger(value)&&value>=0&&value<=99999999999;}
  function sourceField(extraction,key,kind){
    const field=extraction.fields[key];
    if(field===null)return null;
    if(!field||typeof field!=='object'||Array.isArray(field)||field.verified!==false||
       typeof field.evidence!=='string'||field.evidence.length>140||
       typeof field.value!==kind)throw fail('UNTRUSTED_PDF_FACT');
    if(kind==='number'&&!validOre(field.value))throw fail('UNTRUSTED_PDF_FACT');
    if(kind==='string'&&(!field.value||field.value.length>140||
      /[\x00-\x1f\x7f]/.test(field.value)))throw fail('UNTRUSTED_PDF_FACT');
    return field.value;
  }
  function rateFor(net,vat){
    if(!validOre(net)||!validOre(vat))return null;
    if(net===0)return null;
    const matches=VAT_RATES.filter(rate=>Math.abs(vat*100-net*rate)<=100);
    return matches.length===1?matches[0]:null;
  }
  function buildReview(extraction,selection={}){
    if(!extraction||typeof extraction!=='object'||Array.isArray(extraction)||
       extraction.source!=='local-pdf-text'||extraction.status!=='needs-review'||
       extraction.posted!==false||!['supplier-invoice','receipt'].includes(extraction.documentType)||
       !extraction.fields||typeof extraction.fields!=='object'||Array.isArray(extraction.fields)||
       !extraction.checks||typeof extraction.checks!=='object'||Array.isArray(extraction.checks)||
       ![true,false,null].includes(extraction.checks.amountBalance)||
       !Array.isArray(extraction.warnings)||extraction.warnings.length>30||
       extraction.warnings.some(x=>typeof x!=='string'||x.length>240)){
      throw fail('UNTRUSTED_PDF_RESULT');
    }
    if(!selection||typeof selection!=='object'||Array.isArray(selection)||
       Object.keys(selection).some(k=>!['expenseAccount','paymentAccount'].includes(k))||
       !own(ACCOUNTS,selection.expenseAccount))throw fail('INVALID_ACCOUNT_SELECTION');
    const receipt=extraction.documentType==='receipt';
    if(receipt ? !own(PAYMENT,selection.paymentAccount):
      (selection.paymentAccount!==undefined&&selection.paymentAccount!=='')){
      throw fail('INVALID_PAYMENT_SELECTION');
    }
    const warnings=['Förhandsvisning – inga uppgifter är verifierade eller bokförda.',
      'Kontrollera att underlaget inte redan är bokfört och att konto/moms passar inköpet.'];
    const blockers=[];
    const supplier=sourceField(extraction,'supplier','string');
    const reference=sourceField(extraction,'reference','string');
    const date=sourceField(extraction,'invoiceDate','string');
    const due=sourceField(extraction,'dueDate','string');
    const gross=sourceField(extraction,'grossOre','number');
    const vat=sourceField(extraction,'vatOre','number');
    let net=sourceField(extraction,'netOre','number');
    if(!supplier)blockers.push('Leverantör eller butik saknas.');
    if(!date||!/^(?:19|20)\d{2}-\d{2}-\d{2}$/.test(date)||
      Number.isNaN(Date.parse(date+'T00:00:00Z'))||
      new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date){
      blockers.push('Ett giltigt inköps- eller fakturadatum saknas.');
    }
    if(!receipt&&!reference)blockers.push('Fakturanummer saknas.');
    if(!receipt&&!due)warnings.push('Förfallodatum saknas – kontrollera betalningsvillkor.');
    if(gross===null||gross<=0)blockers.push('Positivt totalbelopp saknas.');
    if(vat===null)blockers.push('Momsbelopp saknas eller är motsägelsefullt.');
    if(receipt&&net===null&&gross!==null&&vat!==null&&gross>=vat){
      net=gross-vat;
      warnings.push('Netto är beräknat från total minus moms – kontrollera mot kvittot.');
    }
    if(net===null)blockers.push('Nettobelopp saknas.');
    if(net!==null&&vat!==null&&gross!==null&&net+vat!==gross){
      blockers.push('Netto + moms stämmer inte exakt med totalbeloppet.');
    }
    if(extraction.checks.amountBalance===false)blockers.push('PDF-läsaren hittade en beloppsavvikelse.');
    if(extraction.warnings.some(w=>/utländsk valuta|motstridiga/i.test(w))){
      blockers.push('PDF-läsaren varnar för motstridiga belopp eller utländsk valuta.');
    }
    if(extraction.warnings.some(w=>/totalt belopp kunde inte/i.test(w))){
      blockers.push('Totalt belopp kunde inte verifieras från PDF-texten.');
    }
    const rate=net!==null&&vat!==null?rateFor(net,vat):null;
    if(rate===null)blockers.push('Momsbeloppet motsvarar inte entydigt 0, 6, 12 eller 25 procent.');
    if(receipt)warnings.push('Betalningssättet är valt manuellt, inte verifierat mot banken.');
    if(!receipt)warnings.push('Leverantörsskuld visas som exempel. Kontrollera betalning och eventuella krediter.');
    const result={
      status:blockers.length?'blocked':'manual-review',posted:false,saved:false,
      source:'local-rule-preview',documentType:extraction.documentType,
      requiresHumanApproval:true,aiGenerated:false,
      checks:{amountBalance:blockers.length?false:true,vatRate:rate},
      warnings:Object.freeze(warnings),blockers:Object.freeze([...new Set(blockers)]),
      rows:Object.freeze([])
    };
    if(blockers.length)return Object.freeze(result);
    const payment=receipt?selection.paymentAccount:'2440';
    const rows=[
      {account:selection.expenseAccount,label:ACCOUNTS[selection.expenseAccount],debitOre:net,creditOre:0},
      ...(vat>0?[{account:'2641',label:'Ingående moms (preliminär)',debitOre:vat,creditOre:0}]:[]),
      {account:payment,label:receipt?PAYMENT[payment]:'Leverantörsskulder',debitOre:0,creditOre:gross}
    ];
    if(rows.reduce((sum,row)=>sum+row.debitOre-row.creditOre,0)!==0)throw fail('UNBALANCED_PREVIEW');
    return Object.freeze({...result,rows:Object.freeze(rows.map(row=>Object.freeze(row)))});
  }
  const api=Object.freeze({buildReview,rateFor,ACCOUNTS,PAYMENT});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.LTStudioDocumentReview=api;
})(typeof window!=='undefined'?window:null);
