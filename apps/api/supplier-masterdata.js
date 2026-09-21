'use strict';

const crypto=require('node:crypto');
const Payables=require('./payables.js');

function masterdataError(message,code='SUPPLIER_MASTERDATA_ERROR',statusCode=422,details){const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e}
function id(prefix){return `${prefix}_${crypto.randomUUID()}`}
function text(value){return String(value??'').trim()}
function nowIso(){return new Date().toISOString()}
function validAccount(value){return !value||/^\d{4}$/.test(value)}
function normalizePaymentValue(value){return text(value).replace(/\s+/g,' ')}

function hasColumn(db,table,column){return db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column)}
function initializeSupplierMasterdata(db){
  Payables.initializePayables(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS supplier_change_requests(
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('profile','payment-details')),
      changes_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled')),
      requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      requested_at TEXT NOT NULL,
      approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      approved_at TEXT,
      rejected_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      rejected_at TEXT,
      decision_reason TEXT,
      request_key TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS supplier_change_history(
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      request_id TEXT REFERENCES supplier_change_requests(id) ON DELETE SET NULL,
      change_type TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      changed_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_supplier_change_requests_company_status ON supplier_change_requests(company_id,status,requested_at);
    CREATE INDEX IF NOT EXISTS idx_supplier_change_history_supplier ON supplier_change_history(company_id,supplier_id,changed_at);
  `);
  if(!hasColumn(db,'supplier_change_requests','request_key'))db.exec('ALTER TABLE supplier_change_requests ADD COLUMN request_key TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_change_requests_company_key ON supplier_change_requests(company_id,request_key) WHERE request_key IS NOT NULL`);
    if(!hasColumn(db,'supplier_payments','recipient_bankgiro'))db.exec('ALTER TABLE supplier_payments ADD COLUMN recipient_bankgiro TEXT');
  if(!hasColumn(db,'supplier_payments','recipient_plusgiro'))db.exec('ALTER TABLE supplier_payments ADD COLUMN recipient_plusgiro TEXT');
  if(!hasColumn(db,'supplier_payments','recipient_name'))db.exec('ALTER TABLE supplier_payments ADD COLUMN recipient_name TEXT');
}

function publicSupplier(supplier){if(!supplier)return null;return{...supplier,bankgiro:normalizePaymentValue(supplier.bankgiro),plusgiro:normalizePaymentValue(supplier.plusgiro)}}
function snapshot(supplier){return{supplierNumber:supplier.supplierNumber,name:supplier.name,orgNumber:supplier.orgNumber||'',email:supplier.email||'',bankgiro:supplier.bankgiro||'',plusgiro:supplier.plusgiro||'',defaultCostAccount:supplier.defaultCostAccount||''}}
function validateChanges(kind,changes){
  if(!changes||typeof changes!=='object'||Array.isArray(changes))throw masterdataError('Ändringen måste vara ett objekt.','INVALID_SUPPLIER_CHANGE');
  const allowed=kind==='payment-details'?['bankgiro','plusgiro']:['name','orgNumber','email','defaultCostAccount'];
  const clean={};
  for(const key of allowed)if(Object.prototype.hasOwnProperty.call(changes,key))clean[key]=text(changes[key]);
  if(!Object.keys(clean).length)throw masterdataError('Ingen tillåten ändring angavs.','EMPTY_SUPPLIER_CHANGE');
  if(clean.name!==undefined&&(clean.name.length<2||clean.name.length>160))throw masterdataError('Leverantörsnamnet måste vara 2–160 tecken.','INVALID_SUPPLIER_NAME');
  if(clean.defaultCostAccount!==undefined&&!validAccount(clean.defaultCostAccount))throw masterdataError('Standardkontot måste bestå av fyra siffror.','INVALID_SUPPLIER_ACCOUNT');
  if(kind==='payment-details'&&!clean.bankgiro&&!clean.plusgiro)throw masterdataError('Minst ett betalningssätt måste finnas kvar.','PAYMENT_DETAILS_REQUIRED');
  return clean;
}
function validRequestKey(value){return /^[A-Za-z0-9_-]{16,100}$/.test(text(value))}
function requestByKey(db,companyId,requestKey){if(!requestKey)return null;const row=db.prepare(`SELECT id FROM supplier_change_requests WHERE company_id=? AND request_key=?`).get(companyId,requestKey);return row?changeRequestById(db,companyId,row.id):null}
function createChangeRequest(db,{companyId,supplierId,kind,changes,requestedBy,requestKey},{requireRequestKey=false}={}){
  if(!['profile','payment-details'].includes(kind))throw masterdataError('Okänd ändringstyp.','INVALID_SUPPLIER_CHANGE_KIND');
  const supplier=Payables.supplierById(db,companyId,supplierId);if(!supplier)throw masterdataError('Leverantören hittades inte.','SUPPLIER_NOT_FOUND',404);
  const clean=validateChanges(kind,changes),key=text(requestKey);
  if(requireRequestKey&&!validRequestKey(key))throw masterdataError('Ett giltigt request-id krävs för leverantörsändringen.','INVALID_SUPPLIER_REQUEST_ID',422);
  if(key&&!validRequestKey(key))throw masterdataError('Request-id för leverantörsändringen är ogiltigt.','INVALID_SUPPLIER_REQUEST_ID',422);
  if(key){
    const existing=requestByKey(db,companyId,key);
    if(existing){
      const same=existing.supplierId===supplierId&&existing.kind===kind&&existing.requestedBy===requestedBy&&JSON.stringify(existing.changes)===JSON.stringify(clean);
      if(!same)throw masterdataError('Request-id är redan använt för en annan leverantörsändring.','SUPPLIER_IDEMPOTENCY_CONFLICT',409);
      return{request:existing,duplicate:true};
    }
  }
  const current=snapshot(supplier),alreadyApplied=Object.entries(clean).every(([name,value])=>text(current[name])===text(value));
  if(alreadyApplied){
    const row=db.prepare(`SELECT id FROM supplier_change_requests WHERE company_id=? AND supplier_id=? AND kind=? AND status='approved' AND requested_by=? AND changes_json=? ORDER BY requested_at DESC LIMIT 1`).get(companyId,supplierId,kind,requestedBy,JSON.stringify(clean));
    if(row)return{request:changeRequestById(db,companyId,row.id),duplicate:true};
    throw masterdataError(kind==='payment-details'?'Betalningsuppgifterna har redan dessa värden.':'Leverantörsuppgifterna har redan dessa värden.','NO_SUPPLIER_CHANGE',409);
  }
  const requestId=id('schg'),requestedAt=nowIso();
  db.prepare(`INSERT INTO supplier_change_requests(id,company_id,supplier_id,kind,changes_json,status,requested_by,requested_at,request_key) VALUES(?,?,?,?,?,'pending',?,?,?)`).run(requestId,companyId,supplierId,kind,JSON.stringify(clean),requestedBy,requestedAt,key||null);
  const request=kind==='profile'
    ?approveProfileChange(db,{companyId,requestId,actorId:requestedBy})
    :activatePaymentChange(db,{companyId,requestId,actorId:requestedBy});
  return{request,duplicate:false};
}
function requestChange(db,input){return createChangeRequest(db,input).request}
function requestChangeIdempotent(db,input){return createChangeRequest(db,input,{requireRequestKey:true})}
function changeRequestById(db,companyId,requestId){const row=db.prepare(`SELECT id,company_id AS companyId,supplier_id AS supplierId,kind,changes_json AS changesJson,status,requested_by AS requestedBy,requested_at AS requestedAt,approved_by AS approvedBy,approved_at AS approvedAt,rejected_by AS rejectedBy,rejected_at AS rejectedAt,decision_reason AS decisionReason,request_key AS requestKey FROM supplier_change_requests WHERE company_id=? AND id=?`).get(companyId,requestId);return row?{...row,changes:JSON.parse(row.changesJson)}:null}
function listPending(db,companyId){return db.prepare(`SELECT r.id,r.supplier_id AS supplierId,r.kind,r.changes_json AS changesJson,r.status,r.requested_by AS requestedBy,r.requested_at AS requestedAt,s.name AS supplierName,s.supplier_number AS supplierNumber FROM supplier_change_requests r JOIN suppliers s ON s.id=r.supplier_id AND s.company_id=r.company_id WHERE r.company_id=? AND r.status='pending' ORDER BY r.requested_at`).all(companyId).map(row=>({...row,changes:JSON.parse(row.changesJson)}))}
function applyChanges(db,supplier,changes){const next={...snapshot(supplier),...changes};db.prepare(`UPDATE suppliers SET name=?,org_number=?,email=?,bankgiro=?,plusgiro=?,default_cost_account=?,updated_at=? WHERE company_id=? AND id=?`).run(next.name,text(next.orgNumber)||null,text(next.email)||null,text(next.bankgiro)||null,text(next.plusgiro)||null,text(next.defaultCostAccount)||null,nowIso(),supplier.companyId,supplier.id);return Payables.supplierById(db,supplier.companyId,supplier.id)}
function appendHistory(db,{companyId,supplierId,requestId,changeType,before,after,changedBy}){db.prepare(`INSERT INTO supplier_change_history(id,company_id,supplier_id,request_id,change_type,before_json,after_json,changed_by,changed_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(id('shist'),companyId,supplierId,requestId,changeType,JSON.stringify(before),JSON.stringify(after),changedBy,nowIso())}
function approveProfileChange(db,{companyId,requestId,actorId}){const request=changeRequestById(db,companyId,requestId);if(!request||request.kind!=='profile'||request.status!=='pending')throw masterdataError('Profiländringen kan inte behandlas.','INVALID_CHANGE_STATUS',409);const supplier=Payables.supplierById(db,companyId,request.supplierId),before=snapshot(supplier),updated=applyChanges(db,supplier,request.changes),after=snapshot(updated),time=nowIso();db.prepare(`UPDATE supplier_change_requests SET status='approved',approved_by=?,approved_at=? WHERE company_id=? AND id=?`).run(actorId,time,companyId,requestId);appendHistory(db,{companyId,supplierId:supplier.id,requestId,changeType:'profile',before,after,changedBy:actorId});return changeRequestById(db,companyId,requestId)}
function activatePaymentChange(db,{companyId,requestId,actorId}){const request=changeRequestById(db,companyId,requestId);if(!request||request.kind!=='payment-details'||request.status!=='pending')throw masterdataError('Betalningsändringen kan inte behandlas.','INVALID_CHANGE_STATUS',409);const supplier=Payables.supplierById(db,companyId,request.supplierId),before=snapshot(supplier),updated=applyChanges(db,supplier,request.changes),after=snapshot(updated),time=nowIso();db.prepare(`UPDATE supplier_change_requests SET status='approved',approved_by=?,approved_at=? WHERE company_id=? AND id=?`).run(actorId,time,companyId,requestId);appendHistory(db,{companyId,supplierId:supplier.id,requestId,changeType:'payment-details',before,after,changedBy:actorId});return changeRequestById(db,companyId,requestId)}
function approvePaymentChange(db,{companyId,requestId,approvedBy}){const request=changeRequestById(db,companyId,requestId);if(!request)throw masterdataError('Ändringsbegäran hittades inte.','CHANGE_NOT_FOUND',404);if(request.kind!=='payment-details'||request.status!=='pending')throw masterdataError('Betalningsändringen kan inte godkännas.','INVALID_CHANGE_STATUS',409);if(request.requestedBy===approvedBy)throw masterdataError('En annan person måste godkänna ändringen av betalningsuppgifter.','SEPARATION_OF_DUTIES_FAILED',409);const supplier=Payables.supplierById(db,companyId,request.supplierId),before=snapshot(supplier),updated=applyChanges(db,supplier,request.changes),after=snapshot(updated),time=nowIso();db.prepare(`UPDATE supplier_change_requests SET status='approved',approved_by=?,approved_at=? WHERE company_id=? AND id=?`).run(approvedBy,time,companyId,requestId);appendHistory(db,{companyId,supplierId:supplier.id,requestId,changeType:'payment-details',before,after,changedBy:approvedBy});return{request:changeRequestById(db,companyId,requestId),supplier:publicSupplier(updated)}}
function rejectPaymentChange(db,{companyId,requestId,rejectedBy,reason}){const request=changeRequestById(db,companyId,requestId);if(!request)throw masterdataError('Ändringsbegäran hittades inte.','CHANGE_NOT_FOUND',404);if(request.kind!=='payment-details'||request.status!=='pending')throw masterdataError('Betalningsändringen kan inte avvisas.','INVALID_CHANGE_STATUS',409);const time=nowIso();db.prepare(`UPDATE supplier_change_requests SET status='rejected',rejected_by=?,rejected_at=?,decision_reason=? WHERE company_id=? AND id=?`).run(rejectedBy,time,text(reason).slice(0,500)||null,companyId,requestId);return changeRequestById(db,companyId,requestId)}
function history(db,companyId,supplierId){return db.prepare(`SELECT id,request_id AS requestId,change_type AS changeType,before_json AS beforeJson,after_json AS afterJson,changed_by AS changedBy,changed_at AS changedAt FROM supplier_change_history WHERE company_id=? AND supplier_id=? ORDER BY changed_at DESC`).all(companyId,supplierId).map(row=>({...row,before:JSON.parse(row.beforeJson),after:JSON.parse(row.afterJson)}))}
function snapshotPaymentRecipient(db,{companyId,paymentId}){const row=db.prepare(`SELECT p.id,p.status,i.supplier_id AS supplierId,s.name,s.bankgiro,s.plusgiro FROM supplier_payments p JOIN supplier_invoices i ON i.id=p.supplier_invoice_id AND i.company_id=p.company_id JOIN suppliers s ON s.id=i.supplier_id AND s.company_id=i.company_id WHERE p.company_id=? AND p.id=?`).get(companyId,paymentId);if(!row)throw masterdataError('Betalningen hittades inte.','PAYMENT_NOT_FOUND',404);if(!row.bankgiro&&!row.plusgiro)throw masterdataError('Leverantören saknar betalningsuppgifter.','SUPPLIER_PAYMENT_DETAILS_MISSING',409);db.prepare(`UPDATE supplier_payments SET recipient_name=?,recipient_bankgiro=?,recipient_plusgiro=? WHERE company_id=? AND id=?`).run(row.name,row.bankgiro||null,row.plusgiro||null,companyId,paymentId);return{recipientName:row.name,recipientBankgiro:row.bankgiro||'',recipientPlusgiro:row.plusgiro||''}}

module.exports=Object.freeze({initializeSupplierMasterdata,requestChange,requestChangeIdempotent,changeRequestById,listPending,approvePaymentChange,rejectPaymentChange,history,snapshotPaymentRecipient,validateChanges,validRequestKey});
