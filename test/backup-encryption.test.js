'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const Db=require('../apps/api/database.js');
const Documents=require('../apps/api/documents.js');
const Payables=require('../apps/api/payables.js');
const CustomerInvoicing=require('../apps/api/customer-invoicing.js');
const BackupCrypto=require('../scripts/backup-crypto.js');

const root=path.resolve(__dirname,'..');
const KEY='Backup-Encryption-Test-Key-2026-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

test('backupkryptering återställer exakt samma bytes och använder slumpmässigt salt/IV',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-backup-crypto-'));
  try{
    const source=path.join(dir,'source.bin'),encA=path.join(dir,'a.enc'),encB=path.join(dir,'b.enc'),plain=path.join(dir,'plain.bin');
    const bytes=Buffer.concat([Buffer.from('rollands-backup-fixture\n'),Buffer.alloc(2*1024*1024+31,0x5a)]);
    fs.writeFileSync(source,bytes);
    BackupCrypto.encryptFile(source,encA,KEY);
    BackupCrypto.encryptFile(source,encB,KEY);
    assert.equal(fs.readFileSync(encA).equals(fs.readFileSync(encB)),false);
    BackupCrypto.decryptFile(encA,plain,KEY);
    assert.deepEqual(fs.readFileSync(plain),bytes);
    assert.equal(fs.statSync(encA).mode&0o077,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('fel nyckel eller manipulerad ciphertext skapar ingen dekrypterad backup',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-backup-tamper-'));
  try{
    const source=path.join(dir,'source.bin'),enc=path.join(dir,'backup.enc'),wrong=path.join(dir,'wrong.bin'),tampered=path.join(dir,'tampered.bin');
    fs.writeFileSync(source,Buffer.from('authenticated backup payload'));
    BackupCrypto.encryptFile(source,enc,KEY);
    assert.throws(()=>BackupCrypto.decryptFile(enc,wrong,'Wrong-Backup-Key-2026-abcdefghijklmnopqrstuvwxyz-12345'),e=>e.code==='BACKUP_DECRYPT_AUTH_FAILED');
    assert.equal(fs.existsSync(wrong),false);
    const bytes=fs.readFileSync(enc);bytes[Math.floor(bytes.length/2)]^=1;fs.writeFileSync(enc,bytes);
    assert.throws(()=>BackupCrypto.decryptFile(enc,tampered,KEY),e=>e.code==='BACKUP_DECRYPT_AUTH_FAILED');
    assert.equal(fs.existsSync(tampered),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('pilot backup skapar krypterad artifact som restore verifierar direkt',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-encrypted-cli-'));
  const dbPath=path.join(dir,'source.sqlite'),backupDir=path.join(dir,'backups'),restoreTarget=path.join(dir,'restore','verified.sqlite');
  fs.mkdirSync(backupDir,{mode:0o700});
  const db=Db.openDatabase(dbPath);
  Documents.initializeDocuments(db);
  Payables.initializePayables(db);
  CustomerInvoicing.initializeCustomerInvoicing(db);
  Db.createCompany(db,{legalName:'Encrypted Restore AB',displayName:'Encrypted Restore',orgNumber:'559955-1001'});
  db.close();
  try{
    const env={...process.env,ROLLANDS_DATABASE_PATH:dbPath,ROLLANDS_BACKUP_PATH:backupDir,ROLLANDS_BACKUP_ENCRYPTION_KEY:KEY};
    const backup=spawnSync(process.execPath,['scripts/pilot-backup.js'],{cwd:root,encoding:'utf8',env});
    assert.equal(backup.status,0,backup.stderr);
    const encryptedName=fs.readdirSync(backupDir).find(name=>name.endsWith('.sqlite.enc'));
    assert.ok(encryptedName);
    assert.ok(fs.existsSync(path.join(backupDir,encryptedName+'.sha256')));
    const restore=spawnSync(process.execPath,['scripts/pilot-restore-verify.js'],{cwd:root,encoding:'utf8',env:{...env,ROLLANDS_RESTORE_SOURCE:path.join(backupDir,encryptedName),ROLLANDS_RESTORE_TARGET:restoreTarget}});
    assert.equal(restore.status,0,restore.stderr);
    const report=JSON.parse(restore.stdout.split('\n')[0]);
    assert.equal(report.sourceEncrypted,true);
    assert.equal(report.verified,true);
    const restored=new DatabaseSync(restoreTarget,{readOnly:true});
    try{assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM companies').get().n,1);}
    finally{restored.close()}
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
