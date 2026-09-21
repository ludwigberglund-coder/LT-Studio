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
const {bootstrapSyntheticStaging}=require('../scripts/bootstrap-staging-synthetic.js');
const BackupTarget=require('../scripts/r2-eu-backup-target.js');
const {verifySyntheticStagingArtifact}=require('../scripts/pilot-backup-offsite-r2.js');

const root=path.resolve(__dirname,'..');
const BACKUP_KEY='Synthetic-Staging-Backup-Key-2026-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function syntheticEnv(dir){
  return{
    ROLLANDS_ENV:'staging',
    ROLLANDS_DATA_CLASSIFICATION:'synthetic',
    ROLLANDS_REAL_DATA_ALLOWED:'0',
    ROLLANDS_DEMO_DATA:'0',
    ROLLANDS_DATABASE_PATH:path.join(dir,'platform.sqlite'),
    ROLLANDS_BACKUP_PATH:path.join(dir,'backups'),
    ROLLANDS_AUTH_ENCRYPTION_KEY:'synthetic-staging-backup-auth-key-123456789-ABCDEFG',
    ROLLANDS_BACKUP_ENCRYPTION_KEY:BACKUP_KEY,
    ROLLANDS_STAGING_ALPHA_PASSWORD:'Backup-Synthetic-Alpha-Password-12345',
    ROLLANDS_STAGING_BETA_PASSWORD:'Backup-Synthetic-Beta-Password-67890',
    ROLLANDS_STAGING_ALPHA_MFA_SECRET:'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
    ROLLANDS_STAGING_BETA_MFA_SECRET:'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
  };
}

function initializePrivateObjectSchemas(filename){
  const db=Db.openDatabase(filename);
  try{
    Documents.initializeDocuments(db);
    Payables.initializePayables(db);
    CustomerInvoicing.initializeCustomerInvoicing(db);
  }finally{db.close()}
}

test('staging backup accepts the approved synthetic staging database',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-staging-backup-safe-'));
  const env=syntheticEnv(dir);
  try{
    bootstrapSyntheticStaging({env,root});
    initializePrivateObjectSchemas(env.ROLLANDS_DATABASE_PATH);
    const result=spawnSync(process.execPath,['scripts/pilot-backup.js'],{
      cwd:root,encoding:'utf8',env:{...process.env,...env}
    });
    assert.equal(result.status,0,result.stderr);
    const artifact=BackupTarget.latestEncryptedBackup(env.ROLLANDS_BACKUP_PATH);
    assert.equal(verifySyntheticStagingArtifact(artifact,BACKUP_KEY),true);
    assert.deepEqual(fs.readdirSync(env.ROLLANDS_BACKUP_PATH).filter(name=>name.includes('.synthetic-verify-')),[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('staging backup refuses a non-synthetic customer database before creating backup files',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-staging-backup-reject-'));
  const env=syntheticEnv(dir);
  try{
    const db=Db.openDatabase(env.ROLLANDS_DATABASE_PATH);
    try{
      Db.createCompany(db,{legalName:'Customer Data Example AB',displayName:'Customer Data Example',orgNumber:'559222-3333'});
    }finally{db.close()}
    const result=spawnSync(process.execPath,['scripts/pilot-backup.js'],{
      cwd:root,encoding:'utf8',env:{...process.env,...env}
    });
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Stagingdatabasen|syntetiska/i);
    assert.deepEqual(fs.existsSync(env.ROLLANDS_BACKUP_PATH)?fs.readdirSync(env.ROLLANDS_BACKUP_PATH):[],[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('staging R2 upload verification rejects an encrypted backup created from non-synthetic data',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-staging-offsite-reject-'));
  const env=syntheticEnv(dir);
  try{
    const db=Db.openDatabase(env.ROLLANDS_DATABASE_PATH);
    try{
      Documents.initializeDocuments(db);
      Payables.initializePayables(db);
      CustomerInvoicing.initializeCustomerInvoicing(db);
      Db.createCompany(db,{legalName:'Customer Backup Example AB',displayName:'Customer Backup Example',orgNumber:'559444-5555'});
    }finally{db.close()}

    const result=spawnSync(process.execPath,['scripts/pilot-backup.js'],{
      cwd:root,
      encoding:'utf8',
      env:{...process.env,...env,ROLLANDS_ENV:'pilot'}
    });
    assert.equal(result.status,0,result.stderr);
    const artifact=BackupTarget.latestEncryptedBackup(env.ROLLANDS_BACKUP_PATH);
    assert.throws(
      ()=>verifySyntheticStagingArtifact(artifact,BACKUP_KEY),
      error=>error?.code==='UNSAFE_STAGING_DATA'
    );
    assert.deepEqual(fs.readdirSync(env.ROLLANDS_BACKUP_PATH).filter(name=>name.includes('.synthetic-verify-')),[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
