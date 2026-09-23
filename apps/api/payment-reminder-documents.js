'use strict';

const crypto=require('node:crypto');
const CustomerInvoicing=require('./customer-invoicing.js');
const ReminderPdf=require('../../packages/receivables/reminder-pdf.js');
const Db=require('./database.js');
const InvoiceSettings=require('./company-invoice-settings.js');
const PrivateObject=require('./private-object-contract.js');
const StoreFactory=require('./private-object-store-factory.js');

function reminderError(message,code='PAYMENT_REMINDER_DOCUMENT_ERROR',statusCode=422){const error=new Error(message);error.code=code;error.statusCode=statusCode;return error}
function reminderNumberFor(invoiceNumber,reminderId){
  const invoice=String(invoiceNumber||'').replace(/[^0-9A-Za-z]/g,'').slice(0,20)||'FAKTURA';
  const suffix=String(reminderId||'').replace(/[^0-9A-Za-z]/g,'').slice(-6).toUpperCase();
  return 'P-'+invoice+'-'+(suffix||crypto.randomBytes(3).toString('hex').toUpperCase());
}
function buildDocument(db,{companyId,invoice,reminder,reminderNumber}){
  const bundle=CustomerInvoicing.invoiceBundle(db,companyId,invoice.id);
  const original=bundle?.document||null;
  const customer=Db.customerById(db,companyId,invoice.customerId);
  const profile=InvoiceSettings.privateProfile(db,companyId,{}).profile;
  const seller=original?.seller||{
    name:profile.legalName||profile.displayName||'Företaget',
    address:profile.address?.full||'',
    orgNumber:profile.orgNumber||'',
    vatNumber:profile.vatNumber||'',
    email:profile.contact?.email||'',
    phone:profile.contact?.phone||'',
    website:profile.website||'',
    bankgiro:profile.invoice?.bankgiro||'',
    taxStatus:profile.invoice?.taxStatus||''
  };
  const buyer=original?.buyer||{
    name:customer?.name||invoice.customerName||'Kund',
    address:customer?.address?.full||invoice.customerAddress?.full||'',
    orgNumber:customer?.orgNumber||'',
    email:customer?.email||invoice.customerEmail||''
  };
  return Object.freeze({
    schemaVersion:1,
    documentType:'BETALNINGSPÅMINNELSE',
    reminderNumber,
    reminderDate:reminder.reminderDate,
    originalInvoiceNumber:invoice.invoiceNumber,
    originalInvoiceDate:invoice.invoiceDate,
    originalDueDate:invoice.dueDate,
    customerNumber:invoice.customerNumber,
    seller,
    buyer,
    ocr:original?.ocr||invoice.ocr||invoice.invoiceNumber,
    principalOre:reminder.principalOre,
    interestOre:reminder.interestOre,
    reminderFeeOre:reminder.reminderFeeOre,
    businessLatePaymentCompensationOre:reminder.businessLatePaymentCompensationOre,
    totalDueOre:reminder.totalDueOre,
    annualRateBasisPoints:reminder.annualRateBasisPoints,
    note:reminder.note||'',
    sourceInvoiceId:invoice.id
  });
}
async function prepareArchive(db,{companyId,invoice,reminder}){
  const reminderNumber=reminderNumberFor(invoice.invoiceNumber,reminder.id);
  const document=buildDocument(db,{companyId,invoice,reminder,reminderNumber});
  let bytes;
  try{bytes=Buffer.from(await ReminderPdf.createReminderPdf(document))}
  catch(error){throw reminderError('Påminnelse-PDF kunde inte skapas: '+error.message,'REMINDER_PDF_GENERATION_FAILED',500)}
  if(!bytes.length||bytes.subarray(0,5).toString('ascii')!=='%PDF-')throw reminderError('Påminnelse-PDF blev inte en giltig PDF.','REMINDER_PDF_INVALID',500);
  if(bytes.length>15*1024*1024)throw reminderError('Påminnelse-PDF är för stor.','REMINDER_PDF_TOO_LARGE',500);
  const pdfSha256=crypto.createHash('sha256').update(bytes).digest('hex');
  return Object.freeze({
    reminderNumber,
    documentJson:JSON.stringify(document),
    createdAt:new Date().toISOString(),
    pdfBytes:bytes,
    pdfSha256,
    pdfSizeBytes:bytes.length,
    pdfFileName:'Betalningspaminnelse-'+reminderNumber.replace(/[^0-9A-Za-z_-]/g,'_')+'.pdf'
  });
}
function storeArchive(db,{companyId,reminderId,archive}){
  const metadata=PrivateObject.createPrivateObjectMetadata({companyId,kind:PrivateObject.PRIVATE_OBJECT_KINDS.PAYMENT_REMINDER_PDF,objectId:reminderId,mimeType:'application/pdf',sizeBytes:archive.pdfSizeBytes,sha256:archive.pdfSha256,createdAt:archive.createdAt});
  const store=StoreFactory.createPrivateObjectStore({db,kind:PrivateObject.PRIVATE_OBJECT_KINDS.PAYMENT_REMINDER_PDF});
  if(!store.put({metadata,bytes:archive.pdfBytes}))throw reminderError('Påminnelse-PDF kunde inte lagras i privat arkiv.','REMINDER_PDF_STORE_FAILED',500);
  return metadata;
}
function pdfArchive(db,{companyId,invoiceId,reminderId}){
  const row=db.prepare('SELECT reminder_number AS reminderNumber,pdf_sha256 AS pdfSha256,pdf_size_bytes AS sizeBytes,pdf_file_name AS fileName FROM invoice_reminders WHERE company_id=? AND invoice_id=? AND id=?').get(companyId,invoiceId,reminderId);
  if(!row||!row.pdfSha256)throw reminderError('Påminnelse-PDF saknas.','REMINDER_PDF_NOT_FOUND',404);
  const store=StoreFactory.createPrivateObjectStore({db,kind:PrivateObject.PRIVATE_OBJECT_KINDS.PAYMENT_REMINDER_PDF});
  const bytes=Buffer.from(store.get({companyId,kind:PrivateObject.PRIVATE_OBJECT_KINDS.PAYMENT_REMINDER_PDF,objectId:reminderId})||[]);
  const digest=crypto.createHash('sha256').update(bytes).digest('hex');
  if(bytes.subarray(0,5).toString('ascii')!=='%PDF-'||bytes.length!==Number(row.sizeBytes)||digest!==row.pdfSha256)throw reminderError('Påminnelse-PDF klarade inte integritetskontrollen.','REMINDER_PDF_INTEGRITY_ERROR',409);
  return{...row,bytes};
}
module.exports=Object.freeze({reminderNumberFor,buildDocument,prepareArchive,storeArchive,pdfArchive});
