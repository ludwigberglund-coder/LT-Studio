'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const BackupCrypto=require('../scripts/backup-crypto.js');
const BackupTarget=require('../scripts/r2-eu-backup-target.js');
const R2=require('../apps/api/r2-eu-staging-target.js');

const KEY='Offsite-Backup-Test-Key-2026-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function testEnv(overrides={}){
  return{
    ROLLANDS_ENV:'pilot',
    R2_BACKUP_ENABLED:'1',
    R2_BACKUP_JURISDICTION:'eu',
    R2_BACKUP_ACCOUNT_ID:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    R2_BACKUP_BUCKET:'rollands-offsite-test',
    R2_BACKUP_ACCESS_KEY_ID:'test-backup-access-key',
    R2_BACKUP_SECRET_ACCESS_KEY:'test-backup-secret-key-1234567890',
    ...overrides
  };
}

function createArtifact(dir,name='rollands-2026-09-21T13-30-00-000Z.sqlite'){
  const source=path.join(dir,name);
  const encrypted=source+'.enc';
  fs.writeFileSync(source,Buffer.from('SQLite format 3\0test encrypted backup payload','binary'),{mode:0o600});
  const result=BackupCrypto.encryptFile(source,encrypted,KEY);
  fs.writeFileSync(
    encrypted+'.sha256',
    result.sha256+'  '+path.basename(encrypted)+'\n',
    {mode:0o600}
  );
  return{source,encrypted,result};
}

function fakeR2(){
  const objects=new Map();
  const calls=[];

  async function fetchImpl(url,options={}){
    const target=url instanceof URL?url:new URL(String(url));
    const parts=target.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const bucket=parts.shift();
    const storageKey=parts.join('/');
    const method=String(options.method||'GET').toUpperCase();
    calls.push({method,bucket,storageKey,headers:{...(options.headers||{})}});

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

  return{objects,calls,fetchImpl};
}

test('backupkonfiguration är fail-closed, EU-låst och döljer credentials vid serialisering',()=>{
  assert.throws(
    ()=>BackupTarget.configFromEnvironment(testEnv({ROLLANDS_ENV:'development'})),
    error=>error.code==='R2_BACKUP_ENV_REQUIRED'
  );
  assert.throws(
    ()=>BackupTarget.configFromEnvironment(testEnv({R2_BACKUP_ENABLED:'0'})),
    error=>error.code==='R2_BACKUP_NOT_ENABLED'
  );
  assert.throws(
    ()=>BackupTarget.configFromEnvironment(testEnv({R2_BACKUP_JURISDICTION:'us'})),
    error=>error.code==='R2_BACKUP_JURISDICTION_REQUIRED'
  );

  const config=BackupTarget.configFromEnvironment(testEnv());
  assert.equal(config.jurisdiction,'eu');
  assert.equal(config.endpoint,'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.eu.r2.cloudflarestorage.com');
  const serialized=JSON.stringify(config);
  assert.doesNotMatch(serialized,/test-backup-access-key/);
  assert.doesNotMatch(serialized,/test-backup-secret-key/);
});

test('endast autentiskt krypterad backup med korrekt lokal checksumma accepteras',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-r2-backup-inspect-'));
  try{
    const artifact=createArtifact(dir);
    const inspected=BackupTarget.inspectEncryptedBackup(artifact.encrypted);
    assert.equal(inspected.sha256,artifact.result.sha256);
    assert.equal(inspected.basename,path.basename(artifact.encrypted));
    assert.ok(inspected.sizeBytes>0);

    fs.appendFileSync(artifact.encrypted,Buffer.from([1]));
    assert.throws(
      ()=>BackupTarget.inspectEncryptedBackup(artifact.encrypted),
      error=>error.code==='R2_BACKUP_CHECKSUM_MISMATCH'
    );

    const plaintext=path.join(dir,'rollands-2026-09-21.sqlite');
    fs.writeFileSync(plaintext,'not encrypted');
    assert.throws(
      ()=>BackupTarget.inspectEncryptedBackup(plaintext),
      error=>error.code==='R2_BACKUP_FILENAME_INVALID'
    );
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('offsite-upload streamar endast .enc plus checksumma och verifierar båda via GET',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-r2-backup-upload-'));
  try{
    const artifact=BackupTarget.inspectEncryptedBackup(createArtifact(dir).encrypted);
    const remote=fakeR2();
    const config=BackupTarget.configFromEnvironment(testEnv());
    const target=BackupTarget.createR2EuBackupTarget({config,fetchImpl:remote.fetchImpl});

    const first=await BackupTarget.uploadEncryptedBackup({artifact,target});
    assert.equal(first.verified,true);
    assert.equal(first.encryptedAlreadyExisted,false);
    assert.equal(first.checksumAlreadyExisted,false);
    assert.match(first.storageKey,new RegExp('^encrypted-sqlite-backups/'+artifact.sha256+'/'));
    assert.equal(remote.objects.get(first.storageKey).equals(fs.readFileSync(artifact.filename)),true);
    assert.equal(remote.objects.get(first.checksumStorageKey).equals(fs.readFileSync(artifact.checksumFile)),true);

    const puts=remote.calls.filter(call=>call.method==='PUT');
    const gets=remote.calls.filter(call=>call.method==='GET');
    assert.equal(puts.length,2);
    assert.equal(gets.length,2);
    assert.ok(puts.every(call=>call.bucket==='rollands-offsite-test'));
    assert.ok(puts.every(call=>call.headers['if-none-match']==='*'));
    assert.equal(puts[0].headers['x-amz-content-sha256'],artifact.sha256);
    assert.doesNotMatch(JSON.stringify(remote.calls),/test-backup-secret-key/);

    const downloaded=path.join(dir,'downloaded.sqlite.enc');
    const restored=await target.downloadToFile({
      storageKey:first.storageKey,
      filename:downloaded,
      expectedSha256:artifact.sha256,
      expectedSizeBytes:artifact.sizeBytes
    });
    assert.equal(restored.sha256,artifact.sha256);
    assert.equal(fs.readFileSync(downloaded).equals(fs.readFileSync(artifact.filename)),true);
    await assert.rejects(
      ()=>target.downloadToFile({storageKey:first.storageKey,filename:downloaded}),
      error=>error.code==='R2_BACKUP_DOWNLOAD_TARGET_EXISTS'
    );

    const second=await BackupTarget.uploadEncryptedBackup({artifact,target});
    assert.equal(second.verified,true);
    assert.equal(second.encryptedAlreadyExisted,true);
    assert.equal(second.checksumAlreadyExisted,true);
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('befintlig men korrupt remote-backup godkänns aldrig som idempotent retry',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-r2-backup-corrupt-'));
  try{
    const artifact=BackupTarget.inspectEncryptedBackup(createArtifact(dir).encrypted);
    const remote=fakeR2();
    const config=BackupTarget.configFromEnvironment(testEnv());
    const target=BackupTarget.createR2EuBackupTarget({config,fetchImpl:remote.fetchImpl});
    const first=await BackupTarget.uploadEncryptedBackup({artifact,target});

    const damaged=Buffer.from(remote.objects.get(first.storageKey));
    damaged[damaged.length-1]^=1;
    remote.objects.set(first.storageKey,damaged);

    await assert.rejects(
      ()=>BackupTarget.uploadEncryptedBackup({artifact,target}),
      error=>error.code==='R2_BACKUP_REMOTE_INTEGRITY_MISMATCH'
    );
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('S3-signering kan använda förberäknad SHA-256 för streaming utan att ändra standardbeteendet',()=>{
  const url=new URL('https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.eu.r2.cloudflarestorage.com/test-bucket/object');
  const payloadHash='b'.repeat(64);
  const streamed=R2.signS3Request({
    method:'PUT',
    url,
    payloadHash,
    headers:{'content-length':'123'},
    accessKeyId:'test-access',
    secretAccessKey:'test-secret-value',
    now:new Date('2026-09-21T13:30:00.000Z')
  });
  assert.equal(streamed.payloadHash,payloadHash);
  assert.equal(streamed.headers['x-amz-content-sha256'],payloadHash);

  const normal=R2.signS3Request({
    method:'PUT',
    url,
    body:Buffer.from('abc'),
    accessKeyId:'test-access',
    secretAccessKey:'test-secret-value',
    now:new Date('2026-09-21T13:30:00.000Z')
  });
  assert.equal(normal.payloadHash,R2.sha256Hex(Buffer.from('abc')));
  assert.throws(
    ()=>R2.signS3Request({
      method:'PUT',
      url,
      payloadHash:'not-a-hash',
      accessKeyId:'test-access',
      secretAccessKey:'test-secret-value'
    }),
    error=>error.code==='R2_SIGNING_PAYLOAD_HASH_INVALID'
  );
});
