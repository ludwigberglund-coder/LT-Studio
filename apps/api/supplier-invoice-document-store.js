'use strict';

function createSqliteSupplierInvoiceDocumentStore(db) {
  if (!db) throw new Error('Databas krävs för leverantörsfakturans dokumentlagring.');

  function put({companyId,invoiceId,bytes}) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) return false;
    const result=db.prepare(`UPDATE supplier_invoices
      SET document_blob=?
      WHERE company_id=? AND id=? AND status IN ('registered','coding-review','coded')`).run(bytes,companyId,invoiceId);
    return result.changes===1;
  }

  function get({companyId,invoiceId}) {
    const row=db.prepare(`SELECT document_blob AS bytes
      FROM supplier_invoices
      WHERE company_id=? AND id=?`).get(companyId,invoiceId);
    return row?.bytes ? Buffer.from(row.bytes) : null;
  }

  function exists({companyId,invoiceId}) {
    return Boolean(db.prepare(`SELECT 1 AS present
      FROM supplier_invoices
      WHERE company_id=? AND id=? AND document_blob IS NOT NULL`).get(companyId,invoiceId));
  }

  return Object.freeze({put,get,exists});
}

module.exports=Object.freeze({createSqliteSupplierInvoiceDocumentStore});
