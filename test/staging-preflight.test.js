'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {validateStaging}=require('../scripts/staging-preflight.js');

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-staging-gate-'));
  const dbDir=path.join(dir,'db');
  const backupDir=path.join(dir,'backup');
  const opsDir=path.join(dir,'ops');
  fs.mkdirSync(dbDir,{mode:0o700});
  fs.mkdirSync(backupDir,{mode:0o700});
  fs.mkdirSync(opsDir,{mode:0o700});
  const operationsPath=path.join(dir,'operations.json');
  fs.writeFileSync(operationsPath,JSON.stringify({
    schemaVersion:1,
    technicalOwner:'Tekniskt ansvar',
    accountingOwner:'Redovisningsansvar',
    dataProtectionOwner:'Dataskyddsansvar',
    backupOwner:'Backupansvar',
    monitoringOwner:'Övervakningsansvar',
    incidentContact:'incident@staging.test',
    supportChannel:'support@staging.test',
    pilotStopAuthority:'Pilotansvarig',
    rollbackDecisionProcess:'Dokumenterat beslut krävs före rollback.',
    offsiteBackupDestination:'Separat privat R2 backup-bucket i EU',
    logRetentionDays:30,
    backupRetentionDays:90,
    approvedForPilot:false,
    approvedAt:null
  }));

  const env={
    NODE_ENV:'production',
    ROLLANDS_ENV:'staging',
    ROLLANDS_DEMO_DATA:'0',
    ROLLANDS_DATABASE_PATH:path.join(dbDir,'platform.sqlite'),
    ROLLANDS_BACKUP_PATH:backupDir,
    ROLLANDS_PILOT_OPERATIONS_PATH:operationsPath,
    ROLLANDS_AUTH_ENCRYPTION_KEY:'staging-auth-key-v7r2M9xQ4pL8sT1nW6kD3yH5',
    ROLLANDS_BACKUP_ENCRYPTION_KEY:'staging-backup-key-v7r2M9xQ4pL8sT1nW6kD3yH5',
    ROLLANDS_API_SECURE_COOKIE:'1',
    ROLLANDS_API_HOST:'127.0.0.1',
    ROLLANDS_ALLOWED_HOSTS:'staging.rollands.internal',

    R2_STAGING_ENABLED:'1',
    R2_STAGING_JURISDICTION:'eu',
    R2_STAGING_ACCOUNT_ID:'a'.repeat(32),
    R2_STAGING_BUCKET:'rollands-private-staging',
    R2_STAGING_ACCESS_KEY_ID:'staging-access-key',
    R2_STAGING_SECRET_ACCESS_KEY:'staging-secret-key-1234567890',

    R2_BACKUP_ENABLED:'1',
    R2_BACKUP_JURISDICTION:'eu',
    R2_BACKUP_ACCOUNT_ID:'b'.repeat(32),
    R2_BACKUP_BUCKET:'rollands-backup-staging',
    R2_BACKUP_ACCESS_KEY_ID:'backup-access-key',
    R2_BACKUP_SECRET_ACCESS_KEY:'backup-secret-key-1234567890',

    R2_STAGING_AUDIT_EVIDENCE_PATH:path.join(opsDir,'r2-audit.json'),
    ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH:path.join(opsDir,'offsite-backup.json'),
    ROLLANDS_RESTORE_DRILL_EVIDENCE_PATH:path.join(opsDir,'restore-drill.json'),
    ROLLANDS_MONITORING_EVIDENCE_PATH:path.join(opsDir,'monitoring.json')
  };
  return{dir,env};
}

test('staging preflight accepts isolated EU R2 object and backup configuration',()=>{
  const {dir,env}=fixture();
  try{
    const result=validateStaging(env);
    assert.deepEqual(result.fail,[]);
    assert.ok(result.pass.includes('R2 private-object staging configuration'));
    assert.ok(result.pass.includes('R2 offsite-backup configuration'));
    assert.ok(result.pass.includes('Separate R2 object and backup buckets'));
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('staging preflight refuses shared R2 bucket and evidence inside repository',()=>{
  const {dir,env}=fixture();
  try{
    env.R2_BACKUP_BUCKET=env.R2_STAGING_BUCKET;
    env.ROLLANDS_MONITORING_EVIDENCE_PATH=path.join(__dirname,'monitoring-evidence.json');
    const result=validateStaging(env);
    assert.ok(result.fail.some(item=>item.includes('måste vara olika buckets')));
    assert.ok(result.fail.some(item=>item.includes('ROLLANDS_MONITORING_EVIDENCE_PATH')&&item.includes('utanför Git-repositoryt')));
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('staging preflight refuses missing or non-EU R2 staging credentials',()=>{
  const {dir,env}=fixture();
  try{
    env.R2_STAGING_JURISDICTION='us';
    env.R2_BACKUP_SECRET_ACCESS_KEY='';
    const result=validateStaging(env);
    assert.ok(result.fail.some(item=>item.includes('R2 private objects')));
    assert.ok(result.fail.some(item=>item.includes('R2 offsite backup')));
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
