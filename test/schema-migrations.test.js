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

test('ny databas registrerar den verifierade core-schema-migrationen',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const row=db.prepare('SELECT id,applied_at AS appliedAt FROM schema_migrations WHERE id=?').get(Db.CORE_SCHEMA_MIGRATION_ID);
    assert.ok(row);
    assert.equal(row.id,Db.CORE_SCHEMA_MIGRATION_ID);
    assert.ok(Number.isFinite(Date.parse(row.appliedAt)));
  }finally{
    db.close();
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
      const migration=migrated.prepare('SELECT id FROM schema_migrations WHERE id=?').get(Db.CORE_SCHEMA_MIGRATION_ID);
      assert.equal(migration.id,Db.CORE_SCHEMA_MIGRATION_ID);
      assert.equal(migrated.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    }finally{
      migrated.close();
    }
  }finally{
    if(raw)try{raw.close()}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
