'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Db=require('../apps/api/database.js');

test('databasstart skapar en verifierbar append-only migrationsledger',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const status=Db.schemaMigrationStatus(db);
    assert.equal(status.ok,true);
    assert.equal(status.currentVersion,1);
    assert.equal(status.latestKnownVersion,1);
    assert.equal(status.rows.length,1);
    assert.equal(status.rows[0].name,'core-sqlite-baseline-2026-09-21');
    assert.match(status.rows[0].checksumSha256,/^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(Date.parse(status.rows[0].appliedAt)));
    assert.throws(()=>db.prepare("UPDATE schema_migrations SET name='changed' WHERE version=1").run(),/HISTORY_IMMUTABLE/);
    assert.throws(()=>db.prepare('DELETE FROM schema_migrations WHERE version=1').run(),/HISTORY_IMMUTABLE/);
  }finally{db.close()}
});

test('befintlig SQLite utan migrationsledger får baseline utan att affärsdata ändras',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-schema-baseline-'));
  const filename=path.join(dir,'platform.sqlite');
  let db;
  try{
    db=Db.openDatabase(filename);
    const company=Db.createCompany(db,{legalName:'Legacy Baseline AB',displayName:'Legacy Baseline',orgNumber:'559999-2001'});
    db.exec('DROP TABLE schema_migrations');
    db.close();db=null;

    db=Db.openDatabase(filename);
    assert.equal(Db.companyById(db,company.id).orgNumber,'559999-2001');
    const status=Db.schemaMigrationStatus(db);
    assert.equal(status.ok,true);
    assert.equal(status.currentVersion,1);
    assert.equal(status.rows.length,1);
  }finally{
    try{db?.close()}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('okänd framtida schema-version stoppar äldre programversion fail-closed',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-schema-future-'));
  const filename=path.join(dir,'platform.sqlite');
  let db;
  try{
    db=Db.openDatabase(filename);
    db.exec('DROP TRIGGER history_schema_migrations_replace');
    db.prepare('INSERT INTO schema_migrations(version,name,checksum_sha256,applied_at) VALUES(?,?,?,?)')
      .run(999,'future-version','f'.repeat(64),new Date().toISOString());
    db.close();db=null;
    assert.throws(()=>Db.openDatabase(filename),error=>error?.code==='SCHEMA_VERSION_TOO_NEW');
  }finally{
    try{db?.close()}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('ändrad migrationschecksumma upptäcks vid nästa databasstart',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-schema-tamper-'));
  const filename=path.join(dir,'platform.sqlite');
  let db;
  try{
    db=Db.openDatabase(filename);
    db.exec('DROP TRIGGER history_schema_migrations_update');
    db.prepare('UPDATE schema_migrations SET checksum_sha256=? WHERE version=1').run('0'.repeat(64));
    db.close();db=null;
    assert.throws(()=>Db.openDatabase(filename),error=>error?.code==='SCHEMA_MIGRATION_MISMATCH');
  }finally{
    try{db?.close()}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
