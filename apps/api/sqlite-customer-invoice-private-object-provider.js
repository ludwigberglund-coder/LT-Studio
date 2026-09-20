'use strict';

const ArchiveStore=require('./customer-invoice-pdf-archive-store.js');
const PrivateObject=require('./private-object-contract.js');

function archiveFileName(db,companyId,invoiceId){
  const row=db.prepare(`SELECT i.invoice_number AS invoiceNumber,d.document_json AS documentJson
    FROM invoices i
    JOIN customer_invoice_documents d ON d.invoice_id=i.id AND d.company_id=i.company_id
    WHERE i.company_id=? AND i.id=?`).get(companyId,invoiceId);
  if(!row)return null;
  let document;
  try{document=JSON.parse(row.documentJson)}catch{return null}
  const prefix=document?.documentType==='KREDITFAKTURA'?'Kreditfaktura':'Faktura';
  return `${prefix}-${String(row.invoiceNumber).replace(/[^0-9A-Za-z_-]/g,'_')}.pdf`;
}

function createSqliteCustomerInvoicePrivateObjectProvider(db){
  // This bridge intentionally accepts only archived customer-invoice PDF objects.
  const store=ArchiveStore.createSqliteCustomerInvoicePdfArchiveStore(db);

  function isCustomerInvoicePdf(reference){
    return reference?.kind===PrivateObject.PRIVATE_OBJECT_KINDS.CUSTOMER_INVOICE_PDF;
  }

  function put({metadata,bytes}){
    if(!isCustomerInvoicePdf(metadata))return false;
    const fileName=archiveFileName(db,metadata.companyId,metadata.objectId);
    if(!fileName)return false;
    return store.put({
      invoiceId:metadata.objectId,
      companyId:metadata.companyId,
      fileName,
      mimeType:metadata.mimeType,
      bytes,
      pdfSha256:metadata.sha256,
      sizeBytes:metadata.sizeBytes,
      createdAt:metadata.createdAt
    });
  }

  function get(reference){
    if(!isCustomerInvoicePdf(reference))return null;
    return store.get({
      companyId:reference.companyId,
      invoiceId:reference.objectId
    })?.bytes||null;
  }

  function exists(reference){
    if(!isCustomerInvoicePdf(reference))return false;
    return store.exists({
      companyId:reference.companyId,
      invoiceId:reference.objectId
    });
  }

  return Object.freeze({put,get,exists});
}

module.exports=Object.freeze({createSqliteCustomerInvoicePrivateObjectProvider});
