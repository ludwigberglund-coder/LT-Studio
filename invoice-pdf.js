const {PDFDocument,StandardFonts,rgb} = require('pdf-lib');
const Model = require('./public/invoice-model');
async function invoicePdf(invoice,business) {
  const seller = invoice.seller || business;
  const doc = await PDFDocument.create();
  doc.setTitle(`${invoice.credit?'Kreditfaktura':'Faktura'} ${invoice.number}`);
  const regular=await doc.embedFont(StandardFonts.Helvetica), bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const green=rgb(.08,.23,.18), grey=rgb(.39,.44,.42), light=rgb(.94,.96,.93);
  const clean = text => String(text ?? '').replace(/\t/g,' ').replace(/[\u2010-\u2015]/g,'-');
  // Unsupported characters are rejected explicitly, never silently replaced on an invoice.
  const text = (p,t,x,y,size=10,font=regular,color=green) => p.drawText(clean(t),{x,y,size,font,color});
  function wrap(t,width,size=10,font=regular) {
    const result=[];
    for(const paragraph of clean(t).split('\n')) {
      let line='';
      for(const word of paragraph.split(/\s+/)) {
        const candidate=line ? line+' '+word : word;
        if(font.widthOfTextAtSize(candidate,size)<=width) {line=candidate;continue;}
        if(line)result.push(line);
        line='';
        for(const ch of word) {
          if(font.widthOfTextAtSize(line+ch,size)>width && line) {result.push(line);line='';}
          line+=ch;
        }
      }
      result.push(line);
    }
    return result;
  }
  const block=(p,t,x,y,w,size=10,font=regular)=>{const lines=wrap(t,w,size,font);lines.forEach((l,i)=>text(p,l,x,y-i*(size+4),size,font));return y-lines.length*(size+4);};
  const amount=n=>Number(n).toLocaleString('sv-SE',{minimumFractionDigits:0,maximumFractionDigits:0}).replace(/\u00a0/g,' ').replace(/\u2212/g,'-');
  let page,y;
  const newPage=(first=false)=>{
    page=doc.addPage([595.28,841.89]);
    text(page,'Rollands',42,785,25,bold);
    text(page,invoice.credit?'KREDITFAKTURA':'FAKTURA',370,791,17,bold);
    text(page,invoice.number,370,770,12);
    text(page,`OCR: ${invoice.ocr || Model.ocr(invoice.number)}`,370,750,10,bold);
    text(page,first?'Frukt, grönt & goda smaker':'Fortsättning',42,765,10,regular,grey);
    y=715;
    if(first) {
      const left=block(page,invoice.customer,42,y,295,13,bold);
      const addressEnd=block(page,invoice.address || 'Adress saknas (äldre faktura)',42,left-7,295);
      let meta=y;
      for(const [label,value] of [['Fakturadatum',invoice.date],['Förfallodatum',invoice.dueDate],['Betalningsvillkor',`${invoice.paymentTerms ?? 30} dagar`],['Kundnummer',invoice.customerNumber || '-']]) {
        text(page,label,370,meta,9,regular,grey); text(page,value,370,meta-14,10,bold);meta-=36;
      }
      y=Math.min(addressEnd-12,meta-2);
      y=block(page,`Er referens: ${invoice.reference || '-'}`,42,y,505);
      y=block(page,`Vår kontakt: ${invoice.ourContact || seller.invoiceContact || 'Ej angiven'}`,42,y-2,505)-18;
    }
    page.drawRectangle({x:42,y:y-10,width:511,height:27,color:green});
    text(page,'Fakturatext',51,y,10,bold,rgb(1,1,1));text(page,'Moms',395,y,10,bold,rgb(1,1,1));text(page,'Belopp exkl. moms',444,y,9,bold,rgb(1,1,1)); y-=33;
  };
  newPage(true);
  const rows=invoice.lines || [{description:invoice.reference || 'Varor och tjänster',net:invoice.net,vatRate:invoice.net?Math.round(invoice.vat/invoice.net*100):0}];
  for(const r of rows) {
    const chunks=wrap(r.description,330,10);
    if(y- Math.min(chunks.length,10)*14<205) newPage();
    text(page,`${r.vatRate} %`,397,y,10);
    const a=amount(r.net);text(page,a,547-regular.widthOfTextAtSize(a,10),y,10);
    for(const line of chunks) { if(y<205) newPage(); text(page,line,51,y,10);y-=14; }
    y-=5; page.drawLine({start:{x:42,y},end:{x:553,y},thickness:.5,color:rgb(.83,.87,.83)}); y-=18;
  }
  const summary=invoice.vatSummary || [{rate:invoice.net?Math.round(invoice.vat/invoice.net*100):0,vat:invoice.vat}];
  if(y<300+summary.length*17) newPage();
  y-=12;
  text(page,'Summa exkl. moms',340,y,10);text(page,amount(invoice.net),465,y,10,bold);y-=22;
  for(const v of summary){text(page,`Moms ${v.rate} %`,340,y,10);text(page,amount(v.vat),465,y,10);y-=19;}
  page.drawRectangle({x:330,y:y-27,width:223,height:39,color:light});
  text(page,invoice.credit?'Tillgodo (SEK)':'Att betala (SEK)',340,y-12,12,bold);
  const total=amount(invoice.total);text(page,total,542-bold.widthOfTextAtSize(total,13),y-12,13,bold);
  doc.getPages().forEach((p,index)=>{
    p.drawLine({start:{x:42,y:164},end:{x:553,y:164},thickness:1,color:green});
    text(p,'BETALNINGSUPPGIFTER',42,147,9,bold);
    block(p,`${seller.name}\n${seller.address}\nMomsreg.nr: ${seller.vatNumber}\nSäte: ${seller.registeredOffice || 'Ej angivet'}`,42,129,252,9);
    block(p,`Bankkonto för betalning: ${seller.paymentAccount || 'Ej angivet'}\nOCR-referens: ${invoice.ocr || Model.ocr(invoice.number)}\nFörfallodatum: ${invoice.dueDate}`,310,129,243,9);
    block(p,Model.interestText,42,51,511,8);
    text(p,`${invoice.number}  |  Sida ${index+1} av ${doc.getPageCount()}`,42,22,8,regular,grey);
  });
  return Buffer.from(await doc.save());
}
module.exports={invoicePdf};
