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
  const dbDir=path.join(dir,'db'),backupDir=path.join(dir,'backup'),operationsPath=path.join(dir,'pilot-operations.json');
  fs.mkdirSync(dbDir,{mode:0o700});fs.mkdirSync(backupDir,{mode:0o700});
  fs.writeFileSync(operationsPath,JSON.stringify({
    schemaVersion:1,technicalOwner:'Tekniskt ansvar',accountingOwner:'Redovisningsansvar',dataProtectionOwner:'Dataskyddsansvar',
    backupOwner:'Backupansvar',monitoringOwner:'Övervakningsansvar',incidentContact:'incident@example.test',supportChannel:'support@example.test',
    pilotStopAuthority:'Pilotansvarig',rollbackDecisionProcess:'Dokumenterat incidentbeslut krävs före rollback.',
    offsiteBackupDestination:'Extern krypterad backupdestination',logRetentionDays:30,backupRetentionDays:90,approvedForPilot:true,approvedAt:'2026-09-20'
  }));
  try{
    const result=validateConfig({
      NODE_ENV:'production',ROLLANDS_ENV:'pilot',ROLLANDS_DEMO_DATA:'0',
      ROLLANDS_DATABASE_PATH:path.join(dbDir,'platform.sqlite'),ROLLANDS_BACKUP_PATH:backupDir,ROLLANDS_PILOT_OPERATIONS_PATH:operationsPath,
      ROLLANDS_AUTH_ENCRYPTION_KEY:'v7r2M9xQ4pL8sT1nW6kD3yH5cF0bJ2zR',ROLLANDS_BACKUP_ENCRYPTION_KEY:'Backup-Key-v7r2M9xQ4pL8sT1nW6kD3yH5cF0bJ2zR',
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
  Documents.initializeDocuments(db);
  Payables.initializePayables(db);
  CustomerInvoicing.initializeCustomerInvoicing(db);
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

function restoreCase(mutator, expectedFailure) {
  const {DatabaseSync}=require('node:sqlite');
  const Accounting=require('../apps/api/accounting-store.js');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-restore-safety-'));
  const source=path.join(dir,'source.sqlite'),backupDir=path.join(dir,'backups'),target=path.join(dir,'restore','verified.sqlite');
  const db=Db.openDatabase(source);
  Accounting.initializeAccountingStore(db);
  Documents.initializeDocuments(db);
  Payables.initializePayables(db);
  CustomerInvoicing.initializeCustomerInvoicing(db);
  const co=Db.createCompany(db,{legalName:'Restore test',orgNumber:'RESTORE-TEST'});
  const user=Db.createUser(db,{username:'restore-test',displayName:'Restore tester',passwordHash:'not-a-login-password'});
  const entry=Accounting.postEntry(db,{companyId:co.id,createdBy:user.id,postingDate:'2026-09-18',description:'Test sale with VAT',sourceType:'restore-test',sourceId:'1',lines:[{account:'1510',debitOre:106000},{account:'3053',creditOre:100000},{account:'2631',creditOre:6000}]}).entry;
  // Known binary fixture tests byte-for-byte restoration, not PDF rendering.
  const bytes=Buffer.from('%PDF-1.4\n% Restore byte fixture\n%%EOF\n');
  const doc=Documents.createPending(db,{companyId:co.id,uploadedBy:user.id,title:'Restore fixture',fileName:'test.pdf'});
  Documents.storeContent(db,{companyId:co.id,documentId:doc.id,bytes});
  Db.appendAudit(db,{companyId:co.id,userId:user.id,action:'RESTORE_TEST_FIXTURE',entityType:'entry',entityId:entry.id});
  if(mutator?.database)mutator.database(db,entry);
  db.close();
  try{
    const backup=spawnSync(process.execPath,['scripts/pilot-backup.js'],{cwd:root,encoding:'utf8',env:{...process.env,ROLLANDS_DATABASE_PATH:source,ROLLANDS_BACKUP_PATH:backupDir}});
    assert.equal(backup.status,0,backup.stderr);
    const file=path.join(backupDir,fs.readdirSync(backupDir).find(name=>name.endsWith('.sqlite')));
    if(mutator?.backup)mutator.backup(file);
    const restore=spawnSync(process.execPath,['scripts/pilot-restore-verify.js'],{cwd:root,encoding:'utf8',env:{...process.env,ROLLANDS_DATABASE_PATH:source,ROLLANDS_RESTORE_SOURCE:file,ROLLANDS_RESTORE_TARGET:target}});
    if(expectedFailure){
      assert.notEqual(restore.status,0);
      assert.match(restore.stderr,expectedFailure);
      assert.equal(fs.existsSync(target),false,'A failed check must not create a usable restore target');
    }else{
      assert.equal(restore.status,0,restore.stderr);
      const result=JSON.parse(restore.stdout.split('\n')[0]);
      assert.equal(result.journalEntries,1);
      assert.equal(result.foreignKeys,true);
      const restored=new DatabaseSync(target,{readOnly:true});
      try{
        assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM accounting_entry_lines').get().n,3);
        assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,1);
        assert.deepEqual(Buffer.from(restored.prepare('SELECT content_blob FROM documents WHERE id=?').get(doc.id).content_blob),bytes);
      }finally{restored.close()}
      assert.equal(fs.readFileSync(target).equals(fs.readFileSync(file)),true);
    }
    assert.ok(fs.existsSync(source),'Source is never removed');
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('actual backup and restore commands preserve VAT lines, audit and original bytes',()=>restoreCase());
test('restore refuses a backup without checksum',()=>restoreCase({backup:file=>fs.rmSync(`${file}.sha256`)},/RESTORE_CHECKSUM_REQUIRED/));
test('restore refuses a changed backup checksum',()=>restoreCase({backup:file=>fs.writeFileSync(`${file}.sha256`,'0'.repeat(64))},/RESTORE_CHECKSUM_FAILED/));
test('restore refuses orphan data even when SQLite integrity_check is ok',()=>restoreCase({database:db=>{
  db.exec("CREATE TABLE orphan_probe(id TEXT PRIMARY KEY,company_id TEXT REFERENCES companies(id)); PRAGMA foreign_keys=OFF; INSERT INTO orphan_probe VALUES('x','missing-company'); PRAGMA foreign_keys=ON;");
}},/RESTORE_FOREIGN_KEY_FAILED/));
test('restore refuses a half-written journal with a valid file checksum',()=>restoreCase({database:(db,entry)=>{
  db.exec('DROP TRIGGER history_accounting_entry_lines_delete'); // Offline corruption fixture only.
    db.prepare('DELETE FROM accounting_entry_lines WHERE entry_id=? AND account=?').run(entry.id,'2631');
}},/RESTORE_JOURNAL_FAILED/));
test('restore refuses a mismatched journal sequence counter',()=>restoreCase({database:db=>{
  db.exec('UPDATE accounting_sequences SET last_number=last_number+1');
}},/RESTORE_SEQUENCE_FAILED/));
test('restore refuses cross-company data that passes ordinary foreign key checks',()=>restoreCase({database:db=>{
  const other=Db.createCompany(db,{legalName:'Other restore company',orgNumber:'OTHER-RESTORE'});
  const first=db.prepare('SELECT id FROM companies WHERE id<>?').get(other.id);
  const customer=Db.createCustomer(db,{companyId:other.id,customerNumber:'B-1',name:'Other customer'});
  // This unguarded test-only table emulates data from a pre-guard release.
  db.exec('CREATE TABLE cross_company_probe(id TEXT PRIMARY KEY,company_id TEXT REFERENCES companies(id),customer_id TEXT REFERENCES customers(id))');
  db.prepare('INSERT INTO cross_company_probe VALUES(?,?,?)').run('test-cross',first.id,customer.id);
}},/RESTORE_TENANT_FAILED/));
