'use strict';

function createSqliteDocumentContentStore(db) {
  if (!db) throw new Error('Databas krävs för dokumentlagring.');

  function put({companyId,documentId,bytes}) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) return false;
    const result=db.prepare(`UPDATE documents
      SET content_blob=?
      WHERE company_id=? AND id=? AND status='pending'`).run(bytes,companyId,documentId);
    return result.changes===1;
  }

  function get({companyId,documentId}) {
    const row=db.prepare(`SELECT content_blob AS bytes
      FROM documents
      WHERE company_id=? AND id=?`).get(companyId,documentId);
    return row?.bytes ? Buffer.from(row.bytes) : null;
  }

  function exists({companyId,documentId}) {
    return Boolean(db.prepare(`SELECT 1 AS present
      FROM documents
      WHERE company_id=? AND id=? AND content_blob IS NOT NULL`).get(companyId,documentId));
  }

  return Object.freeze({put,get,exists});
}

module.exports=Object.freeze({createSqliteDocumentContentStore});
