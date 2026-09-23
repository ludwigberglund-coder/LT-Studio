'use strict';

async function createReminderPdf(data,options={}){
  const PDFLib=options.PDFLib||require('pdf-lib');
  const {PDFDocument,StandardFonts,rgb}=PDFLib;
  const pdf=await PDFDocument.create();
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const W=595.28,H=841.89,M=42,C=W-2*M;
  const ink=rgb(.05,.05,.05),muted=rgb(.42,.42,.42),line=rgb(.86,.86,.84),soft=rgb(.965,.96,.94),accent=rgb(.08,.08,.08);
  const page=pdf.addPage([W,H]);
  const money=value=>new Intl.NumberFormat('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value||0)/100);
  const safe=value=>String(value??'').replace(/[\u00a0\u202f]/g,' ').replace(/[\u2010-\u2015]/g,'-').replace(/\u2212/g,'-');
  const text=(value,x,y,size=9,font=regular,color=ink)=>page.drawText(safe(value),{x,y,size,font,color});
  const right=(value,x,y,size=9,font=regular,color=ink)=>{const s=safe(value);text(s,x-font.widthOfTextAtSize(s,size),y,size,font,color)};
  const rule=y=>page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:.7,color:line});
  const box=(x,y,w,h,color=soft)=>page.drawRectangle({x,y,width:w,height:h,color});
  const seller=data.seller||{},buyer=data.buyer||{};
  pdf.setTitle('Betalningspåminnelse '+(data.reminderNumber||''));
  pdf.setAuthor(seller.name||'LT Studio');
  pdf.setSubject('Betalningspåminnelse avseende faktura '+(data.originalInvoiceNumber||''));
  pdf.setCreator('LT Studio');

  page.drawRectangle({x:0,y:H-9,width:W,height:9,color:accent});
  text('LT STUDIO',M,H-58,11,bold,muted);
  right('BETALNINGSPÅMINNELSE',W-M,H-58,21,bold,ink);
  text(seller.name||'',M,H-80,9,regular,muted);
  right('Påminnelsenr. '+(data.reminderNumber||'—'),W-M,H-80,9,bold,ink);

  let y=H-122;
  box(M,y-56,C,56);
  text('VIKTIGT',M+14,y-20,8,bold,muted);
  text('Detta är en betalningspåminnelse och inte en ny kundfaktura.',M+14,y-38,10,bold,ink);
  y-=78;

  const factW=(C-20)/3;
  const facts=[
    ['Påminnelsedatum',data.reminderDate||'—'],
    ['Avser faktura',data.originalInvoiceNumber||'—'],
    ['Ursprungligt förfallodatum',data.originalDueDate||'—']
  ];
  facts.forEach(([label,value],i)=>{
    const x=M+i*(factW+10);
    text(label.toUpperCase(),x,y,7,bold,muted);
    text(value,x,y-18,10,bold,ink);
  });
  y-=56;rule(y);y-=24;

  const cardW=(C-16)/2;
  [['Avsändare',seller],['Mottagare',buyer]].forEach(([label,party],i)=>{
    const x=M+i*(cardW+16);
    box(x,y-112,cardW,112);
    text(label.toUpperCase(),x+12,y-18,7,bold,muted);
    text(party.name||'—',x+12,y-40,10,bold);
    const lines=[party.address,party.orgNumber?'Org.nr: '+party.orgNumber:'',party.email||''].filter(Boolean);
    lines.forEach((value,index)=>text(value,x+12,y-60-index*16,8.5,regular,ink));
  });
  y-=136;

  text('UNDERLAG',M,y,8,bold,muted);y-=20;
  const rows=[
    ['Utestående belopp på fakturan',data.principalOre],
    ['Dröjsmålsränta',data.interestOre],
    ['Påminnelseavgift',data.reminderFeeOre],
    ['Förseningsersättning',data.businessLatePaymentCompensationOre]
  ];
  rows.forEach(([label,value],index)=>{
    if(index%2===0)box(M,y-25,C,28,soft);
    text(label,M+10,y-16,9,regular,ink);
    right(money(value)+' kr',W-M-10,y-16,9,bold,ink);
    y-=28;
  });
  y-=10;
  box(M,y-54,C,54,rgb(.91,.91,.89));
  text('TOTALT ATT BETALA',M+12,y-21,9,bold,muted);
  right(money(data.totalDueOre)+' kr',W-M-12,y-29,18,bold,ink);
  y-=80;

  text('BETALNINGSUPPGIFTER',M,y,8,bold,muted);y-=20;
  const paymentLines=[
    'Bankgiro: '+(seller.bankgiro||seller.paymentAccount||'—'),
    'Betalningsreferens/OCR: '+(data.ocr||data.originalInvoiceNumber||'—'),
    'Ursprunglig faktura: '+(data.originalInvoiceNumber||'—'),
    data.annualRateBasisPoints?'Årsränta vid påminnelsedatum: '+(Number(data.annualRateBasisPoints)/100).toFixed(2).replace('.',',')+' %':''
  ].filter(Boolean);
  paymentLines.forEach((value,index)=>text(value,M,y-index*18,9,index<2?bold:regular,ink));
  y-=paymentLines.length*18+18;

  if(data.note){
    text('ANTECKNING',M,y,8,bold,muted);y-=18;
    const note=safe(data.note).slice(0,900);
    const words=note.split(/\s+/);let lineText='',lines=[];
    for(const word of words){const next=lineText?lineText+' '+word:word;if(regular.widthOfTextAtSize(next,9)>C){lines.push(lineText);lineText=word}else lineText=next}
    if(lineText)lines.push(lineText);
    lines.slice(0,8).forEach((value,index)=>text(value,M,y-index*15,9,regular,ink));
  }

  rule(48);
  text('Påminnelse '+(data.reminderNumber||'—')+' · avser faktura '+(data.originalInvoiceNumber||'—'),M,30,7.5,regular,muted);
  right('Sida 1 av 1',W-M,30,7.5,regular,muted);
  return pdf.save();
}

module.exports=Object.freeze({createReminderPdf});
