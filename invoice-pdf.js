const {PDFDocument,StandardFonts,rgb} = require('pdf-lib');
const Model = require('./public/invoice-model');

function invoiceDocumentData(invoice,business={}) {
  const seller=invoice.seller || business || {};
  const required=(value,label)=>{
    const text=String(value ?? '').trim();
    if(!text) throw new Error(`Fakturan saknar obligatorisk uppgift: ${label}.`);
    return text;
  };
  const number=required(invoice.number,'fakturanummer');
  const issueDate=required(invoice.date,'fakturadatum');
  const customer=required(invoice.customer,'köparens namn');
  const customerAddress=required(invoice.address,'köparens adress');
  const sellerName=required(seller.name || seller.legalName,'säljarens namn');
  const sellerAddress=required(seller.address,'säljarens adress');
  const sellerVatNumber=required(seller.vatNumber,'säljarens momsregistreringsnummer');
  const sellerOrgNumber=required(seller.orgNumber,'säljarens organisationsnummer');
  const paymentAccount=required(seller.paymentAccount,'betalningskonto');
  const dueDate=required(invoice.dueDate,'förfallodatum');
  const lines=(invoice.lines || [{description:invoice.reference || 'Varor och tjänster',net:invoice.net,vatRate:invoice.net?Math.round(invoice.vat/invoice.net*100):0}]).map((line,index)=>{
    const description=required(line.description,`fakturarad ${index+1}: benämning`);
    const net=Number(line.net ?? line.amount);
    const vatRate=Number(line.vatRate ?? 0);
    if(!Number.isFinite(net)) throw new Error(`Fakturarad ${index+1} saknar giltigt belopp.`);
    if(![0,6,12,25].includes(vatRate)) throw new Error(`Fakturarad ${index+1} har en momssats som inte stöds av denna fakturamall.`);
    const quantity=Number(line.quantity ?? 1);
    if(!Number.isFinite(quantity) || quantity<=0) throw new Error(`Fakturarad ${index+1} har ogiltig kvantitet.`);
    const unit=String(line.unit || 'st').trim() || 'st';
    const discountPercent=Number(line.discountPercent ?? 0);
    const unitPrice=Number(line.unitPrice ?? (net/quantity));
    if(!Number.isFinite(unitPrice) || !Number.isFinite(discountPercent)) throw new Error(`Fakturarad ${index+1} har ogiltigt pris eller rabatt.`);
    return {description,quantity,unit,unitPrice,discountPercent,vatRate,net};
  });
  const vatSummary=(invoice.vatSummary || [{rate:invoice.net?Math.round(invoice.vat/invoice.net*100):0,net:invoice.net,vat:invoice.vat}]).map(row=>({rate:Number(row.rate),net:Number(row.net||0),vat:Number(row.vat||0)}));
  return Object.freeze({
    documentType:invoice.credit?'KREDITFAKTURA':'FAKTURA',
    number,
    ocr:String(invoice.ocr || Model.ocr(number)),
    issueDate,
    deliveryDate:String(invoice.deliveryDate || invoice.serviceDate || issueDate),
    dueDate,
    paymentTerms:Number(invoice.paymentTerms ?? 30),
    currency:String(invoice.currency || 'SEK'),
    customer,
    customerNumber:String(invoice.customerNumber || ''),
    customerAddress,
    customerOrgNumber:String(invoice.customerOrgNumber || ''),
    customerVatNumber:String(invoice.customerVatNumber || ''),
    buyerReference:String(invoice.reference || ''),
    ourContact:String(invoice.ourContact || seller.invoiceContact || ''),
    sellerName,
    sellerAddress,
    sellerOrgNumber,
    sellerVatNumber,
    sellerRegisteredOffice:String(seller.registeredOffice || ''),
    sellerPhone:String(seller.phone || ''),
    sellerEmail:String(seller.email || ''),
    paymentAccount,
    lines,
    vatSummary,
    net:Number(invoice.net || 0),
    vat:Number(invoice.vat || 0),
    total:Number(invoice.total || 0),
    credit:invoice.credit===true,
    originalInvoiceNumber:String(invoice.originalInvoiceNumber || ''),
    creditReason:String(invoice.creditReason || invoice.reference || ''),
    reverseCharge:invoice.reverseCharge===true,
    taxExemptionReason:String(invoice.taxExemptionReason || ''),
    interestText:String(invoice.interestText || 'Vid försenad betalning kan dröjsmålsränta tas ut enligt räntelagen med Riksbankens referensränta + 8 procentenheter, om inte annat har avtalats.')
  });
}

async function invoicePdf(invoice,business) {
  const data=invoiceDocumentData(invoice,business);
  const doc=await PDFDocument.create();
  doc.setTitle(`${data.documentType} ${data.number}`);
  doc.setSubject(`${data.documentType} från ${data.sellerName} till ${data.customer}`);
  doc.setAuthor(data.sellerName);
  doc.setCreator('Rollands Plattform');
  const regular=await doc.embedFont(StandardFonts.Helvetica), bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const green=rgb(.055,.22,.17), greenSoft=rgb(.91,.95,.93), grey=rgb(.38,.43,.41), line=rgb(.82,.86,.83), paper=rgb(.98,.985,.98), white=rgb(1,1,1), warm=rgb(.96,.93,.84);
  const clean=value=>String(value ?? '').replace(/\t/g,' ').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\u00a0/g,' ');
  const text=(page,value,x,y,size=9,font=regular,color=green)=>page.drawText(clean(value),{x,y,size,font,color});
  const width=(value,size=9,font=regular)=>font.widthOfTextAtSize(clean(value),size);
  function wrap(value,maxWidth,size=9,font=regular){
    const result=[];
    for(const paragraph of clean(value).split('\n')){
      const words=paragraph.split(/\s+/).filter(Boolean);
      if(!words.length){result.push('');continue;}
      let current='';
      for(const word of words){
        const candidate=current?`${current} ${word}`:word;
        if(width(candidate,size,font)<=maxWidth){current=candidate;continue;}
        if(current)result.push(current);
        current='';
        let part='';
        for(const character of word){
          if(part && width(part+character,size,font)>maxWidth){result.push(part);part='';}
          part+=character;
        }
        current=part;
      }
      if(current)result.push(current);
    }
    return result;
  }
  const block=(page,value,x,y,maxWidth,size=9,font=regular,color=green,lineHeight=size+3)=>{const lines=wrap(value,maxWidth,size,font);lines.forEach((row,index)=>text(page,row,x,y-index*lineHeight,size,font,color));return y-lines.length*lineHeight;};
  const money=value=>`${Number(value||0).toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2}).replace(/\u00a0/g,' ')} ${data.currency}`;
  const number=value=>Number(value||0).toLocaleString('sv-SE',{minimumFractionDigits:0,maximumFractionDigits:3}).replace(/\u00a0/g,' ');
  const right=(page,value,rightX,y,size=9,font=regular,color=green)=>text(page,value,rightX-width(value,size,font),y,size,font,color);
  const labelValue=(page,label,value,x,y,w)=>{text(page,label,x,y,7.5,bold,grey);return block(page,value||'-',x,y-12,w,9,bold,green)-4;};
  let page,y;

  function pageHeader(first){
    page=doc.addPage([595.28,841.89]);
    page.drawRectangle({x:0,y:780,width:595.28,height:61,color:green});
    text(page,'ROLLANDS',42,807,19,bold,white);
    text(page,data.sellerName,42,790,8,regular,rgb(.82,.91,.87));
    text(page,data.documentType,392,807,15,bold,white);
    text(page,`Nr ${data.number}`,392,790,9,bold,white);
    y=748;
    if(first){
      page.drawRectangle({x:42,y:628,width:250,height:100,color:paper,borderColor:line,borderWidth:.6});
      text(page,'FAKTURERAS TILL',55,710,8,bold,grey);
      let cy=691;
      cy=block(page,data.customer,55,cy,224,11,bold)-3;
      cy=block(page,data.customerAddress,55,cy,224,9,regular)-3;
      if(data.customerOrgNumber)cy=block(page,`Org.nr: ${data.customerOrgNumber}`,55,cy,224,8,regular,grey);
      if(data.customerVatNumber)block(page,`Momsreg.nr: ${data.customerVatNumber}`,55,cy,224,8,regular,grey);

      page.drawRectangle({x:310,y:628,width:243,height:100,color:white,borderColor:line,borderWidth:.6});
      labelValue(page,'FAKTURADATUM',data.issueDate,323,710,105);
      labelValue(page,'FÖRFALLODATUM',data.dueDate,440,710,100);
      labelValue(page,'KUNDNUMMER',data.customerNumber||'-',323,661,105);
      labelValue(page,'OCR / BETALNINGSREFERENS',data.ocr,440,661,100);

      const refs=[
        ['Er referens',data.buyerReference||'-'],
        ['Vår kontakt',data.ourContact||'-'],
        ['Leverans-/tjänstedatum',data.deliveryDate],
        ['Betalningsvillkor',`${data.paymentTerms} dagar`]
      ];
      let rx=42,ry=606;
      refs.forEach(([label,value],index)=>{text(page,label.toUpperCase(),rx,ry,7,bold,grey);text(page,value,rx,ry-13,9,bold);rx=index%2===0?310:42;if(index%2===1)ry-=38;});
      y=520;
      if(data.credit){
        page.drawRectangle({x:42,y:y-4,width:511,height:35,color:warm});
        text(page,'KREDITFAKTURA',52,y+17,8,bold,grey);
        const original=data.originalInvoiceNumber?`Avser ursprungsfaktura ${data.originalInvoiceNumber}`:'Kontrollera referensen till ursprungsfakturan före utskick.';
        text(page,original,52,y+2,9,bold);
        if(data.creditReason)right(page,`Orsak: ${data.creditReason}`,542,y+2,8,regular,grey);
        y-=55;
      }
    }
    page.drawRectangle({x:42,y:y-7,width:511,height:26,color:green});
    text(page,'Beskrivning',50,y,8,bold,white);
    text(page,'Antal',303,y,8,bold,white);
    text(page,'Enhet',343,y,8,bold,white);
    text(page,'À-pris exkl.',386,y,8,bold,white);
    text(page,'Moms',464,y,8,bold,white);
    text(page,'Belopp exkl.',505,y,8,bold,white);
    y-=31;
  }

  pageHeader(true);
  for(const row of data.lines){
    const descriptionLines=wrap(row.description,238,9,regular);
    const rowHeight=Math.max(27,descriptionLines.length*12+8);
    if(y-rowHeight<238)pageHeader(false);
    descriptionLines.forEach((value,index)=>text(page,value,50,y-index*12,9));
    right(page,number(row.quantity),329,y,9);
    text(page,row.unit,343,y,9);
    right(page,money(row.unitPrice).replace(` ${data.currency}`,''),451,y,9);
    right(page,`${row.vatRate} %`,492,y,9);
    right(page,money(row.net).replace(` ${data.currency}`,''),545,y,9,bold);
    if(row.discountPercent){text(page,`Rabatt ${number(row.discountPercent)} %`,50,y-13,8,regular,grey);}
    y-=rowHeight;
    page.drawLine({start:{x:42,y:y+5},end:{x:553,y:y+5},thickness:.5,color:line});
  }

  const summaryHeight=98+data.vatSummary.length*17;
  if(y-summaryHeight<188)pageHeader(false);
  y-=8;
  page.drawRectangle({x:306,y:y-summaryHeight+24,width:247,height:summaryHeight-24,color:paper,borderColor:line,borderWidth:.6});
  let sy=y-20;
  text(page,'SAMMANSTÄLLNING',319,sy,8,bold,grey);sy-=22;
  text(page,'Summa exkl. moms',319,sy,9);right(page,money(data.net),540,sy,9,bold);sy-=18;
  for(const vat of data.vatSummary){
    text(page,`Moms ${vat.rate} % på ${money(vat.net)}`,319,sy,8,regular,grey);right(page,money(vat.vat),540,sy,9);sy-=17;
  }
  text(page,'Moms totalt',319,sy,9);right(page,money(data.vat),540,sy,9,bold);sy-=23;
  page.drawRectangle({x:314,y:sy-12,width:231,height:35,color:greenSoft});
  text(page,data.credit?'TILLGODO':'ATT BETALA',325,sy+1,10,bold);
  right(page,money(data.total),534,sy+1,12,bold);

  doc.getPages().forEach((p,index)=>{
    p.drawLine({start:{x:42,y:166},end:{x:553,y:166},thickness:.8,color:green});
    text(p,'BETALNING',42,149,8,bold,grey);
    text(p,data.paymentAccount,42,133,10,bold);
    text(p,`OCR: ${data.ocr}`,42,118,9);
    text(p,`Förfallodatum: ${data.dueDate}`,42,104,9);

    text(p,'SÄLJARE',216,149,8,bold,grey);
    let fy=133;
    fy=block(p,data.sellerName,216,fy,158,8.5,bold)-1;
    fy=block(p,data.sellerAddress,216,fy,158,8,regular)-1;
    text(p,`Org.nr ${data.sellerOrgNumber}`,216,fy,8);fy-=12;
    text(p,`Momsreg.nr ${data.sellerVatNumber}`,216,fy,8);

    text(p,'KONTAKT',400,149,8,bold,grey);
    let ky=133;
    if(data.sellerPhone){text(p,data.sellerPhone,400,ky,8);ky-=12;}
    if(data.sellerEmail){text(p,data.sellerEmail,400,ky,8);ky-=12;}
    if(data.sellerRegisteredOffice)text(p,`Säte: ${data.sellerRegisteredOffice}`,400,ky,8);

    let notice=data.interestText;
    if(data.reverseCharge)notice+=' Omvänd betalningsskyldighet gäller för denna faktura.';
    if(data.taxExemptionReason)notice+=` Momsfrihet: ${data.taxExemptionReason}.`;
    block(p,notice,42,73,511,7.5,regular,grey,10);
    text(p,`${data.documentType.charAt(0)+data.documentType.slice(1).toLowerCase()} ${data.number} · Sida ${index+1} av ${doc.getPageCount()}`,42,24,7.5,regular,grey);
    right(p,'Rollands Plattform',553,24,7.5,bold,grey);
  });
  return Buffer.from(await doc.save());
}

module.exports={invoicePdf,invoiceDocumentData};
