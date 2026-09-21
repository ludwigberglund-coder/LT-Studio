'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Db=require('../apps/api/database.js');
const Documents=require('../apps/api/documents.js');
const Payables=require('../apps/api/payables.js');
const CustomerInvoicing=require('../apps/api/customer-invoicing.js');
const BackupCrypto=require('../scripts/backup-crypto.js');
const {runR2RestoreDrill}=require('../scripts/pilot-restore-drill-r2.js');

const KEY='R2-Restore-Drill-Test-Key-2026-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function encryptedFixture(dir){
  const source=path.join(dir,'source.sqlite');
  const db=Db.openDatabase(source);
  Documents.initializeDocuments(db);
  Payables.initializePayables(db);
  CustomerInvoicing.initializeCustomerInvoicing(db);
  Db.createCompany(db,{legalName:'R2 Restore Test AB',displayName:'R2 Restore Test',orgNumber:'559990-8001'});
  db.close();

  const encrypted=path.join(dir,'rollands-r2-restore-test.sqlite.enc');
  const result=BackupCrypto.encryptFile(source,encrypted,KEY);
  return{source,encrypted,result};
}

function fakeDownloadTarget(remoteFile){
  return{
    async getToFile({storageKey,filename,sha256,sizeBytes}){
      const bytes=fs.readFileSync(remoteFile);
      fs.writeFileSync(filename,bytes,{mode:0o600,flag:'wx'});
      const actual=BackupCrypto.sha256File(filename);
      if(actual!==sha256||bytes.length!==sizeBytes){
        fs.rmSync(filename,{force:true});
        const error=new Error('remote mismatch');error.code='R2_BACKUP_REMOTE_INTEGRITY_MISMATCH';throw error;
      }
      return{storageKey,filename,sha256:actual,sizeBytes:bytes.length,verified:true};
    }
  };
}

test('R2 restore-drill laddar ned, dekrypterar, verifierar och städar isolerad kopia',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-r2-restore-drill-'));
  const drillDir=path.join(dir,'drill'),evidencePath=path.join(dir,'ops','evidence.json');
  try{
    const f=encryptedFixture(dir);
    const source={
      ok:true,
      bucket:'rollands-backup-staging',
      encryptedFile:path.basename(f.encrypted),
      sha256:f.result.sha256,
      sizeBytes:f.result.sizeBytes
    };
    const before=BackupCrypto.sha256File(f.source);
    const evidence=await runR2RestoreDrill({
      target:fakeDownloadTarget(f.encrypted),
      source,
      drillDir,
      evidencePath,
      backupKey:KEY,
      now:new Date('2026-09-21T15:30:00.000Z')
    });

    assert.equal(evidence.sourceProvider,'r2');
    assert.equal(evidence.remoteDownloadVerified,true);
    assert.equal(evidence.sqliteIntegrity,true);
    assert.equal(evidence.foreignKeys,true);
    assert.equal(evidence.privateObjectsVerified,true);
    assert.equal(evidence.remoteDownloadRemoved,true);
    assert.equal(evidence.restoreCopyRemoved,true);
    assert.equal(evidence.sourceEncryptedSha256,f.result.sha256);
    assert.equal(BackupCrypto.sha256File(f.source),before);
    assert.equal(fs.existsSync(evidencePath),true);
    assert.deepEqual(fs.existsSync(drillDir)?fs.readdirSync(drillDir):[],[]);
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('R2 restore-drill lämnar inget bevis eller testdatabas vid fel backupnyckel',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-r2-restore-drill-key-'));
  const drillDir=path.join(dir,'drill'),evidencePath=path.join(dir,'ops','evidence.json');
  try{
    const f=encryptedFixture(dir);
    const source={
      ok:true,
      bucket:'rollands-backup-staging',
      encryptedFile:path.basename(f.encrypted),
      sha256:f.result.sha256,
      sizeBytes:f.result.sizeBytes
    };
    await assert.rejects(
      ()=>runR2RestoreDrill({
        target:fakeDownloadTarget(f.encrypted),
        source,
        drillDir,
        evidencePath,
        backupKey:'Wrong-R2-Restore-Key-2026-ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      }),
      error=>String(error.code||'').startsWith('BACKUP_')
    );
    assert.equal(fs.existsSync(evidencePath),false);
    assert.deepEqual(fs.existsSync(drillDir)?fs.readdirSync(drillDir):[],[]);
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
