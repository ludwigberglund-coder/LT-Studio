'use strict';

const PrivateObject=require('./private-object-contract.js');
const StoreContract=require('./private-object-store-contract.js');
const StoreFactory=require('./private-object-store-factory.js');
const Ledger=require('./private-object-copy-ledger.js');

function workerError(message,code='PRIVATE_OBJECT_COPY_WORKER_ERROR',cause){
  const error=new Error(message);
  error.code=code;
  if(cause){
    error.cause=cause;
    error.causeCode=cause?.code||'';
  }
  return error;
}

function assertTargetStore(targetStore){
  if(!targetStore||typeof targetStore!=='object'){
    throw workerError('Extern staging-lagring saknas.','PRIVATE_OBJECT_COPY_TARGET_REQUIRED');
  }
  for(const method of ['put','get']){
    if(typeof targetStore[method]!=='function'){
      throw workerError(
        `Extern staging-lagring saknar ${method}().`,
        'PRIVATE_OBJECT_COPY_TARGET_INVALID'
      );
    }
  }
  return targetStore;
}

function metadataFromCopy(copy){
  return PrivateObject.createPrivateObjectMetadata({
    companyId:copy.companyId,
    kind:copy.kind,
    objectId:copy.objectId,
    mimeType:copy.mimeType,
    sizeBytes:copy.sizeBytes,
    sha256:copy.sha256,
    createdAt:copy.sourceCreatedAt
  });
}

function identityFromCopy(copy){
  return Object.freeze({
    companyId:copy.companyId,
    kind:copy.kind,
    objectId:copy.objectId,
    sha256:copy.sha256,
    provider:copy.provider
  });
}

function safeFailureReason(error){
  const code=String(error?.code||'PRIVATE_OBJECT_COPY_ATTEMPT_ERROR')
    .replace(/[^A-Z0-9_-]/gi,'')
    .slice(0,120)||'PRIVATE_OBJECT_COPY_ATTEMPT_ERROR';
  return `Kopieringsförsöket misslyckades (${code}).`;
}

async function copyPlannedPrivateObject(db,identity,{targetStore,sourceProvider='sqlite'}={}){
  if(!db)throw workerError('Databas krävs för objektkopiering.','PRIVATE_OBJECT_COPY_WORKER_DB_REQUIRED');
  const target=assertTargetStore(targetStore);
  const existing=Ledger.copyByIdentity(db,identity);
  if(!existing)throw workerError('Kopieringsplanen hittades inte.','PRIVATE_OBJECT_COPY_NOT_FOUND');
  if(existing.status==='ready'){
    return Object.freeze({duplicate:true,copy:existing});
  }

  const started=Ledger.startCopyAttempt(db,identity);
  const stableIdentity=identityFromCopy(started);
  const metadata=metadataFromCopy(started);

  try{
    const sourceStore=StoreFactory.createPrivateObjectStore({
      db,
      kind:started.kind,
      provider:sourceProvider
    });
    const sourceBytes=sourceStore.get({
      companyId:started.companyId,
      kind:started.kind,
      objectId:started.objectId
    });
    const normalized=StoreContract.normalizePutRequest({metadata,bytes:sourceBytes});

    const expectedStorageKey=`${metadata.objectKey}/${metadata.sha256}`;
    if(started.storageKey!==expectedStorageKey){
      throw workerError(
        'Ledgerns fysiska lagringsnyckel matchar inte objektets verifierade identitet.',
        'PRIVATE_OBJECT_COPY_STORAGE_KEY_MISMATCH'
      );
    }

    const putResult=await target.put({
      storageKey:started.storageKey,
      metadata,
      bytes:normalized.bytes
    });
    if(putResult===false){
      throw workerError('Extern staging-lagring avvisade objektet.','PRIVATE_OBJECT_COPY_TARGET_PUT_FAILED');
    }

    const readBack=await target.get({
      storageKey:started.storageKey,
      metadata
    });
    StoreContract.normalizePutRequest({metadata,bytes:readBack});

    const ready=Ledger.markCopyReady(db,stableIdentity);
    return Object.freeze({duplicate:false,copy:ready});
  }catch(error){
    try{
      const latest=Ledger.copyByIdentity(db,stableIdentity);
      if(latest&&latest.status!=='ready'){
        Ledger.markCopyFailed(db,stableIdentity,{message:safeFailureReason(error)});
      }
    }catch{}
    if(error?.code==='PRIVATE_OBJECT_COPY_ATTEMPT_FAILED')throw error;
    throw workerError(
      'Objektet kunde inte kopieras och verifieras mot extern staging-lagring.',
      'PRIVATE_OBJECT_COPY_ATTEMPT_FAILED',
      error
    );
  }
}

module.exports=Object.freeze({
  assertTargetStore,
  metadataFromCopy,
  identityFromCopy,
  copyPlannedPrivateObject
});
