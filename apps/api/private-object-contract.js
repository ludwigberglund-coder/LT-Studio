'use strict';

const PRIVATE_OBJECT_KINDS=Object.freeze({
  DOCUMENT:'document',
  SUPPLIER_INVOICE:'supplier-invoice',
  CUSTOMER_INVOICE_PDF:'customer-invoice-pdf'
});

const KIND_PATHS=Object.freeze({
  [PRIVATE_OBJECT_KINDS.DOCUMENT]:'documents',
  [PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE]:'supplier-invoices',
  [PRIVATE_OBJECT_KINDS.CUSTOMER_INVOICE_PDF]:'customer-invoices'
});

const MAX_PRIVATE_OBJECT_BYTES=15*1024*1024;

function contractError(message,code='PRIVATE_OBJECT_CONTRACT_ERROR'){
  const error=new Error(message);
  error.code=code;
  return error;
}

function identifier(value,label){
  const normalized=String(value??'').trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(normalized)){
    throw contractError(`${label} har ett ogiltigt internt id.`,'INVALID_PRIVATE_OBJECT_ID');
  }
  return normalized;
}

function kind(value){
  const normalized=String(value??'').trim();
  if(!Object.hasOwn(KIND_PATHS,normalized)){
    throw contractError('Objekttypen stöds inte.','INVALID_PRIVATE_OBJECT_KIND');
  }
  return normalized;
}

function mimeType(value){
  const normalized=String(value??'').trim().toLowerCase();
  if(!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)||normalized.length>120){
    throw contractError('MIME-typen är ogiltig.','INVALID_PRIVATE_OBJECT_MIME');
  }
  return normalized;
}

function sha256(value){
  const normalized=String(value??'').trim().toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(normalized)){
    throw contractError('SHA-256 är ogiltig.','INVALID_PRIVATE_OBJECT_SHA256');
  }
  return normalized;
}

function sizeBytes(value){
  const normalized=Number(value);
  if(!Number.isSafeInteger(normalized)||normalized<1||normalized>MAX_PRIVATE_OBJECT_BYTES){
    throw contractError('Objektstorleken är ogiltig.','INVALID_PRIVATE_OBJECT_SIZE');
  }
  return normalized;
}

function createdAt(value){
  const normalized=String(value??'').trim();
  if(!normalized||Number.isNaN(Date.parse(normalized))){
    throw contractError('Objektets skapad-tid är ogiltig.','INVALID_PRIVATE_OBJECT_CREATED_AT');
  }
  return normalized;
}

function buildPrivateObjectKey({companyId,kind:objectKind,objectId}){
  const safeCompanyId=identifier(companyId,'Företaget');
  const safeKind=kind(objectKind);
  const safeObjectId=identifier(objectId,'Objektet');
  return `private/${safeCompanyId}/${KIND_PATHS[safeKind]}/${safeObjectId}`;
}

function createPrivateObjectMetadata(input){
  const companyId=identifier(input?.companyId,'Företaget');
  const objectKind=kind(input?.kind);
  const objectId=identifier(input?.objectId,'Objektet');
  const metadata={
    objectKey:buildPrivateObjectKey({companyId,kind:objectKind,objectId}),
    companyId,
    kind:objectKind,
    objectId,
    mimeType:mimeType(input?.mimeType),
    sizeBytes:sizeBytes(input?.sizeBytes),
    sha256:sha256(input?.sha256),
    createdAt:createdAt(input?.createdAt)
  };
  return Object.freeze(metadata);
}

module.exports=Object.freeze({
  PRIVATE_OBJECT_KINDS,
  MAX_PRIVATE_OBJECT_BYTES,
  buildPrivateObjectKey,
  createPrivateObjectMetadata
});
