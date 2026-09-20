'use strict';

const crypto=require('node:crypto');
const PrivateObject=require('./private-object-contract.js');

function storeContractError(message,code='PRIVATE_OBJECT_STORE_CONTRACT_ERROR'){
  const error=new Error(message);
  error.code=code;
  return error;
}

function createPrivateObjectReference(input={}){
  const companyId=String(input.companyId??'').trim();
  const kind=String(input.kind??'').trim();
  const objectId=String(input.objectId??'').trim();
  const objectKey=PrivateObject.buildPrivateObjectKey({companyId,kind,objectId});
  return Object.freeze({companyId,kind,objectId,objectKey});
}

function normalizePutRequest({metadata,bytes}={}){
  const normalizedMetadata=PrivateObject.createPrivateObjectMetadata(metadata);
  if(!Buffer.isBuffer(bytes)||!bytes.length){
    throw storeContractError('Binärt objektinnehåll saknas.','PRIVATE_OBJECT_BYTES_REQUIRED');
  }
  if(bytes.length!==normalizedMetadata.sizeBytes){
    throw storeContractError('Objektets storlek stämmer inte med metadata.','PRIVATE_OBJECT_SIZE_MISMATCH');
  }
  const actualSha256=crypto.createHash('sha256').update(bytes).digest('hex');
  if(actualSha256!==normalizedMetadata.sha256){
    throw storeContractError('Objektets SHA-256 stämmer inte med metadata.','PRIVATE_OBJECT_SHA256_MISMATCH');
  }
  return Object.freeze({metadata:normalizedMetadata,bytes:Buffer.from(bytes)});
}

function assertPrivateObjectStore(provider){
  if(!provider||typeof provider!=='object'){
    throw storeContractError('Privat objektlagring saknas.','PRIVATE_OBJECT_STORE_REQUIRED');
  }
  for(const method of ['put','get','exists']){
    if(typeof provider[method]!=='function'){
      throw storeContractError(`Privat objektlagring saknar ${method}().`,'PRIVATE_OBJECT_STORE_INVALID');
    }
  }
  return provider;
}

function createContractedPrivateObjectStore(provider){
  const store=assertPrivateObjectStore(provider);
  return Object.freeze({
    put(request){
      return store.put(normalizePutRequest(request));
    },
    get(reference){
      return store.get(createPrivateObjectReference(reference));
    },
    exists(reference){
      return store.exists(createPrivateObjectReference(reference));
    }
  });
}

module.exports=Object.freeze({
  createPrivateObjectReference,
  normalizePutRequest,
  assertPrivateObjectStore,
  createContractedPrivateObjectStore
});
