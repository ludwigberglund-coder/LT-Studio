'use strict';

const crypto=require('node:crypto');
const Inventory=require('./private-object-inventory.js');
const Ledger=require('./private-object-copy-ledger.js');
const PrivateObject=require('./private-object-contract.js');

function plannerError(message,code='PRIVATE_OBJECT_COPY_PLAN_ERROR',details){
  const error=new Error(message);
  error.code=code;
  if(details)error.details=details;
  return error;
}

function nowIso(){
  return new Date().toISOString();
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

function planVerifiedPrivateObjectCopies(db,{
  targetProvider,
  sourceProvider='sqlite',
  generatedAt=nowIso(),
  plannedAt=nowIso()
}={}){
  if(!db)throw plannerError('Databas krävs för objektkopieringsplan.','PRIVATE_OBJECT_COPY_PLAN_DB_REQUIRED');

  const target=Ledger.normalizeTargetProvider(targetProvider);
  const inventory=Inventory.buildPrivateObjectInventory(db,{
    provider:sourceProvider,
    generatedAt
  });

  if(!inventory.ok){
    throw plannerError(
      'Källagret innehåller objekt som inte kan verifieras. Ingen extern kopieringsplan skapades.',
      'PRIVATE_OBJECT_COPY_SOURCE_NOT_VERIFIED',
      {issueCount:inventory.issueCount,objectCount:inventory.objectCount}
    );
  }

  Ledger.initializePrivateObjectCopyLedger(db);

  const savepoint=`private_object_copy_plan_${crypto.randomBytes(8).toString('hex')}`;
  const copies=[];
  let newPlans=0;
  let existingPlans=0;

  db.exec(`SAVEPOINT ${savepoint}`);
  try{
    for(const object of inventory.objects){
      const metadata=metadataFromInventoryObject(object);
      const identity={
        companyId:metadata.companyId,
        kind:metadata.kind,
        objectId:metadata.objectId,
        sha256:metadata.sha256,
        provider:target
      };
      const before=Ledger.copyByIdentity(db,identity);
      const copy=Ledger.planPrivateObjectCopy(db,{
        metadata,
        provider:target,
        createdAt:plannedAt
      });
      if(before)existingPlans+=1;
      else newPlans+=1;
      copies.push(copy);
    }
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
  }catch(error){
    try{db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)}catch{}
    try{db.exec(`RELEASE SAVEPOINT ${savepoint}`)}catch{}
    throw error;
  }

  const statusCounts={pending:0,failed:0,ready:0};
  for(const copy of copies)statusCounts[copy.status]+=1;

  return Object.freeze({
    schemaVersion:1,
    sourceProvider:inventory.sourceProvider,
    targetProvider:target,
    sourceInventoryGeneratedAt:inventory.generatedAt,
    sourceObjectCount:inventory.objectCount,
    sourceTotalBytes:inventory.totalBytes,
    newPlans,
    existingPlans,
    statusCounts:Object.freeze(statusCounts)
  });
}

module.exports=Object.freeze({
  metadataFromInventoryObject,
  planVerifiedPrivateObjectCopies
});
