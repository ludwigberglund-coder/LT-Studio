'use strict';

const ArchiveStore=require('./payment-reminder-pdf-archive-store.js');
const PrivateObject=require('./private-object-contract.js');

function archiveFileName(db,companyId,reminderId){
  const row=db.prepare('SELECT reminder_number AS reminderNumber,pdf_file_name AS pdfFileName FROM invoice_reminders WHERE company_id=? AND id=?').get(companyId,reminderId);
  if(!row)return null;
  return row.pdfFileName||('Betalningspaminnelse-'+String(row.reminderNumber||reminderId).replace(/[^0-9A-Za-z_-]/g,'_')+'.pdf');
}
function createSqlitePaymentReminderPrivateObjectProvider(db){
  const store=ArchiveStore.createSqlitePaymentReminderPdfArchiveStore(db);
  function valid(reference){return reference?.kind===PrivateObject.PRIVATE_OBJECT_KINDS.PAYMENT_REMINDER_PDF}
  function put({metadata,bytes}){
    if(!valid(metadata))return false;
    const fileName=archiveFileName(db,metadata.companyId,metadata.objectId);if(!fileName)return false;
    return store.put({reminderId:metadata.objectId,companyId:metadata.companyId,fileName,mimeType:metadata.mimeType,bytes,pdfSha256:metadata.sha256,sizeBytes:metadata.sizeBytes,createdAt:metadata.createdAt});
  }
  function get(reference){if(!valid(reference))return null;return store.get({companyId:reference.companyId,reminderId:reference.objectId})?.bytes||null}
  function exists(reference){if(!valid(reference))return false;return store.exists({companyId:reference.companyId,reminderId:reference.objectId})}
  return Object.freeze({put,get,exists});
}
module.exports=Object.freeze({createSqlitePaymentReminderPrivateObjectProvider});
