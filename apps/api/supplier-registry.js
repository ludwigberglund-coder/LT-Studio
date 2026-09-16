'use strict';

const crypto=require('node:crypto');

function registryError(message,code='SUPPLIER_REGISTRY_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function id(prefix){return `${prefix}_${crypto.randomUUID()}`}
function text(v){return String(v??'').trim()}
function json(v,fallback){try{return JSON.parse(v)}catch{return fallback}}
function validAccount(v){return /^\d{4}$/.test(text(v))}
function validEmail(v){const value=text(v);return !value||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)}
function cleanPaymentNumber(v){return text(v).replace(/\s+/g,' ').slice(0,40)}

function initializeSupplierRegistry(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS supplier_history(
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      changes_json TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS supplier_bank_change_requests(
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      proposed_bankgiro TEXT,
      proposed_plusgiro TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled')),
      requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      requested_at TEXT NOT NULL,
      decided_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      decided_at TEXT,
      decision_reason TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_supplier_history_company_supplier ON supplier_history(company_id,supplier_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_supplier_bank_change_company_status ON supplier_bank_change_requests(company_id,status,requested_at);
  `);
}

function supplier(db,companyId,supplierId){return db.prepare(`SELECT id,company_id AS companyId,supplier_number AS supplierNumber,name,org_number AS orgNumber,email,bankgiro,plusgiro,default_cost_account AS defaultCostAccount,created_at AS createdAt,updated_at AS updatedAt FROM suppliers WHERE company_id=? AND id=?`).get(companyId,supplierId)||null}
function appendHistory(db,{companyId,supplierId,action,changes,actorId}){const historyId=id('shist'),createdAt=new Date().toISOString();db.prepare(`INSERT INTO supplier_history(id,company_id,supplier_id,action,changes_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?)`).run(historyId,companyId,supplierId,action,JSON.stringify(changes||{}),actorId,createdAt);return{historyId,createdAt}}
function listHistory(db,companyId,supplierId){return db.prepare(`SELECT id,action,changes_json AS changesJson,actor_id AS actorId,created_at AS createdAt FROM supplier_history WHERE company_id=? AND supplier_id=? ORDER BY created_at DESC,id DESC`).all(companyId,supplierId).map(row=>({...row,changes:json(row.changesJson,{})}))}

function updateProfile(db,{companyId,supplierId,patch,actorId}){
  const current=supplier(db,companyId,supplierId);if(!current)throw registryError('Leverantören hittades inte.','SUPPLIER_NOT_FOUND',404);
  const allowed={name:current.name,orgNumber:current.orgNumber||'',email:current.email||'',defaultCostAccount:current.defaultCostAccount||''};
  if(Object.hasOwn(patch||{},'name'))allowed.name=text(patch.name);
  if(Object.hasOwn(patch||{},'orgNumber'))allowed.orgNumber=text(patch.orgNumber);
  if(Object.hasOwn(patch||{},'email'))allowed.email=text(patch.email);
  if(Object.hasOwn(patch||{},'defaultCostAccount'))allowed.defaultCostAccount=text(patch.defaultCostAccount);
  if(allowed.name.length<2||allowed.name.length>160)throw registryError('Leverantörens namn måste vara 2–160 tecken.','INVALID_SUPPLIER_NAME');
  if(allowed.orgNumber.length>30)throw registryError('Organisationsnumret är för långt.','INVALID_SUPPLIER_ORG_NUMBER');
  if(!validEmail(allowed.email)||allowed.email.length>200)throw registryError('E-postadressen är ogiltig.','INVALID_SUPPLIER_EMAIL');
  if(allowed.defaultCostAccount&&!validAccount(allowed.defaultCostAccount))throw registryError('Standardkontot måste bestå av fyra siffror.','INVALID_SUPPLIER_ACCOUNT');
  const changes={};for(const key of Object.keys(allowed)){const before=text(current[key]);const after=text(allowed[key]);if(before!==after)changes[key]={before,after}}
  if(!Object.keys(changes).length)return{supplier:current,changed:false};
  const now=new Date().toISOString();
  db.prepare(`UPDATE suppliers SET name=?,org_number=?,email=?,default_cost_account=?,updated_at=? WHERE company_id=? AND id=?`).run(allowed.name,allowed.orgNumber||null,allowed.email||null,allowed.defaultCostAccount||null,now,companyId,supplierId);
  appendHistory(db,{companyId,supplierId,action:'SUPPLIER_PROFILE_UPDATED',changes,actorId});
  return{supplier:supplier(db,companyId,supplierId),changed:true,changes};
}

function pendingForSupplier(db,companyId,supplierId){return db.prepare(`SELECT id,company_id AS companyId,supplier_id AS supplierId,proposed_bankgiro AS proposedBankgiro,proposed_plusgiro AS proposedPlusgiro,status,requested_by AS requestedBy,requested_at AS requestedAt,decided_by AS decidedBy,decided_at AS decidedAt,decision_reason AS decisionReason FROM supplier_bank_change_requests WHERE company_id=? AND supplier_id=? AND status='pending' ORDER BY requested_at DESC LIMIT 1`).get(companyId,supplierId)||null}
function bankChangeById(db,companyId,requestId){return db.prepare(`SELECT id,company_id AS companyId,supplier_id AS supplierId,proposed_bankgiro AS proposedBankgiro,proposed_plusgiro AS proposedPlusgiro,status,requested_by AS requestedBy,requested_at AS requestedAt,decided_by AS decidedBy,decided_at AS decidedAt,decision_reason AS decisionReason FROM supplier_bank_change_requests WHERE company_id=? AND id=?`).get(companyId,requestId)||null}
function listBankChanges(db,companyId,{status='pending'}={}){const allowed=['pending','approved','rejected','cancelled','all'];const filter=allowed.includes(status)?status:'pending';const sql=`SELECT r.id,r.company_id AS companyId,r.supplier_id AS supplierId,r.proposed_bankgiro AS proposedBankgiro,r.proposed_plusgiro AS proposedPlusgiro,r.status,r.requested_by AS requestedBy,r.requested_at AS requestedAt,r.decided_by AS decidedBy,r.decided_at AS decidedAt,r.decision_reason AS decisionReason,s.supplier_number AS supplierNumber,s.name AS supplierName,s.bankgiro AS currentBankgiro,s.plusgiro AS currentPlusgiro FROM supplier_bank_change_requests r JOIN suppliers s ON s.id=r.supplier_id AND s.company_id=r.company_id WHERE r.company_id=?${filter==='all'?'':' AND r.status=?'} ORDER BY r.requested_at DESC`;return filter==='all'?db.prepare(sql).all(companyId):db.prepare(sql).all(companyId,filter)}

function requestBankChange(db,{companyId,supplierId,bankgiro,plusgiro,requestedBy}){
  const current=supplier(db,companyId,supplierId);if(!current)throw registryError('Leverantören hittades inte.','SUPPLIER_NOT_FOUND',404);
  if(pendingForSupplier(db,companyId,supplierId))throw registryError('Det finns redan en väntande ändring av betalningsuppgifter.','BANK_CHANGE_ALREADY_PENDING',409);
  const nextBankgiro=cleanPaymentNumber(bankgiro),nextPlusgiro=cleanPaymentNumber(plusgiro);
  if(!nextBankgiro&&!nextPlusgiro)throw registryError('Bankgiro eller plusgiro måste anges.','PAYMENT_DETAILS_REQUIRED');
  if(nextBankgiro===text(current.bankgiro)&&nextPlusgiro===text(current.plusgiro))throw registryError('De föreslagna betalningsuppgifterna är redan aktiva.','BANK_DETAILS_UNCHANGED');
  const requestId=id('sbank'),requestedAt=new Date().toISOString();
  db.prepare(`INSERT INTO supplier_bank_change_requests(id,company_id,supplier_id,proposed_bankgiro,proposed_plusgiro,status,requested_by,requested_at) VALUES(?,?,?,?,?,'pending',?,?)`).run(requestId,companyId,supplierId,nextBankgiro||null,nextPlusgiro||null,requestedBy,requestedAt);
  appendHistory(db,{companyId,supplierId,action:'SUPPLIER_BANK_CHANGE_REQUESTED',changes:{bankgiro:{before:text(current.bankgiro),after:nextBankgiro},plusgiro:{before:text(current.plusgiro),after:nextPlusgiro},requestId},actorId:requestedBy});
  return bankChangeById(db,companyId,requestId);
}
function decideBankChange(db,{companyId,requestId,actorId,decision,reason=''}){
  const request=bankChangeById(db,companyId,requestId);if(!request)throw registryError('Ändringsbegäran hittades inte.','BANK_CHANGE_NOT_FOUND',404);
  if(request.status!=='pending')throw registryError('Ändringsbegäran är redan behandlad.','BANK_CHANGE_ALREADY_DECIDED',409);
  if(request.requestedBy===actorId)throw registryError('Den som begärde ändringen får inte godkänna eller avslå den själv.','SEPARATION_OF_DUTIES_FAILED',409);
  if(!['approved','rejected'].includes(decision))throw registryError('Beslutet är ogiltigt.','INVALID_BANK_CHANGE_DECISION');
  const current=supplier(db,companyId,request.supplierId);if(!current)throw registryError('Leverantören hittades inte.','SUPPLIER_NOT_FOUND',404);
  const decidedAt=new Date().toISOString();
  if(decision==='approved')db.prepare(`UPDATE suppliers SET bankgiro=?,plusgiro=?,updated_at=? WHERE company_id=? AND id=?`).run(request.proposedBankgiro||null,request.proposedPlusgiro||null,decidedAt,companyId,request.supplierId);
  db.prepare(`UPDATE supplier_bank_change_requests SET status=?,decided_by=?,decided_at=?,decision_reason=? WHERE company_id=? AND id=? AND status='pending'`).run(decision,actorId,decidedAt,text(reason).slice(0,500)||null,companyId,requestId);
  appendHistory(db,{companyId,supplierId:request.supplierId,action:decision==='approved'?'SUPPLIER_BANK_CHANGE_APPROVED':'SUPPLIER_BANK_CHANGE_REJECTED',changes:{requestId,bankgiro:{before:text(current.bankgiro),after:request.proposedBankgiro||''},plusgiro:{before:text(current.plusgiro),after:request.proposedPlusgiro||''},reason:text(reason)},actorId});
  return{request:bankChangeById(db,companyId,requestId),supplier:supplier(db,companyId,request.supplierId)};
}

module.exports=Object.freeze({initializeSupplierRegistry,supplier,updateProfile,listHistory,pendingForSupplier,bankChangeById,listBankChanges,requestBankChange,decideBankChange});
