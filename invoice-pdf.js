const {createInvoicePdf}=require('./packages/invoicing/pdf.js');
const Model=require('./public/invoice-model');

function invoiceDocumentData(invoice,business={}) {
  const seller=invoice.seller || business || {};
  const strictValidation=invoice.strictInvoiceValidation===true || seller.strictInvoiceValidation===true;
  const warnings=[];
  const required=(value,label)=>{
    const text=String(value ?? '').trim();
    if(!text) throw new Error(`Fakturan saknar obligatorisk uppgift: ${label}.`);
    return text;
  };
  const number=required(invoice.number,'fakturanummer');
  const issueDate=required(invoice.date,'fakturadatum');
  const customer=required(invoice.customer,'köparens namn');
  let customerAddress=String(invoice.address || '').trim();
  if(!customerAddress){
    if(strictValidation) throw new Error('Fakturan saknar obligatorisk uppgift: köparens adress.');
    warnings.push('Köparens adress saknas');
    customerAddress='ADRESS SAKNAS - EJ REDO FÖR UTSKICK';
  }
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
    return {description,quantity,unit,unitPrice,discountPercent,vatRate,net,articleNumber:String(line.articleNumber || ''),revenueAccount:String(line.account || line.revenueAccount || '')};
  });
  const vatSummary=(invoice.vatSummary || [{rate:invoice.net?Math.round(invoice.vat/invoice.net*100):0,net:invoice.net,vat:invoice.vat}]).map(row=>({rate:Number(row.rate),net:Number(row.net||0),vat:Number(row.vat||0)}));
  const originalInvoiceNumber=String(invoice.originalInvoiceNumber || '').trim();
  if(invoice.credit && !originalInvoiceNumber){
    if(strictValidation) throw new Error('Kreditfakturan saknar obligatorisk hänvisning till ursprungsfakturan.');
    warnings.push('Hänvisning till ursprungsfaktura saknas');
  }
  const registeredOffice=String(seller.registeredOffice || '').trim();
  if(!registeredOffice) warnings.push('Styrelsens sätesort saknas i fakturaunderlaget');
  return Object.freeze({
    documentType:invoice.credit?'KREDITFAKTURA':'FAKTURA',number,
    ocr:String(invoice.ocr || Model.ocr(number)),issueDate,
    deliveryDate:String(invoice.deliveryDate || invoice.serviceDate || issueDate),dueDate,
    paymentTerms:Number(invoice.paymentTerms ?? 30),currency:String(invoice.currency || 'SEK'),
    customer,customerNumber:String(invoice.customerNumber || ''),customerAddress,
    customerOrgNumber:String(invoice.customerOrgNumber || ''),customerVatNumber:String(invoice.customerVatNumber || ''),
    buyerReference:String(invoice.reference || ''),ourContact:String(invoice.ourContact || seller.invoiceContact || ''),
    sellerName,sellerAddress,sellerOrgNumber,sellerVatNumber,sellerRegisteredOffice:registeredOffice,
    sellerPhone:String(seller.phone || ''),sellerEmail:String(seller.email || ''),paymentAccount,
    lines,vatSummary,net:Number(invoice.net || 0),vat:Number(invoice.vat || 0),total:Number(invoice.total || 0),
    credit:invoice.credit===true,originalInvoiceNumber,creditReason:String(invoice.creditReason || invoice.reference || ''),
    reverseCharge:invoice.reverseCharge===true,taxExemptionReason:String(invoice.taxExemptionReason || ''),
    interestText:String(invoice.interestText || 'Vid försenad betalning kan dröjsmålsränta tas ut enligt räntelagen med Riksbankens referensränta + 8 procentenheter, om inte annat har avtalats.'),
    strictValidation,productionReady:warnings.length===0,validationWarnings:Object.freeze([...warnings])
  });
}
async function invoicePdf(invoice,business={}) {
  if(invoice.document)return Buffer.from(await createInvoicePdf(invoice.document));
  const d=invoiceDocumentData(invoice,business),seller=invoice.seller||business||{};
  const ore=value=>Math.round(Number(value||0)*100);
  const document={
    schemaVersion:2,documentType:d.documentType,demo:invoice.demo===true||seller.demo===true,
    invoiceNumber:d.number,ocr:d.ocr,invoiceDate:d.issueDate,postingDate:invoice.postingDate||d.issueDate,
    dueDate:d.dueDate,deliveryDate:d.deliveryDate,customerNumber:d.customerNumber,
    seller:{name:d.sellerName,address:d.sellerAddress,orgNumber:d.sellerOrgNumber,vatNumber:d.sellerVatNumber,
      phone:d.sellerPhone,email:d.sellerEmail,registeredOffice:d.sellerRegisteredOffice,
      website:String(seller.website||''),bankgiro:String(seller.bankgiro||''),plusgiro:String(seller.plusgiro||''),
      iban:String(seller.iban||''),bic:String(seller.bic||''),swish:String(seller.swish||''),taxStatus:String(seller.taxStatus||''),paymentAccount:d.paymentAccount},
    buyer:{name:d.customer,address:d.customerAddress,orgNumber:d.customerOrgNumber,vatNumber:d.customerVatNumber,email:String(invoice.customerEmail||''),phone:String(invoice.customerPhone||'')},
    ourReference:d.ourContact,yourReference:d.buyerReference,paymentTermsDays:d.paymentTerms,currency:d.currency,
    paymentTermsText:String(invoice.paymentTermsText||''),interestText:d.interestText,deliveryTerms:String(invoice.deliveryTerms||''),deliveryMethod:String(invoice.deliveryMethod||''),
    deliveryAddress:String(invoice.deliveryAddress||''),orderNumber:String(invoice.orderNumber||''),notes:String(invoice.notes||''),
    lines:d.lines.map(l=>({...l,quantityMilli:Math.round(l.quantity*1000),unitPriceOre:ore(l.unitPrice),netOre:ore(l.net),vatOre:ore(l.net*l.vatRate/100),discountBasisPoints:Math.round(l.discountPercent*100)})),
    vatBreakdown:d.vatSummary.map(r=>({rate:r.rate,netOre:ore(r.net),vatOre:ore(r.vat)})),
    netOre:ore(d.net),vatOre:ore(d.vat),totalOre:ore(d.total),roundingOre:ore(d.total)-ore(d.net)-ore(d.vat),
    freightOre:0,administrationOre:0,taxExemptionReason:d.taxExemptionReason,
    originalInvoiceNumber:d.originalInvoiceNumber,creditReason:d.creditReason,warnings:[...d.validationWarnings]
  };
  if(d.reverseCharge)document.taxExemptionReason+=' Omvänd betalningsskyldighet.';
  return Buffer.from(await createInvoicePdf(document));
}
module.exports={invoicePdf,invoiceDocumentData};
