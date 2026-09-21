'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const Db=require('../apps/api/database.js');
const MoneyStorage=require('../apps/api/money-storage-guards.js');
const {createServer}=require('../apps/api/server.js');

test('SQLite money guards kräver heltalsören inom JavaScripts säkra intervall',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('CREATE TABLE money_fixture(id TEXT PRIMARY KEY, amount_ore INTEGER, vat_ore INTEGER NOT NULL)');
    const installed=MoneyStorage.installMoneyStorageGuards(db);
    assert.equal(installed.ok,true);
    assert.equal(installed.checkedColumns,2);
    assert.equal(installed.installedTriggers,4);

    assert.doesNotThrow(()=>db.prepare('INSERT INTO money_fixture(id,amount_ore,vat_ore) VALUES(?,?,?)').run('ok',14950,2990));
    assert.throws(
      ()=>db.prepare('INSERT INTO money_fixture(id,amount_ore,vat_ore) VALUES(?,?,?)').run('fraction',1.5,1),
      /MONEY_STORAGE_SAFE_INTEGER_REQUIRED/
    );
    assert.throws(
      ()=>db.exec("INSERT INTO money_fixture(id,amount_ore,vat_ore) VALUES('too-large',9007199254740992,1)"),
      /MONEY_STORAGE_SAFE_INTEGER_REQUIRED/
    );
    assert.throws(
      ()=>db.prepare('UPDATE money_fixture SET amount_ore=? WHERE id=?').run(2.25,'ok'),
      /MONEY_STORAGE_SAFE_INTEGER_REQUIRED/
    );
    assert.equal(db.prepare("SELECT amount_ore FROM money_fixture WHERE id='ok'").get().amount_ore,14950);
  }finally{db.close()}
});

test('befintligt decimalbelopp stoppar guard-installation utan att skrivas om',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('CREATE TABLE money_fixture(id TEXT PRIMARY KEY, amount_ore INTEGER)');
    db.exec("INSERT INTO money_fixture(id,amount_ore) VALUES('bad',1.5)");
    const report=MoneyStorage.inspectMoneyStorage(db);
    assert.equal(report.ok,false);
    assert.equal(report.violations.length,1);
    assert.equal(report.violations[0].count,1);
    assert.throws(
      ()=>MoneyStorage.installMoneyStorageGuards(db),
      error=>error?.code==='MONEY_STORAGE_INTEGRITY_ERROR'
    );
    assert.equal(db.prepare("SELECT typeof(amount_ore) AS type,amount_ore AS value FROM money_fixture WHERE id='bad'").get().type,'real');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'money_integer_%'").get().n,0);
  }finally{db.close()}
});

test('hela privata runtime-schemat har INTEGER-deklaration och guards för alla _ore-kolumner',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    createServer({db,databasePath:':memory:',secureCookies:false});
    const report=MoneyStorage.inspectMoneyStorage(db);
    assert.equal(report.ok,true,JSON.stringify(report));
    assert.ok(report.checkedColumns>=20,'För få pengakolumner hittades: '+report.checkedColumns);
    assert.deepEqual(report.invalidDeclarations,[]);
    assert.deepEqual(report.violations,[]);
    assert.ok(report.columns.every(row=>row.column.endsWith('_ore')&&row.declaredType==='INTEGER'));
    const triggerCount=Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'money_integer_%'").get().n);
    assert.equal(triggerCount,report.checkedColumns*2);
  }finally{db.close()}
});
