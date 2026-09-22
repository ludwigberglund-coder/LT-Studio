'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const {createServer}=require('../apps/api/server.js');

const KEY='Persistent-Login-Throttle-Test-Key-2026-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MFA='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const PASSWORD='Ett unikt langt testlosenord 2026!';

function seed(filename){
  const db=Db.openDatabase(filename);
  const company=Db.createCompany(db,{legalName:'Throttle Test AB',displayName:'Throttle Test',orgNumber:'559933-1001'});
  const user=Db.createUser(db,{username:'throttle.user',displayName:'Throttle User',passwordHash:Auth.hashPassword(PASSWORD),mfaSecretEncrypted:Auth.encryptSecret(MFA,KEY)});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  db.close();
}
async function start(filename,options={}){
  const runtime=createServer({databasePath:filename,secureCookies:false,authEncryptionKey:KEY,...options});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  return{runtime,base:`http://127.0.0.1:${runtime.server.address().port}`};
}
async function stop(runtime){await new Promise(resolve=>runtime.close(resolve))}
async function login(base,{password=PASSWORD,totp=Auth.totpCode(MFA),clientIp=''}={}){
  const headers={'Content-Type':'application/json'};
  if(clientIp)headers['CF-Connecting-IP']=clientIp;
  return fetch(base+'/api/v1/auth/login',{method:'POST',headers,body:JSON.stringify({username:'throttle.user',password,totp})});
}

test('fem felaktiga försök överlever serveromstart och blockerar nästa försök',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-login-throttle-')),dbPath=path.join(dir,'platform.sqlite');
  seed(dbPath);
  let first,second;
  try{
    first=await start(dbPath);
    for(let i=0;i<5;i++){
      const response=await login(first.base,{password:'felaktigt testlosenord som inte matchar'});
      assert.equal(response.status,401);
      assert.equal((await response.json()).code,'INVALID_CREDENTIALS');
    }
    await stop(first.runtime);first=null;

    second=await start(dbPath);
    const blocked=await login(second.base,{password:'fortfarande felaktigt testlosenord'});
    assert.equal(blocked.status,429);
    assert.equal((await blocked.json()).code,'LOGIN_RATE_LIMITED');
    assert.equal(blocked.headers.get('retry-after'),'900');

    const inspect=Db.openDatabase(dbPath);
    try{
      const rows=inspect.prepare('SELECT key_hash AS keyHash,failure_count AS failureCount FROM login_attempts').all();
      assert.equal(rows.length,2);
      assert.deepEqual(rows.map(row=>row.failureCount).sort((a,b)=>a-b),[5,5]);
      for(const row of rows)assert.match(row.keyHash,/^[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(rows).includes('throttle.user'),false);
      assert.equal(JSON.stringify(rows).includes('127.0.0.1'),false);
    }finally{inspect.close()}
  }finally{
    if(first)await stop(first.runtime);
    if(second)await stop(second.runtime);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('lyckad MFA-inloggning rensar tidigare felräknare',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-login-clear-')),dbPath=path.join(dir,'platform.sqlite');
  seed(dbPath);
  let runtime;
  try{
    const started=await start(dbPath);runtime=started.runtime;
    for(let i=0;i<4;i++)assert.equal((await login(started.base,{password:'felaktigt testlosenord som inte matchar'})).status,401);
    const success=await login(started.base);
    assert.equal(success.status,200);
    assert.equal((await success.json()).authenticated,true);
    const rows=runtime.db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n;
    assert.equal(rows,0);
  }finally{
    if(runtime)await stop(runtime);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});


test('konto-baserad spärr stoppar distribuerade försök från många Cloudflare-IP:n',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-account-throttle-')),dbPath=path.join(dir,'platform.sqlite');
  seed(dbPath);
  let runtime;
  try{
    const started=await start(dbPath,{trustCloudflare:true});runtime=started.runtime;
    for(let i=1;i<=20;i+=1){
      const response=await login(started.base,{
        password:'distribuerat felaktigt testlosenord',
        clientIp:`203.0.113.${i}`
      });
      assert.equal(response.status,401);
    }
    const blocked=await login(started.base,{
      password:'fortsatt felaktigt testlosenord',
      clientIp:'198.51.100.200'
    });
    assert.equal(blocked.status,429);
    assert.equal((await blocked.json()).code,'LOGIN_RATE_LIMITED');

    const events=Db.securityEvents(runtime.db).filter(event=>event.kind==='ACCOUNT_LOGIN_FAILURE_THRESHOLD');
    assert.equal(events.length,1);
    assert.equal(events[0].severity,'critical');
    assert.equal(events[0].details.scope,'user');
    assert.doesNotMatch(JSON.stringify(events[0]),/throttle\.user|203\.0\.113/);
  }finally{
    if(runtime)await stop(runtime);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
