'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const Release=require('../scripts/pilot-release-verify.js');
const {verifyDeploymentIdentity}=require('../scripts/pilot-preflight.js');
const {sha256File,SOURCE_ENV}=require('../scripts/staging-signoff-format.js');
const {validateRuntime}=require('../apps/api/private-runtime.js');

const root=path.resolve(__dirname,'..');

function git(cwd,args){return execFileSync('git',args,{cwd,encoding:'utf8'}).trim()}
function repoFixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-release-check-'));
  git(dir,['init','-q']);
  git(dir,['config','user.email','test@example.invalid']);
  git(dir,['config','user.name','Rollands Test']);
  fs.writeFileSync(path.join(dir,'tracked.txt'),'version one\n');
  git(dir,['add','tracked.txt']);
  git(dir,['commit','-q','-m','fixture']);
  return{dir,head:git(dir,['rev-parse','HEAD'])};
}

test('release verifier accepterar exakt HEAD med ren tracked worktree',()=>{
  const {dir,head}=repoFixture();
  try{
    fs.writeFileSync(path.join(dir,'untracked-runtime.log'),'runtime only\n');
    const result=Release.verifyRelease({cwd:dir,expectedCommit:head});
    assert.equal(result.ok,true);
    assert.equal(result.commit,head);
    assert.equal(result.trackedWorktreeClean,true);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('release verifier stoppar annan godkänd commit än deployad HEAD',()=>{
  const {dir}=repoFixture();
  try{
    assert.throws(
      ()=>Release.verifyRelease({cwd:dir,expectedCommit:'0'.repeat(40)}),
      error=>error.code==='RELEASE_COMMIT_MISMATCH'
    );
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('release verifier stoppar lokala ändringar i spårade filer',()=>{
  const {dir,head}=repoFixture();
  try{
    fs.writeFileSync(path.join(dir,'tracked.txt'),'locally changed\n');
    assert.throws(
      ()=>Release.verifyRelease({cwd:dir,expectedCommit:head}),
      error=>error.code==='RELEASE_WORKTREE_DIRTY'
    );
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('release verifier kräver fullständig SHA',()=>{
  assert.throws(
    ()=>Release.normalizeCommit('abc123'),
    error=>error.code==='RELEASE_COMMIT_INVALID'
  );
});


function writePilotApprovalFixture(dir,releaseCommit){
  const sourcePaths={};
  for(const [key,name] of Object.entries(SOURCE_ENV)){
    const filename=path.join(dir,key+'.json');
    fs.writeFileSync(filename,JSON.stringify({fixture:key}));
    sourcePaths[key]=filename;
  }
  const stamp=new Date(Date.now()-60*1000).toISOString();
  const signoffPath=path.join(dir,'staging-signoff.json');
  fs.writeFileSync(signoffPath,JSON.stringify({
    schemaVersion:3,
    environment:'staging',
    createdAt:stamp,
    releaseCommit,
    readyForPilotDecision:true,
    uatCompletedAt:stamp,
    checks:{
      preflight:true,
      r2Audit:true,
      offsiteBackup:true,
      restoreDrill:true,
      r2RestoreDrill:true,
      monitoring:true,
      logging:true,
      auditAnchor:true,
      sameBackupArtifact:true
    },
    evidence:{backupSha256:'b'.repeat(64)},
    sourceEvidenceSha256:Object.fromEntries(
      Object.entries(sourcePaths).map(([key,filename])=>[key,sha256File(filename)])
    )
  }));
  const operationsPath=path.join(dir,'pilot-operations.json');
  fs.writeFileSync(operationsPath,JSON.stringify({
    schemaVersion:1,
    technicalOwner:'Tekniskt ansvar',
    accountingOwner:'Redovisningsansvar',
    dataProtectionOwner:'Dataskyddsansvar',
    backupOwner:'Backupansvar',
    monitoringOwner:'Övervakningsansvar',
    incidentContact:'incident@pilot.test',
    supportChannel:'support@pilot.test',
    pilotStopAuthority:'Pilotansvarig',
    rollbackDecisionProcess:'Dokumenterat beslut krävs före rollback.',
    offsiteBackupDestination:'Separat privat backupdestination',
    logRetentionDays:30,
    backupRetentionDays:90,
    approvedForPilot:true,
    approvedAt:stamp.slice(0,10),
    approvedReleaseCommit:releaseCommit,
    stagingSignoffSha256:sha256File(signoffPath)
  }));
  return{sourcePaths,signoffPath,operationsPath};
}

function pilotRuntimeFixture(dir,releaseCommit){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const approval=writePilotApprovalFixture(dir,releaseCommit);
  const backupPath=path.join(dir,'backups');
  fs.mkdirSync(backupPath,{mode:0o700});
  const env={
    NODE_ENV:'production',
    ROLLANDS_ENV:'pilot',
    ROLLANDS_DEMO_DATA:'0',
    ROLLANDS_DATABASE_PATH:path.join(dir,'platform.sqlite'),
    ROLLANDS_BACKUP_PATH:backupPath,
    ROLLANDS_PILOT_OPERATIONS_PATH:approval.operationsPath,
    ROLLANDS_AUTH_ENCRYPTION_KEY:'release-auth-key-v7r2M9xQ4pL8sT1nW6kD3yH5',
    ROLLANDS_BACKUP_ENCRYPTION_KEY:'release-backup-key-v7r2M9xQ4pL8sT1nW6kD3yH5',
    ROLLANDS_API_SECURE_COOKIE:'1',
    ROLLANDS_API_HOST:'127.0.0.1',
    ROLLANDS_ALLOWED_HOSTS:'pilot.rollands.internal',
    ROLLANDS_RELEASE_COMMIT:releaseCommit,
    ROLLANDS_STAGING_SIGNOFF_PATH:approval.signoffPath,
    ROLLANDS_UAT_EVIDENCE_PATH:approval.sourcePaths.uat,
    R2_STAGING_AUDIT_EVIDENCE_PATH:approval.sourcePaths.r2Audit,
    ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH:approval.sourcePaths.offsiteBackup,
    ROLLANDS_RESTORE_DRILL_EVIDENCE_PATH:approval.sourcePaths.restoreDrill,
    ROLLANDS_R2_RESTORE_DRILL_EVIDENCE_PATH:approval.sourcePaths.r2RestoreDrill,
    ROLLANDS_MONITORING_EVIDENCE_PATH:approval.sourcePaths.monitoring,
    ROLLANDS_LOGGING_EVIDENCE_PATH:approval.sourcePaths.logging,
    ROLLANDS_AUDIT_ANCHOR_PATH:approval.sourcePaths.auditAnchor,
    ROLLANDS_AUDIT_ANCHOR_EVIDENCE_PATH:approval.sourcePaths.auditAnchorEvidence
  };
  const settings={
    databasePath:env.ROLLANDS_DATABASE_PATH,
    host:env.ROLLANDS_API_HOST,
    secureCookies:true,
    authEncryptionKey:env.ROLLANDS_AUTH_ENCRYPTION_KEY,
    allowedHosts:[env.ROLLANDS_ALLOWED_HOSTS]
  };
  return{env,settings};
}

test('deployment identity är obligatorisk i pilot/production men inte staging',()=>{
  const {dir,head}=repoFixture();
  try{
    const staging=verifyDeploymentIdentity(
      {ROLLANDS_ENV:'staging',ROLLANDS_RELEASE_COMMIT:'0'.repeat(40)},
      {cwd:dir}
    );
    assert.equal(staging.required,false);

    const pilot=verifyDeploymentIdentity(
      {ROLLANDS_ENV:'pilot',ROLLANDS_RELEASE_COMMIT:head},
      {cwd:dir}
    );
    assert.equal(pilot.required,true);
    assert.equal(pilot.commit,head);
    assert.equal(pilot.trackedWorktreeClean,true);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('pilot-runtime stoppar även internt godkänd signoff när checkout HEAD inte matchar',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-runtime-release-'));
  try{
    const actual=git(root,['rev-parse','HEAD']).toLowerCase();
    const good=pilotRuntimeFixture(path.join(dir,'good'),actual);
    validateRuntime(good.env,good.settings);
    assert.equal(fs.statSync(good.env.ROLLANDS_DATABASE_PATH).mode&0o777,0o600);

    const wrong='f'.repeat(40)===actual?'e'.repeat(40):'f'.repeat(40);
    const badDir=path.join(dir,'bad');
    fs.mkdirSync(badDir,{recursive:true,mode:0o700});
    const bad=pilotRuntimeFixture(badDir,wrong);
    assert.throws(
      ()=>validateRuntime(bad.env,bad.settings),
      error=>error.code==='UNSAFE_RUNTIME_CONFIGURATION'&&/Deployad commit avviker/.test(error.message)
    );
    assert.equal(fs.existsSync(bad.env.ROLLANDS_DATABASE_PATH),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
