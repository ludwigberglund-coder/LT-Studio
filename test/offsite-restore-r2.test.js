'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const Db=require('../apps/api/database.js');
const Documents=require('../apps/api/documents.js');
const Payables=require('../apps/api/payables.js');
const CustomerInvoicing=require('../apps/api/customer-invoicing.js');
const BackupTarget=require('../scripts/r2-eu-backup-target.js');
const OffsiteRestore=require('../scripts/pilot-restore-offsite-r2.js');

const root=path.resolve(__dirname,'..');
const KEY='Offsite-Restore-Test-Key-2026-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function env(overrides={}){
  return{
    ROLLANDS_ENV:'staging',
    R2_BACKUP_ENABLED:'1',
    R2_BACKUP_JURISDICTION:'eu',
    R2_BACKUP_ACCOUNT_ID:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    R2_BACKUP_BUCKET:'rollands-offsite-restore-test',
    R2_BACKUP_ACCESS_KEY_ID:'restore-test-access-key',
    R2_BACKUP_SECRET_ACCESS_KEY:'restore-test-secret-key-123456789',
    ROLLANDS_BACKUP_ENCRYPTION_KEY:KEY,
    ...overrides
  };
}
function fakeR2(){
  const objects=new Map();
  async function fetchImpl(url,options={}){
    const target=url instanceof URL?url:new URL(String(url));
    const parts=target.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    parts.shift();
    const storageKey=parts.join('/');
    const method=String(options.method||'GET').toUpperCase();
    if(method==='PUT'){
      const chunks=[];
      for await(const chunk of options.body||[])chunks.push(Buffer.from(chunk));
      const bytes=Buffer.concat(chunks);
      if(objects.has(storageKey))return new Response(null,{status:412});
      objects.set(storageKey,bytes);
      return new Response(null,{status:200});
    }
    if(method==='GET'){
      if(!objects.has(storageKey))return new Response(null,{status:404});
      const bytes=objects.get(storageKey);
      return new Response(bytes,{status:200,headers:{'content-length':String(bytes.length)}});
    }
    return new Response(null,{status:405});
  }
  return{objects,fetchImpl};
}
function createBackup(dir){
  const databasePath=path.join(dir,'platform.sqlite');
  const backupDir=path.join(dir,'backups');
  fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
  const db=Db.openDatabase(databasePath);
  Documents.initializeDocuments(db);
  Payables.initializePayables(db);
  CustomerInvoicing.initializeCustomerInvoicing(db);
  const company=Db.createCompany(db,{legalName:'Offsite Restore AB',displayName:'Offsite Restore',orgNumber:'559955-2002'});
  const user=Db.createUser(db,{username:'offsite.restore',displayName:'Offsite Restore',passwordHash:'test-only'});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  Db.appendAudit(db,{companyId:company.id,userId:user.id,action:'OFFSITE_RESTORE_FIXTURE',entityType:'company',entityId:company.id});
  db.close();

  const result=spawnSync(process.execPath,['scripts/pilot-backup.js'],{
    cwd:root,
    encoding:'utf8',
    env:{...process.env,ROLLANDS_DATABASE_PATH:databasePath,ROLLANDS_BACKUP_PATH:backupDir,ROLLANDS_BACKUP_ENCRYPTION_KEY:KEY}
  });
  assert.equal(result.status,0,result.stderr);
  const encrypted=path.join(backupDir,fs.readdirSync(backupDir).find(name=>name.endsWith('.sqlite.enc')));
  return{databasePath,backupDir,artifact:BackupTarget.inspectEncryptedBackup(encrypted)};
}
async function uploadAndEvidence(dir,artifact,remote,now){
  const selectedEnv=env();
  const config=BackupTarget.configFromEnvironment(selectedEnv);
  const target=BackupTarget.createR2EuBackupTarget({config,fetchImpl:remote.fetchImpl});
  const uploaded=await BackupTarget.uploadEncryptedBackup({artifact,target});
  const evidencePath=path.join(dir,'ops','offsite-backup-evidence.json');
  fs.mkdirSync(path.dirname(evidencePath),{recursive:true,mode:0o700});
  fs.writeFileSync(evidencePath,JSON.stringify({
    schemaVersion:1,
    verifiedAt:now.toISOString(),
    provider:'r2',
    jurisdiction:'eu',
    bucket:config.bucket,
    encryptedFile:uploaded.basename,
    encryptedSha256:uploaded.sha256,
    encryptedSizeBytes:uploaded.sizeBytes,
    encryptedStorageKey:uploaded.storageKey,
    checksumStorageKey:uploaded.checksumStorageKey,
    remoteEncryptedVerified:true,
    remoteChecksumVerified:true
  }),{mode:0o600});
  return{evidencePath,uploaded,selectedEnv};
}

test('offsite restore hämtar faktiska R2-objekt, verifierar databasen och rensar arbetskopior',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-offsite-restore-'));
  try{
    const now=new Date('2026-09-21T14:30:00.000Z');
    const {databasePath,artifact}=createBackup(dir);
    const remote=fakeR2();
    const {evidencePath,selectedEnv}=await uploadAndEvidence(dir,artifact,remote,now);
    const drillDir=path.join(dir,'restore-drill');
    const restoreEvidencePath=path.join(dir,'ops','offsite-restore-evidence.json');

    fs.rmSync(artifact.filename,{force:true});
    fs.rmSync(artifact.checksumFile,{force:true});

    const evidence=await OffsiteRestore.runOffsiteRestore({
      env:{...selectedEnv,ROLLANDS_DATABASE_PATH:databasePath,ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH:evidencePath,ROLLANDS_RESTORE_DRILL_PATH:drillDir,ROLLANDS_OFFSITE_RESTORE_EVIDENCE_PATH:restoreEvidencePath},
      fetchImpl:remote.fetchImpl,
      now
    });

    assert.equal(evidence.provider,'r2');
    assert.equal(evidence.remoteDownloadVerified,true);
    assert.equal(evidence.sqliteIntegrity,true);
    assert.equal(evidence.foreignKeys,true);
    assert.equal(evidence.privateObjectsVerified,true);
    assert.equal(evidence.privateObjectSchemaComplete,true);
    assert.equal(evidence.productionDatabaseTouched,false);
    assert.equal(evidence.restoreCopyRemoved,true);
    assert.equal(evidence.downloadedCopiesRemoved,true);
    assert.ok(fs.existsSync(databasePath));
    assert.equal(fs.statSync(restoreEvidencePath).mode&0o077,0);
    assert.deepEqual(fs.existsSync(drillDir)?fs.readdirSync(drillDir):[],[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('korrupt R2-kopia stoppar restore och får inte skriva över tidigare evidens',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-offsite-restore-corrupt-'));
  try{
    const now=new Date('2026-09-21T14:30:00.000Z');
    const {databasePath,artifact}=createBackup(dir);
    const remote=fakeR2();
    const {evidencePath,uploaded,selectedEnv}=await uploadAndEvidence(dir,artifact,remote,now);
    const damaged=Buffer.from(remote.objects.get(uploaded.storageKey));
    damaged[damaged.length-1]^=1;
    remote.objects.set(uploaded.storageKey,damaged);

    const drillDir=path.join(dir,'restore-drill');
    const restoreEvidencePath=path.join(dir,'ops','offsite-restore-evidence.json');
    fs.writeFileSync(restoreEvidencePath,'{"sentinel":true}\n',{mode:0o600});

    await assert.rejects(
      ()=>OffsiteRestore.runOffsiteRestore({
        env:{...selectedEnv,ROLLANDS_DATABASE_PATH:databasePath,ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH:evidencePath,ROLLANDS_RESTORE_DRILL_PATH:drillDir,ROLLANDS_OFFSITE_RESTORE_EVIDENCE_PATH:restoreEvidencePath},
        fetchImpl:remote.fetchImpl,
        now
      }),
      error=>error.code==='R2_BACKUP_REMOTE_INTEGRITY_MISMATCH'
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(restoreEvidencePath,'utf8')),{sentinel:true});
    assert.deepEqual(fs.existsSync(drillDir)?fs.readdirSync(drillDir):[],[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
