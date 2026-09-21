'use strict';

const PrivateObject=require('./private-object-contract.js');

const TARGET_PROVIDERS=Object.freeze(['r2','s3']);

function copyError(message,code='PRIVATE_OBJECT_COPY_ERROR'){
  const error=new Error(message);
  error.code=code;
  return error;
}

function normalizeTargetProvider(value){
  const provider=String(value??'').trim().toLowerCase();
  if(!TARGET_PROVIDERS.includes(provider)){
    throw copyError(
      `Extern objektprovider "${provider}" är inte godkänd som migrationstarget.`,
      'PRIVATE_OBJECT_COPY_PROVIDER_UNSUPPORTED'
    );
  }
  return provider;
}

function nowIso(){
  return new Date().toISOString();
}

function initializePrivateObjectCopyLedger(db){
  if(!db)throw copyError('Databas krävs för objektkopieringsledger.','PRIVATE_OBJECT_COPY_DB_REQUIRED');
  db.exec(`
    CREATE TABLE IF NOT EXISTS private_object_copies(
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('document','supplier-invoice','customer-invoice-pdf')),
      object_id TEXT NOT NULL,
      sha256 TEXT NOT NULL CHECK(length(sha256)=64),
      provider TEXT NOT NULL CHECK(provider IN ('r2','s3')),
      logical_key TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK(size_bytes>0),
      source_created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','failed','ready')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
      last_error TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(company_id,kind,object_id,sha256,provider),
      UNIQUE(provider,storage_key),
      CHECK((status='failed')=(last_error IS NOT NULL)),
      CHECK((status='ready')=(verified_at IS NOT NULL))
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_private_object_copies_status
      ON private_object_copies(provider,status,updated_at);

    CREATE TRIGGER IF NOT EXISTS private_object_copy_identity_immutable
    BEFORE UPDATE ON private_object_copies
    WHEN NEW.company_id IS NOT OLD.company_id
      OR NEW.kind IS NOT OLD.kind
      OR NEW.object_id IS NOT OLD.object_id
      OR NEW.sha256 IS NOT OLD.sha256
      OR NEW.provider IS NOT OLD.provider
      OR NEW.logical_key IS NOT OLD.logical_key
      OR NEW.storage_key IS NOT OLD.storage_key
      OR NEW.mime_type IS NOT OLD.mime_type
      OR NEW.size_bytes IS NOT OLD.size_bytes
      OR NEW.source_created_at IS NOT OLD.source_created_at
      OR NEW.created_at IS NOT OLD.created_at
    BEGIN
      SELECT RAISE(ABORT,'PRIVATE_OBJECT_COPY_IDENTITY_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS private_object_copy_ready_final
    BEFORE UPDATE ON private_object_copies
    WHEN OLD.status='ready'
    BEGIN
      SELECT RAISE(ABORT,'PRIVATE_OBJECT_COPY_READY_IMMUTABLE');
    END;
  `);
}

function externalStorageKey(metadata){
  const normalized=PrivateObject.createPrivateObjectMetadata(metadata);
  return `${normalized.objectKey}/${normalized.sha256}`;
}

function rowToCopy(row){
  if(!row)return null;
  return Object.freeze({
    companyId:row.companyId,
    kind:row.kind,
    objectId:row.objectId,
    sha256:row.sha256,
    provider:row.provider,
    logicalKey:row.logicalKey,
    storageKey:row.storageKey,
    mimeType:row.mimeType,
    sizeBytes:row.sizeBytes,
    sourceCreatedAt:row.sourceCreatedAt,
    status:row.status,
    attemptCount:row.attemptCount,
    lastError:row.lastError,
    verifiedAt:row.verifiedAt,
    createdAt:row.createdAt,
    updatedAt:row.updatedAt
  });
}

function copyByIdentity(db,{companyId,kind,objectId,sha256,provider}){
  const row=db.prepare(`SELECT
    company_id AS companyId,kind,object_id AS objectId,sha256,provider,
    logical_key AS logicalKey,storage_key AS storageKey,mime_type AS mimeType,
    size_bytes AS sizeBytes,source_created_at AS sourceCreatedAt,status,
    attempt_count AS attemptCount,last_error AS lastError,verified_at AS verifiedAt,
    created_at AS createdAt,updated_at AS updatedAt
    FROM private_object_copies
    WHERE company_id=? AND kind=? AND object_id=? AND sha256=? AND provider=?`)
    .get(companyId,kind,objectId,String(sha256??'').toLowerCase(),normalizeTargetProvider(provider));
  return rowToCopy(row);
}

function planPrivateObjectCopy(db,{metadata,provider,createdAt=nowIso()}={}){
  if(!db)throw copyError('Databas krävs för objektkopiering.','PRIVATE_OBJECT_COPY_DB_REQUIRED');
  const normalized=PrivateObject.createPrivateObjectMetadata(metadata);
  const target=normalizeTargetProvider(provider);
  const storageKey=externalStorageKey(normalized);
  const existing=copyByIdentity(db,{
    companyId:normalized.companyId,
    kind:normalized.kind,
    objectId:normalized.objectId,
    sha256:normalized.sha256,
    provider:target
  });

  if(existing){
    const matches=
      existing.logicalKey===normalized.objectKey&&
      existing.storageKey===storageKey&&
      existing.mimeType===normalized.mimeType&&
      existing.sizeBytes===normalized.sizeBytes&&
      existing.sourceCreatedAt===normalized.createdAt;
    if(!matches){
      throw copyError('Befintlig kopieringsplan matchar inte objektets metadata.','PRIVATE_OBJECT_COPY_CONFLICT');
    }
    return existing;
  }

  const created=String(createdAt);
  db.prepare(`INSERT INTO private_object_copies(
    company_id,kind,object_id,sha256,provider,logical_key,storage_key,mime_type,size_bytes,
    source_created_at,status,attempt_count,last_error,verified_at,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',0,NULL,NULL,?,?)`).run(
    normalized.companyId,
    normalized.kind,
    normalized.objectId,
    normalized.sha256,
    target,
    normalized.objectKey,
    storageKey,
    normalized.mimeType,
    normalized.sizeBytes,
    normalized.createdAt,
    created,
    created
  );

  return copyByIdentity(db,{
    companyId:normalized.companyId,
    kind:normalized.kind,
    objectId:normalized.objectId,
    sha256:normalized.sha256,
    provider:target
  });
}

function requireCopy(db,identity){
  const copy=copyByIdentity(db,identity);
  if(!copy)throw copyError('Objektkopieringsplanen hittades inte.','PRIVATE_OBJECT_COPY_NOT_FOUND');
  return copy;
}

function startCopyAttempt(db,identity,{updatedAt=nowIso()}={}){
  const current=requireCopy(db,identity);
  if(current.status==='ready')return current;
  db.prepare(`UPDATE private_object_copies
    SET status='pending',attempt_count=attempt_count+1,last_error=NULL,verified_at=NULL,updated_at=?
    WHERE company_id=? AND kind=? AND object_id=? AND sha256=? AND provider=?`).run(
    String(updatedAt),
    current.companyId,current.kind,current.objectId,current.sha256,current.provider
  );
  return requireCopy(db,identity);
}

function markCopyFailed(db,identity,{message,updatedAt=nowIso()}={}){
  const current=requireCopy(db,identity);
  if(current.status==='ready'){
    throw copyError('En verifierad extern kopia kan inte markeras som misslyckad.','PRIVATE_OBJECT_COPY_READY_IMMUTABLE');
  }
  const errorMessage=String(message??'').trim().slice(0,1000);
  if(!errorMessage)throw copyError('Felorsak krävs för misslyckad objektkopiering.','PRIVATE_OBJECT_COPY_FAILURE_REASON_REQUIRED');
  db.prepare(`UPDATE private_object_copies
    SET status='failed',last_error=?,verified_at=NULL,updated_at=?
    WHERE company_id=? AND kind=? AND object_id=? AND sha256=? AND provider=?`).run(
    errorMessage,String(updatedAt),
    current.companyId,current.kind,current.objectId,current.sha256,current.provider
  );
  return requireCopy(db,identity);
}

function markCopyReady(db,identity,{verifiedAt=nowIso()}={}){
  const current=requireCopy(db,identity);
  if(current.status==='ready')return current;
  const verified=String(verifiedAt);
  db.prepare(`UPDATE private_object_copies
    SET status='ready',last_error=NULL,verified_at=?,updated_at=?
    WHERE company_id=? AND kind=? AND object_id=? AND sha256=? AND provider=?`).run(
    verified,verified,
    current.companyId,current.kind,current.objectId,current.sha256,current.provider
  );
  return requireCopy(db,identity);
}

function copiesForCompany(db,companyId){
  return db.prepare(`SELECT
    company_id AS companyId,kind,object_id AS objectId,sha256,provider,
    logical_key AS logicalKey,storage_key AS storageKey,mime_type AS mimeType,
    size_bytes AS sizeBytes,source_created_at AS sourceCreatedAt,status,
    attempt_count AS attemptCount,last_error AS lastError,verified_at AS verifiedAt,
    created_at AS createdAt,updated_at AS updatedAt
    FROM private_object_copies
    WHERE company_id=?
    ORDER BY kind,object_id,sha256,provider`).all(companyId).map(rowToCopy);
}

module.exports=Object.freeze({
  TARGET_PROVIDERS,
  normalizeTargetProvider,
  initializePrivateObjectCopyLedger,
  externalStorageKey,
  planPrivateObjectCopy,
  copyByIdentity,
  startCopyAttempt,
  markCopyFailed,
  markCopyReady,
  copiesForCompany
});
