'use strict';

const crypto=require('node:crypto');

const OBJECT_KINDS=Object.freeze([
  'document',
  'supplier-invoice',
  'customer-invoice-pdf'
]);
const STORAGE_STATUSES=Object.freeze(['pending','ready']);

function contractError(message,code='OBJECT_METADATA_INVALID'){
  const error=new Error(message);
  error.code=code;
  return error;
}
function token(value,label){
  const result=String(value??'').trim();
  if(!/^[A-Za-z0-9._:-]{1,180}$/.test(result))throw contractError(`${label} är ogiltigt.`);
  return result;
}
function sha256(value){
  const result=String(value??'').trim().toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(result))throw contractError('SHA-256 är ogiltigt.');
  return result;
}
function mimeType(value){
  const result=String(value??'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(result))throw contractError('MIME-typen är ogiltig.');
  return result;
}
function sizeBytes(value){
  const result=Number(value);
  if(!Number.isSafeInteger(result)||result<0)throw contractError('Filstorleken är ogiltig.');
  return result;
}
function kind(value){
  const result=String(value??'').trim();
  if(!OBJECT_KINDS.includes(result))throw contractError('Objekttypen är ogiltig.');
  return result;
}
function status(value){
  const result=String(value??'').trim();
  if(!STORAGE_STATUSES.includes(result))throw contractError('Lagringsstatus är ogiltig.');
  return result;
}

function objectKey({companyId,kind:objectKind,objectId}){
  const company=token(companyId,'Företags-id');
  const type=kind(objectKind);
  const id=token(objectId,'Objekt-id');
  return `private/${company}/${type}/${id}`;
}

function createObjectMetadata(input={}){
  const companyId=token(input.companyId,'Företags-id');
  const objectKind=kind(input.kind);
  const objectId=token(input.objectId,'Objekt-id');
  const storageStatus=status(input.status||'ready');
  const metadata={
    version:1,
    companyId,
    kind:objectKind,
    objectId,
    objectKey:objectKey({companyId,kind:objectKind,objectId}),
    mimeType:mimeType(input.mimeType),
    sizeBytes:sizeBytes(input.sizeBytes),
    sha256:sha256(input.sha256),
    status:storageStatus
  };
  return Object.freeze(metadata);
}

function metadataForBytes({companyId,kind:objectKind,objectId,mimeType:contentType,bytes}){
  if(!Buffer.isBuffer(bytes)||!bytes.length)throw contractError('Binärt innehåll saknas.');
  return createObjectMetadata({
    companyId,
    kind:objectKind,
    objectId,
    mimeType:contentType,
    sizeBytes:bytes.length,
    sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
    status:'ready'
  });
}

function assertBytesMatch(metadata,bytes){
  const normalized=createObjectMetadata(metadata);
  if(!Buffer.isBuffer(bytes))throw contractError('Binärt innehåll saknas.');
  const actualSha=crypto.createHash('sha256').update(bytes).digest('hex');
  if(bytes.length!==normalized.sizeBytes||actualSha!==normalized.sha256){
    throw contractError('Objektets storlek eller SHA-256 stämmer inte med metadata.','OBJECT_METADATA_INTEGRITY_ERROR');
  }
  return normalized;
}

module.exports=Object.freeze({
  OBJECT_KINDS,
  STORAGE_STATUSES,
  objectKey,
  createObjectMetadata,
  metadataForBytes,
  assertBytesMatch
});
