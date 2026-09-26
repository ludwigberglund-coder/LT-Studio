'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','supabase-client.js'),'utf8');

function response(status,body){
  return{
    ok:status>=200&&status<300,
    status,
    async text(){return body==null?'':JSON.stringify(body)},
    async json(){return body}
  };
}

function clientWithFetch(fetchImpl){
  const window={LT_SUPABASE:{url:'https://example.supabase.co',publishableKey:'pk_test'}};
  const sandbox={
    window,
    fetch:fetchImpl,
    setTimeout(fn){fn();return 1},
    clearTimeout(){},
    Promise,
    JSON,
    Object,
    String,
    RegExp,
    encodeURIComponent
  };
  vm.runInNewContext(source,sandbox,{filename:'supabase-client.js'});
  return window.LTSupabase;
}

test('GET retries transient JWT issued-at-future errors and then succeeds',async()=>{
  let calls=0;
  const client=clientWithFetch(async()=>{
    calls+=1;
    if(calls===1)return response(403,{message:'JWT issued at future'});
    return response(200,{id:'user-1'});
  });
  const user=await client.getUser('token');
  assert.equal(user.id,'user-1');
  assert.equal(calls,2);
});

test('REST selects retry transient JWT clock skew without duplicating writes',async()=>{
  let calls=0;
  const client=clientWithFetch(async()=>{
    calls+=1;
    if(calls<3)return response(401,{message:'jwt issued at future'});
    return response(200,[{id:'row-1'}]);
  });
  const rows=await client.from('companies','token').select('*');
  assert.equal(rows[0].id,'row-1');
  assert.equal(calls,3);
});

test('POST requests are never automatically replayed on JWT clock skew',async()=>{
  let calls=0;
  const client=clientWithFetch(async()=>{calls+=1;return response(403,{message:'JWT issued at future'});});
  await assert.rejects(
    ()=>client.from('companies','token').insert([{display_name:'Test'}]),
    /sessionen håller fortfarande på att synkroniseras/
  );
  assert.equal(calls,1);
});


test('refresh session exchanges the refresh token exactly once',async()=>{
  const calls=[];
  const client=clientWithFetch(async(url,options)=>{
    calls.push({url,options});
    return response(200,{access_token:'new-access',refresh_token:'new-refresh'});
  });
  const refreshed=await client.refreshSession('old-refresh');
  assert.equal(refreshed.access_token,'new-access');
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/\/auth\/v1\/token\?grant_type=refresh_token$/);
  assert.deepEqual(JSON.parse(calls[0].options.body),{refresh_token:'old-refresh'});
});

test('sign out defaults to global Supabase scope',async()=>{
  const calls=[];
  const client=clientWithFetch(async(url,options)=>{calls.push({url,options});return response(204,null);});
  await client.signOut('access-token');
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/\/auth\/v1\/logout$/);
  assert.equal(calls[0].options.headers.Authorization,'Bearer access-token');
});
