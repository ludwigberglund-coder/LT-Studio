'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Documents=require('../apps/api/documents.js');
const PrivateObject=require('../apps/api/private-object-contract.js');
const StoreContract=require('../apps/api/private-object-store-contract.js');
const Bridge=require('../apps/api/sqlite-document-private-object-provider.js');

function pdf(label='bridge'){return Buffer.from('%PDF-1.4\n% '+label+'\n','ascii')}

test('dokumentarkivets SQLite-brygga följer gemensamt provider-kontrakt',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    Documents.initializeDocuments(db);
    const company=Db.createCompany(db,{legalName:'Provider A AB',displayName:'Provider A',orgNumber:'559902-1001'});
    const other=Db.createCompany(db,{legalName:'Provider B AB',displayName:'Provider B',orgNumber:'559902-1002'});
    const user=Db.createUser(db,{username:'provider.test',displayName:'Provider Test',passwordHash:Auth.hashPassword('Provider testlosenord 2026!')});
    const doc=Documents.createPending(db,{
      companyId:company.id,
      uploadedBy:user.id,
      title:'Provider bridge',
      category:'other',
      fileName:'bridge.pdf',
      mimeType:'application/pdf'
    });
    const bytes=pdf();
    const metadata=PrivateObject.createPrivateObjectMetadata({
      companyId:company.id,
      kind:PrivateObject.PRIVATE_OBJECT_KINDS.DOCUMENT,
      objectId:doc.id,
      mimeType:'application/pdf',
      sizeBytes:bytes.length,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
      createdAt:'2026-09-20T21:45:00.000Z'
    });
    const store=StoreContract.createContractedPrivateObjectStore(
      Bridge.createSqliteDocumentPrivateObjectProvider(db)
    );

    assert.equal(store.put({metadata,bytes}),true);
    assert.equal(store.exists(metadata),true);
    assert.deepEqual(store.get(metadata),bytes);

    const wrongCompany={companyId:other.id,kind:metadata.kind,objectId:metadata.objectId};
    assert.equal(store.exists(wrongCompany),false);
    assert.equal(store.get(wrongCompany),null);

    const wrongKind={companyId:company.id,kind:PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE,objectId:metadata.objectId};
    assert.equal(store.exists(wrongKind),false);
    assert.equal(store.get(wrongKind),null);
    assert.equal(store.put({metadata:{...metadata,kind:PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE},bytes}),false);
  }finally{db.close();}
});
