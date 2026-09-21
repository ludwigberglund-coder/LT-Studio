'use strict';

const crypto=require('node:crypto');
const {protectAppendOnly}=require('./history-guards.js');

const MIGRATIONS=Object.freeze([
  Object.freeze({
    version:1,
    name:'core-sqlite-baseline-2026-09-21',
    description:'Adopt the current verified LT Studio private SQLite core schema as the versioned migration baseline.',
    sql:''
  })
]);

function migrationError(message,code='SCHEMA_MIGRATION_ERROR'){
  const error=new Error(message);
  error.code=code;
  return error;
}
function checksum(row){
  return crypto.createHash('sha256')
    .update(JSON.stringify({version:row.version,name:row.name,description:row.description,sql:row.sql}))
    .digest('hex');
}
function expectedRows(){
  return MIGRATIONS.map(row=>({...row,checksumSha256:checksum(row)}));
}
function tableExists(db){
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get());
}
function readRows(db){
  if(!tableExists(db))return[];
  return db.prepare('SELECT version,name,checksum_sha256 AS checksumSha256,applied_at AS appliedAt FROM schema_migrations ORDER BY version').all();
}
function validateRows(rows){
  const expected=expectedRows();
  const known=new Map(expected.map(row=>[row.version,row]));
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
    const match=known.get(row.version);
    if(!match||row.name!==match.name||row.checksumSha256!==match.checksumSha256||!Number.isFinite(Date.parse(row.appliedAt))){
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
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY CHECK(version>0),name TEXT NOT NULL UNIQUE,checksum_sha256 TEXT NOT NULL CHECK(length(checksum_sha256)=64),applied_at TEXT NOT NULL) STRICT");
  const before=readRows(db);
  validateRows(before);
  const applied=new Set(before.map(row=>row.version));
  const savepoint=`schema_migrations_${crypto.randomBytes(8).toString('hex')}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try{
    const insert=db.prepare('INSERT INTO schema_migrations(version,name,checksum_sha256,applied_at) VALUES(?,?,?,?)');
    for(const migration of expectedRows()){
      if(applied.has(migration.version))continue;
      if(migration.sql)db.exec(migration.sql);
      insert.run(migration.version,migration.name,migration.checksumSha256,new Date().toISOString());
    }
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
  }catch(error){
    try{db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)}catch{}
    try{db.exec(`RELEASE SAVEPOINT ${savepoint}`)}catch{}
    throw error;
  }
  protectAppendOnly(db,'schema_migrations');
  return status(db);
}

module.exports=Object.freeze({MIGRATIONS,checksum,expectedRows,readRows,status,initialize,migrationError});
