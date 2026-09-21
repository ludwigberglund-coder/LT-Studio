'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const OperationalLog=require('../apps/api/operational-log.js');
const {createServer}=require('../apps/api/server.js');

test('operational log whitelistar fält och tar bort query/secrets',()=>{
  const value=OperationalLog.record({
    level:'warning',
    event:'http_request',
    runtimeId:'runtime-1',
    requestId:'request-1',
    method:'post',
    route:OperationalLog.routeClass('/api/v1/readiness?access_token=SUPERSECRET'),
    statusCode:503,
    durationMs:1.2,
    code:'HOST_NOT_ALLOWED',
    body:'PASSWORD=VERYSECRET',
    cookie:'session=VERYSECRET'
  });
  assert.equal(value.routeClass,'readiness');
  assert.equal(value.method,'POST');
  assert.equal(value.durationMs,2);
  assert.equal(value.statusCode,503);
  assert.equal(value.code,'HOST_NOT_ALLOWED');
  const serialized=JSON.stringify(value);
  assert.doesNotMatch(serialized,/SUPERSECRET|VERYSECRET|cookie|body|access_token/i);
});

test('operational log writer-fel får inte krascha requestflödet',()=>{
  const logger=OperationalLog.createOperationalLogger({writer:()=>{throw new Error('collector unavailable')}});
  assert.doesNotThrow(()=>logger.emit({event:'service_started',runtimeId:'runtime-1'}));
  assert.equal(logger.emit({event:'service_started',runtimeId:'runtime-1'}),null);
});

test('serverns request-id matchar strukturerad logg utan query, cookies eller privat sökväg',async()=>{
  const lines=[];
  const db=Db.openDatabase(':memory:');
  const runtime=createServer({
    databasePath:':memory:',
    db,
    secureCookies:false,
    operationalLogWriter:line=>lines.push(line)
  });
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  try{
    const base='http://127.0.0.1:'+runtime.server.address().port;
    const response=await fetch(base+'/api/v1/readiness?access_token=SUPERSECRET',{headers:{Cookie:'rollands_session=VERYSECRET'}});
    await response.text();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(response.status,200);
    const requestId=response.headers.get('x-request-id');
    assert.match(requestId,/^[0-9a-f-]{36}$/i);
    const records=lines.map(line=>JSON.parse(line));
    const row=records.find(item=>item.event==='http_request'&&item.routeClass==='readiness');
    assert.ok(row);
    assert.equal(row.requestId,requestId);
    assert.equal(row.statusCode,200);
    const serialized=lines.join('');
    assert.doesNotMatch(serialized,/SUPERSECRET|VERYSECRET|access_token|cookie|:memory:/i);
  }finally{
    await new Promise(resolve=>runtime.close(resolve));
  }
});

test('fem felaktiga inloggningar ger redigerad central säkerhetssignal',async()=>{
  const lines=[];
  const db=Db.openDatabase(':memory:');
  const runtime=createServer({
    databasePath:':memory:',
    db,
    secureCookies:false,
    operationalLogWriter:line=>lines.push(line)
  });
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  try{
    const base='http://127.0.0.1:'+runtime.server.address().port;
    for(let i=0;i<5;i++){
      const response=await fetch(base+'/api/v1/auth/login',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({username:'sensitive-user@example.test',password:'VERY-SECRET-PASSWORD'})
      });
      assert.equal(response.status,401);
      await response.text();
    }
    await new Promise(resolve=>setImmediate(resolve));
    const records=lines.map(line=>JSON.parse(line));
    const signal=records.find(item=>item.event==='security_event'&&item.code==='LOGIN_FAILURE_THRESHOLD');
    assert.ok(signal);
    assert.match(signal.runtimeId,/^[0-9a-f-]{36}$/i);
    const serialized=lines.join('');
    assert.doesNotMatch(serialized,/sensitive-user|VERY-SECRET-PASSWORD|example\.test/i);
  }finally{
    await new Promise(resolve=>runtime.close(resolve));
  }
});
