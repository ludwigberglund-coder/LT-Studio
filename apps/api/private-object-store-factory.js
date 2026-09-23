'use strict';

const PrivateObject=require('./private-object-contract.js');
const StoreContract=require('./private-object-store-contract.js');
const DocumentProvider=require('./sqlite-document-private-object-provider.js');
const SupplierInvoiceProvider=require('./sqlite-supplier-invoice-private-object-provider.js');
const CustomerInvoiceProvider=require('./sqlite-customer-invoice-private-object-provider.js');
const PaymentReminderProvider=require('./sqlite-payment-reminder-private-object-provider.js');

const DEFAULT_PROVIDER='sqlite';
const SUPPORTED_PROVIDERS=Object.freeze([DEFAULT_PROVIDER]);

function factoryError(message,code='PRIVATE_OBJECT_STORE_FACTORY_ERROR'){
  const error=new Error(message);
  error.code=code;
  return error;
}

function normalizeProvider(value){
  const provider=String(value??DEFAULT_PROVIDER).trim().toLowerCase()||DEFAULT_PROVIDER;
  if(!SUPPORTED_PROVIDERS.includes(provider)){
    throw factoryError(
      `Privat objektlagringsprovider "${provider}" stöds inte.`,
      'PRIVATE_OBJECT_STORE_PROVIDER_UNSUPPORTED'
    );
  }
  return provider;
}

function providerFromEnvironment(env=process.env){
  return normalizeProvider(env?.PRIVATE_OBJECT_STORAGE_PROVIDER);
}

function sqliteProviderForKind(db,kind){
  switch(kind){
    case PrivateObject.PRIVATE_OBJECT_KINDS.DOCUMENT:
      return DocumentProvider.createSqliteDocumentPrivateObjectProvider(db);
    case PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE:
      return SupplierInvoiceProvider.createSqliteSupplierInvoicePrivateObjectProvider(db);
    case PrivateObject.PRIVATE_OBJECT_KINDS.CUSTOMER_INVOICE_PDF:
      return CustomerInvoiceProvider.createSqliteCustomerInvoicePrivateObjectProvider(db);
    case PrivateObject.PRIVATE_OBJECT_KINDS.PAYMENT_REMINDER_PDF:
      return PaymentReminderProvider.createSqlitePaymentReminderPrivateObjectProvider(db);
    default:
      throw factoryError(
        `Privat objekttyp "${String(kind??'')}" stöds inte av lagringsfactoryn.`,
        'PRIVATE_OBJECT_KIND_UNSUPPORTED'
      );
  }
}

function createPrivateObjectStore({db,kind,provider}={}){
  if(!db)throw factoryError('Databas krävs för privat objektlagring.','PRIVATE_OBJECT_STORE_DB_REQUIRED');
  const selected=normalizeProvider(provider??providerFromEnvironment());
  if(selected!==DEFAULT_PROVIDER){
    throw factoryError('Endast SQLite är aktiverat för privat objektlagring.','PRIVATE_OBJECT_STORE_PROVIDER_UNSUPPORTED');
  }
  return StoreContract.createContractedPrivateObjectStore(sqliteProviderForKind(db,kind));
}

module.exports=Object.freeze({
  DEFAULT_PROVIDER,
  SUPPORTED_PROVIDERS,
  normalizeProvider,
  providerFromEnvironment,
  createPrivateObjectStore
});
