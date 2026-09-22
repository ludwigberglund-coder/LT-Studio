'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createServer}=require('../apps/api/server.js');

async function withServer(options,run){
  const runtime=createServer({databasePath:':memory:',secureCookies:false,...options});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  try{await run(base,runtime)}
  finally{await new Promise(resolve=>runtime.close(resolve))}
}

test('global login rate limit returns graceful 429 before application login throttle',()=>withServer({
  rateLimitEnv:{ROLLANDS_RATE_LIMIT_LOGIN_IP_PER_MINUTE:'5'}
},async base=>{
  const request=()=>fetch(base+'/api/v1/auth/login',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'nobody.test',password:'invalid password value',totp:'000000'})
  });

  for(let attempt=1;attempt<=5;attempt+=1){
    const response=await request();
    assert.equal(response.status,401);
    assert.equal((await response.json()).code,'INVALID_CREDENTIALS');
  }

  const blocked=await request();
  const body=await blocked.json();
  assert.equal(blocked.status,429);
  assert.equal(body.code,'RATE_LIMITED');
  assert.ok(Number(blocked.headers.get('retry-after'))>=1);
  assert.equal(blocked.headers.get('ratelimit-remaining'),'0');
  assert.equal(blocked.headers.get('cache-control'),'no-store');
  assert.equal(blocked.headers.get('x-frame-options'),'DENY');
  assert.equal(blocked.headers.get('x-content-type-options'),'nosniff');
  assert.match(blocked.headers.get('permissions-policy')||'',/camera=\(\)/);
  assert.equal(blocked.headers.get('cross-origin-opener-policy'),'same-origin');
  assert.equal(blocked.headers.get('cross-origin-resource-policy'),'same-origin');
  assert.match(blocked.headers.get('strict-transport-security')||'',/max-age=31536000/);
}));

test('Cloudflare client IP cannot be trusted on a publicly bound origin',()=>{
  assert.throws(()=>createServer({
    databasePath:':memory:',
    secureCookies:true,
    authEncryptionKey:'test-only-encryption-key-longer-than-thirty-two-chars',
    host:'0.0.0.0',
    allowedHosts:['portal.example.test'],
    trustCloudflare:true
  }),/Cloudflare-klient-IP/);
});

test('request guards reject unexpected API query fields before route handling',()=>withServer({},async base=>{
  const response=await fetch(base+'/api/v1/customers?unexpected=1');
  const body=await response.json();
  assert.equal(response.status,422);
  assert.equal(body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.ok(body.requestId);
}));


test('bodyless action accepts empty JSON but rejects unexpected fields before auth',()=>withServer({},async base=>{
  const compatible=await fetch(base+'/api/v1/bank/payments/payment-1/match',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:'{}'
  });
  assert.equal(compatible.status,401);
  assert.equal((await compatible.json()).code,'AUTH_REQUIRED');

  const rejected=await fetch(base+'/api/v1/bank/payments/payment-1/match',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({admin:true})
  });
  const body=await rejected.json();
  assert.equal(rejected.status,422);
  assert.equal(body.code,'UNEXPECTED_REQUEST_BODY');
  assert.ok(body.requestId);
}));


function rawGet(base,hostHeader){
  const target=new URL('/_runtime-version',base);
  return new Promise((resolve,reject)=>{
    const req=http.request({
      hostname:target.hostname,
      port:target.port,
      path:target.pathname,
      method:'GET',
      headers:{Host:hostHeader}
    },res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>{
        const raw=Buffer.concat(chunks).toString('utf8');
        resolve({status:res.statusCode,body:raw?JSON.parse(raw):{}});
      });
    });
    req.on('error',reject);
    req.end();
  });
}

test('public origin rejects spoofed loopback Host but accepts configured host',()=>withServer({
  host:'0.0.0.0',
  secureCookies:true,
  authEncryptionKey:'test-only-encryption-key-longer-than-thirty-two-chars',
  allowedHosts:['portal.example.test']
},async base=>{
  const spoofed=await rawGet(base,'127.0.0.1');
  assert.equal(spoofed.status,421);
  assert.equal(spoofed.body.code,'HOST_NOT_ALLOWED');

  const allowed=await rawGet(base,'portal.example.test');
  assert.equal(allowed.status,200);
  assert.equal(typeof allowed.body.runtimeId,'string');
  assert.ok(allowed.body.runtimeId.length>10);
}));


test('static portal responses use the stricter page CSP and security headers',()=>withServer({},async base=>{
  const response=await fetch(base+'/portal/index.html');
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-security-policy')||'',/default-src 'self'/);
  assert.match(response.headers.get('permissions-policy')||'',/geolocation=\(\)/);
  assert.equal(response.headers.get('cross-origin-opener-policy'),'same-origin');
  assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');
  assert.match(response.headers.get('strict-transport-security')||'',/max-age=31536000/);
}));
