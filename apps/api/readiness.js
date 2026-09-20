'use strict';

const fs=require('node:fs');
const path=require('node:path');

const DEFAULT_MIN_FREE_BYTES=128*1024*1024;

function readinessError(code){const error=new Error(code);error.code=code;return error}

function initializeReadiness(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_readiness_probe(
      id INTEGER PRIMARY KEY CHECK(id=1),
      touched_at TEXT NOT NULL
    ) STRICT;
    INSERT OR IGNORE INTO runtime_readiness_probe(id,touched_at) VALUES(1,'1970-01-01T00:00:00.000Z');
  `);
}

function pragmaValue(db,name){
  const row=db.prepare(`PRAGMA ${name}`).get();
  return row?Object.values(row)[0]:undefined;
}

function probeDatabase(db,{persistent=false}={}){
  const issues=[];
  try{
    if(Number(pragmaValue(db,'foreign_keys'))!==1)issues.push('READINESS_FOREIGN_KEYS_DISABLED');
    const integrity=db.prepare('PRAGMA quick_check(1)').all();
    if(integrity.length!==1||String(Object.values(integrity[0]||{})[0]||'').toLowerCase()!=='ok')issues.push('READINESS_DATABASE_INTEGRITY_FAILED');
    if(db.prepare('PRAGMA foreign_key_check').all().length)issues.push('READINESS_FOREIGN_KEY_VIOLATION');
    if(persistent){
      const journal=String(pragmaValue(db,'journal_mode')||'').toLowerCase();
      if(journal!=='wal')issues.push('READINESS_JOURNAL_MODE_UNSAFE');
      if(Number(pragmaValue(db,'synchronous'))!==2)issues.push('READINESS_SYNCHRONOUS_NOT_FULL');
    }
    let savepoint=false;
    try{
      db.exec('SAVEPOINT runtime_readiness_write');
      savepoint=true;
      const result=db.prepare('UPDATE runtime_readiness_probe SET touched_at=? WHERE id=1').run(new Date().toISOString());
      if(Number(result.changes||0)!==1)issues.push('READINESS_DATABASE_WRITE_FAILED');
      db.exec('ROLLBACK TO runtime_readiness_write');
      db.exec('RELEASE runtime_readiness_write');
      savepoint=false;
    }catch(error){
      issues.push('READINESS_DATABASE_WRITE_FAILED');
      if(savepoint){try{db.exec('ROLLBACK TO runtime_readiness_write')}catch{}try{db.exec('RELEASE runtime_readiness_write')}catch{}}
    }
  }catch(error){
    issues.push('READINESS_DATABASE_UNAVAILABLE');
  }
  return{ok:issues.length===0,issues:[...new Set(issues)]};
}

function freeBytesFor(directory,fsImpl=fs){
  if(typeof fsImpl.statfsSync!=='function')return null;
  const stat=fsImpl.statfsSync(directory,{bigint:true});
  return stat.bavail*stat.bsize;
}

function probeStorage(databasePath,{requirePrivatePermissions=false,minFreeBytes=DEFAULT_MIN_FREE_BYTES,fsImpl=fs}={}){
  if(databasePath===':memory:')return{ok:true,issues:[],persistent:false};
  const issues=[];
  try{
    const absolute=path.resolve(databasePath),real=fsImpl.realpathSync(absolute),stat=fsImpl.statSync(real);
    if(!stat.isFile())issues.push('READINESS_DATABASE_FILE_INVALID');
    fsImpl.accessSync(real,fs.constants.R_OK|fs.constants.W_OK);
    const directory=path.dirname(real);
    fsImpl.accessSync(directory,fs.constants.R_OK|fs.constants.W_OK|fs.constants.X_OK);
    if(requirePrivatePermissions&&(stat.mode&0o077)!==0)issues.push('READINESS_DATABASE_PERMISSIONS_UNSAFE');
    const free=freeBytesFor(directory,fsImpl);
    if(free!==null&&free<BigInt(minFreeBytes))issues.push('READINESS_STORAGE_LOW');
  }catch(error){
    issues.push('READINESS_STORAGE_UNAVAILABLE');
  }
  return{ok:issues.length===0,issues:[...new Set(issues)],persistent:true};
}

function evaluateReadiness({db,databasePath=':memory:',requirePrivatePermissions=false,minFreeBytes=DEFAULT_MIN_FREE_BYTES,fsImpl=fs}){
  const database=probeDatabase(db,{persistent:databasePath!==':memory:'});
  const storage=probeStorage(databasePath,{requirePrivatePermissions,minFreeBytes,fsImpl});
  const issues=[...new Set([...database.issues,...storage.issues])];
  return{
    ok:issues.length===0,
    status:issues.length?'not-ready':'ready',
    checks:{database:database.ok?'ok':'failed',storage:storage.ok?'ok':'failed'},
    issues
  };
}

module.exports=Object.freeze({DEFAULT_MIN_FREE_BYTES,initializeReadiness,probeDatabase,probeStorage,evaluateReadiness,readinessError});
