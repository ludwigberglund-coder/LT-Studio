'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const R2=require('../apps/api/r2-eu-staging-target.js');
const PrivateObject=require('../apps/api/private-object-contract.js');

function env(overrides={}){
  return{
    ROLLANDS_ENV:'staging',
    R2_STAGING_ENABLED:'1',
    R2_STAGING_JURISDICTION:'eu',
    R2_STAGING_ACCOUNT_ID:'a'.repeat(32),
    R2_STAGING_BUCKET:'lt-private-staging',
    R2_STAGING_ACCESS_KEY_ID:'test-access-key-id',
    R2_STAGING_SECRET_ACCESS_KEY:'test-secret-access-key-value',
    ...overrides
  };
}

function objectFixture(){
  const bytes=Buffer.from('%PDF-1.4\nr2-staging-target\n','ascii');
  const metadata=PrivateObject.createPrivateObjectMetadata({
    companyId:'company_r2',
    kind:PrivateObject.PRIVATE_OBJECT_KINDS.DOCUMENT,
    objectId:'doc_r2',
    mimeType:'application/pdf',
    sizeBytes:bytes.length,
    sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
    createdAt:'2026-09-21T10:00:00.000Z'
  });
  return{
    bytes,
    metadata,
    storageKey:metadata.objectKey+'/'+metadata.sha256
  };
}

function response({status=200,body=Buffer.alloc(0),headers={}}={}){
  const normalized=new Map(
    Object.entries(headers).map(([key,value])=>[key.toLowerCase(),String(value)])
  );
  return{
    status,
    ok:status>=200&&status<300,
    headers:{
      get(name){return normalized.get(String(name).toLowerCase())??null}
    },
    async arrayBuffer(){
      const copy=Buffer.from(body);
      return copy.buffer.slice(copy.byteOffset,copy.byteOffset+copy.byteLength);
    }
  };
}

test('AWS SigV4-signeringen matchar AWS officiella S3-testvektor',()=>{
  const signed=R2.signS3Request({
    method:'GET',
    url:'https://examplebucket.s3.amazonaws.com/test.txt',
    headers:{range:'bytes=0-9'},
    accessKeyId:'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey:'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region:'us-east-1',
    now:new Date('2013-05-24T00:00:00.000Z')
  });

  assert.equal(
    signed.signature,
    'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
  );
  assert.equal(
    signed.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,'+
    'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,'+
    'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
  );
});

test('R2 staging-konfiguration är fail-closed, EU-låst och loggar inte credentials via JSON',()=>{
  const config=R2.configFromEnvironment(env());
  assert.equal(config.jurisdiction,'eu');
  assert.equal(config.region,'auto');
  assert.equal(config.endpoint,'https://'+'a'.repeat(32)+'.eu.r2.cloudflarestorage.com');
  assert.equal(config.bucket,'lt-private-staging');
  assert.equal(config.accessKeyId,'test-access-key-id');
  assert.equal(config.secretAccessKey,'test-secret-access-key-value');
  assert.doesNotMatch(JSON.stringify(config),/access-key|secret/i);

  for(const bad of [
    {...env(),ROLLANDS_ENV:'production'},
    {...env(),R2_STAGING_ENABLED:'0'},
    {...env(),R2_STAGING_JURISDICTION:'us'},
    {...env(),R2_STAGING_ACCOUNT_ID:'not-an-account'},
    {...env(),R2_STAGING_BUCKET:'Bad_Bucket'}
  ]){
    assert.throws(()=>R2.configFromEnvironment(bad));
  }
});

test('R2 target använder signerad villkorad PUT mot EU-endpoint och serverstyrd nyckel',async()=>{
  const calls=[];
  const {bytes,metadata,storageKey}=objectFixture();
  const target=R2.createR2EuStagingTarget({
    config:R2.configFromEnvironment(env()),
    fetchImpl:async(url,options)=>{
      calls.push({url:url.toString(),options});
      return response({status:200});
    }
  });

  assert.equal(Object.isFrozen(target),true);
  assert.equal(await target.put({storageKey,metadata,bytes}),true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,'PUT');
  assert.equal(
    calls[0].url,
    'https://'+'a'.repeat(32)+'.eu.r2.cloudflarestorage.com/lt-private-staging/'+storageKey
  );
  assert.equal(calls[0].options.headers['if-none-match'],'*');
  assert.equal(calls[0].options.headers['content-type'],'application/pdf');
  assert.equal(calls[0].options.headers['x-amz-meta-sha256'],metadata.sha256);
  assert.equal(calls[0].options.headers['x-amz-meta-companyid'],metadata.companyId);
  assert.match(calls[0].options.headers.Authorization,/^AWS4-HMAC-SHA256 Credential=test-access-key-id\//);
  assert.match(calls[0].options.headers.Authorization,/\/auto\/s3\/aws4_request,/);
  assert.deepEqual(Buffer.from(calls[0].options.body),bytes);
  assert.equal(calls[0].options.redirect,'error');
});

test('befintlig SHA-nyckel behandlas idempotent vid 412 och skrivs inte över',async()=>{
  const {bytes,metadata,storageKey}=objectFixture();
  let calls=0;
  const target=R2.createR2EuStagingTarget({
    config:R2.configFromEnvironment(env()),
    fetchImpl:async()=>{
      calls+=1;
      return response({status:412});
    }
  });
  assert.equal(await target.put({storageKey,metadata,bytes}),true);
  assert.equal(calls,1);
});

test('R2 readback returnerar bytes som workern sedan kan SHA-verifiera',async()=>{
  const calls=[];
  const {bytes,metadata,storageKey}=objectFixture();
  const target=R2.createR2EuStagingTarget({
    config:R2.configFromEnvironment(env()),
    fetchImpl:async(url,options)=>{
      calls.push({url:url.toString(),options});
      return response({
        status:200,
        body:bytes,
        headers:{'content-length':bytes.length}
      });
    }
  });
  const read=await target.get({storageKey,metadata});
  assert.deepEqual(read,bytes);
  assert.notEqual(read,bytes);
  assert.equal(calls[0].options.method,'GET');
  assert.equal(
    calls[0].url,
    'https://'+'a'.repeat(32)+'.eu.r2.cloudflarestorage.com/lt-private-staging/'+storageKey
  );
  assert.match(calls[0].options.headers.Authorization,/AWS4-HMAC-SHA256/);
});

test('klienten kan inte välja annan fysisk objektnyckel',async()=>{
  const {bytes,metadata}=objectFixture();
  let calls=0;
  const target=R2.createR2EuStagingTarget({
    config:R2.configFromEnvironment(env()),
    fetchImpl:async()=>{calls+=1;return response({status:200})}
  });
  await assert.rejects(
    target.put({storageKey:'private/other-company/stolen-key',metadata,bytes}),
    error=>error.code==='R2_STAGING_STORAGE_KEY_MISMATCH'
  );
  assert.equal(calls,0);
});
