'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const R2=require('../apps/api/r2-eu-staging-target.js');
const AuditAnchor=require('./audit-anchor.js');

function auditError(message,code='R2_AUDIT_ANCHOR_ERROR',details){
  const error=new Error(message);
  error.code=code;
  if(details&&typeof details==='object')Object.assign(error,details);
  return error;
}
function required(value,label,minLength=1){
  const normalized=String(value??'').trim();
  if(normalized.length<minLength)throw auditError(label+' saknas eller är ogiltig.','R2_AUDIT_CONFIG_REQUIRED');
  return normalized;
}
function configFromEnvironment(env=process.env){
  const runtime=String(env.ROLLANDS_ENV||'').trim().toLowerCase();
  if(!['staging','pilot','production'].includes(runtime))throw auditError('Audit-ankare får bara laddas upp i skyddad drift.','R2_AUDIT_ENV_REQUIRED');
  if(String(env.R2_AUDIT_ENABLED||'').trim()!=='1')throw auditError('R2 audit-ankare är inte explicit aktiverat.','R2_AUDIT_NOT_ENABLED');
  if(String(env.R2_AUDIT_JURISDICTION||'eu').trim().toLowerCase()!=='eu')throw auditError('Audit-ankaret kräver R2 EU-jurisdiktion.','R2_AUDIT_JURISDICTION_REQUIRED');
  const accountId=R2.normalizeAccountId(env.R2_AUDIT_ACCOUNT_ID);
  const bucket=R2.normalizeBucket(env.R2_AUDIT_BUCKET);
  const accessKeyId=required(env.R2_AUDIT_ACCESS_KEY_ID,'R2_AUDIT_ACCESS_KEY_ID',8);
  const secretAccessKey=required(env.R2_AUDIT_SECRET_ACCESS_KEY,'R2_AUDIT_SECRET_ACCESS_KEY',16);
  const sessionToken=String(env.R2_AUDIT_SESSION_TOKEN||'').trim();

  for(const other of [env.R2_STAGING_BUCKET,env.R2_BACKUP_BUCKET]){
    if(String(other||'').trim()&&String(other).trim()===bucket)throw auditError('Audit-ankaret måste använda en separat bucket.','R2_AUDIT_BUCKET_NOT_INDEPENDENT');
  }
  for(const other of [env.R2_STAGING_ACCESS_KEY_ID,env.R2_BACKUP_ACCESS_KEY_ID]){
    if(String(other||'').trim()&&String(other).trim()===accessKeyId)throw auditError('Audit-ankaret måste använda separat credential-scope/access key.','R2_AUDIT_ACCESS_KEY_NOT_INDEPENDENT');
  }

  const config={accountId,bucket,jurisdiction:'eu',endpoint:R2.r2EuEndpoint(accountId),region:'auto',requestTimeoutMs:30000};
  Object.defineProperties(config,{
    accessKeyId:{value:accessKeyId,enumerable:false},
    secretAccessKey:{value:secretAccessKey,enumerable:false},
    sessionToken:{value:sessionToken||null,enumerable:false}
  });
  return Object.freeze(config);
}
function storageKey(rootSha256){
  const root=String(rootSha256||'').trim().toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(root))throw auditError('Audit root SHA-256 är ogiltig.','R2_AUDIT_ROOT_SHA_INVALID');
  return 'audit-anchors/v1/'+root+'.json';
}
function objectUrl(config,key){
  if(!/^audit-anchors\/v1\/[a-f0-9]{64}\.json$/.test(String(key||'')))throw auditError('Audit storage key är ogiltig.','R2_AUDIT_STORAGE_KEY_INVALID');
  const objectPath=[R2.encodeRfc3986(config.bucket),...String(key).split('/').map(R2.encodeRfc3986)].join('/');
  return new URL('/'+objectPath,config.endpoint);
}
function requestHeaders(signed){
  const headers={...signed.headers};
  delete headers.host;
  headers.Authorization=headers.authorization;
  delete headers.authorization;
  return headers;
}
async function signedFetch({config,fetchImpl,method,key,bytes=Buffer.alloc(0)}){
  const url=objectUrl(config,key);
  const verb=String(method||'GET').toUpperCase();
  const headers={};
  if(verb==='PUT'){
    headers['content-type']='application/json';
    headers['content-length']=String(bytes.length);
    headers['if-none-match']='*';
    headers['x-amz-meta-sha256']=AuditAnchor.sha256Bytes(bytes);
  }
  const signed=R2.signS3Request({
    method:verb,url,body:bytes,headers,
    accessKeyId:config.accessKeyId,
    secretAccessKey:config.secretAccessKey,
    sessionToken:config.sessionToken||'',
    region:config.region
  });
  try{
    return await fetchImpl(url,{method:verb,headers:requestHeaders(signed),body:verb==='PUT'?bytes:undefined,redirect:'error',signal:AbortSignal.timeout(config.requestTimeoutMs)});
  }catch(error){
    throw auditError('Nätverksanropet till R2 audit-bucket misslyckades.','R2_AUDIT_NETWORK_ERROR',{causeCode:error?.code||error?.name||''});
  }
}
async function createR2AuditTarget({env=process.env,config,fetchImpl=globalThis.fetch}={}){
  const selected=config||configFromEnvironment(env);
  if(typeof fetchImpl!=='function')throw auditError('HTTP-klient saknas.','R2_AUDIT_FETCH_REQUIRED');
  return Object.freeze({
    async putAndVerify(anchor){
      const bytes=Buffer.from(JSON.stringify(anchor,null,2)+'\n');
      const sha256=AuditAnchor.sha256Bytes(bytes);
      const key=storageKey(anchor.rootSha256);
      const put=await signedFetch({config:selected,fetchImpl,method:'PUT',key,bytes});
      const alreadyExisted=put?.status===412;
      if(!alreadyExisted&&!put?.ok)throw auditError('R2 audit-upload misslyckades.','R2_AUDIT_PUT_FAILED',{statusCode:Number(put?.status)||0});
      const get=await signedFetch({config:selected,fetchImpl,method:'GET',key});
      if(!get?.ok)throw auditError('R2 audit-readback misslyckades.','R2_AUDIT_GET_FAILED',{statusCode:Number(get?.status)||0});
      const remote=Buffer.from(await get.arrayBuffer());
      if(AuditAnchor.sha256Bytes(remote)!==sha256||remote.length!==bytes.length)throw auditError('R2 audit-readback matchar inte uppladdat ankare.','R2_AUDIT_REMOTE_INTEGRITY_MISMATCH');
      let parsed;
      try{parsed=JSON.parse(remote.toString('utf8'))}catch{throw auditError('R2 audit-readback är inte giltig JSON.','R2_AUDIT_REMOTE_JSON_INVALID')}
      if(parsed.rootSha256!==anchor.rootSha256)throw auditError('R2 audit-readback har fel root SHA.','R2_AUDIT_REMOTE_ROOT_MISMATCH');
      return Object.freeze({verified:true,key,bucket:selected.bucket,sha256,sizeBytes:bytes.length,alreadyExisted});
    }
  });
}

function writeEvidence(filename,value){
  const resolved=path.resolve(String(filename||''));
  fs.mkdirSync(path.dirname(resolved),{recursive:true,mode:0o700});
  const temp=resolved+'.tmp-'+crypto.randomUUID();
  try{
    fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
    fs.renameSync(temp,resolved);
    fs.chmodSync(resolved,0o600);
  }catch(error){fs.rmSync(temp,{force:true});throw error}
}
function requiredEnv(name){const value=String(process.env[name]||'').trim();if(!value)throw auditError(name+' saknas.','R2_AUDIT_ENV_VALUE_REQUIRED');return value}

async function main(){
  try{
    const databasePath=path.resolve(requiredEnv('ROLLANDS_DATABASE_PATH'));
    const anchorPath=path.resolve(requiredEnv('ROLLANDS_AUDIT_ANCHOR_PATH'));
    const evidencePath=path.resolve(requiredEnv('ROLLANDS_AUDIT_ANCHOR_EVIDENCE_PATH'));
    const anchor=AuditAnchor.createAuditAnchorFromDatabase(databasePath);
    const local=AuditAnchor.writeAnchor(anchorPath,anchor);
    const target=await createR2AuditTarget();
    const remote=await target.putAndVerify(anchor);
    const evidence={
      schemaVersion:1,
      verifiedAt:new Date().toISOString(),
      provider:'r2',
      jurisdiction:'eu',
      bucket:remote.bucket,
      storageKey:remote.key,
      rootSha256:anchor.rootSha256,
      anchorSha256:local.sha256,
      anchorSizeBytes:local.sizeBytes,
      remoteReadbackVerified:true
    };
    writeEvidence(evidencePath,evidence);
    process.stdout.write(JSON.stringify({verified:true,rootSha256:anchor.rootSha256,bucket:remote.bucket,storageKey:remote.key,evidencePath})+'\n');
  }catch(error){
    console.error((error?.code||'R2_AUDIT_ANCHOR_FAILED')+': '+(error?.message||String(error)));
    process.exitCode=1;
  }
}

if(require.main===module)main();

module.exports=Object.freeze({
  configFromEnvironment,
  storageKey,
  objectUrl,
  createR2AuditTarget,
  writeEvidence,
  main
});
