'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Payables=require('../apps/api/payables.js');
const PrivateObject=require('../apps/api/private-object-contract.js');
const StoreContract=require('../apps/api/private-object-store-contract.js');
const Bridge=require('../apps/api/sqlite-supplier-invoice-private-object-provider.js');

function pdf(label='supplier-provider'){return Buffer.from('%PDF-1.4\n% '+label+'\n','ascii')}

test('leverantörsfakturans SQLite-brygga följer gemensamt provider-kontrakt',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    Payables.initializePayables(db);
    const company=Db.createCompany(db,{legalName:'Supplier Provider A AB',displayName:'Supplier A',orgNumber:'559903-1001'});
    const other=Db.createCompany(db,{legalName:'Supplier Provider B AB',displayName:'Supplier B',orgNumber:'559903-1002'});
    const user=Db.createUser(db,{username:'supplier.provider',displayName:'Supplier Provider',passwordHash:Auth.hashPassword('Supplier provider test 2026!')});
    const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-100',name:'Leverantör A AB',bankgiro:'555-1000',defaultCostAccount:'4010'});
    const invoice=Payables.createSupplierInvoice(db,{
      companyId:company.id,
      supplierId:supplier.id,
      supplierInvoiceNumber:'SUP-1001',
      invoiceDate:'2026-09-20',
      dueDate:'2026-10-20',
      totalOre:125000,
      vatOre:25000,
      registeredBy:user.id
    });
    const bytes=pdf();
    const metadata=PrivateObject.createPrivateObjectMetadata({
      companyId:company.id,
      kind:PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE,
      objectId:invoice.id,
      mimeType:'application/pdf',
      sizeBytes:bytes.length,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
      createdAt:'2026-09-20T21:55:00.000Z'
    });
    const store=StoreContract.createContractedPrivateObjectStore(
      Bridge.createSqliteSupplierInvoicePrivateObjectProvider(db)
    );

    assert.equal(store.put({metadata,bytes}),true);
    assert.equal(store.exists(metadata),true);
    assert.deepEqual(store.get(metadata),bytes);

    const wrongCompany={companyId:other.id,kind:metadata.kind,objectId:metadata.objectId};
    assert.equal(store.exists(wrongCompany),false);
    assert.equal(store.get(wrongCompany),null);

    const wrongKind={companyId:company.id,kind:PrivateObject.PRIVATE_OBJECT_KINDS.DOCUMENT,objectId:metadata.objectId};
    assert.equal(store.exists(wrongKind),false);
    assert.equal(store.get(wrongKind),null);
    assert.equal(store.put({metadata:{...metadata,kind:PrivateObject.PRIVATE_OBJECT_KINDS.DOCUMENT},bytes}),false);
  }finally{db.close();}
});
