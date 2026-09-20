'use strict';

const ContentStore=require('./document-content-store.js');
const PrivateObject=require('./private-object-contract.js');

function createSqliteDocumentPrivateObjectProvider(db){
  const store=ContentStore.createSqliteDocumentContentStore(db);

  function isDocument(reference){
    return reference?.kind===PrivateObject.PRIVATE_OBJECT_KINDS.DOCUMENT;
  }

  function put({metadata,bytes}){
    if(!isDocument(metadata))return false;
    return store.put({
      companyId:metadata.companyId,
      documentId:metadata.objectId,
      bytes
    });
  }

  function get(reference){
    if(!isDocument(reference))return null;
    return store.get({
      companyId:reference.companyId,
      documentId:reference.objectId
    });
  }

  function exists(reference){
    if(!isDocument(reference))return false;
    return store.exists({
      companyId:reference.companyId,
      documentId:reference.objectId
    });
  }

  return Object.freeze({put,get,exists});
}

module.exports=Object.freeze({createSqliteDocumentPrivateObjectProvider});
