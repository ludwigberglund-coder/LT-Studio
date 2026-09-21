'use strict';

const crypto=require('node:crypto');
const PrivateObject=require('./private-object-contract.js');
const StoreContract=require('./private-object-store-contract.js');

function r2Error(message,code='R2_STAGING_ERROR',details){
  const error=new Error(message);
  error.code=code;
  if(details&&typeof details==='object')Object.assign(error,details);
  return error;
}

function required(value,label,code,minLength=1){
  const normalized=String(value??'').trim();
  if(normalized.length<minLength)throw r2Error(`${label} saknas eller är ogiltig.`,code);
  return normalized;
}

function normalizeAccountId(value){
  const accountId=required(value,'R2 account-id','R2_STAGING_ACCOUNT_ID_REQUIRED').toLowerCase();
  if(!/^[a-f0-9]{32}$/.test(accountId)){
    throw r2Error('R2 account-id har ogiltigt format.','R2_STAGING_ACCOUNT_ID_INVALID');
  }
  return accountId;
}

function normalizeBucket(value){
  const bucket=required(value,'R2 staging-bucket','R2_STAGING_BUCKET_REQUIRED');
  if(bucket.length<3||bucket.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(bucket)){
    throw r2Error('R2 staging-bucket har ogiltigt namn.','R2_STAGING_BUCKET_INVALID');
  }
  return bucket;
}

function r2EuEndpoint(accountId){
  return `https://${normalizeAccountId(accountId)}.eu.r2.cloudflarestorage.com`;
}

function configFromEnvironment(env=process.env){
  const runtime=String(env?.ROLLANDS_ENV??'').trim().toLowerCase();
  if(runtime!=='staging'){
    throw r2Error(
      'R2 staging-adaptern får endast användas när ROLLANDS_ENV=staging.',
      'R2_STAGING_ENV_REQUIRED'
    );
  }
  if(String(env?.R2_STAGING_ENABLED??'').trim()!=='1'){
    throw r2Error(
      'R2 staging-kopiering är inte explicit aktiverad.',
      'R2_STAGING_NOT_ENABLED'
    );
  }
  const jurisdiction=String(env?.R2_STAGING_JURISDICTION??'eu').trim().toLowerCase();
  if(jurisdiction!=='eu'){
    throw r2Error(
      'Den första staging-adaptern tillåter endast R2 EU-jurisdiktion.',
      'R2_STAGING_JURISDICTION_REQUIRED'
    );
  }

  const accountId=normalizeAccountId(env?.R2_STAGING_ACCOUNT_ID);
  const bucket=normalizeBucket(env?.R2_STAGING_BUCKET);
  const accessKeyId=required(
    env?.R2_STAGING_ACCESS_KEY_ID,
    'R2 Access Key ID',
    'R2_STAGING_ACCESS_KEY_REQUIRED',
    8
  );
  const secretAccessKey=required(
    env?.R2_STAGING_SECRET_ACCESS_KEY,
    'R2 Secret Access Key',
    'R2_STAGING_SECRET_KEY_REQUIRED',
    16
  );
  const sessionToken=String(env?.R2_STAGING_SESSION_TOKEN??'').trim();

  const config={
    accountId,
    bucket,
    jurisdiction:'eu',
    endpoint:r2EuEndpoint(accountId),
    region:'auto',
    requestTimeoutMs:30000
  };
  Object.defineProperties(config,{
    accessKeyId:{value:accessKeyId,enumerable:false},
    secretAccessKey:{value:secretAccessKey,enumerable:false},
    sessionToken:{value:sessionToken||null,enumerable:false}
  });
  return Object.freeze(config);
}

function sha256Hex(value){
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key,value){
  return crypto.createHmac('sha256',key).update(value).digest();
}

function amzDate(value=new Date()){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.valueOf()))throw r2Error('Signeringstiden är ogiltig.','R2_STAGING_SIGNING_TIME_INVALID');
  return date.toISOString().replace(/[:-]|\.\d{3}/g,'');
}

function encodeRfc3986(value){
  return encodeURIComponent(String(value)).replace(/[!'()*]/g,char=>
    '%'+char.charCodeAt(0).toString(16).toUpperCase()
  );
}

function canonicalQuery(url){
  const entries=[...url.searchParams.entries()].map(([key,value])=>[
    encodeRfc3986(key),
    encodeRfc3986(value)
  ]);
  entries.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
  return entries.map(([key,value])=>`${key}=${value}`).join('&');
}

function normalizeHeaderValue(value){
  return String(value??'').trim().replace(/\s+/g,' ');
}

function signS3Request({
  method,
  url,
  body=Buffer.alloc(0),
  headers={},
  accessKeyId,
  secretAccessKey,
  sessionToken='',
  region='auto',
  service='s3',
  now=new Date()
}={}){
  const target=url instanceof URL?new URL(url.toString()):new URL(String(url));
  const verb=String(method||'GET').trim().toUpperCase();
  const payload=Buffer.isBuffer(body)?body:Buffer.from(body||'');
  const payloadHash=sha256Hex(payload);
  const timestamp=amzDate(now);
  const dateStamp=timestamp.slice(0,8);
  const normalizedHeaders={};

  for(const [name,value] of Object.entries(headers||{})){
    const lower=String(name).trim().toLowerCase();
    if(!lower||lower==='authorization')continue;
    normalizedHeaders[lower]=normalizeHeaderValue(value);
  }
  normalizedHeaders.host=target.host;
  normalizedHeaders['x-amz-content-sha256']=payloadHash;
  normalizedHeaders['x-amz-date']=timestamp;
  if(sessionToken)normalizedHeaders['x-amz-security-token']=normalizeHeaderValue(sessionToken);

  const headerNames=Object.keys(normalizedHeaders).sort();
  const canonicalHeaders=headerNames
    .map(name=>`${name}:${normalizedHeaders[name]}\n`)
    .join('');
  const signedHeaders=headerNames.join(';');
  const canonicalRequest=[
    verb,
    target.pathname||'/',
    canonicalQuery(target),
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope=`${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign=[
    'AWS4-HMAC-SHA256',
    timestamp,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n');

  const kDate=hmac(Buffer.from('AWS4'+String(secretAccessKey)),dateStamp);
  const kRegion=hmac(kDate,region);
  const kService=hmac(kRegion,service);
  const kSigning=hmac(kService,'aws4_request');
  const signature=crypto.createHmac('sha256',kSigning).update(stringToSign).digest('hex');
  const authorization=
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope},`+
    `SignedHeaders=${signedHeaders},Signature=${signature}`;

  return Object.freeze({
    authorization,
    canonicalRequest,
    stringToSign,
    signature,
    signedHeaders,
    payloadHash,
    headers:Object.freeze({...normalizedHeaders,authorization})
  });
}

function expectedStorageKey(metadata){
  const normalized=PrivateObject.createPrivateObjectMetadata(metadata);
  return `${normalized.objectKey}/${normalized.sha256}`;
}

function assertStorageKey(storageKey,metadata){
  const expected=expectedStorageKey(metadata);
  if(String(storageKey??'')!==expected){
    throw r2Error(
      'R2 storage key matchar inte objektets serverstyrda identitet.',
      'R2_STAGING_STORAGE_KEY_MISMATCH'
    );
  }
  return expected;
}

function objectUrl(config,storageKey){
  const path=[
    encodeRfc3986(config.bucket),
    ...String(storageKey).split('/').map(encodeRfc3986)
  ].join('/');
  return new URL('/'+path,config.endpoint);
}

function requestHeadersForFetch(signed){
  const headers={...signed.headers};
  delete headers.host;
  headers.Authorization=headers.authorization;
  delete headers.authorization;
  return headers;
}

async function fetchSigned({
  config,
  fetchImpl,
  method,
  storageKey,
  metadata,
  bytes=Buffer.alloc(0),
  extraHeaders={},
  now
}){
  const url=objectUrl(config,storageKey);
  const signed=signS3Request({
    method,
    url,
    body:bytes,
    headers:extraHeaders,
    accessKeyId:config.accessKeyId,
    secretAccessKey:config.secretAccessKey,
    sessionToken:config.sessionToken||'',
    region:config.region,
    now
  });
  try{
    return await fetchImpl(url,{
      method,
      headers:requestHeadersForFetch(signed),
      body:method==='PUT'?bytes:undefined,
      redirect:'error',
      signal:AbortSignal.timeout(config.requestTimeoutMs)
    });
  }catch(error){
    throw r2Error(
      'Nätverksanropet till R2 staging misslyckades.',
      'R2_STAGING_NETWORK_ERROR',
      {causeCode:error?.code||error?.name||''}
    );
  }
}

function createR2EuStagingTarget({env=process.env,config,fetchImpl=globalThis.fetch}={}){
  const selected=config||configFromEnvironment(env);
  if(selected.jurisdiction!=='eu'||selected.endpoint!==r2EuEndpoint(selected.accountId)){
    throw r2Error('R2 staging-konfigurationen måste använda EU-endpoint.','R2_STAGING_ENDPOINT_INVALID');
  }
  if(typeof fetchImpl!=='function'){
    throw r2Error('HTTP-klient saknas för R2 staging.','R2_STAGING_FETCH_REQUIRED');
  }

  async function put({storageKey,metadata,bytes}={}){
    const normalized=StoreContract.normalizePutRequest({metadata,bytes});
    const key=assertStorageKey(storageKey,normalized.metadata);
    const response=await fetchSigned({
      config:selected,
      fetchImpl,
      method:'PUT',
      storageKey:key,
      metadata:normalized.metadata,
      bytes:normalized.bytes,
      extraHeaders:{
        'content-type':normalized.metadata.mimeType,
        'if-none-match':'*',
        'x-amz-meta-sha256':normalized.metadata.sha256,
        'x-amz-meta-companyid':normalized.metadata.companyId,
        'x-amz-meta-kind':normalized.metadata.kind,
        'x-amz-meta-objectid':normalized.metadata.objectId
      }
    });
    if(response?.status===412)return true;
    if(!response?.ok){
      throw r2Error(
        'R2 staging-upload misslyckades.',
        'R2_STAGING_PUT_FAILED',
        {statusCode:Number(response?.status)||0}
      );
    }
    return true;
  }

  async function get({storageKey,metadata}={}){
    const normalized=PrivateObject.createPrivateObjectMetadata(metadata);
    const key=assertStorageKey(storageKey,normalized);
    const response=await fetchSigned({
      config:selected,
      fetchImpl,
      method:'GET',
      storageKey:key,
      metadata:normalized
    });
    if(!response?.ok){
      throw r2Error(
        'R2 staging-readback misslyckades.',
        'R2_STAGING_GET_FAILED',
        {statusCode:Number(response?.status)||0}
      );
    }
    const bytes=Buffer.from(await response.arrayBuffer());
    const contentLength=response.headers?.get?.('content-length');
    if(contentLength!=null&&contentLength!==''&&Number(contentLength)!==bytes.length){
      throw r2Error('R2 readback-storleken matchar inte svaret.','R2_STAGING_CONTENT_LENGTH_MISMATCH');
    }
    return bytes;
  }

  return Object.freeze({put,get});
}

module.exports=Object.freeze({
  normalizeAccountId,
  normalizeBucket,
  r2EuEndpoint,
  configFromEnvironment,
  sha256Hex,
  amzDate,
  encodeRfc3986,
  canonicalQuery,
  signS3Request,
  expectedStorageKey,
  assertStorageKey,
  objectUrl,
  createR2EuStagingTarget
});
