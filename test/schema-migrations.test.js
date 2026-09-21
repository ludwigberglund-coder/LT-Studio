'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Db=require('../apps/api/database.js');

function columns(db,table){
  return db.prepare('PRAGMA table_info("'+table+'")').all().map(row=>row.name);
}
function hasTable(db,name){
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}
function dropMigrationGuards(db){
  db.exec(`
    DROP TRIGGER IF EXISTS history_schema_migrations_update;
    DROP TRIGGER IF EXISTS history_schema_migrations_delete;
    DROP TRIGGER IF EXISTS history_schema_migrations_replace;
  `);
}

test('ny databas registrerar verifierbar append-only schemahistorik',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const status=Db.schemaMigrationStatus(db);
    assert.equal(status.ok,true);
    assert.equal(status.currentVersion,2);
    assert.equal(status.latestKnownVersion,2);
    assert.equal(status.rows.length,2);
    assert.equal(status.rows[0].id,Db.CORE_SCHEMA_MIGRATION_ID);
    assert.equal(status.rows[0].name,'core-sqlite-baseline-2026-09-21');
    assert.match(status.rows[0].checksumSha256,/^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(Date.parse(status.rows[0].appliedAt)));
    assert.throws(()=>db.prepare("UPDATE schema_migrations SET name='changed' WHERE version=1").run(),/HISTORY_IMMUTABLE/);
    assert.throws(()=>db.prepare('DELETE FROM schema_migrations WHERE version=1').run(),/HISTORY_IMMUTABLE/);
  }finally{
    db.close();
  }
});

test('befintlig tvåkolumners migrationsledger uppgraderas utan att affärsdata försvinner',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-schema-ledger-upgrade-'));
  const filename=path.join(dir,'platform.sqlite');
  let db;
  try{
    db=Db.openDatabase(filename);
    const company=Db.createCompany(db,{legalName:'Ledger Upgrade AB',displayName:'Ledger Upgrade',orgNumber:'559999-2101'});
    db.close();db=null;

    const raw=new DatabaseSync(filename);
    try{
      dropMigrationGuards(raw);
      raw.exec('DROP INDEX IF EXISTS idx_schema_migrations_version; DROP INDEX IF EXISTS idx_schema_migrations_name; DROP TABLE schema_migrations;');
      raw.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL) STRICT');
      raw.prepare('INSERT INTO schema_migrations(id,applied_at) VALUES(?,?)')
        .run(Db.CORE_SCHEMA_MIGRATION_ID,'2026-09-21T12:00:00.000Z');
    }finally{raw.close()}

    db=Db.openDatabase(filename);
    assert.equal(Db.companyById(db,company.id).orgNumber,'559999-2101');
    assert.deepEqual(columns(db,'schema_migrations'),['id','applied_at','version','name','checksum_sha256']);
    const status=Db.schemaMigrationStatus(db);
    assert.equal(status.ok,true);
    assert.equal(status.currentVersion,2);
    assert.equal(status.rows[0].id,Db.CORE_SCHEMA_MIGRATION_ID);
    assert.equal(status.rows[1].id,'customer-archive-2026-09-21-v2');
    assert.ok(columns(db,'customers').includes('archived_at'));
    assert.equal(status.rows[0].appliedAt,'2026-09-21T12:00:00.000Z');
    assert.match(status.rows[0].checksumSha256,/^[a-f0-9]{64}$/);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
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
    db.close();db=null;

    const raw=new DatabaseSync(filename);
    try{
      dropMigrationGuards(raw);
      raw.prepare('INSERT INTO schema_migrations(id,version,name,checksum_sha256,applied_at) VALUES(?,?,?,?,?)')
        .run('future-schema-v999',999,'future-version','f'.repeat(64),new Date().toISOString());
    }finally{raw.close()}

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
    db.close();db=null;

    const raw=new DatabaseSync(filename);
    try{
      raw.exec('DROP TRIGGER IF EXISTS history_schema_migrations_update');
      raw.prepare('UPDATE schema_migrations SET checksum_sha256=? WHERE version=1').run('0'.repeat(64));
    }finally{raw.close()}

    assert.throws(()=>Db.openDatabase(filename),error=>error?.code==='SCHEMA_MIGRATION_MISMATCH');
  }finally{
    try{db?.close()}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('okänd post i äldre tvåkolumners ledger stoppas i stället för att gissas',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-schema-unknown-legacy-'));
  const filename=path.join(dir,'platform.sqlite');
  let db;
  try{
    db=Db.openDatabase(filename);
    db.close();db=null;

    const raw=new DatabaseSync(filename);
    try{
      dropMigrationGuards(raw);
      raw.exec('DROP INDEX IF EXISTS idx_schema_migrations_version; DROP INDEX IF EXISTS idx_schema_migrations_name; DROP TABLE schema_migrations;');
      raw.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL) STRICT');
      raw.prepare('INSERT INTO schema_migrations(id,applied_at) VALUES(?,?)')
        .run('unknown-old-migration','2026-09-21T12:00:00.000Z');
    }finally{raw.close()}

    assert.throws(()=>Db.openDatabase(filename),error=>error?.code==='SCHEMA_MIGRATION_UNKNOWN_LEGACY');
  }finally{
    try{db?.close()}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('avbruten legacy-migration rullar tillbaka schemaändringar och migrationspost atomiskt',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-schema-migration-'));
  const filename=path.join(dir,'legacy.sqlite');
  let raw=new DatabaseSync(filename);
  try{
    raw.exec(`
      CREATE TABLE invoice_reminders(
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        invoice_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        principal_ore INTEGER NOT NULL,
        reminder_fee_ore INTEGER NOT NULL DEFAULT 0,
        interest_ore INTEGER NOT NULL DEFAULT 0,
        business_compensation_ore INTEGER NOT NULL DEFAULT 0,
        total_due_ore INTEGER NOT NULL,
        annual_rate_basis_points INTEGER NOT NULL,
        interest_segments_json TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO invoice_reminders(
        id,company_id,invoice_id,user_id,kind,sent_at,principal_ore,total_due_ore,
        annual_rate_basis_points,interest_segments_json,created_at
      ) VALUES(
        'legacy-reminder','company-old','invoice-old','user-old','payment-reminder',
        '2026-09-01T10:00:00.000Z',10000,10000,1000,'[]','2026-09-01T10:00:00.000Z'
      );
      CREATE TRIGGER abort_core_migration
      BEFORE UPDATE ON invoice_reminders
      BEGIN
        SELECT RAISE(ABORT,'MIGRATION_TEST_ABORT');
      END;
    `);
  }finally{
    raw.close();
  }

  try{
    assert.throws(()=>Db.openDatabase(filename),/MIGRATION_TEST_ABORT/);

    raw=new DatabaseSync(filename,{readOnly:false});
    const afterFailure=columns(raw,'invoice_reminders');
    assert.equal(afterFailure.includes('request_fingerprint'),false);
    assert.equal(afterFailure.includes('reminder_date'),false);
    assert.equal(afterFailure.includes('delivery_status'),false);
    assert.equal(hasTable(raw,'schema_migrations'),false);
    assert.equal(hasTable(raw,'companies'),false);
    raw.exec('DROP TRIGGER abort_core_migration');
    raw.close();
    raw=null;

    const migrated=Db.openDatabase(filename);
    try{
      const upgraded=columns(migrated,'invoice_reminders');
      for(const name of [
        'request_fingerprint','reminder_date','delivery_status','delivered_at',
        'rate_config_version','rate_verified_at','interest_start_basis',
        'interest_start_evidence_source','interest_start_verified_at'
      ])assert.equal(upgraded.includes(name),true,'saknad migrerad kolumn: '+name);
      const reminder=migrated.prepare('SELECT reminder_date AS reminderDate FROM invoice_reminders WHERE id=?').get('legacy-reminder');
      assert.equal(reminder.reminderDate,'2026-09-01');
      const status=Db.schemaMigrationStatus(migrated);
      assert.equal(status.ok,true);
      assert.equal(status.currentVersion,2);
      assert.equal(status.rows[0].id,Db.CORE_SCHEMA_MIGRATION_ID);
      assert.equal(status.rows[1].id,'customer-archive-2026-09-21-v2');
      assert.ok(columns(migrated,'customers').includes('archived_at'));
      assert.equal(migrated.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    }finally{
      migrated.close();
    }
  }finally{
    if(raw)try{raw.close()}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
