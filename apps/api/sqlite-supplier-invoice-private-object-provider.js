'use strict';

const DocumentStore=require('./supplier-invoice-document-store.js');
const PrivateObject=require('./private-object-contract.js');

function createSqliteSupplierInvoicePrivateObjectProvider(db){
  // This bridge intentionally accepts only supplier-invoice objects.
  const store=DocumentStore.createSqliteSupplierInvoiceDocumentStore(db);

  function isSupplierInvoice(reference){
    return reference?.kind===PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE;
  }

  function put({metadata,bytes}){
    if(!isSupplierInvoice(metadata))return false;
    return store.put({
      companyId:metadata.companyId,
      invoiceId:metadata.objectId,
      bytes
    });
  }

  function get(reference){
    if(!isSupplierInvoice(reference))return null;
    return store.get({
      companyId:reference.companyId,
      invoiceId:reference.objectId
    });
  }

  function exists(reference){
    if(!isSupplierInvoice(reference))return false;
    return store.exists({
      companyId:reference.companyId,
      invoiceId:reference.objectId
    });
  }

  return Object.freeze({put,get,exists});
}

module.exports=Object.freeze({createSqliteSupplierInvoicePrivateObjectProvider});
