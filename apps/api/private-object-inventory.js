'use strict';

const PrivateObject=require('./private-object-contract.js');
const StoreContract=require('./private-object-store-contract.js');
const StoreFactory=require('./private-object-store-factory.js');

function inventoryError(message,code='PRIVATE_OBJECT_INVENTORY_ERROR'){
  const error=new Error(message);
  error.code=code;
  return error;
}

function rowsForKind(db,kind){
  switch(kind){
    case PrivateObject.PRIVATE_OBJECT_KINDS.DOCUMENT:
      return db.prepare(`SELECT id AS objectId,company_id AS companyId,mime_type AS mimeType,
        sha256,size_bytes AS sizeBytes,completed_at AS createdAt,status AS sourceState
        FROM documents
        WHERE status='ready'
        ORDER BY company_id,id`).all();
    case PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE:
      return db.prepare(`SELECT id AS objectId,company_id AS companyId,document_mime AS mimeType,
        document_sha256 AS sha256,created_at AS createdAt,status AS sourceState
        FROM supplier_invoices
        WHERE document_sha256 IS NOT NULL
        ORDER BY company_id,id`).all();
    case PrivateObject.PRIVATE_OBJECT_KINDS.CUSTOMER_INVOICE_PDF:
      return db.prepare(`SELECT invoice_id AS objectId,company_id AS companyId,mime_type AS mimeType,
        pdf_sha256 AS sha256,size_bytes AS sizeBytes,created_at AS createdAt,'archived' AS sourceState
        FROM customer_invoice_pdf_archives
        ORDER BY company_id,invoice_id`).all();
    case PrivateObject.PRIVATE_OBJECT_KINDS.PAYMENT_REMINDER_PDF:
      return db.prepare(`SELECT id AS objectId,company_id AS companyId,'application/pdf' AS mimeType,
        pdf_sha256 AS sha256,pdf_size_bytes AS sizeBytes,created_at AS createdAt,'archived' AS sourceState
        FROM invoice_reminders
        WHERE pdf_sha256 IS NOT NULL AND pdf_size_bytes IS NOT NULL
        ORDER BY company_id,id`).all();
    default:
      throw inventoryError('Objekttypen stöds inte av inventeringen.','PRIVATE_OBJECT_INVENTORY_KIND_UNSUPPORTED');
  }
}

function safeObjectKey(row,kind){
  try{
    return PrivateObject.buildPrivateObjectKey({
      companyId:row.companyId,
      kind,
      objectId:row.objectId
    });
  }catch{
    return '';
  }
}

function recordForRow(store,kind,row){
  const issues=[];
  const base={
    companyId:String(row.companyId??''),
    kind,
    objectId:String(row.objectId??''),
    objectKey:safeObjectKey(row,kind),
    mimeType:String(row.mimeType??''),
    sizeBytes:row.sizeBytes==null?null:Number(row.sizeBytes),
    sha256:String(row.sha256??'').toLowerCase(),
    createdAt:String(row.createdAt??''),
    sourceState:String(row.sourceState??'')
  };

  let bytes=null;
  try{
    bytes=store.get({
      companyId:base.companyId,
      kind,
      objectId:base.objectId
    });
  }catch(error){
    issues.push({
      code:error?.code||'PRIVATE_OBJECT_INVENTORY_STORE_READ_FAILED',
      message:error?.message||'Objektet kunde inte läsas från källagret.'
    });
  }

  if(!Buffer.isBuffer(bytes)||!bytes.length){
    issues.push({
      code:'PRIVATE_OBJECT_INVENTORY_BYTES_MISSING',
      message:'Binärt innehåll saknas för objektets metadata.'
    });
    return Object.freeze({...base,verified:false,issues:Object.freeze(issues)});
  }

  const sizeBytes=base.sizeBytes==null?bytes.length:base.sizeBytes;
  let metadata=null;
  try{
    metadata=PrivateObject.createPrivateObjectMetadata({
      companyId:base.companyId,
      kind,
      objectId:base.objectId,
      mimeType:base.mimeType,
      sizeBytes,
      sha256:base.sha256,
      createdAt:base.createdAt
    });
    StoreContract.normalizePutRequest({metadata,bytes});
  }catch(error){
    issues.push({
      code:error?.code||'PRIVATE_OBJECT_INVENTORY_INTEGRITY_ERROR',
      message:error?.message||'Objektets integritetskontroll misslyckades.'
    });
  }

  return Object.freeze({
    ...base,
    objectKey:metadata?.objectKey||base.objectKey,
    sizeBytes,
    verified:issues.length===0,
    issues:Object.freeze(issues)
  });
}

function buildPrivateObjectInventory(db,{provider='sqlite',generatedAt=new Date().toISOString()}={}){
  if(!db)throw inventoryError('Databas krävs för privat objektinventering.','PRIVATE_OBJECT_INVENTORY_DB_REQUIRED');
  const selectedProvider=StoreFactory.normalizeProvider(provider);
  const objects=[];

  for(const kind of Object.values(PrivateObject.PRIVATE_OBJECT_KINDS)){
    const store=StoreFactory.createPrivateObjectStore({db,kind,provider:selectedProvider});
    for(const row of rowsForKind(db,kind)){
      objects.push(recordForRow(store,kind,row));
    }
  }

  objects.sort((a,b)=>
    a.companyId.localeCompare(b.companyId)||
    a.kind.localeCompare(b.kind)||
    a.objectId.localeCompare(b.objectId)
  );

  const countsByKind={};
  for(const kind of Object.values(PrivateObject.PRIVATE_OBJECT_KINDS)){
    const rows=objects.filter(object=>object.kind===kind);
    countsByKind[kind]=Object.freeze({
      objects:rows.length,
      verified:rows.filter(object=>object.verified).length,
      bytes:rows.reduce((sum,object)=>sum+(Number.isSafeInteger(object.sizeBytes)?object.sizeBytes:0),0)
    });
  }

  const issueCount=objects.reduce((sum,object)=>sum+object.issues.length,0);
  const totalBytes=objects.reduce((sum,object)=>sum+(Number.isSafeInteger(object.sizeBytes)?object.sizeBytes:0),0);

  return Object.freeze({
    schemaVersion:1,
    generatedAt:String(generatedAt),
    sourceProvider:selectedProvider,
    ok:issueCount===0,
    objectCount:objects.length,
    verifiedCount:objects.filter(object=>object.verified).length,
    issueCount,
    totalBytes,
    countsByKind:Object.freeze(countsByKind),
    objects:Object.freeze(objects)
  });
}

module.exports=Object.freeze({buildPrivateObjectInventory});
