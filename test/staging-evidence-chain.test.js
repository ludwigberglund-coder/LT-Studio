'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {validateEvidenceChain}=require('../scripts/staging-evidence-verify.js');
const Db=require('../apps/api/database.js');
const AuditAnchor=require('../scripts/audit-anchor.js');

function write(filename,value){
  fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  fs.writeFileSync(filename,JSON.stringify(value));
}

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-staging-evidence-'));
  const dbDir=path.join(dir,'db'),backupDir=path.join(dir,'backup'),opsDir=path.join(dir,'ops');
  fs.mkdirSync(dbDir,{mode:0o700});fs.mkdirSync(backupDir,{mode:0o700});fs.mkdirSync(opsDir,{mode:0o700});
  const operationsPath=path.join(dir,'operations.json');
  write(operationsPath,{
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
  });

  const now=Date.UTC(2026,8,21,15,0,0);
  const objectBucket='rollands-private-staging';
  const backupBucket='rollands-backup-staging';
  const auditBucket='rollands-audit-staging';
  const backupSha='d'.repeat(64);
  const backupFile='rollands-20260921T140000.sqlite.enc';
  const r2Path=path.join(opsDir,'r2-audit.json');
  const offsitePath=path.join(opsDir,'offsite-backup.json');
  const restorePath=path.join(opsDir,'restore-drill.json');
  const r2RestorePath=path.join(opsDir,'r2-restore-drill.json');
  const monitorPath=path.join(opsDir,'monitoring.json');
  const loggingPath=path.join(opsDir,'logging.json');
  const auditAnchorPath=path.join(opsDir,'audit-anchor.json');
  const auditAnchorEvidencePath=path.join(opsDir,'audit-anchor-r2.json');
  const databasePath=path.join(dbDir,'platform.sqlite');

  const auditDb=Db.openDatabase(databasePath);
  const auditCompany=Db.createCompany(auditDb,{legalName:'Staging Evidence AB',displayName:'Staging Evidence',orgNumber:'559999-5511'});
  const auditUser=Db.createUser(auditDb,{username:'staging-evidence',displayName:'Staging Evidence',passwordHash:'test-password-hash'});
  Db.addMembership(auditDb,{companyId:auditCompany.id,userId:auditUser.id});
  Db.appendAudit(auditDb,{companyId:auditCompany.id,userId:auditUser.id,action:'STAGING_EVIDENCE_FIXTURE',entityType:'fixture',entityId:'one',details:{ok:true}});
  Db.appendSecurityEvent(auditDb,{kind:'staging-fixture',severity:'info',fingerprintHash:'a'.repeat(64),details:{ok:true}});
  const auditOperator=Db.createPlatformOperator(auditDb,{username:'staging-operator',displayName:'Staging Operator',passwordHash:'test-password-hash',mfaSecretEncrypted:'test-encrypted-secret'});
  Db.appendPlatformOperatorAudit(auditDb,{operatorId:auditOperator.id,action:'STAGING_EVIDENCE_FIXTURE',details:{ok:true}});
  auditDb.close();
  fs.chmodSync(databasePath,0o600);
  const auditAnchor=AuditAnchor.createAuditAnchorFromDatabase(databasePath,{now:now-15*60*1000});
  const writtenAuditAnchor=AuditAnchor.writeAnchor(auditAnchorPath,auditAnchor);
  write(auditAnchorEvidencePath,{
    schemaVersion:1,
    verifiedAt:new Date(now-10*60*1000).toISOString(),
    provider:'r2',
    jurisdiction:'eu',
    bucket:auditBucket,
    storageKey:`audit-anchors/v1/${auditAnchor.rootSha256}.json`,
    rootSha256:auditAnchor.rootSha256,
    anchorSha256:writtenAuditAnchor.sha256,
    anchorSizeBytes:writtenAuditAnchor.sizeBytes,
    remoteReadbackVerified:true
  });

  write(r2Path,{
    schemaVersion:1,
    auditedAt:new Date(now-60*60*1000).toISOString(),
    sourceProvider:'sqlite',
    targetProvider:'r2',
    sourceManifestSha256:'c'.repeat(64),
    ok:true,
    sourceOk:true,
    sourceObjectCount:3,
    sourceTotalBytes:60,
    readyCount:3,
    verifiedExternalCount:3,
    missingReadyCount:0,
    issueCount:0,
    countsByKind:{
      document:{objects:1,ready:1,verified:1,bytes:10},
      'supplier-invoice':{objects:1,ready:1,verified:1,bytes:20},
      'customer-invoice-pdf':{objects:1,ready:1,verified:1,bytes:30}
    },
    issues:[],
    target:{provider:'r2',jurisdiction:'eu',bucket:objectBucket}
  });

  write(offsitePath,{
    schemaVersion:1,
    verifiedAt:new Date(now-40*60*1000).toISOString(),
    provider:'r2',
    jurisdiction:'eu',
    bucket:backupBucket,
    encryptedFile:backupFile,
    encryptedSha256:backupSha,
    encryptedSizeBytes:500,
    encryptedStorageKey:`encrypted-sqlite-backups/${backupSha}/${backupFile}`,
    checksumStorageKey:`encrypted-sqlite-backups/${backupSha}/${backupFile}.sha256`,
    remoteEncryptedVerified:true,
    remoteChecksumVerified:true
  });

  write(restorePath,{
    schemaVersion:2,
    verifiedAt:new Date(now-30*60*1000).toISOString(),
    sourceFile:backupFile,
    sourceEncryptedSha256:backupSha,
    sourceSizeBytes:500,
    sqliteIntegrity:true,
    foreignKeys:true,
    tenantRelations:0,
    journalEntries:1,
    archivedDocuments:3,
    privateObjectsVerified:true,
    privateObjectSchemaComplete:true,
    privateObjectCount:3,
    verifiedPrivateObjectCount:3,
    privateObjectBytes:60,
    privateObjectIssueCount:0,
    privateObjectsByKind:{
      document:{objects:1,verified:1,bytes:10},
      'supplier-invoice':{objects:1,verified:1,bytes:20},
      'customer-invoice-pdf':{objects:1,verified:1,bytes:30}
    },
    productionDatabaseTouched:false,
    restoreCopyRemoved:true
  });

  write(r2RestorePath,{
    schemaVersion:1,
    verifiedAt:new Date(now-25*60*1000).toISOString(),
    sourceProvider:'r2',
    provider:'r2',
    jurisdiction:'eu',
    bucket:backupBucket,
    sourceFile:backupFile,
    sourceEncryptedSha256:backupSha,
    sourceSizeBytes:500,
    sourceStorageKey:`encrypted-sqlite-backups/${backupSha}/${backupFile}`,
    remoteDownloadVerified:true,
    sqliteIntegrity:true,
    foreignKeys:true,
    tenantRelations:0,
    journalEntries:1,
    archivedDocuments:3,
    privateObjectsVerified:true,
    privateObjectSchemaComplete:true,
    privateObjectCount:3,
    verifiedPrivateObjectCount:3,
    privateObjectBytes:60,
    privateObjectIssueCount:0,
    privateObjectsByKind:{
      document:{objects:1,verified:1,bytes:10},
      'supplier-invoice':{objects:1,verified:1,bytes:20},
      'customer-invoice-pdf':{objects:1,verified:1,bytes:30}
    },
    productionDatabaseTouched:false,
    remoteDownloadRemoved:true,
    restoreCopyRemoved:true
  });

  write(monitorPath,{
    schemaVersion:1,
    provider:'Extern monitor',
    endpoint:'https://staging.example.se/api/v1/readiness/core',
    alertRoute:'driftjour',
    checkedAt:new Date(now-20*60*1000).toISOString(),
    alertTestedAt:new Date(now-25*60*1000).toISOString(),
    readinessProbeSucceeded:true,
    alertDeliverySucceeded:true,
    alertTestReference:'alert-test-staging-001',
    alertObserver:'LT Studio driftansvarig'
  });
  write(loggingPath,{
    schemaVersion:1,
    environment:'staging',
    source:'stderr',
    provider:'Central Logg AB',
    destination:'lt-studio-staging',
    testedAt:new Date(now-15*60*1000).toISOString(),
    testRequestId:'123e4567-e89b-42d3-a456-426614174000',
    requestIdLookupSucceeded:true,
    lookupReference:'lookup-staging-001',
    observer:'LT Studio driftansvarig',
    transportEncrypted:true,
    accessRestricted:true,
    retentionDays:30,
    alerts:{securityEvent:true,http5xx:true,streamMissing:true},
    alertingReference:'alerts-staging-001'
  });

  const env={
    NODE_ENV:'production',
    ROLLANDS_ENV:'staging',
    ROLLANDS_DEMO_DATA:'0',
    ROLLANDS_DATABASE_PATH:databasePath,
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
    R2_STAGING_BUCKET:objectBucket,
    R2_STAGING_ACCESS_KEY_ID:'staging-access-key',
    R2_STAGING_SECRET_ACCESS_KEY:'staging-secret-key-1234567890',
    R2_BACKUP_ENABLED:'1',
    R2_BACKUP_JURISDICTION:'eu',
    R2_BACKUP_ACCOUNT_ID:'b'.repeat(32),
    R2_BACKUP_BUCKET:backupBucket,
    R2_BACKUP_ACCESS_KEY_ID:'backup-access-key',
    R2_BACKUP_SECRET_ACCESS_KEY:'backup-secret-key-1234567890',
    R2_AUDIT_ENABLED:'1',
    R2_AUDIT_JURISDICTION:'eu',
    R2_AUDIT_ACCOUNT_ID:'c'.repeat(32),
    R2_AUDIT_BUCKET:auditBucket,
    R2_AUDIT_ACCESS_KEY_ID:'audit-access-key',
    R2_AUDIT_SECRET_ACCESS_KEY:'audit-secret-key-1234567890',
    R2_STAGING_AUDIT_EVIDENCE_PATH:r2Path,
    ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH:offsitePath,
    ROLLANDS_RESTORE_DRILL_PATH:path.join(dir,'restore'),
    ROLLANDS_RESTORE_DRILL_EVIDENCE_PATH:restorePath,
    ROLLANDS_R2_RESTORE_DRILL_EVIDENCE_PATH:r2RestorePath,
    ROLLANDS_MONITORING_EVIDENCE_PATH:monitorPath,
    ROLLANDS_LOGGING_EVIDENCE_PATH:loggingPath,
    ROLLANDS_AUDIT_ANCHOR_PATH:auditAnchorPath,
    ROLLANDS_AUDIT_ANCHOR_EVIDENCE_PATH:auditAnchorEvidencePath
  };
  return{dir,env,now,paths:{r2Path,offsitePath,restorePath,r2RestorePath,monitorPath,loggingPath,auditAnchorPath,auditAnchorEvidencePath,databasePath},backupSha,backupFile};
}

test('staging evidence chain passes only when all fresh proofs agree',()=>{
  const f=fixture();
  try{
    const result=validateEvidenceChain(f.env,{now:f.now});
    assert.equal(result.ok,true,JSON.stringify({fail:result.fail,checks:result.checks,evidence:result.evidence}));
    assert.deepEqual(result.fail,[]);
    assert.equal(result.checks.sameBackupArtifact,true);
    assert.equal(result.checks.logging,true);
    assert.equal(result.checks.auditAnchor,true);
    assert.equal(result.evidence.loggingRetentionDays,30);
    assert.equal(result.evidence.loggingTestRequestId,'123e4567-e89b-42d3-a456-426614174000');
    assert.equal(result.evidence.backupSha256,f.backupSha);
    assert.match(result.evidence.auditAnchorRootSha256,/^[a-f0-9]{64}$/);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});

test('staging evidence chain rejects restore proof for another backup',()=>{
  const f=fixture();
  try{
    const restore=JSON.parse(fs.readFileSync(f.paths.restorePath,'utf8'));
    restore.sourceEncryptedSha256='e'.repeat(64);
    write(f.paths.restorePath,restore);
    const result=validateEvidenceChain(f.env,{now:f.now});
    assert.equal(result.ok,false);
    assert.equal(result.checks.sameBackupArtifact,false);
    assert.ok(result.fail.some(item=>item.includes('samma krypterade backup-SHA')));
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});

test('staging evidence chain rejects evidence from wrong R2 buckets',()=>{
  const f=fixture();
  try{
    const r2=JSON.parse(fs.readFileSync(f.paths.r2Path,'utf8'));
    r2.target.bucket='other-private-staging';
    write(f.paths.r2Path,r2);
    const offsite=JSON.parse(fs.readFileSync(f.paths.offsitePath,'utf8'));
    offsite.bucket='other-backup-staging';
    write(f.paths.offsitePath,offsite);
    const result=validateEvidenceChain(f.env,{now:f.now});
    assert.equal(result.ok,false);
    assert.equal(result.checks.r2Audit,false);
    assert.equal(result.checks.offsiteBackup,false);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});

test('staging evidence chain rejects stale R2 audit',()=>{
  const f=fixture();
  try{
    const r2=JSON.parse(fs.readFileSync(f.paths.r2Path,'utf8'));
    r2.auditedAt=new Date(f.now-27*60*60*1000).toISOString();
    write(f.paths.r2Path,r2);
    const result=validateEvidenceChain(f.env,{now:f.now});
    assert.equal(result.ok,false);
    assert.equal(result.checks.r2Audit,false);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});


test('staging evidence chain rejects R2 restore proof for another backup',()=>{
  const f=fixture();
  try{
    const restore=JSON.parse(fs.readFileSync(f.paths.r2RestorePath,'utf8'));
    restore.sourceEncryptedSha256='f'.repeat(64);
    restore.sourceStorageKey=`encrypted-sqlite-backups/${restore.sourceEncryptedSha256}/${restore.sourceFile}`;
    write(f.paths.r2RestorePath,restore);
    const result=validateEvidenceChain(f.env,{now:f.now});
    assert.equal(result.ok,false);
    assert.equal(result.checks.r2RestoreDrill,true);
    assert.equal(result.checks.sameBackupArtifact,false);
    assert.ok(result.fail.some(item=>item.includes('R2 restore-drillen gäller inte samma krypterade backup-SHA')));
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});


test('staging evidence chain rejects changed history after audit anchor',()=>{
  const f=fixture();
  const db=Db.openDatabase(f.paths.databasePath);
  try{
    db.exec('DROP TRIGGER history_audit_events_update');
    db.exec("UPDATE audit_events SET action='TAMPERED'");
  }finally{db.close()}
  try{
    const result=validateEvidenceChain(f.env,{now:f.now});
    assert.equal(result.ok,false);
    assert.equal(result.checks.auditAnchor,false);
    assert.ok(result.fail.some(item=>item.includes('Audit-ankaret')));
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});

test('staging evidence chain rejects audit evidence from wrong or stale audit bucket proof',()=>{
  const f=fixture();
  try{
    const evidence=JSON.parse(fs.readFileSync(f.paths.auditAnchorEvidencePath,'utf8'));
    evidence.bucket='other-audit-bucket';
    write(f.paths.auditAnchorEvidencePath,evidence);
    let result=validateEvidenceChain(f.env,{now:f.now});
    assert.equal(result.ok,false);
    assert.equal(result.checks.auditAnchor,false);

    evidence.bucket=f.env.R2_AUDIT_BUCKET;
    evidence.verifiedAt=new Date(f.now-25*60*60*1000).toISOString();
    write(f.paths.auditAnchorEvidencePath,evidence);
    result=validateEvidenceChain(f.env,{now:f.now});
    assert.equal(result.ok,false);
    assert.equal(result.checks.auditAnchor,false);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});


test('staging evidence chain rejects stale central logging proof',()=>{
  const f=fixture();
  try{
    const evidence=JSON.parse(fs.readFileSync(f.paths.loggingPath,'utf8'));
    evidence.testedAt=new Date(f.now-25*60*60*1000).toISOString();
    write(f.paths.loggingPath,evidence);
    const result=validateEvidenceChain(f.env,{now:f.now});
    assert.equal(result.ok,false);
    assert.equal(result.checks.logging,false);
    assert.ok(result.fail.some(item=>item.includes('Central loggtransport')));
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});

test('staging evidence chain rejects logging retention that differs from operations decision',()=>{
  const f=fixture();
  try{
    const evidence=JSON.parse(fs.readFileSync(f.paths.loggingPath,'utf8'));
    evidence.retentionDays=14;
    write(f.paths.loggingPath,evidence);
    const result=validateEvidenceChain(f.env,{now:f.now});
    assert.equal(result.ok,false);
    assert.equal(result.checks.logging,false);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
