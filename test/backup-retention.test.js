'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const Retention=require('../scripts/pilot-backup-retention.js');

const root=path.resolve(__dirname,'..');

function touch(file,when){
  fs.writeFileSync(file,'fixture');
  fs.utimesSync(file,when,when);
}
function operationsFile(dir,days=30){
  const filename=path.join(dir,'operations.json');
  fs.writeFileSync(filename,JSON.stringify({
    schemaVersion:1,
    technicalOwner:'Tekniskt ansvar',
    accountingOwner:'Redovisningsansvar',
    dataProtectionOwner:'Dataskyddsansvar',
    backupOwner:'Backupansvar',
    monitoringOwner:'Övervakningsansvar',
    incidentContact:'incident@example.test',
    supportChannel:'support@example.test',
    pilotStopAuthority:'Pilotansvarig',
    rollbackDecisionProcess:'Dokumenterad rollbackprocess.',
    offsiteBackupDestination:'Extern backupdestination',
    logRetentionDays:30,
    backupRetentionDays:days,
    approvedForPilot:true,
    approvedAt:'2026-09-20'
  }));
  return filename;
}

test('retention grupperar backupfamiljer och ignorerar okända filer',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-retention-groups-'));
  try{
    const stamp='rollands-2026-01-01T00-00-00-000Z.sqlite';
    for(const suffix of ['', '.sha256', '.enc', '.enc.sha256'])fs.writeFileSync(path.join(dir,stamp+suffix),'x');
    fs.writeFileSync(path.join(dir,'notes.txt'),'keep');
    const families=Retention.backupFamilies(dir);
    assert.equal(families.length,1);
    assert.equal(families[0].base,stamp);
    assert.equal(families[0].files.length,4);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('retention planerar bara gamla familjer och bevarar alltid den nyaste',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-retention-plan-'));
  const now=Date.UTC(2026,8,20,12,0,0);
  try{
    const old='rollands-2026-01-01T00-00-00-000Z.sqlite';
    const staleNewest='rollands-2026-02-01T00-00-00-000Z.sqlite';
    const oldDate=new Date(now-100*24*60*60*1000);
    const newerDate=new Date(now-90*24*60*60*1000);
    for(const suffix of ['', '.sha256', '.enc', '.enc.sha256'])touch(path.join(dir,old+suffix),oldDate);
    for(const suffix of ['', '.sha256', '.enc', '.enc.sha256'])touch(path.join(dir,staleNewest+suffix),newerDate);
    const plan=Retention.retentionPlan({backupDir:dir,retentionDays:30,now});
    assert.equal(plan.remove.length,1);
    assert.equal(plan.remove[0].base,old);
    assert.equal(plan.newest,staleNewest);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('CLI är dry-run som standard och --apply raderar endast planerade backupfamiljer',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-retention-cli-'));
  const backupDir=path.join(dir,'backups');fs.mkdirSync(backupDir);
  const operationsPath=operationsFile(dir,30);
  try{
    const now=Date.now(),old='rollands-old.sqlite',fresh='rollands-fresh.sqlite';
    const oldDate=new Date(now-45*24*60*60*1000),freshDate=new Date(now-2*24*60*60*1000);
    for(const suffix of ['', '.sha256', '.enc', '.enc.sha256'])touch(path.join(backupDir,old+suffix),oldDate);
    for(const suffix of ['', '.sha256', '.enc', '.enc.sha256'])touch(path.join(backupDir,fresh+suffix),freshDate);
    fs.writeFileSync(path.join(backupDir,'manual-note.txt'),'do not delete');
    const env={...process.env,ROLLANDS_BACKUP_PATH:backupDir,ROLLANDS_PILOT_OPERATIONS_PATH:operationsPath};
    const dry=spawnSync(process.execPath,['scripts/pilot-backup-retention.js'],{cwd:root,encoding:'utf8',env});
    assert.equal(dry.status,0,dry.stderr);
    const dryReport=JSON.parse(dry.stdout.split('\n')[0]);
    assert.equal(dryReport.mode,'dry-run');
    assert.equal(dryReport.candidateFamilies.length,1);
    assert.ok(fs.existsSync(path.join(backupDir,old+'.enc')));

    const apply=spawnSync(process.execPath,['scripts/pilot-backup-retention.js','--apply'],{cwd:root,encoding:'utf8',env});
    assert.equal(apply.status,0,apply.stderr);
    const applyReport=JSON.parse(apply.stdout.split('\n')[0]);
    assert.equal(applyReport.mode,'apply');
    assert.equal(applyReport.removedFiles.length,4);
    assert.equal(fs.existsSync(path.join(backupDir,old)),false);
    assert.ok(fs.existsSync(path.join(backupDir,fresh+'.enc')));
    assert.ok(fs.existsSync(path.join(backupDir,'manual-note.txt')));
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
