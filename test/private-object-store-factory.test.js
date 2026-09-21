'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Factory=require('../apps/api/private-object-store-factory.js');
const PrivateObject=require('../apps/api/private-object-contract.js');

test('factoryn använder SQLite som enda standardprovider',()=>{
  assert.equal(Factory.DEFAULT_PROVIDER,'sqlite');
  assert.deepEqual(Factory.SUPPORTED_PROVIDERS,['sqlite']);
  assert.equal(Factory.normalizeProvider(undefined),'sqlite');
  assert.equal(Factory.normalizeProvider(' SQLITE '),'sqlite');
  assert.equal(Factory.providerFromEnvironment({}),'sqlite');
  assert.equal(Factory.providerFromEnvironment({PRIVATE_OBJECT_STORAGE_PROVIDER:'sqlite'}),'sqlite');
});

test('okänd lagringsprovider stoppas fail-closed',()=>{
  for(const provider of ['s3','r2','filesystem','memory']){
    assert.throws(
      ()=>Factory.normalizeProvider(provider),
      error=>error.code==='PRIVATE_OBJECT_STORE_PROVIDER_UNSUPPORTED'
    );
    assert.throws(
      ()=>Factory.providerFromEnvironment({PRIVATE_OBJECT_STORAGE_PROVIDER:provider}),
      error=>error.code==='PRIVATE_OBJECT_STORE_PROVIDER_UNSUPPORTED'
    );
  }
});

test('factoryn mappar alla tre privata objekttyper till kontrakterade SQLite-stores',()=>{
  const db={};
  for(const kind of Object.values(PrivateObject.PRIVATE_OBJECT_KINDS)){
    const store=Factory.createPrivateObjectStore({db,kind,provider:'sqlite'});
    assert.equal(typeof store.put,'function');
    assert.equal(typeof store.get,'function');
    assert.equal(typeof store.exists,'function');
    assert.equal(Object.isFrozen(store),true);
  }
});

test('okänd objekttyp och saknad databas stoppas innan lagringsåtkomst',()=>{
  assert.throws(
    ()=>Factory.createPrivateObjectStore({kind:PrivateObject.PRIVATE_OBJECT_KINDS.DOCUMENT,provider:'sqlite'}),
    error=>error.code==='PRIVATE_OBJECT_STORE_DB_REQUIRED'
  );
  assert.throws(
    ()=>Factory.createPrivateObjectStore({db:{},kind:'unknown-private-kind',provider:'sqlite'}),
    error=>error.code==='PRIVATE_OBJECT_KIND_UNSUPPORTED'
  );
});
