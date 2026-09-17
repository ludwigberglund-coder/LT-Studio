'use strict';
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('../accounting/money.js'):root.RollandsMoney);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RollandsInvoice=api;
})(globalThis,function(Money){
  const DEFAULT_ACCOUNTS=[
    {number:'3010',name:'Försäljning'},
    {number:'3041',name:'Försäljning tjänster, 25 %'},
    {number:'3042',name:'Försäljning tjänster, 12 %'},
    {number:'3043',name:'Försäljning tjänster, 6 %'},
    {number:'3051',name:'Försäljning varor, 25 %'},
    {number:'3052',name:'Försäljning varor, 12 %'},
    {number:'3053',name:'Försäljning varor, 6 %'},
    {number:'8310',name:'Ränteintäkter'}
  ];
  const VAT_ACCOUNTS={25:'2611',12:'2621',6:'2631'};
  const clone=value=>JSON.parse(JSON.stringify(value));
  function text(value,label,max=500,required=false){
    const result=String(value??'').trim();
    if(required&&!result)throw new Error(`${label} måste anges.`);
    if(result.length>max)throw new Error(`${label} får ha högst ${max} tecken.`);
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result))throw new Error(`${label} innehåller otillåtna kontrolltecken.`);
    return result;
  }
  function date(value,label,optional=false){
    const result=text(value,label,10,!optional);
    if(!result&&optional)return '';
    const parsed=new Date(`${result}T12:00:00Z`);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==result)throw new Error(`${label} är inte ett giltigt datum.`);
    return result;
  }
  function revenueAccounts(custom=[]){
    if(!Array.isArray(custom))throw new Error('Kontoplanen måste vara en lista.');
    const accounts=new Map(DEFAULT_ACCOUNTS.map(row=>[row.number,{...row}]));
    for(const row of custom){
      const number=text(row.number,'Intäktskonto',4,true);
      if(!/^(3\d{3}|83\d{2})$/.test(number)||number==='3740')throw new Error('Välj ett intäktskonto i klass 3 eller 83. Avrundningskonto 3740 kan inte användas som intäktskonto.');
      accounts.set(number,{number,name:text(row.name,'Kontonamn',120,true)});
    }
    return [...accounts.values()].sort((a,b)=>a.number.localeCompare(b.number));
  }
  function party(value,label,isSeller){
    const p=value||{};
    const result={name:text(p.name,`${label}: namn`,160,true),address:text(p.address,`${label}: adress med postnummer och ort`,500,true)};
    for(const field of ['orgNumber','vatNumber','phone','email','website','registeredOffice','bankgiro','plusgiro','iban','bic','swish','taxStatus']){
      result[field]=text(p[field],`${label}: ${field}`,field==='website'?300:120,isSeller&&['orgNumber','vatNumber'].includes(field));
    }
    if(isSeller&&!['bankgiro','plusgiro','iban','swish'].some(field=>result[field]))throw new Error('Ange minst ett betalningssätt: Bankgiro, Plusgiro, IBAN eller Swish.');
    return result;
  }
  function prepare(input,options={}){
    if(!input||typeof input!=='object')throw new Error('Fakturaunderlag saknas.');
    const accounts=revenueAccounts(options.accounts||[]);
    const lookup=new Map(accounts.map(a=>[a.number,a]));
    const seller=party(input.seller,'Avsändare',true),buyer=party(input.buyer,'Mottagare',false);
    const invoiceDate=date(input.invoiceDate,'Fakturadatum');
    const dueDate=date(input.dueDate,'Förfallodatum');
    const postingDate=date(input.postingDate||invoiceDate,'Bokföringsdatum');
    if(dueDate<invoiceDate)throw new Error('Förfallodatum får inte ligga före fakturadatum.');
    const paymentTermsDays=Number(input.paymentTermsDays??30);
    if(!Number.isInteger(paymentTermsDays)||paymentTermsDays<0||paymentTermsDays>365)throw new Error('Betalningsvillkor måste vara 0–365 dagar.');
    if((input.currency||'SEK')!=='SEK')throw new Error('Fakturaverktyget stödjer SEK i denna version.');
    if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>200)throw new Error('Fakturan ska innehålla 1–200 rader inklusive eventuella avgifter.');
    const lines=input.lines.map((row,index)=>{
      const label=`Rad ${index+1}`;
      const revenueAccount=text(row.revenueAccount,`${label}: intäktskonto`,4,true);
      if(!lookup.has(revenueAccount))throw new Error(`${label}: välj ett intäktskonto från kontoplanen. Bank-, moms- och kostnadskonton är inte intäktskonton.`);
      const quantityMilli=Money.parseQuantityMilli(row.quantity,{label:`${label}: antal`});
      const unitPriceOre=Money.parseOre(row.unitPrice,{label:`${label}: à-pris`,allowNegative:false});
      const discountBasisPoints=Money.parseVatBasisPoints(row.discountPercent||'0',{label:`${label}: rabatt`});
      const vatBasisPoints=Money.parseVatBasisPoints(row.vatRate,{label:`${label}: moms`});
      const vatRate=vatBasisPoints/100;
      if(![0,6,12,25].includes(vatRate))throw new Error(`${label}: välj 0, 6, 12 eller 25 % moms.`);
      const base=Money.calculateLine({quantityMilli,unitPriceOre,vatBasisPoints:0}).netOre;
      const product=base*(10000-discountBasisPoints);
      Money.assertSafeInteger(product,'Rabattberäkningen');
      const netOre=Money.roundDivide(product,10000);
      const vatOre=Money.calculateVatOre(netOre,vatBasisPoints);
      return {
        articleNumber:text(row.articleNumber,`${label}: artikelnummer`,60),
        description:text(row.description,`${label}: beskrivning`,1200,true),
        unit:text(row.unit,`${label}: enhet`,30,true),quantityMilli,unitPriceOre,
        discountBasisPoints,vatRate,vatBasisPoints,netOre,vatOre,grossOre:Money.sumOre([netOre,vatOre]),
        revenueAccount,revenueAccountName:lookup.get(revenueAccount).name,
        kind:['freight','administration'].includes(row.kind)?row.kind:'item'
      };
    });
    const netOre=Money.sumOre(lines.map(r=>r.netOre)),vatOre=Money.sumOre(lines.map(r=>r.vatOre));
    const grossOre=Money.sumOre([netOre,vatOre]);
    const totalOre=input.roundToKrona?Money.roundDivide(grossOre,100)*100:grossOre;
    Money.assertSafeInteger(totalOre,'Fakturabeloppet');
    if(totalOre<=0)throw new Error('En kundfaktura måste ha ett positivt totalbelopp.');
    const taxExemptionReason=text(input.taxExemptionReason,'Förklaring till momsfria rader',1000);
    if(lines.some(r=>r.vatRate===0&&r.netOre!==0)&&!taxExemptionReason)throw new Error('Ange förklaring/rättslig grund för rader med 0 % moms.');
    const invoiceNumber=text(options.invoiceNumber||'UTKAST','Fakturanummer',30,true);
    const result={
      schemaVersion:2,documentType:'FAKTURA',demo:options.demo!==false,invoiceNumber,
      ocr:text(input.ocr||invoiceNumber,'OCR / betalningsreferens',80,true),
      seller,buyer,customerNumber:text(input.customerNumber,'Kundnummer',50,true),
      invoiceDate,dueDate,postingDate,deliveryDate:date(input.deliveryDate,'Leveransdatum',true),paymentTermsDays,currency:'SEK',
      lines,netOre,vatOre,totalOre,roundingOre:totalOre-grossOre,
      freightOre:Money.sumOre(lines.filter(r=>r.kind==='freight').map(r=>r.netOre)),
      administrationOre:Money.sumOre(lines.filter(r=>r.kind==='administration').map(r=>r.netOre)),
      vatBreakdown:[25,12,6,0].map(rate=>({rate,netOre:Money.sumOre(lines.filter(r=>r.vatRate===rate).map(r=>r.netOre)),vatOre:Money.sumOre(lines.filter(r=>r.vatRate===rate).map(r=>r.vatOre))})),
      taxExemptionReason,warnings:[]
    };
    for(const field of ['ourReference','yourReference','orderNumber','deliveryTerms','deliveryMethod','deliveryAddress','interestText','paymentTermsText','notes','internalNotes'])result[field]=text(input[field],field,field.endsWith('Notes')||field==='notes'?3000:600);
    return result;
  }
  function journalLines(document){
    const d=document;
    const result=[{account:'1510',text:'Kundfordringar',debitOre:d.totalOre,creditOre:0}];
    const sales=new Map();
    for(const row of d.lines){const old=sales.get(row.revenueAccount)||{account:row.revenueAccount,text:row.revenueAccountName,debitOre:0,creditOre:0};old.creditOre=Money.sumOre([old.creditOre,row.netOre]);sales.set(row.revenueAccount,old);}
    result.push(...[...sales.values()].filter(row=>row.creditOre!==0));
    for(const row of d.vatBreakdown){if(row.vatOre)result.push({account:VAT_ACCOUNTS[row.rate],text:`Utgående moms ${row.rate} %`,debitOre:0,creditOre:row.vatOre});}
    if(d.roundingOre)result.push({account:'3740',text:'Öresutjämning',debitOre:Math.max(0,-d.roundingOre),creditOre:Math.max(0,d.roundingOre)});
    if(Money.sumOre(result.map(r=>r.debitOre))!==Money.sumOre(result.map(r=>r.creditOre)))throw new Error('Verifikationen balanserar inte. Ingen faktura har sparats.');
    return result;
  }
  function postDemoInvoice(state,input,options={}){
    const known=[...(state.customers||[]),...(state.customerInvoices||[])].some(c=>c.customerNumber===input.customerNumber);
    if(!known)throw new Error('Kunden finns inte i kundregistret.');
    const max=(state.customerInvoices||[]).reduce((n,i)=>Math.max(n,Number(i.invoiceNumber)||0),310000);
    const invoiceNumber=String(max+1);
    if(!/^\d{6}$/.test(invoiceNumber))throw new Error('Fakturanummerserien är full.');
    const document=prepare(input,{...options,invoiceNumber,accounts:state.invoiceRevenueAccounts||[],demo:true});
    if((state.accountingPeriods||[]).some(p=>p.period===document.postingDate.slice(0,7)&&p.status==='locked'))throw new Error('Bokföringsperioden är låst. Välj en öppen bokföringsdag.');
    const id=options.id||`cinv-${globalThis.crypto.randomUUID()}`;
    if((state.customerInvoices||[]).some(i=>i.id===id))throw new Error('Fakturan har redan registrerats.');
    const entries=state.accountingEntries||[];
    const year=document.postingDate.slice(0,4);
    const sequence=entries.filter(e=>String(e.postingDate).startsWith(year)).reduce((n,e)=>Math.max(n,/^F\d+$/.test(e.number)?Number(e.number.slice(1)):0),0)+1;
    const batch=(state.customerInvoices||[]).reduce((n,i)=>Math.max(n,Number(i.batchNumber)||0),1099)+1;
    const record={
      id,kind:'customer',customerNumber:document.customerNumber,customerName:document.buyer.name,
      invoiceNumber,ocr:document.ocr,invoiceDate:document.invoiceDate,postingDate:document.postingDate,dueDate:document.dueDate,
      totalOre:document.totalOre,vatOre:document.vatOre,remainingOre:document.totalOre,status:'Bokförd',
      paymentMethod:'Enligt faktura',paymentAccount:document.seller.bankgiro||document.seller.plusgiro||document.seller.iban||document.seller.swish,
      invoiceAccount:'1510',batchNumber:String(batch),journalNumber:`F${sequence}`,customerType:'business',
      description:document.lines.map(r=>r.description).join('; '),commentCount:0,transactions:[],reminders:[],
      document:clone(document),createdAt:new Date().toISOString()
    };
    const entry={id:`entry-${id}`,number:record.journalNumber,postingDate:document.postingDate,description:`Kundfaktura ${invoiceNumber} · ${record.customerName}`,sourceType:'customer-invoice',sourceId:id,lines:journalLines(document)};
    // Nothing in state changes until validation and balanced posting have succeeded.
    state.customerInvoices=[...(state.customerInvoices||[]),record];
    state.accountingEntries=[...entries,entry];
    return clone(record);
  }
  function documentFor(record,company={}){
    if(record.document)return clone(record.document);
    const vat=Number(record.vatOre||0),total=Number(record.totalOre||0),net=total-vat;
    return {
      schemaVersion:2,documentType:'FAKTURA',demo:true,invoiceNumber:record.invoiceNumber,ocr:record.ocr,
      customerNumber:record.customerNumber,invoiceDate:record.invoiceDate,dueDate:record.dueDate,postingDate:record.postingDate,
      seller:{name:company.legalName||'Rollands',address:company.address?.full||'',orgNumber:company.orgNumber||'',vatNumber:company.vatNumber||'',phone:company.contact?.phone||'',email:company.contact?.email||''},
      buyer:{name:record.customerName,address:''},currency:'SEK',paymentTermsDays:30,
      lines:[{description:record.description||'Äldre demopost – detaljerat radunderlag saknas',articleNumber:'',quantityMilli:1000,unit:'st',unitPriceOre:net,netOre:net,vatOre:vat,vatRate:record.vatRate??null,discountBasisPoints:0}],
      netOre:net,vatOre:vat,totalOre:total,roundingOre:0,freightOre:0,administrationOre:0,vatBreakdown:[],
      warnings:['Äldre demofaktura: fullständiga adress-, betalnings- och radunderlag saknas. Inte för utskick.']
    };
  }
  return Object.freeze({DEFAULT_ACCOUNTS,VAT_ACCOUNTS,revenueAccounts,prepare,journalLines,postDemoInvoice,documentFor});
});
