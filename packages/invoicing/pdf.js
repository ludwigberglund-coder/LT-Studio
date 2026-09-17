'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.RollandsInvoicePdf=api;})(globalThis,function(){
  async function createInvoicePdf(data,options={}){
    const lib=options.PDFLib||globalThis.PDFLib||(typeof require==='function'?require('pdf-lib'):null);
    if(!lib)throw new Error('PDF-biblioteket kunde inte laddas. Ladda om sidan och försök igen.');
    const {PDFDocument,StandardFonts,rgb}=lib;
    const pdf=await PDFDocument.create();
    const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),serif=await pdf.embedFont(StandardFonts.TimesRomanBold);
    const W=595.28,H=841.89,M=38,C=W-2*M,BOTTOM=55;
    const ink=rgb(.075,.235,.19),muted=rgb(.37,.43,.40),line=rgb(.83,.87,.84),pale=rgb(.95,.965,.947),lime=rgb(.86,.91,.66),white=rgb(1,1,1);
    let page,y;
    const pages=[];
    const normalized=value=>String(value??'').replace(/[\u00a0\u202f]/g,' ').replace(/[\u2010-\u2015]/g,'-').replace(/\u2212/g,'-');
    function safe(value,font=regular){const s=normalized(value);try{font.encodeText(s.replace(/\n/g,''));}catch{throw new Error('Ett textfält innehåller tecken som PDF-fonten inte stödjer. Använd latinska bokstäver, svenska tecken och vanliga skiljetecken i denna demoversion.');}return s;}
    function text(value,x,top,size=9,font=regular,color=ink){const s=safe(value,font);page.drawText(s,{x,y:top-size,size,font,color});}
    function width(value,size=9,font=regular){return font.widthOfTextAtSize(safe(value,font),size);}
    function wrap(value,max,size=9,font=regular){
      const result=[];
      for(const paragraph of safe(value,font).split('\n')){
        if(!paragraph.trim()){result.push('');continue;}
        let current='';
        for(const word of paragraph.trim().split(/\s+/)){
          if(width(word,size,font)>max){
            if(current){result.push(current);current='';}
            let part='';for(const c of word){if(part&&width(part+c,size,font)>max){result.push(part);part='';}part+=c;}current=part;
          }else if(current&&width(current+' '+word,size,font)>max){result.push(current);current=word;}else current=current?current+' '+word:word;
        }
        result.push(current);
      }
      return result.length?result:[''];
    }
    function right(value,x,top,size=9,font=regular,maxWidth=null){if(maxWidth)while(size>7.5&&width(value,size,font)>maxWidth)size-=.25;text(value,x-width(value,size,font),top,size,font);}
    function rect(x,top,w,h,color=pale){page.drawRectangle({x,y:top-h,width:w,height:h,color});}
    function rule(top,x=M,w=C){page.drawLine({start:{x,y:top},end:{x:x+w,y:top},color:line,thickness:.6});}
    const money=value=>new Intl.NumberFormat('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value||0)/100);
    const quantity=value=>new Intl.NumberFormat('sv-SE',{maximumFractionDigits:3}).format(Number(value||0)/1000);
    const seller=data.seller||{},buyer=data.buyer||{};
    const documentType=data.documentType||'FAKTURA';
    pdf.setTitle(`${documentType} ${data.invoiceNumber}`);pdf.setAuthor(seller.name||'Rollands');pdf.setSubject(options.internal?'Faktura med internt fakturaunderlag':'Kundfaktura');pdf.setCreator('Rollands fakturaverktyg');
    function newPage(internal=false){
      page=pdf.addPage([W,H]);pages.push(page);rect(0,H,W,7,ink);
      text('Rollands',M,H-33,29,serif);
      right(internal?'Fakturaunderlag':documentType==='KREDITFAKTURA'?'Kreditfaktura':'Faktura',W-M,H-34,23,bold);
      const sub=internal?'Internt underlag - inte för utskick':seller.name||'';
      wrap(sub,C-160,8,regular).slice(0,2).forEach((s,i)=>text(s,M,H-69-i*10,8,regular,muted));
      right(`Nr ${data.invoiceNumber||'UTKAST'}  |  ${data.currency||'SEK'}`,W-M,H-69,8,bold);
      y=H-87;
    }
    function ensure(height,internal=false){if(y-height<BOTTOM)newPage(internal);}
    function paragraph(label,value,internal=false){
      if(!value)return;
      const lines=wrap(value,C,9);
      ensure(33,internal);text(label.toUpperCase(),M,y,7.5,bold,muted);y-=16;
      for(const s of lines){ensure(13,internal);text(s,M,y,9);y-=12;}
      y-=10;
    }
    function facts(rows,columns=3){
      const gap=16,cw=(C-gap*(columns-1))/columns;
      for(let start=0;start<rows.length;start+=columns){
        const group=rows.slice(start,start+columns);
        const wrapped=group.map(([label,value])=>wrap(value||'–',cw,8.5));
        const height=14+Math.max(...wrapped.map(a=>a.length))*11;
        ensure(height+7);
        group.forEach(([label],i)=>{text(label,M+i*(cw+gap),y,7.4,bold,muted);wrapped[i].forEach((s,j)=>text(s,M+i*(cw+gap),y-13-j*11,8.5));});y-=height+4;
      }
    }
    const columns=[{label:'Artikelnr.',w:45},{label:'Benämning / beskrivning',w:193},{label:'Antal',w:38,right:true},{label:'Enhet',w:38},{label:'À-pris',w:70,right:true},{label:'Moms',w:40,right:true},{label:'Belopp (SEK)',w:C-424,right:true}];
    function tableHeader(){
      ensure(48);rect(M,y,C,30,ink);let x=M;
      columns.forEach(c=>{const labels=wrap(c.label,c.w-12,7.4,bold);labels.forEach((s,i)=>text(s,x+6,y-7-i*9,7.4,bold,white));x+=c.w;});y-=30;
    }
    function invoiceRows(){
      tableHeader();
      for(let index=0;index<(data.lines||[]).length;index++){
        const r=data.lines[index];
        const discount=r.discountBasisPoints?`\nRabatt ${money(r.discountBasisPoints)} %`:'';
        const values=[r.articleNumber||'–',(r.description||'–')+discount,quantity(r.quantityMilli),r.unit||'–',money(r.unitPriceOre),r.vatRate==null?'–':`${r.vatRate} %`,money(r.netOre)];
        const cells=values.map((v,i)=>wrap(v,columns[i].w-12,8.3));
        const count=Math.max(...cells.map(c=>c.length));let offset=0;
        while(offset<count){
          if(y-30<BOTTOM){newPage();tableHeader();}
          const fitting=Math.max(1,Math.floor((y-BOTTOM-14)/11));
          const n=Math.min(count-offset,fitting),h=14+n*11;
          if(index%2===0)rect(M,y,C,h,pale);
          let x=M;
          columns.forEach((column,i)=>{for(let j=0;j<n;j++){const s=cells[i][offset+j];if(s!==undefined){const tx=column.right?x+column.w-6-width(s,8.3):x+6;text(s,tx,y-7-j*11,8.3);}}x+=column.w;});
          y-=h;rule(y);offset+=n;
          if(offset<count){newPage();tableHeader();}
        }
      }
      y-=14;
    }
    newPage();
    facts([['Fakturanr.',data.invoiceNumber],['Fakturadatum',data.invoiceDate],['Förfallodatum',data.dueDate]]);
    if(data.demo||data.invoiceNumber==='UTKAST'){
      ensure(27);rect(M,y,C,20,lime);text(data.invoiceNumber==='UTKAST'?'UTKAST - INTE BOKFÖRD':'DEMO - INTE BETALNINGSUNDERLAG',M+9,y-5,8,bold);y-=25;
    }
    if((data.warnings||[]).length)paragraph('Underlaget är ofullständigt',data.warnings.join('\n'));
    const cardWidth=(C-16)/2;
    const partyLines=[seller,buyer].map(p=>[p.name||'–',p.address||'Adress saknas',p.orgNumber?`Org.nr: ${p.orgNumber}`:'',p.vatNumber?`VAT.nr: ${p.vatNumber}`:''].filter(Boolean).flatMap(v=>wrap(v,cardWidth-24,9)));
    const cardHeight=31+Math.max(...partyLines.map(a=>a.length))*11;
    ensure(cardHeight+12);
    ['Avsändare','Mottagare'].forEach((label,i)=>{const x=M+i*(cardWidth+16);rect(x,y,cardWidth,cardHeight,pale);text(label.toUpperCase(),x+12,y-10,7.5,bold,muted);partyLines[i].forEach((s,j)=>text(s,x+12,y-26-j*11,9,j===0?bold:regular));});y-=cardHeight+10;
    facts([
      ['Vår referens',data.ourReference],['Er referens',data.yourReference],['Kundnummer',data.customerNumber],
      ['Betalningsvillkor',`${data.paymentTermsDays??30} dagar${data.paymentTermsText?' · '+data.paymentTermsText:''}`],['Dröjsmålsränta',data.interestText],['Ordernummer',data.orderNumber],
      ['Leveransvillkor',data.deliveryTerms],['Leveranssätt',data.deliveryMethod],['Leveransdatum',data.deliveryDate]
    ]);
    if(data.deliveryAddress)paragraph('Leveransadress',data.deliveryAddress);
    if(buyer.email||buyer.phone)paragraph('Mottagarens kontaktuppgifter',[buyer.email,buyer.phone].filter(Boolean).join(' · '));
    invoiceRows();
    const summaryHeight=167;
    ensure(summaryHeight+12);
    const split=M+C*.51,tw=C*.49;
    text('MOMSUNDERLAG',M,y,8,bold,muted);text('Underlag',M+98,y,7.5,bold,muted);text('Moms',M+176,y,7.5,bold,muted);
    [25,12,6,0].forEach((rate,i)=>{
      const r=(data.vatBreakdown||[]).find(r=>Number(r.rate??r.vatBasisPoints/100)===rate);
      text(rate===0?'Momsfritt':`Moms ${rate} %`,M,y-23-i*20,8.5);
      right(r?money(r.netOre):(data.vatBreakdown?.length?'0,00':'–'),M+153,y-23-i*20,8.5,regular,78);
      right(r?money(r.vatOre):(data.vatBreakdown?.length?'0,00':'–'),M+233,y-23-i*20,8.5,regular,75);
    });
    text('OCR / BETALNINGSREFERENS',M,y-112,7.5,bold,muted);
    wrap(data.ocr||data.invoiceNumber,C*.48-12,9,bold).forEach((s,i)=>text(s,M,y-128-i*11,9,bold));
    const summary=[['Varor / tjänster',data.netOre-(data.freightOre||0)-(data.administrationOre||0)],['Expeditionsavgift',data.administrationOre],['Frakt',data.freightOre],['Belopp före moms',data.netOre],['Total moms',data.vatOre],['Öresutjämning',data.roundingOre]];
    summary.forEach(([label,value],i)=>{text(label,split+8,y-i*20,8.5);right(money(value),W-M-8,y-i*20,9,i===3?bold:regular,tw-125);});
    rect(split,y-125,tw,39,lime);text(data.totalOre<0?'Att återfå (SEK)':'Att betala (SEK)',split+10,y-137,10,bold);right(money(Math.abs(data.totalOre)),W-M-10,y-136,13,bold,tw-135);
    y-=summaryHeight+12;
    paragraph('Meddelande',data.notes);
    paragraph('Momsupplysning',data.taxExemptionReason);
    if(data.originalInvoiceNumber)paragraph('Kredit av faktura',`${data.originalInvoiceNumber}${data.creditReason?' · '+data.creditReason:''}`);
    const contactColumns=[
      ['KONTAKT',`Tel.nr: ${seller.phone||'–'}`,`Webb: ${seller.website||'–'}`,`E-post: ${seller.email||'–'}`,`Säte: ${seller.registeredOffice||'–'}`],
      ['FÖRETAGSUPPGIFTER',`Org.nr: ${seller.orgNumber||'–'}`,`VAT.nr: ${seller.vatNumber||'–'}`,`SWIFT/BIC: ${seller.bic||'–'}`,`IBAN: ${seller.iban||'–'}`],
      ['BETALNING',`Bankgiro: ${seller.bankgiro||'–'}`,`Plusgiro: ${seller.plusgiro||'–'}`,`Swish: ${seller.swish||'–'}`,`Skattestatus: ${seller.taxStatus||'–'}`]
    ];
    const cw=(C-28)/3,contacts=contactColumns.map(c=>c.slice(1).flatMap(v=>wrap(v,cw,8)));
    const contactHeight=28+Math.max(...contacts.map(c=>c.length))*11;
    ensure(contactHeight+12);rule(y);y-=11;
    contactColumns.forEach((c,i)=>{const x=M+i*(cw+14);text(c[0],x,y,7.5,bold,muted);contacts[i].forEach((s,j)=>text(s,x,y-17-j*11,8));});y-=contactHeight;
    if(seller.paymentAccount&&!seller.bankgiro&&!seller.iban&&!seller.plusgiro&&!seller.swish)paragraph('Betalningskonto',seller.paymentAccount);
    if(options.internal){
      newPage(true);
      const record=options.record||{};
      paragraph('Internt fakturaunderlag','Kundfakturan på föregående sidor kompletteras här med alla interna uppgifter. Denna bilaga ska inte skickas till kunden.',true);
      paragraph('Bokföringsinformation',`Bokföringsdatum: ${data.postingDate||'–'}\nVerifikation: ${record.journalNumber||'Ej bokförd'} · Buntnummer: ${record.batchNumber||'–'}\nStatus: ${record.status||'Utkast'} · Internt faktura-id: ${record.id||'–'}\nRestbelopp: ${money(record.remainingOre??data.totalOre)} SEK`,true);
      paragraph('Kontering per fakturarad','Intäktskontot är valt i fakturaverktyget och sparat med fakturans ursprungsuppgifter.',true);
      for(const [i,r] of (data.lines||[]).entries()){
        paragraph(`Rad ${i+1}`,`${r.articleNumber||'–'} · ${r.description}\nIntäktskonto: ${r.revenueAccount||'Saknas i äldre underlag'} ${r.revenueAccountName||''}\nNettobelopp: ${money(r.netOre)} SEK · Moms: ${money(r.vatOre)} SEK`,true);
      }
      const journal=options.journalLines||[];
      if(journal.length){
        ensure(45,true);text('VERIFIKATION',M,y,8,bold,muted);y-=22;
        for(const r of journal){paragraph(`${r.account} ${r.text||''}`,`Debet: ${money(r.debitOre)} SEK    Kredit: ${money(r.creditOre)} SEK`,true);}
      }
      paragraph('Interna anteckningar',data.internalNotes||'Inga interna anteckningar.',true);
      if(record.transactions?.length)paragraph('Betalningshistorik',record.transactions.map(t=>`${t.paymentDate||t.postingDate||'–'} · ${t.transactionType||t.type||'Händelse'} · ${money(t.amountOre)} SEK · ${t.journalNumber||t.transactionNumber||''}`).join('\n'),true);
    }
    pages.forEach((p,i)=>{page=p;rule(40);text(`Faktura ${data.invoiceNumber||'UTKAST'}`,M,30,7.5,regular,muted);right(`Sida ${i+1} av ${pages.length}`,W-M,30,7.5,regular);});
    return pdf.save();
  }
  return {createInvoicePdf};
});
