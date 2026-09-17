'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const Db=require('../apps/api/database.js');
const {validateConfig}=require('../scripts/pilot-preflight.js');

const root=path.resolve(__dirname,'..');

test('pilot preflight stoppar demo, placeholders och databas i repositoryt',()=>{
  const result=validateConfig({
    NODE_ENV:'development',ROLLANDS_ENV:'pilot',ROLLANDS_DEMO_DATA:'1',
    ROLLANDS_DATABASE_PATH:path.join(root,'data','pilot.sqlite'),
    ROLLANDS_BACKUP_PATH:path.join(root,'backups'),
    ROLLANDS_AUTH_ENCRYPTION_KEY:'REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS',
    ROLLANDS_API_SECURE_COOKIE:'0',ROLLANDS_API_HOST:'127.0.0.1',ROLLANDS_ALLOWED_HOSTS:'portal.example.invalid'
  });
  assert.ok(result.fail.some(item=>item.includes('NODE_ENV')));
  assert.ok(result.fail.some(item=>item.includes('ROLLANDS_DEMO_DATA')));
  assert.ok(result.fail.some(item=>item.includes('ROLLANDS_DATABASE_PATH')));
  assert.ok(result.fail.some(item=>item.includes('ROLLANDS_BACKUP_PATH')));
  assert.ok(result.fail.some(item=>item.includes('ROLLANDS_AUTH_ENCRYPTION_KEY')));
  assert.ok(result.fail.some(item=>item.includes('ROLLANDS_API_SECURE_COOKIE')));
});

test('pilot preflight godkänner en säker serverkonfiguration utan att kräva demo',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-preflight-'));
  const dbDir=path.join(dir,'db'),backupDir=path.join(dir,'backup');
  fs.mkdirSync(dbDir,{mode:0o700});fs.mkdirSync(backupDir,{mode:0o700});
  try{
    const result=validateConfig({
      NODE_ENV:'production',ROLLANDS_ENV:'pilot',ROLLANDS_DEMO_DATA:'0',
      ROLLANDS_DATABASE_PATH:path.join(dbDir,'platform.sqlite'),ROLLANDS_BACKUP_PATH:backupDir,
      ROLLANDS_AUTH_ENCRYPTION_KEY:'v7r2M9xQ4pL8sT1nW6kD3yH5cF0bJ2zR',
      ROLLANDS_API_SECURE_COOKIE:'1',ROLLANDS_API_HOST:'127.0.0.1',ROLLANDS_ALLOWED_HOSTS:'pilot.rollands.internal'
    });
    assert.deepEqual(result.fail,[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('pilot backup och restore-kommandon skapar och verifierar separata SQLite-filer',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-deploy-backup-'));
  const dbDir=path.join(dir,'db'),backupDir=path.join(dir,'backups'),restoreDir=path.join(dir,'restore');
  fs.mkdirSync(dbDir,{mode:0o700});fs.mkdirSync(backupDir,{mode:0o700});fs.mkdirSync(restoreDir,{mode:0o700});
  const databasePath=path.join(dbDir,'platform.sqlite');
  const db=Db.openDatabase(databasePath);
  Db.createCompany(db,{legalName:'Pilot Drift Test AB',displayName:'Pilot Drift Test',orgNumber:'559999-4400'});
  db.close();
  try{
    const backup=spawnSync(process.execPath,['scripts/pilot-backup.js'],{cwd:root,encoding:'utf8',env:{...process.env,ROLLANDS_DATABASE_PATH:databasePath,ROLLANDS_BACKUP_PATH:backupDir}});
    assert.equal(backup.status,0,backup.stderr);
    const files=fs.readdirSync(backupDir).filter(name=>name.endsWith('.sqlite'));
    assert.equal(files.length,1);
    assert.ok(fs.existsSync(path.join(backupDir,`${files[0]}.sha256`)));
    const restoreTarget=path.join(restoreDir,'verified.sqlite');
    const restore=spawnSync(process.execPath,['scripts/pilot-restore-verify.js'],{cwd:root,encoding:'utf8',env:{...process.env,ROLLANDS_DATABASE_PATH:databasePath,ROLLANDS_RESTORE_SOURCE:path.join(backupDir,files[0]),ROLLANDS_RESTORE_TARGET:restoreTarget}});
    assert.equal(restore.status,0,restore.stderr);
    assert.ok(fs.existsSync(restoreTarget));
    const restored=Db.openDatabase(restoreTarget);
    assert.equal(restored.prepare('SELECT count(*) AS count FROM companies').get().count,1);
    restored.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('npm start pekar på det skyddade SQLite-API:t',()=>{
  const pkg=require('../package.json');
  assert.equal(pkg.scripts.start,'node apps/api/server.js');
});
