'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const BackupCrypto=require('./backup-crypto.js');
const R2=require('../apps/api/r2-eu-staging-target.js');

function backupError(message,code='R2_BACKUP_ERROR',details){
  const error=new Error(message);
  error.code=code;
  if(details&&typeof details==='object')Object.assign(error,details);
  return error;
}

function required(value,label,code,minLength=1){
  const normalized=String(value??'').trim();
  if(normalized.length<minLength)throw backupError(`${label} saknas eller är ogiltig.`,code);
  return normalized;
}

function normalizeAccountId(value){
  const accountId=required(value,'R2 backup account-id','R2_BACKUP_ACCOUNT_ID_REQUIRED').toLowerCase();
  if(!/^[a-f0-9]{32}$/.test(accountId)){
    throw backupError('R2 backup account-id har ogiltigt format.','R2_BACKUP_ACCOUNT_ID_INVALID');
  }
  return accountId;
}

function normalizeBucket(value){
  const bucket=required(value,'R2 backup-bucket','R2_BACKUP_BUCKET_REQUIRED');
  if(bucket.length<3||bucket.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(bucket)){
    throw backupError('R2 backup-bucket har ogiltigt namn.','R2_BACKUP_BUCKET_INVALID');
  }
  return bucket;
}

function r2EuEndpoint(accountId){
  return `https://${normalizeAccountId(accountId)}.eu.r2.cloudflarestorage.com`;
}

function configFromEnvironment(env=process.env){
  const runtime=String(env?.ROLLANDS_ENV??'').trim().toLowerCase();
  if(!['staging','pilot','production'].includes(runtime)){
    throw backupError(
      'Offsite-backup får endast köras i staging, pilot eller production.',
      'R2_BACKUP_ENV_REQUIRED'
    );
  }
  if(String(env?.R2_BACKUP_ENABLED??'').trim()!=='1'){
    throw backupError(
      'R2 offsite-backup är inte explicit aktiverad.',
      'R2_BACKUP_NOT_ENABLED'
    );
  }
  const jurisdiction=String(env?.R2_BACKUP_JURISDICTION??'eu').trim().toLowerCase();
  if(jurisdiction!=='eu'){
    throw backupError(
      'Offsite-backup tillåter endast R2 EU-jurisdiktion.',
      'R2_BACKUP_JURISDICTION_REQUIRED'
    );
  }

  const accountId=normalizeAccountId(env?.R2_BACKUP_ACCOUNT_ID);
  const bucket=normalizeBucket(env?.R2_BACKUP_BUCKET);
  const accessKeyId=required(
    env?.R2_BACKUP_ACCESS_KEY_ID,
    'R2 backup Access Key ID',
    'R2_BACKUP_ACCESS_KEY_REQUIRED',
    8
  );
  const secretAccessKey=required(
    env?.R2_BACKUP_SECRET_ACCESS_KEY,
    'R2 backup Secret Access Key',
    'R2_BACKUP_SECRET_KEY_REQUIRED',
    16
  );
  const sessionToken=String(env?.R2_BACKUP_SESSION_TOKEN??'').trim();

  const config={
    runtime,
    accountId,
    bucket,
    jurisdiction:'eu',
    endpoint:r2EuEndpoint(accountId),
    region:'auto',
    requestTimeoutMs:60000
  };
  Object.defineProperties(config,{
    accessKeyId:{value:accessKeyId,enumerable:false},
    secretAccessKey:{value:secretAccessKey,enumerable:false},
    sessionToken:{value:sessionToken||null,enumerable:false}
  });
  return Object.freeze(config);
}

function encryptedBackupBasename(filename){
  const basename=path.basename(String(filename||''));
  if(!/^rollands-[0-9A-Za-z._-]+\.sqlite\.enc$/.test(basename)){
    throw backupError(
      'Endast servergenererade krypterade .sqlite.enc-backuper får skickas offsite.',
      'R2_BACKUP_FILENAME_INVALID'
    );
  }
  return basename;
}

function checksumRecord(filename){
  if(!fs.existsSync(filename)||!fs.statSync(filename).isFile()){
    throw backupError('Backupens checksumfil saknas.','R2_BACKUP_CHECKSUM_REQUIRED');
  }
  const line=fs.readFileSync(filename,'utf8').trim();
  const match=line.match(/^([a-f0-9]{64})\s+([^\s]+)$/i);
  if(!match){
    throw backupError('Backupens checksumfil har ogiltigt format.','R2_BACKUP_CHECKSUM_INVALID');
  }
  return Object.freeze({sha256:match[1].toLowerCase(),basename:match[2]});
}

function inspectEncryptedBackup(filename){
  const resolved=path.resolve(String(filename||''));
  if(!fs.existsSync(resolved)||!fs.statSync(resolved).isFile()){
    throw backupError('Den krypterade backupfilen saknas.','R2_BACKUP_FILE_REQUIRED');
  }
  const basename=encryptedBackupBasename(resolved);
  const stat=fs.statSync(resolved);
  if(!Number.isSafeInteger(stat.size)||stat.size<=BackupCrypto.MAGIC.length){
    throw backupError('Den krypterade backupfilen är tom eller ogiltig.','R2_BACKUP_FILE_INVALID');
  }

  const fd=fs.openSync(resolved,'r');
  try{
    const magic=Buffer.alloc(BackupCrypto.MAGIC.length);
    if(fs.readSync(fd,magic,0,magic.length,0)!==magic.length||!magic.equals(BackupCrypto.MAGIC)){
      throw backupError(
        'Offsite-backup vägrar en fil som inte använder det krypterade backupformatet.',
        'R2_BACKUP_ENCRYPTED_FORMAT_REQUIRED'
      );
    }
  }finally{
    fs.closeSync(fd);
  }

  const checksumFile=`${resolved}.sha256`;
  const expected=checksumRecord(checksumFile);
  if(expected.basename!==basename){
    throw backupError('Checksumfilen pekar på fel backupfil.','R2_BACKUP_CHECKSUM_NAME_MISMATCH');
  }
  const actual=BackupCrypto.sha256File(resolved);
  if(actual!==expected.sha256){
    throw backupError('Den krypterade backupen matchar inte sin lokala SHA-256.','R2_BACKUP_CHECKSUM_MISMATCH');
  }

  const checksumSha256=BackupCrypto.sha256File(checksumFile);
  const checksumSizeBytes=fs.statSync(checksumFile).size;
  return Object.freeze({
    filename:resolved,
    basename,
    sha256:actual,
    sizeBytes:stat.size,
    checksumFile,
    checksumSha256,
    checksumSizeBytes
  });
}

function latestEncryptedBackup(backupDir){
  const resolved=path.resolve(String(backupDir||''));
  if(!fs.existsSync(resolved)||!fs.statSync(resolved).isDirectory()){
    throw backupError('ROLLANDS_BACKUP_PATH måste vara en befintlig katalog.','R2_BACKUP_DIRECTORY_REQUIRED');
  }
  const rows=fs.readdirSync(resolved,{withFileTypes:true})
    .filter(entry=>entry.isFile()&&/^rollands-[0-9A-Za-z._-]+\.sqlite\.enc$/.test(entry.name))
    .map(entry=>{
      const filename=path.join(resolved,entry.name);
      return{filename,mtimeMs:fs.statSync(filename).mtimeMs,name:entry.name};
    })
    .sort((a,b)=>b.mtimeMs-a.mtimeMs||a.name.localeCompare(b.name));
  if(!rows.length)throw backupError('Ingen krypterad backup hittades.','R2_BACKUP_ENCRYPTED_FILE_MISSING');
  return inspectEncryptedBackup(rows[0].filename);
}

function backupStorageKeys(artifact){
  const digest=String(artifact?.sha256??'').trim().toLowerCase();
  const basename=encryptedBackupBasename(artifact?.basename);
  if(!/^[a-f0-9]{64}$/.test(digest)){
    throw backupError('Backupens SHA-256 är ogiltig.','R2_BACKUP_SHA256_INVALID');
  }
  const prefix=`encrypted-sqlite-backups/${digest}`;
  return Object.freeze({
    encrypted:`${prefix}/${basename}`,
    checksum:`${prefix}/${basename}.sha256`
  });
}

function objectUrl(config,storageKey){
  const key=String(storageKey??'').trim();
  if(!/^encrypted-sqlite-backups\/[a-f0-9]{64}\/rollands-[0-9A-Za-z._-]+\.sqlite\.enc(?:\.sha256)?$/.test(key)){
    throw backupError('R2 backup storage key är ogiltig.','R2_BACKUP_STORAGE_KEY_INVALID');
  }
  const objectPath=[
    R2.encodeRfc3986(config.bucket),
    ...key.split('/').map(R2.encodeRfc3986)
  ].join('/');
  return new URL('/'+objectPath,config.endpoint);
}

function requestHeadersForFetch(signed){
  const headers={...signed.headers};
  delete headers.host;
  headers.Authorization=headers.authorization;
  delete headers.authorization;
  return headers;
}

async function digestResponse(response){
  if(!response?.ok){
    throw backupError(
      'R2 offsite-readback misslyckades.',
      'R2_BACKUP_GET_FAILED',
      {statusCode:Number(response?.status)||0}
    );
  }

  const hash=crypto.createHash('sha256');
  let sizeBytes=0;
  if(response.body&&typeof response.body[Symbol.asyncIterator]==='function'){
    for await(const chunk of response.body){
      const bytes=Buffer.from(chunk);
      sizeBytes+=bytes.length;
      hash.update(bytes);
    }
  }else if(typeof response.arrayBuffer==='function'){
    const bytes=Buffer.from(await response.arrayBuffer());
    sizeBytes=bytes.length;
    hash.update(bytes);
  }else{
    throw backupError('R2 offsite-readback saknar läsbart svar.','R2_BACKUP_RESPONSE_BODY_REQUIRED');
  }

  const contentLength=response.headers?.get?.('content-length');
  if(contentLength!=null&&contentLength!==''&&Number(contentLength)!==sizeBytes){
    throw backupError('R2 offsite-readback har fel Content-Length.','R2_BACKUP_CONTENT_LENGTH_MISMATCH');
  }
  return Object.freeze({sha256:hash.digest('hex'),sizeBytes});
}

function createR2EuBackupTarget({env=process.env,config,fetchImpl=globalThis.fetch}={}){
  const selected=config||configFromEnvironment(env);
  if(selected.jurisdiction!=='eu'||selected.endpoint!==r2EuEndpoint(selected.accountId)){
    throw backupError('R2 backup-konfigurationen måste använda EU-endpoint.','R2_BACKUP_ENDPOINT_INVALID');
  }
  if(typeof fetchImpl!=='function'){
    throw backupError('HTTP-klient saknas för R2 backup.','R2_BACKUP_FETCH_REQUIRED');
  }

  async function signedFetch({method,storageKey,filename='',sha256='',sizeBytes=0,contentType='application/octet-stream'}){
    const url=objectUrl(selected,storageKey);
    const verb=String(method||'GET').toUpperCase();
    const extraHeaders={};

    if(verb==='PUT'){
      if(!filename||!fs.existsSync(filename)){
        throw backupError('Lokal backupfil saknas vid upload.','R2_BACKUP_UPLOAD_FILE_REQUIRED');
      }
      if(!/^[a-f0-9]{64}$/.test(String(sha256))){
        throw backupError('Upload-SHA-256 är ogiltig.','R2_BACKUP_UPLOAD_SHA256_INVALID');
      }
      if(!Number.isSafeInteger(sizeBytes)||sizeBytes<1){
        throw backupError('Upload-storleken är ogiltig.','R2_BACKUP_UPLOAD_SIZE_INVALID');
      }
      Object.assign(extraHeaders,{
        'content-length':String(sizeBytes),
        'content-type':String(contentType),
        'if-none-match':'*',
        'x-amz-meta-sha256':String(sha256)
      });
    }

    const signed=R2.signS3Request({
      method:verb,
      url,
      body:Buffer.alloc(0),
      payloadHash:verb==='PUT'?String(sha256):undefined,
      headers:extraHeaders,
      accessKeyId:selected.accessKeyId,
      secretAccessKey:selected.secretAccessKey,
      sessionToken:selected.sessionToken||'',
      region:selected.region
    });

    const options={
      method:verb,
      headers:requestHeadersForFetch(signed),
      redirect:'error',
      signal:AbortSignal.timeout(selected.requestTimeoutMs)
    };
    if(verb==='PUT'){
      options.body=fs.createReadStream(filename);
      options.duplex='half';
    }

    try{
      return await fetchImpl(url,options);
    }catch(error){
      throw backupError(
        'Nätverksanropet till R2 offsite-backup misslyckades.',
        'R2_BACKUP_NETWORK_ERROR',
        {causeCode:error?.code||error?.name||''}
      );
    }
  }

  async function putAndVerify({storageKey,filename,sha256,sizeBytes,contentType}){
    const response=await signedFetch({
      method:'PUT',
      storageKey,
      filename,
      sha256,
      sizeBytes,
      contentType
    });
    const alreadyExisted=response?.status===412;
    if(!alreadyExisted&&!response?.ok){
      throw backupError(
        'R2 offsite-upload misslyckades.',
        'R2_BACKUP_PUT_FAILED',
        {statusCode:Number(response?.status)||0}
      );
    }

    const remote=await digestResponse(await signedFetch({method:'GET',storageKey}));
    if(remote.sha256!==sha256||remote.sizeBytes!==sizeBytes){
      throw backupError(
        'R2 offsite-kopian matchar inte den lokalt verifierade filen.',
        'R2_BACKUP_REMOTE_INTEGRITY_MISMATCH'
      );
    }
    return Object.freeze({storageKey,verified:true,alreadyExisted,sha256,sizeBytes});
  }

  return Object.freeze({putAndVerify});
}

async function uploadEncryptedBackup({artifact,target}={}){
  if(!artifact||!target||typeof target.putAndVerify!=='function'){
    throw backupError('Verifierad backup och R2-target krävs.','R2_BACKUP_UPLOAD_INPUT_REQUIRED');
  }
  const keys=backupStorageKeys(artifact);
  const encrypted=await target.putAndVerify({
    storageKey:keys.encrypted,
    filename:artifact.filename,
    sha256:artifact.sha256,
    sizeBytes:artifact.sizeBytes,
    contentType:'application/octet-stream'
  });
  const checksum=await target.putAndVerify({
    storageKey:keys.checksum,
    filename:artifact.checksumFile,
    sha256:artifact.checksumSha256,
    sizeBytes:artifact.checksumSizeBytes,
    contentType:'text/plain; charset=utf-8'
  });

  return Object.freeze({
    verified:encrypted.verified&&checksum.verified,
    basename:artifact.basename,
    sha256:artifact.sha256,
    sizeBytes:artifact.sizeBytes,
    storageKey:encrypted.storageKey,
    checksumStorageKey:checksum.storageKey,
    encryptedAlreadyExisted:encrypted.alreadyExisted,
    checksumAlreadyExisted:checksum.alreadyExisted
  });
}

module.exports=Object.freeze({
  configFromEnvironment,
  encryptedBackupBasename,
  checksumRecord,
  inspectEncryptedBackup,
  latestEncryptedBackup,
  backupStorageKeys,
  objectUrl,
  digestResponse,
  createR2EuBackupTarget,
  uploadEncryptedBackup
});
