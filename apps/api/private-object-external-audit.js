'use strict';

const crypto=require('node:crypto');
const PrivateObject=require('./private-object-contract.js');
const StoreContract=require('./private-object-store-contract.js');
const Inventory=require('./private-object-inventory.js');
const Ledger=require('./private-object-copy-ledger.js');

function auditError(message,code='PRIVATE_OBJECT_EXTERNAL_AUDIT_ERROR'){
  const error=new Error(message);
  error.code=code;
  return error;
}

function assertTargetStore(targetStore){
  if(!targetStore||typeof targetStore!=='object'||typeof targetStore.get!=='function'){
    throw auditError(
      'Extern staging-lagring med get() krävs för audit.',
      'PRIVATE_OBJECT_EXTERNAL_AUDIT_TARGET_REQUIRED'
    );
  }
  return targetStore;
}

function manifestSha256(objects){
  const rows=objects.map(object=>({
    companyId:object.companyId,
    kind:object.kind,
    objectId:object.objectId,
    sha256:object.sha256,
    sizeBytes:object.sizeBytes
  }));
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function metadataFromInventoryObject(object){
  return PrivateObject.createPrivateObjectMetadata({
    companyId:object.companyId,
    kind:object.kind,
    objectId:object.objectId,
    mimeType:object.mimeType,
    sizeBytes:object.sizeBytes,
    sha256:object.sha256,
    createdAt:object.createdAt
  });
}

function issueFor(object,code){
  return Object.freeze({
    companyId:object.companyId,
    kind:object.kind,
    objectId:object.objectId,
    sha256:object.sha256,
    code:String(code||'PRIVATE_OBJECT_EXTERNAL_AUDIT_FAILED')
  });
}

async function auditExternalPrivateObjects(db,{
  targetStore,
  targetProvider='r2',
  sourceProvider='sqlite',
  auditedAt=new Date().toISOString()
}={}){
  if(!db)throw auditError('Databas krävs för extern objekt-audit.','PRIVATE_OBJECT_EXTERNAL_AUDIT_DB_REQUIRED');
  const target=assertTargetStore(targetStore);
  const provider=Ledger.normalizeTargetProvider(targetProvider);
  const inventory=Inventory.buildPrivateObjectInventory(db,{
    provider:sourceProvider,
    generatedAt:auditedAt
  });

  const countsByKind={};
  for(const kind of Object.values(PrivateObject.PRIVATE_OBJECT_KINDS)){
    countsByKind[kind]={objects:0,ready:0,verified:0,bytes:0};
  }

  const issues=[];
  if(!inventory.ok){
    for(const object of inventory.objects){
      for(const sourceIssue of object.issues){
        issues.push(issueFor(object,sourceIssue.code||'PRIVATE_OBJECT_SOURCE_NOT_VERIFIED'));
      }
    }
    return Object.freeze({
      schemaVersion:1,
      auditedAt:String(auditedAt),
      sourceProvider:inventory.sourceProvider,
      targetProvider:provider,
      sourceManifestSha256:manifestSha256(inventory.objects),
      ok:false,
      sourceOk:false,
      sourceObjectCount:inventory.objectCount,
      sourceTotalBytes:inventory.totalBytes,
      readyCount:0,
      verifiedExternalCount:0,
      missingReadyCount:0,
      issueCount:issues.length,
      countsByKind:Object.freeze(Object.fromEntries(
        Object.entries(countsByKind).map(([kind,row])=>[kind,Object.freeze(row)])
      )),
      issues:Object.freeze(issues)
    });
  }

  let readyCount=0;
  let verifiedExternalCount=0;
  let missingReadyCount=0;

  for(const object of inventory.objects){
    const row=countsByKind[object.kind];
    row.objects+=1;
    row.bytes+=Number(object.sizeBytes)||0;

    const metadata=metadataFromInventoryObject(object);
    const copy=Ledger.copyByIdentity(db,{
      companyId:metadata.companyId,
      kind:metadata.kind,
      objectId:metadata.objectId,
      sha256:metadata.sha256,
      provider
    });

    if(!copy||copy.status!=='ready'){
      missingReadyCount+=1;
      issues.push(issueFor(object,'PRIVATE_OBJECT_EXTERNAL_COPY_NOT_READY'));
      continue;
    }

    const expectedStorageKey=Ledger.externalStorageKey(metadata);
    const copyMatches=
      copy.logicalKey===metadata.objectKey&&
      copy.storageKey===expectedStorageKey&&
      copy.mimeType===metadata.mimeType&&
      copy.sizeBytes===metadata.sizeBytes&&
      copy.sourceCreatedAt===metadata.createdAt;

    if(!copyMatches){
      issues.push(issueFor(object,'PRIVATE_OBJECT_EXTERNAL_COPY_METADATA_MISMATCH'));
      continue;
    }

    readyCount+=1;
    row.ready+=1;

    try{
      const bytes=await target.get({
        storageKey:copy.storageKey,
        metadata
      });
      StoreContract.normalizePutRequest({metadata,bytes});
      verifiedExternalCount+=1;
      row.verified+=1;
    }catch(error){
      issues.push(issueFor(
        object,
        error?.code||'PRIVATE_OBJECT_EXTERNAL_READBACK_FAILED'
      ));
    }
  }

  const frozenCounts=Object.freeze(Object.fromEntries(
    Object.entries(countsByKind).map(([kind,row])=>[kind,Object.freeze({...row})])
  ));

  return Object.freeze({
    schemaVersion:1,
    auditedAt:String(auditedAt),
    sourceProvider:inventory.sourceProvider,
    targetProvider:provider,
    sourceManifestSha256:manifestSha256(inventory.objects),
    ok:issues.length===0&&verifiedExternalCount===inventory.objectCount,
    sourceOk:true,
    sourceObjectCount:inventory.objectCount,
    sourceTotalBytes:inventory.totalBytes,
    readyCount,
    verifiedExternalCount,
    missingReadyCount,
    issueCount:issues.length,
    countsByKind:frozenCounts,
    issues:Object.freeze(issues)
  });
}

module.exports=Object.freeze({
  assertTargetStore,
  manifestSha256,
  metadataFromInventoryObject,
  auditExternalPrivateObjects
});
