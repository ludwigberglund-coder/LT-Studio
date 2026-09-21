'use strict';

const crypto=require('node:crypto');
const {protectAppendOnly}=require('./history-guards.js');

const CORE_SCHEMA_MIGRATION_ID='core-schema-2026-09-21-v1';
const MIGRATIONS=Object.freeze([
  Object.freeze({
    version:1,
    id:CORE_SCHEMA_MIGRATION_ID,
    name:'core-sqlite-baseline-2026-09-21',
    description:'Adopt the verified LT Studio private SQLite core schema as the versioned migration baseline.',
    sql:''
  }),
  Object.freeze({
    version:2,
    id:'customer-archive-2026-09-21-v2',
    name:'customer-archive-and-safe-removal-2026-09-21',
    description:'Add non-destructive customer archival state so invoice history can be preserved while archived customers are excluded from new invoicing.',
    sql:'ALTER TABLE customers ADD COLUMN archived_at TEXT; CREATE INDEX IF NOT EXISTS idx_customers_company_archived ON customers(company_id,archived_at,customer_number);'
  })
]);

function migrationError(message,code='SCHEMA_MIGRATION_ERROR'){
  const error=new Error(message);
  error.code=code;
  return error;
}
function checksum(row){
  return crypto.createHash('sha256')
    .update(JSON.stringify({version:row.version,id:row.id,name:row.name,description:row.description,sql:row.sql}))
    .digest('hex');
}
function expectedRows(){return MIGRATIONS.map(row=>({...row,checksumSha256:checksum(row)}))}
function tableExists(db){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get())}
function columnNames(db){return new Set(db.prepare('PRAGMA table_info(schema_migrations)').all().map(row=>row.name))}
function readRows(db){
  if(!tableExists(db))return[];
  const columns=columnNames(db);
  for(const name of ['id','version','name','checksum_sha256','applied_at']){
    if(!columns.has(name))throw migrationError('Migrationshistoriken saknar verifieringsmetadata.','SCHEMA_MIGRATION_METADATA_MISSING');
  }
  return db.prepare('SELECT id,version,name,checksum_sha256 AS checksumSha256,applied_at AS appliedAt FROM schema_migrations ORDER BY version,id').all();
}
function validateRows(rows){
  const expected=expectedRows();
  const knownByVersion=new Map(expected.map(row=>[row.version,row]));
  const maxKnown=expected.at(-1)?.version||0;
  const seen=new Set();
  for(const row of rows){
    if(!Number.isSafeInteger(row.version)||row.version<1)throw migrationError('Databasen innehåller ett ogiltigt migrationsnummer.','SCHEMA_MIGRATION_MISMATCH');
    if(seen.has(row.version))throw migrationError('Databasen innehåller dubbla migrationsnummer.','SCHEMA_MIGRATION_MISMATCH');
    seen.add(row.version);
    if(row.version>maxKnown)throw migrationError(
      `Databasen använder schema-version ${row.version}, men denna programversion känner endast till version ${maxKnown}. Start stoppad för att undvika nedgradering.`,
      'SCHEMA_VERSION_TOO_NEW'
    );
    const match=knownByVersion.get(row.version);
    if(!match||row.id!==match.id||row.name!==match.name||row.checksumSha256!==match.checksumSha256||!Number.isFinite(Date.parse(row.appliedAt))){
      throw migrationError(`Migrationshistoriken för version ${row.version} stämmer inte med programversionen.`,'SCHEMA_MIGRATION_MISMATCH');
    }
  }
  const highest=rows.at(-1)?.version||0;
  for(let version=1;version<=highest;version++){
    if(!seen.has(version))throw migrationError(`Migrationshistoriken saknar version ${version} före en senare tillämpad version.`,'SCHEMA_MIGRATION_GAP');
  }
  return{ok:true,currentVersion:highest,latestKnownVersion:maxKnown,rows};
}
function status(db){
  if(!tableExists(db))return Object.freeze({ok:false,currentVersion:0,latestKnownVersion:MIGRATIONS.at(-1)?.version||0,rows:[]});
  return Object.freeze(validateRows(readRows(db)));
}
function initialize(db){
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(
    id TEXT PRIMARY KEY,
    version INTEGER CHECK(version IS NULL OR version>0),
    name TEXT,
    checksum_sha256 TEXT,
    applied_at TEXT NOT NULL
  ) STRICT`);

  const columns=columnNames(db);
  const metadata=['version','name','checksum_sha256'];
  const present=metadata.filter(name=>columns.has(name));
  const legacyRows=db.prepare('SELECT id,applied_at AS appliedAt FROM schema_migrations ORDER BY applied_at,id').all();

  if(present.length>0&&present.length<metadata.length){
    throw migrationError('Migrationshistoriken har en ofullständig metadatauppgradering. Start stoppad.','SCHEMA_MIGRATION_METADATA_PARTIAL');
  }
  if(present.length===0){
    if(legacyRows.some(row=>row.id!==CORE_SCHEMA_MIGRATION_ID)){
      throw migrationError('Den äldre migrationshistoriken innehåller en okänd migration. Start stoppad.','SCHEMA_MIGRATION_UNKNOWN_LEGACY');
    }
    db.exec('ALTER TABLE schema_migrations ADD COLUMN version INTEGER; ALTER TABLE schema_migrations ADD COLUMN name TEXT; ALTER TABLE schema_migrations ADD COLUMN checksum_sha256 TEXT;');
    if(legacyRows.length===1){
      const baseline=expectedRows()[0];
      db.prepare('UPDATE schema_migrations SET version=?,name=?,checksum_sha256=? WHERE id=?')
        .run(baseline.version,baseline.name,baseline.checksumSha256,baseline.id);
    }
  }

  let rows=readRows(db);
  let report=validateRows(rows);
  const insert=db.prepare('INSERT INTO schema_migrations(id,version,name,checksum_sha256,applied_at) VALUES(?,?,?,?,?)');
  for(const migration of expectedRows().filter(row=>row.version>report.currentVersion)){
    const expectedNext=(rows.at(-1)?.version||0)+1;
    if(migration.version!==expectedNext){
      throw migrationError(`Nästa kända migration är version ${migration.version}, men version ${expectedNext} krävs först.`,'SCHEMA_MIGRATION_GAP');
    }
    if(migration.sql)db.exec(migration.sql);
    insert.run(migration.id,migration.version,migration.name,migration.checksumSha256,new Date().toISOString());
    rows=readRows(db);
    report=validateRows(rows);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_migrations_version ON schema_migrations(version); CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_migrations_name ON schema_migrations(name);');
  protectAppendOnly(db,'schema_migrations');
  return Object.freeze(report);
}

module.exports=Object.freeze({
  CORE_SCHEMA_MIGRATION_ID,
  MIGRATIONS,
  checksum,
  expectedRows,
  readRows,
  status,
  initialize,
  migrationError
});
