'use strict';
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('../accounting/money.js'):root.RollandsMoney);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RollandsInvoice=api;
})(globalThis,function(Money){
  const DEFAULT_ACCOUNTS=[
    {number:'3041',name:'Försäljning tjänster, 25 %',vatRates:[25]},
    {number:'3042',name:'Försäljning tjänster, 12 %',vatRates:[12]},
    {number:'3043',name:'Försäljning tjänster, 6 %',vatRates:[6]},
    {number:'3044',name:'Försäljning tjänster, momsfritt',vatRates:[0]},
    {number:'3051',name:'Försäljning varor, 25 %',vatRates:[25]},
    {number:'3052',name:'Försäljning varor, 12 %',vatRates:[12]},
    {number:'3053',name:'Försäljning varor, 6 %',vatRates:[6]},
    {number:'3054',name:'Försäljning varor, momsfritt',vatRates:[0]},
    {number:'3520',name:'Fakturerade frakter',vatRates:[25],system:true},
    {number:'3690',name:'Övriga sidointäkter',vatRates:[25],system:true}
  ];
  const VAT_ACCOUNTS={25:'2611',12:'2621',6:'2631'};
  const VAT_TREATMENTS=Object.freeze({
    'se-standard-25':Object.freeze({label:'Övrig vara/tjänst · 25 %',periods:Object.freeze([{from:'2025-01-01',to:'2027-12-31',rate:25}])}),
    'se-food':Object.freeze({label:'Livsmedel',periods:Object.freeze([{from:'2025-01-01',to:'2026-03-31',rate:12},{from:'2026-04-01',to:'2027-12-31',rate:6}])}),
    'se-restaurant-12':Object.freeze({label:'Restaurang-/cateringtjänst · 12 %',periods:Object.freeze([{from:'2025-01-01',to:'2027-12-31',rate:12}])})
  });
  const VAT_RULES_VERIFIED_AT='2026-09-21';
  const VAT_RULES_VERIFIED_THROUGH='2027-12-31';
  const INTEREST_TEXT='Efter förfallodagen debiteras dröjsmålsränta enligt räntelagen med referensränta + 8 %enheter.';
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
  function vatTreatmentRate(treatment,invoiceDate){
    const id=text(treatment,'Momsbehandling',40,true),rule=VAT_TREATMENTS[id];
    if(!rule)throw new Error('Välj en verifierad typ av försäljning för momsen.');
    const day=date(invoiceDate,'Fakturadatum');
    if(day>VAT_RULES_VERIFIED_THROUGH)throw new Error(`Momsreglerna är endast verifierade till och med ${VAT_RULES_VERIFIED_THROUGH}. Uppdatera regelverket innan fakturan bokförs.`);
    const period=rule.periods.find(row=>row.from<=day&&day<=row.to);
    if(!period)throw new Error(`Momsregeln för ${rule.label} är inte verifierad för ${day}.`);
    return period.rate;
  }
  function normalizeVatRates(row){
    const raw=Array.isArray(row.vatRates)?row.vatRates:(row.vatRate!==undefined?[row.vatRate]:[]);
    const values=[...new Set(raw.map(Number))];
    if(values.some(v=>![0,6,12,25].includes(v)))throw new Error('Intäktskontots momssats måste vara 0, 6, 12 eller 25 %.');
    return values;
  }
  function revenueAccounts(custom=[]){
    if(!Array.isArray(custom))throw new Error('Kontoplanen måste vara en lista.');
    const accounts=new Map(DEFAULT_ACCOUNTS.map(row=>[row.number,{...row,vatRates:[...row.vatRates]}]));
    for(const row of custom){
      const number=text(row.number,'Intäktskonto',4,true);
      if(!/^3\d{3}$/.test(number)||number==='3740')throw new Error('Välj ett intäktskonto i klass 3. Avrundningskonto 3740 kan inte användas som intäktskonto.');
      const vatRates=normalizeVatRates(row);
      if(!vatRates.length)continue; // Äldre egna konton utan momskoppling bevaras i historik men får inte väljas på nya fakturor.
      accounts.set(number,{number,name:text(row.name,'Kontonamn',120,true),vatRates});
    }
    return [...accounts.values()].sort((a,b)=>a.number.localeCompare(b.number));
  }
  function accountsForVat(accounts,vatRate){return accounts.filter(a=>a.vatRates.includes(Number(vatRate)));}
  function party(value,label,isSeller,{requireBankgiro=true}={}){
    const p=value||{};
    const result={name:text(p.name,`${label}: namn`,160,true),address:text(p.address,`${label}: adress med postnummer och ort`,500,true)};
    for(const field of ['orgNumber','vatNumber','phone','email','website','bankgiro','taxStatus']){
      const required=isSeller&&['orgNumber','vatNumber'].includes(field);
      result[field]=text(p[field],`${label}: ${field}`,field==='website'?300:120,required);
    }
    if(isSeller&&requireBankgiro&&!result.bankgiro)throw new Error('Bankgiro måste vara angivet i företagsinformationen innan en faktura kan bokföras.');
    return result;
  }
  function prepare(input,options={}){
    if(!input||typeof input!=='object')throw new Error('Fakturaunderlag saknas.');
    const accounts=revenueAccounts(options.accounts||[]),lookup=new Map(accounts.map(a=>[a.number,a]));
    const seller=party(input.seller,'Avsändare',true,{requireBankgiro:options.requireSellerBankgiro!==false}),buyer=party(input.buyer,'Mottagare',false);
    const invoiceDate=date(input.invoiceDate,'Fakturadatum'),dueDate=date(input.dueDate,'Förfallodatum'),postingDate=date(input.postingDate||invoiceDate,'Bokföringsdatum');
    if(dueDate<invoiceDate)throw new Error('Förfallodatum får inte ligga före fakturadatum.');
    const paymentTermsDays=Number(input.paymentTermsDays??30);
    if(!Number.isInteger(paymentTermsDays)||paymentTermsDays<0||paymentTermsDays>365)throw new Error('Betalningsvillkor måste vara 0–365 dagar.');
    if((input.currency||'SEK')!=='SEK')throw new Error('Fakturaverktyget stödjer SEK i denna version.');
    if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>200)throw new Error('Fakturan ska innehålla 1–200 rader inklusive eventuella avgifter.');
    const lines=input.lines.map((row,index)=>{
      const label=`Rad ${index+1}`,revenueAccount=text(row.revenueAccount,`${label}: intäktskonto`,4,true);
      if(!lookup.has(revenueAccount))throw new Error(`${label}: välj ett intäktskonto från kontoplanen.`);
      const quantityMilli=Money.parseQuantityMilli(row.quantity,{label:`${label}: antal`});
      const unitPriceOre=Money.parseOre(row.unitPrice,{label:`${label}: à-pris`,allowNegative:true});
      const vatTreatment=text(row.vatTreatment,`${label}: typ av försäljning`,40,false);
      let vatRate;
      if(vatTreatment){
        vatRate=vatTreatmentRate(vatTreatment,invoiceDate);
        if(row.vatRate!==undefined&&String(row.vatRate).trim()!==''&&Number(row.vatRate)!==vatRate)throw new Error(`${label}: momssatsen stämmer inte med vald typ av försäljning och fakturadatum.`);
      }else{
        if(options.requireVatTreatment===true)throw new Error(`${label}: välj typ av försäljning så att momssatsen kan verifieras.`);
        vatRate=Number(row.vatRate);
      }
      if(![0,6,12,25].includes(vatRate))throw new Error(`${label}: välj en giltig momssats.`);
      const vatBasisPoints=Money.parseVatBasisPoints(vatRate,{label:`${label}: moms`});
      if(!lookup.get(revenueAccount).vatRates.includes(vatRate))throw new Error(`${label}: konto ${revenueAccount} får inte användas med ${vatRate} % moms.`);
      const netOre=Money.calculateLine({quantityMilli,unitPriceOre,vatBasisPoints:0}).netOre;
      const vatOre=Money.calculateVatOre(netOre,vatBasisPoints);
      return {articleNumber:'',description:text(row.description,`${label}: benämning`,1200,true),unit:text(row.unit,`${label}: enhet`,30),quantityMilli,unitPriceOre,discountBasisPoints:0,vatTreatment:vatTreatment||null,vatRate,vatBasisPoints,netOre,vatOre,grossOre:Money.sumOre([netOre,vatOre]),revenueAccount,revenueAccountName:lookup.get(revenueAccount).name,kind:['freight','administration'].includes(row.kind)?row.kind:'item'};
    });
    const netOre=Money.sumOre(lines.map(r=>r.netOre)),vatOre=Money.sumOre(lines.map(r=>r.vatOre)),grossOre=Money.sumOre([netOre,vatOre]);
    const totalOre=Money.roundDivide(grossOre,100)*100; // Öresutjämning sker alltid automatiskt.
    Money.assertSafeInteger(totalOre,'Fakturabeloppet');
    if(totalOre===0)throw new Error('En kundfaktura får inte ha totalbelopp 0 kr.');
    const invoiceNumber=text(options.invoiceNumber||'UTKAST','Fakturanummer',30,true);
    const result={schemaVersion:3,documentType:'FAKTURA',demo:options.demo!==false,invoiceNumber,ocr:invoiceNumber,seller,buyer,customerNumber:text(input.customerNumber,'Kundnummer',50,true),invoiceDate,dueDate,postingDate,paymentTermsDays,currency:'SEK',lines,netOre,vatOre,totalOre,roundingOre:totalOre-grossOre,freightOre:Money.sumOre(lines.filter(r=>r.kind==='freight').map(r=>r.netOre)),administrationOre:Money.sumOre(lines.filter(r=>r.kind==='administration').map(r=>r.netOre)),vatBreakdown:[25,12,6,0].map(rate=>({rate,netOre:Money.sumOre(lines.filter(r=>r.vatRate===rate).map(r=>r.netOre)),vatOre:Money.sumOre(lines.filter(r=>r.vatRate===rate).map(r=>r.vatOre))})),interestText:INTEREST_TEXT,ourReference:text(input.ourReference,'Vår referens',600),yourReference:text(input.yourReference,'Er referens',600),notes:text(input.notes,'Meddelande på faktura',3000),warnings:[]};
    return result;
  }
  function signedJournalLine(account,text,amountOre,{positiveSide='credit'}={}){
    const amount=Number(amountOre||0);
    if(!amount)return null;
    const positive=amount>0,abs=Math.abs(amount);
    const credit=(positiveSide==='credit'&&positive)||(positiveSide==='debit'&&!positive);
    return {account,text,debitOre:credit?0:abs,creditOre:credit?abs:0};
  }
  function journalLines(document){
    const d=document,result=[];
    const receivable=signedJournalLine('1510','Kundfordringar',d.totalOre,{positiveSide:'debit'});
    if(receivable)result.push(receivable);
    const sales=new Map();
    for(const row of d.lines){
      const current=sales.get(row.revenueAccount)||{account:row.revenueAccount,text:row.revenueAccountName,amountOre:0};
      current.amountOre=Money.sumOre([current.amountOre,row.netOre]);
      sales.set(row.revenueAccount,current);
    }
    for(const row of sales.values()){
      const line=signedJournalLine(row.account,row.text,row.amountOre,{positiveSide:'credit'});
      if(line)result.push(line);
    }
    for(const row of d.vatBreakdown){
      const line=signedJournalLine(VAT_ACCOUNTS[row.rate],`Utgående moms ${row.rate} %`,row.vatOre,{positiveSide:'credit'});
      if(line)result.push(line);
    }
    if(d.roundingOre)result.push({account:'3740',text:'Öresutjämning',debitOre:Math.max(0,-d.roundingOre),creditOre:Math.max(0,d.roundingOre)});
    if(Money.sumOre(result.map(r=>r.debitOre))!==Money.sumOre(result.map(r=>r.creditOre)))throw new Error('Verifikationen balanserar inte. Ingen faktura har sparats.');
    return result;
  }
  function postDemoInvoice(state,input,options={}){
    const known=[...(state.customers||[]),...(state.customerInvoices||[])].some(c=>c.customerNumber===input.customerNumber);
    if(!known)throw new Error('Kunden finns inte i kundregistret.');
    const max=(state.customerInvoices||[]).reduce((n,i)=>Math.max(n,Number(i.invoiceNumber)||0),310000),invoiceNumber=String(max+1);
    if(!/^\d{6}$/.test(invoiceNumber))throw new Error('Fakturanummerserien är full.');
    const document=prepare(input,{...options,invoiceNumber,accounts:state.invoiceRevenueAccounts||[],demo:true});
    if((state.accountingPeriods||[]).some(p=>p.period===document.postingDate.slice(0,7)&&p.status==='locked'))throw new Error('Bokföringsperioden är låst. Välj en öppen bokföringsdag.');
    const id=options.id||`cinv-${globalThis.crypto.randomUUID()}`;
    if((state.customerInvoices||[]).some(i=>i.id===id))throw new Error('Fakturan har redan registrerats.');
    const entries=state.accountingEntries||[],year=document.postingDate.slice(0,4),sequence=entries.filter(e=>String(e.postingDate).startsWith(year)).reduce((n,e)=>Math.max(n,/^F\d+$/.test(e.number)?Number(e.number.slice(1)):0),0)+1,batch=(state.customerInvoices||[]).reduce((n,i)=>Math.max(n,Number(i.batchNumber)||0),1099)+1;
    const record={id,kind:'customer',customerNumber:document.customerNumber,customerName:document.buyer.name,invoiceNumber,ocr:invoiceNumber,invoiceDate:document.invoiceDate,postingDate:document.postingDate,dueDate:document.dueDate,totalOre:document.totalOre,vatOre:document.vatOre,remainingOre:document.totalOre,status:'Bokförd',paymentMethod:'Bankgiro',paymentAccount:document.seller.bankgiro,invoiceAccount:'1510',batchNumber:String(batch),journalNumber:`F${sequence}`,customerType:'business',description:document.lines.map(r=>r.description).join('; '),commentCount:0,transactions:[],reminders:[],document:clone(document),createdAt:new Date().toISOString()};
    const entry={id:`entry-${id}`,number:record.journalNumber,postingDate:document.postingDate,description:`Kundfaktura ${invoiceNumber} · ${record.customerName}`,sourceType:'customer-invoice',sourceId:id,lines:journalLines(document)};
    state.customerInvoices=[...(state.customerInvoices||[]),record];state.accountingEntries=[...entries,entry];return clone(record);
  }
  function documentFor(record,company={}){
    if(record.document)return clone(record.document);
    const vat=Number(record.vatOre||0),total=Number(record.totalOre||0),net=total-vat;
    return {schemaVersion:2,documentType:'FAKTURA',demo:true,invoiceNumber:record.invoiceNumber,ocr:record.invoiceNumber,customerNumber:record.customerNumber,invoiceDate:record.invoiceDate,dueDate:record.dueDate,postingDate:record.postingDate,seller:{name:company.legalName||'Rollands',address:company.address?.full||'',orgNumber:company.orgNumber||'',vatNumber:company.vatNumber||'',phone:company.contact?.phone||'',email:company.contact?.email||'',website:company.website||'',bankgiro:company.invoice?.bankgiro||'',taxStatus:company.invoice?.taxStatus||''},buyer:{name:record.customerName,address:''},currency:'SEK',paymentTermsDays:30,lines:[{description:record.description||'Äldre demopost – detaljerat radunderlag saknas',articleNumber:'',quantityMilli:1000,unit:'',unitPriceOre:net,netOre:net,vatOre:vat,vatRate:record.vatRate??null,discountBasisPoints:0}],netOre:net,vatOre:vat,totalOre:total,roundingOre:0,freightOre:0,administrationOre:0,vatBreakdown:[],interestText:INTEREST_TEXT,warnings:['Äldre demofaktura: fullständiga adress-, betalnings- och radunderlag saknas. Inte för utskick.']};
  }
  return Object.freeze({DEFAULT_ACCOUNTS,VAT_ACCOUNTS,VAT_TREATMENTS,VAT_RULES_VERIFIED_AT,VAT_RULES_VERIFIED_THROUGH,INTEREST_TEXT,vatTreatmentRate,revenueAccounts,accountsForVat,prepare,journalLines,postDemoInvoice,documentFor});
});
