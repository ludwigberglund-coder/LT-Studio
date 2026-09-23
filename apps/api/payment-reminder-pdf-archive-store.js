'use strict';

function createSqlitePaymentReminderPdfArchiveStore(db){
  if(!db)throw new Error('Databas krävs för betalningspåminnelsens PDF-arkiv.');
  db.exec(`CREATE TABLE IF NOT EXISTS payment_reminder_pdf_archives(
    reminder_id TEXT PRIMARY KEY REFERENCES invoice_reminders(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/pdf' CHECK(mime_type='application/pdf'),
    pdf_blob BLOB NOT NULL,
    pdf_sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK(size_bytes>0),
    created_at TEXT NOT NULL,
    UNIQUE(company_id,reminder_id)
  ) STRICT;`);
  function put({reminderId,companyId,fileName,mimeType='application/pdf',bytes,pdfSha256,sizeBytes,createdAt}){
    if(!Buffer.isBuffer(bytes)||!bytes.length)return false;
    db.prepare('INSERT INTO payment_reminder_pdf_archives(reminder_id,company_id,file_name,mime_type,pdf_blob,pdf_sha256,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(reminderId,companyId,fileName,mimeType,bytes,pdfSha256,sizeBytes,createdAt);
    return true;
  }
  function get({companyId,reminderId}){
    const row=db.prepare('SELECT file_name AS fileName,mime_type AS mimeType,pdf_blob AS bytes,pdf_sha256 AS pdfSha256,size_bytes AS sizeBytes,created_at AS createdAt FROM payment_reminder_pdf_archives WHERE company_id=? AND reminder_id=?').get(companyId,reminderId);
    return row?{...row,bytes:Buffer.from(row.bytes||[])}:null;
  }
  function exists({companyId,reminderId}){return Boolean(db.prepare('SELECT 1 AS present FROM payment_reminder_pdf_archives WHERE company_id=? AND reminder_id=?').get(companyId,reminderId))}
  return Object.freeze({put,get,exists});
}
module.exports=Object.freeze({createSqlitePaymentReminderPdfArchiveStore});
