'use strict';

function paymentError(message,code='PAYMENT_RELEASE_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function nowIso(){return new Date().toISOString()}
function paymentById(db,companyId,paymentId){return db.prepare(`SELECT id,company_id AS companyId,supplier_invoice_id AS supplierInvoiceId,payment_date AS paymentDate,amount_ore AS amountOre,account,status,prepared_by AS preparedBy,released_by AS releasedBy,released_at AS releasedAt FROM supplier_payments WHERE company_id=? AND id=?`).get(companyId,paymentId)||null}
function releasePayment(db,{companyId,paymentId,releasedBy}){
  const payment=paymentById(db,companyId,paymentId);
  if(!payment)throw paymentError('Betalningen hittades inte.','PAYMENT_NOT_FOUND',404);
  if(payment.status!=='prepared')throw paymentError('Endast en förberedd betalning kan frisläppas.','INVALID_PAYMENT_STATUS',409);
  if(!releasedBy)throw paymentError('Personlig användaridentitet krävs.','PERSONAL_IDENTITY_REQUIRED',401);
  const releasedAt=nowIso();
  const result=db.prepare(`UPDATE supplier_payments SET status='released',released_by=?,released_at=?,updated_at=? WHERE company_id=? AND id=? AND status='prepared'`).run(releasedBy,releasedAt,releasedAt,companyId,paymentId);
  if(result.changes!==1)throw paymentError('Betalningen ändrades av någon annan och kunde inte frisläppas.','PAYMENT_RELEASE_CONFLICT',409);
  return paymentById(db,companyId,paymentId);
}
module.exports=Object.freeze({paymentById,releasePayment});
