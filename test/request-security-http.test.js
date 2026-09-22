'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
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
