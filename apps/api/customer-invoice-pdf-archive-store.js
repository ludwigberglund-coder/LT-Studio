'use strict';

function createSqliteCustomerInvoicePdfArchiveStore(db) {
  if (!db) throw new Error('Databas krävs för kundfakturans PDF-arkiv.');

  function put({invoiceId,companyId,fileName,mimeType='application/pdf',bytes,pdfSha256,sizeBytes,createdAt}) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) return false;
    db.prepare(`INSERT INTO customer_invoice_pdf_archives(
      invoice_id,company_id,file_name,mime_type,pdf_blob,pdf_sha256,size_bytes,created_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(invoiceId,companyId,fileName,mimeType,bytes,pdfSha256,sizeBytes,createdAt);
    return true;
  }

  function get({companyId,invoiceId}) {
    const row=db.prepare(`SELECT file_name AS fileName,mime_type AS mimeType,pdf_blob AS bytes,
      pdf_sha256 AS pdfSha256,size_bytes AS sizeBytes,created_at AS createdAt
      FROM customer_invoice_pdf_archives
      WHERE company_id=? AND invoice_id=?`).get(companyId,invoiceId);
    return row?{...row,bytes:Buffer.from(row.bytes||[])}:null;
  }

  function exists({companyId,invoiceId}) {
    return Boolean(db.prepare(`SELECT 1 AS present
      FROM customer_invoice_pdf_archives
      WHERE company_id=? AND invoice_id=?`).get(companyId,invoiceId));
  }

  return Object.freeze({put,get,exists});
}

module.exports=Object.freeze({createSqliteCustomerInvoicePdfArchiveStore});
