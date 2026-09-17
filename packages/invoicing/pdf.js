'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.RollandsInvoicePdf=api;})(globalThis,function(){
  async function createInvoicePdf(data,options={}){
    const lib=options.PDFLib||globalThis.PDFLib||(typeof require==='function'?require('pdf-lib'):null);
    if(!lib)throw new Error('PDF-biblioteket kunde inte laddas. Ladda om sidan och försök igen.');
    const {PDFDocument,StandardFonts,rgb}=lib,pdf=await PDFDocument.create();
    const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),serif=await pdf.embedFont(StandardFonts.TimesRomanBold);
    const W=595.28,H=841.89,M=38,C=W-2*M,BOTTOM=50;
    const ink=rgb(.075,.235,.19),muted=rgb(.37,.43,.40),line=rgb(.83,.87,.84),pale=rgb(.95,.965,.947),lime=rgb(.86,.91,.66),white=rgb(1,1,1);
    let page,y;const pages=[];
    const normalized=v=>String(v??'').replace(/[\u00a0\u202f]/g,' ').replace(/[\u2010-\u2015]/g,'-').replace(/\u2212/g,'-');
    function safe(v,font=regular){const s=normalized(v);try{font.encodeText(s.replace(/\n/g,''));}catch{throw new Error('Ett textfält innehåller tecken som PDF-fonten inte stödjer. Använd latinska bokstäver, svenska tecken och vanliga skiljetecken.');}return s;}
    function text(v,x,top,size=9,font=regular,color=ink){page.drawText(safe(v,font),{x,y:top-size,size,font,color});}
    function width(v,size=9,font=regular){return font.widthOfTextAtSize(safe(v,font),size);}
    function wrap(v,max,size=9,font=regular){const out=[];for(const p of safe(v,font).split('\n')){if(!p.trim()){out.push('');continue;}let cur='';for(const word of p.trim().split(/\s+/)){if(width(word,size,font)>max){if(cur){out.push(cur);cur='';}let part='';for(const ch of word){if(part&&width(part+ch,size,font)>max){out.push(part);part='';}part+=ch;}cur=part;}else if(cur&&width(cur+' '+word,size,font)>max){out.push(cur);cur=word;}else cur=cur?cur+' '+word:word;}out.push(cur);}return out.length?out:[''];}
    function right(v,x,top,size=9,font=regular){text(v,x-width(v,size,font),top,size,font);}
    function rect(x,top,w,h,color=pale){page.drawRectangle({x,y:top-h,width:w,height:h,color});}
    function rule(top,x=M,w=C){page.drawLine({start:{x,y:top},end:{x:x+w,y:top},color:line,thickness:.6});}
    const money=v=>new Intl.NumberFormat('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0)/100);
    const qty=v=>new Intl.NumberFormat('sv-SE',{maximumFractionDigits:3}).format(Number(v||0)/1000);
    const seller=data.seller||{},buyer=data.buyer||{},type=data.documentType||'FAKTURA';
    pdf.setTitle(`${type} ${data.invoiceNumber}`);pdf.setAuthor(seller.name||'Rollands');pdf.setSubject(options.internal?'Faktura med internt underlag':'Kundfaktura');pdf.setCreator('Rollands fakturaverktyg');
    function newPage(internal=false){page=pdf.addPage([W,H]);pages.push(page);rect(0,H,W,7,ink);text('Rollands',M,H-31,29,serif);right(internal?'Internt underlag':type==='KREDITFAKTURA'?'Kreditfaktura':'Faktura',W-M,H-33,22,bold);text(internal?'Inte för utskick':seller.name||'',M,H-66,8,regular,muted);right(`Nr ${data.invoiceNumber||'UTKAST'} · ${data.currency||'SEK'}`,W-M,H-66,8,bold);y=H-88;}
    function ensure(h,internal=false){if(y-h<BOTTOM)newPage(internal);}
    function paragraph(label,value,internal=false){if(!value)return;const lines=wrap(value,C,9);ensure(30+lines.length*12,internal);text(label.toUpperCase(),M,y,7.4,bold,muted);y-=15;for(const s of lines){ensure(13,internal);text(s,M,y,9);y-=12;}y-=9;}
    function facts(rows,columns=3){const gap=14,cw=(C-gap*(columns-1))/columns;for(let s=0;s<rows.length;s+=columns){const g=rows.slice(s,s+columns),wrapped=g.map(([,v])=>wrap(v||'–',cw,8.4));const h=14+Math.max(...wrapped.map(a=>a.length))*11;ensure(h+5);g.forEach(([label],i)=>{const x=M+i*(cw+gap);text(label,x,y,7.2,bold,muted);wrapped[i].forEach((v,j)=>text(v,x,y-13-j*11,8.4));});y-=h+3;}}
    const cols=[{label:'Benämning',w:215},{label:'Antal',w:54,right:true},{label:'Enhet',w:50},{label:'À-pris',w:70,right:true},{label:'Moms',w:45,right:true},{label:'Belopp',w:C-434,right:true}];
    function tableHeader(){ensure(42);rect(M,y,C,29,ink);let x=M;for(const c of cols){wrap(c.label,c.w-10,7.4,bold).forEach((s,i)=>text(s,x+5,y-7-i*9,7.4,bold,white));x+=c.w;}y-=29;}
    function rows(){tableHeader();for(let i=0;i<(data.lines||[]).length;i++){const r=data.lines[i],vals=[r.description||'–',qty(r.quantityMilli),r.unit||'',money(r.unitPriceOre),r.vatRate==null?'–':`${r.vatRate} %`,money(r.netOre)],cells=vals.map((v,j)=>wrap(v,cols[j].w-10,8.2)),count=Math.max(...cells.map(c=>c.length)),h=14+count*11;if(h<=H-100-29-BOTTOM&&y-h<BOTTOM){newPage();tableHeader();}if(i%2===0)rect(M,y,C,h,pale);let x=M;cols.forEach((c,j)=>{cells[j].forEach((s,k)=>{const tx=c.right?x+c.w-5-width(s,8.2):x+5;text(s,tx,y-7-k*11,8.2);});x+=c.w;});y-=h;rule(y);}y-=12;}
    newPage();
    facts([['Fakturanr.',data.invoiceNumber],['Fakturadatum',data.invoiceDate],['Förfallodatum',data.dueDate]]);
    if(data.demo||data.invoiceNumber==='UTKAST'){ensure(25);rect(M,y,C,20,lime);text(data.invoiceNumber==='UTKAST'?'UTKAST – INTE BOKFÖRD':'DEMO – INTE BETALNINGSUNDERLAG',M+9,y-5,8,bold);y-=25;}
    if((data.warnings||[]).length)paragraph('Underlaget är ofullständigt',data.warnings.join('\n'));
    const cardW=(C-16)/2,partyLines=[seller,buyer].map(p=>[...wrap(p.name||'–',cardW-24,9,bold),...[p.address||'Adress saknas',p.orgNumber?`Org.nr: ${p.orgNumber}`:'',p.vatNumber?`VAT.nr: ${p.vatNumber}`:''].filter(Boolean).flatMap(v=>wrap(v,cardW-24,9))]),cardH=31+Math.max(...partyLines.map(a=>a.length))*11;ensure(cardH+10);['Avsändare','Mottagare'].forEach((label,i)=>{const x=M+i*(cardW+16);rect(x,y,cardW,cardH,pale);text(label.toUpperCase(),x+12,y-10,7.5,bold,muted);partyLines[i].forEach((s,j)=>text(s,x+12,y-26-j*11,9,j===0?bold:regular));});y-=cardH+9;
    facts([['Kundnummer',data.customerNumber],['Betalningsvillkor',`${data.paymentTermsDays??30} dagar`],['OCR / betalningsreferens',data.ocr||data.invoiceNumber],['Vår referens',data.ourReference],['Er referens',data.yourReference]]);
    if(buyer.email)paragraph('Kundens e-post',buyer.email);
    rows();
    const summaryH=163;ensure(summaryH+10);const split=M+C*.51,tw=C*.49;
    text('MOMSUNDERLAG',M,y,8,bold,muted);text('Underlag',M+98,y,7.5,bold,muted);text('Moms',M+176,y,7.5,bold,muted);
    [25,12,6,0].forEach((rate,i)=>{const r=(data.vatBreakdown||[]).find(r=>Number(r.rate??r.vatBasisPoints/100)===rate);text(rate===0?'Momsfritt':`Moms ${rate} %`,M,y-23-i*20,8.5);right(r?money(r.netOre):(data.vatBreakdown?.length?'0,00':'–'),M+153,y-23-i*20,8.5);right(r?money(r.vatOre):(data.vatBreakdown?.length?'0,00':'–'),M+233,y-23-i*20,8.5);});
    const summary=[['Varor / tjänster',data.netOre-(data.freightOre||0)-(data.administrationOre||0)],['Fakturaavgift',data.administrationOre],['Frakt',data.freightOre],['Belopp före moms',data.netOre],['Total moms',data.vatOre],['Öresutjämning',data.roundingOre]];
    summary.forEach(([label,value],i)=>{text(label,split+8,y-i*20,8.5);right(money(value),W-M-8,y-i*20,9,i===3?bold:regular);});rect(split,y-125,tw,39,lime);text(data.totalOre<0?'Att återfå (SEK)':'Att betala (SEK)',split+10,y-137,10,bold);right(money(Math.abs(data.totalOre)),W-M-10,y-136,13,bold);y-=summaryH+8;
    paragraph('Dröjsmålsränta',data.interestText);
    paragraph('Meddelande',data.notes);
    if(data.originalInvoiceNumber)paragraph('Kredit av faktura',`${data.originalInvoiceNumber}${data.creditReason?' · '+data.creditReason:''}`);
    const contact=[['KONTAKT',`Tel: ${seller.phone||'–'}`,`Webb: ${seller.website||'–'}`,`E-post: ${seller.email||'–'}`],['FÖRETAGSUPPGIFTER',`Org.nr: ${seller.orgNumber||'–'}`,`VAT.nr: ${seller.vatNumber||'–'}`,seller.taxStatus||''],['BETALNING',`Bankgiro: ${seller.bankgiro||seller.paymentAccount||'–'}`]],cw=(C-28)/3,wrapped=contact.map(c=>c.slice(1).filter(Boolean).flatMap(v=>wrap(v,cw,8))),contactH=28+Math.max(...wrapped.map(c=>c.length))*11;ensure(contactH+10);rule(y);y-=11;contact.forEach((c,i)=>{const x=M+i*(cw+14);text(c[0],x,y,7.5,bold,muted);wrapped[i].forEach((s,j)=>text(s,x,y-17-j*11,8));});y-=contactH;
    if(options.internal){newPage(true);const record=options.record||{};paragraph('Internt fakturaunderlag','Kundens PDF innehåller inte bokföringsdatum eller interna konteringsuppgifter.',true);paragraph('Bokföringsinformation',`Bokföringsdatum: ${data.postingDate||'–'}\nVerifikation: ${record.journalNumber||'Ej bokförd'} · Buntnummer: ${record.batchNumber||'–'}\nStatus: ${record.status||'Utkast'} · Internt faktura-id: ${record.id||'–'}\nRestbelopp: ${money(record.remainingOre??data.totalOre)} SEK`,true);for(const [i,r] of (data.lines||[]).entries())paragraph(`Rad ${i+1}`,`${r.description}\nIntäktskonto: ${r.revenueAccount||'–'} ${r.revenueAccountName||''}\nMoms: ${r.vatRate??'–'} % · Netto: ${money(r.netOre)} SEK`,true);if(options.journalLines?.length)paragraph('Verifikation',options.journalLines.map(r=>`${r.account} ${r.text}: Debet ${money(r.debitOre)} · Kredit ${money(r.creditOre)}`).join('\n'),true);}
    pages.forEach((p,i)=>{const old=page;page=p;right(`Sida ${i+1} av ${pages.length}`,W-M,27,7.5,regular);page=old;});
    return pdf.save();
  }
  return Object.freeze({createInvoicePdf});
});
