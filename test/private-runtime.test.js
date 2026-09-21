'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {createServer}=require('../apps/api/server.js');
const {validateRuntime,protectedRuntimeMode}=require('../apps/api/private-runtime.js');
const {validateConfig}=require('../scripts/pilot-preflight.js');

async function withServer(run){
  const runtime=createServer({databasePath:':memory:',secureCookies:false});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  try { await run(`http://127.0.0.1:${runtime.server.address().port}`,runtime); }
  finally { await new Promise(resolve=>runtime.close(resolve)); }
}
test('private server rejects demo flags for every method and never serves demo helpers',()=>withServer(async base=>{
  for(const path of ['/portal/invoices.html?demo=1','/portal/index.html?demo=0','/portal/payables.html?%64emo=1','/portal/website.html?DEMO=1','/api/v1/session?demo=1']){
    for(const method of ['GET','POST']){
      const r=await fetch(base+path,{method});assert.equal(r.status,400);assert.equal((await r.json()).code,'DEMO_DISABLED');
    }
  }
  for(const file of ['demo-scenario.js','demo-workflows.js','uat.html','uat.js'])assert.equal((await fetch(base+'/portal/'+file)).status,404);
  const html=await (await fetch(base+'/portal/invoices.html')).text();
  assert.doesNotMatch(html,/<script[^>]*src=["'][^"']*demo-/i);
  assert.match(html,/invoices.js/);
}));
test('private assets include the pinned PDF runtime but not arbitrary configuration or repository files',()=>withServer(async base=>{
  for(const file of ['/shared/vendor/pdf-lib.min.js','/shared/invoicing/pdf.js','/portal/payables.html','/operator/index.html','/operator/app.js','/operator/styles.css','/config/accounting-accounts.json'])assert.equal((await fetch(base+file)).status,200,file);
  for(const file of ['/config/rolands-business-decisions.json','/content/company.json','/legacy/index.html','/admin/index.html','/package.json','/.env','/portal/%2e%2e%2f../package.json','/operator/../package.json','/operator/.env','/operator/nested/file.js'])assert.equal((await fetch(base+file)).status,404,file);
  const response=await fetch(base+'/portal/invoices.html',{method:'HEAD'});
  assert.equal(response.status,200);assert.equal(await response.text(),'');
  assert.match(response.headers.get('content-security-policy'),/script-src 'self';/);
  assert.match(response.headers.get('content-security-policy'),/object-src 'none'/);
}));
test('production start cannot bypass preflight by binding to loopback',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-start-test-'));
  const file=path.join(folder,'not-created.sqlite');
  try{
    const result=spawnSync(process.execPath,['apps/api/server.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:5000,
      env:{...process.env,NODE_ENV:'production',ROLLANDS_ENV:'pilot',ROLLANDS_DATABASE_PATH:file,
        ROLLANDS_API_HOST:'127.0.0.1',ROLLANDS_API_SECURE_COOKIE:'0',ROLLANDS_AUTH_ENCRYPTION_KEY:'',ROLLANDS_BACKUP_PATH:folder,ROLLANDS_ALLOWED_HOSTS:'pilot.example.invalid'}});
    assert.notEqual(result.status,0);assert.match(result.stderr,/UNSAFE_RUNTIME_CONFIGURATION/);assert.equal(fs.existsSync(file),false);
  }finally{fs.rmSync(folder,{recursive:true,force:true})}
});
function config(folder,{mode='pilot',approvedForPilot=true}={}){
  const operationsPath=path.join(folder,'pilot-operations.json');
  fs.writeFileSync(operationsPath,JSON.stringify({
    schemaVersion:1,technicalOwner:'Tekniskt ansvar',accountingOwner:'Redovisningsansvar',dataProtectionOwner:'Dataskyddsansvar',
    backupOwner:'Backupansvar',monitoringOwner:'Övervakningsansvar',incidentContact:'incident@example.test',
    supportChannel:'support@example.test',pilotStopAuthority:'Pilotansvarig',rollbackDecisionProcess:'Incidentansvarig fattar dokumenterat återgångsbeslut.',
    offsiteBackupDestination:'Extern krypterad backupdestination',logRetentionDays:30,backupRetentionDays:90,approvedForPilot,approvedAt:approvedForPilot?'2026-09-20':null
  }));
  return{NODE_ENV:'production',ROLLANDS_ENV:mode,ROLLANDS_DATABASE_PATH:path.join(folder,'db.sqlite'),ROLLANDS_BACKUP_PATH:folder,
    ROLLANDS_PILOT_OPERATIONS_PATH:operationsPath,ROLLANDS_API_HOST:'127.0.0.1',ROLLANDS_API_SECURE_COOKIE:'1',
    ROLLANDS_AUTH_ENCRYPTION_KEY:'test-only-runtime-key-123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',ROLLANDS_BACKUP_ENCRYPTION_KEY:'test-only-backup-key-987654321-ZYXWVUTSRQPONMLKJIHGFEDCBA',ROLLANDS_ALLOWED_HOSTS:'pilot.rollands.internal',ROLLANDS_DEMO_DATA:'0'};
}
function settings(env){return {databasePath:env.ROLLANDS_DATABASE_PATH,host:env.ROLLANDS_API_HOST,secureCookies:env.ROLLANDS_API_SECURE_COOKIE==='1',authEncryptionKey:env.ROLLANDS_AUTH_ENCRYPTION_KEY,allowedHosts:env.ROLLANDS_ALLOWED_HOSTS.split(',')}}
test('validated private start creates a 0600 database file and rejects all nonzero demo flags',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-private-mode-'));
  try{
    const env=config(folder,{mode:'staging',approvedForPilot:false});env.ROLLANDS_BACKUP_PATH=path.join(folder,'backup');fs.mkdirSync(env.ROLLANDS_BACKUP_PATH);
    for(const flag of ['1','true','yes'])assert.ok(validateConfig({...env,ROLLANDS_DEMO_DATA:flag}).fail.some(v=>v.includes('ROLLANDS_DEMO_DATA')));
    assert.throws(()=>validateRuntime({...env,ROLLANDS_ENV:'demo'},settings(env)),{code:'UNSAFE_RUNTIME_CONFIGURATION'});
    assert.throws(()=>validateRuntime(env,{...settings(env),db:{}}),{code:'UNSAFE_RUNTIME_CONFIGURATION'});
    validateRuntime(env,settings(env));assert.equal(fs.statSync(env.ROLLANDS_DATABASE_PATH).mode&0o777,0o600);
  }finally{fs.rmSync(folder,{recursive:true,force:true})}
});
test('staging är skyddad privat runtime men kräver inte slutligt pilotgodkännande',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-staging-mode-'));
  try{
    const env=config(folder,{mode:'staging',approvedForPilot:false});
    env.ROLLANDS_BACKUP_PATH=path.join(folder,'backup');fs.mkdirSync(env.ROLLANDS_BACKUP_PATH);

    assert.equal(protectedRuntimeMode(env),true);
    assert.equal(protectedRuntimeMode({NODE_ENV:'development',ROLLANDS_ENV:'development'}),false);
    assert.deepEqual(validateConfig(env).fail,[]);
    validateRuntime(env,settings(env));
    assert.equal(fs.statSync(env.ROLLANDS_DATABASE_PATH).mode&0o777,0o600);

    assert.throws(
      ()=>validateRuntime({...env,ROLLANDS_ENV:'pilot'},settings({...env,ROLLANDS_ENV:'pilot'})),
      {code:'UNSAFE_RUNTIME_CONFIGURATION'}
    );
  }finally{fs.rmSync(folder,{recursive:true,force:true})}
});

test('pilot preflight requires an approved external operations decision file',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-operations-gate-'));
  try{
    const env=config(folder);
    fs.rmSync(env.ROLLANDS_PILOT_OPERATIONS_PATH);
    assert.ok(validateConfig(env).fail.some(v=>v.includes('operationsfil')));
    fs.writeFileSync(env.ROLLANDS_PILOT_OPERATIONS_PATH,JSON.stringify({
      schemaVersion:1,technicalOwner:'REPLACE_WITH_PERSON',accountingOwner:'A',dataProtectionOwner:'B',backupOwner:'C',monitoringOwner:'D',
      incidentContact:'E',supportChannel:'F',pilotStopAuthority:'G',rollbackDecisionProcess:'H',offsiteBackupDestination:'I',
      logRetentionDays:30,backupRetentionDays:90,approvedForPilot:false,approvedAt:'YYYY-MM-DD'
    }));
    const report=validateConfig(env);
    assert.ok(report.fail.some(v=>v.includes('placeholder')));
    assert.ok(report.fail.some(v=>v.includes('approvedForPilot')));
  }finally{fs.rmSync(folder,{recursive:true,force:true})}
});

test('storage symlinks into the repository cannot bypass private preflight',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-symlink-test-'));
  try{
    fs.symlinkSync(path.resolve(__dirname,'..'),path.join(folder,'link'),'dir');
    const env=config(folder);env.ROLLANDS_DATABASE_PATH=path.join(folder,'link','data','not-created.sqlite');
    assert.ok(validateConfig(env).fail.some(v=>v.includes('ROLLANDS_DATABASE_PATH')));
  }finally{fs.rmSync(folder,{recursive:true,force:true})}
});

test('private navigation contains only usable portal links and uses the real receivables API screen',()=>withServer(async base=>{
  const Nav=require('../apps/portal/portal-nav.js');
  const access=require('../config/access-control.json');
  const items=Nav.visibleGroups({authenticated:true}).flatMap(group=>group.items);
  assert.equal(new Set(items.map(row=>row[2])).size,items.length);
  assert.equal(items.find(row=>row[0]==='receivables')[2],'portal/index.html');
  assert.ok(!items.some(row=>/^(admin|legacy)\//.test(row[2]) || row[0]==='uat'));
  for(const [id,label,route] of items)assert.equal((await fetch(base+'/'+route)).status,200,label);
  for(const route of ['/portal/','/portal/receivables.html']){
    const alias=await fetch(base+route,{redirect:'manual'});
    assert.equal(alias.status,302);assert.equal(alias.headers.get('location'),'/portal/index.html');
  }
  assert.ok(Nav.visibleGroups(access,[],{}).length===0);
  assert.ok(Nav.visibleGroups({demo:true}).flatMap(group=>group.items).some(row=>row[0]==='uat'));
}));


test('runtime-version är no-store och ändras när servern startas om',async()=>{
  const first=createServer({databasePath:':memory:',secureCookies:false});
  await new Promise(resolve=>first.server.listen(0,'127.0.0.1',resolve));
  const firstBase=`http://127.0.0.1:${first.server.address().port}`;
  let firstId;
  try{
    const response=await fetch(firstBase+'/_runtime-version');
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    firstId=(await response.json()).runtimeId;
    assert.equal(firstId,first.runtimeId);
  }finally{await new Promise(resolve=>first.close(resolve));}

  const second=createServer({databasePath:':memory:',secureCookies:false});
  await new Promise(resolve=>second.server.listen(0,'127.0.0.1',resolve));
  const secondBase=`http://127.0.0.1:${second.server.address().port}`;
  try{
    const response=await fetch(secondBase+'/_runtime-version');
    const secondId=(await response.json()).runtimeId;
    assert.notEqual(secondId,firstId);
    const head=await fetch(secondBase+'/_runtime-version',{method:'HEAD'});
    assert.equal(head.status,200);
    assert.equal(await head.text(),'');
    const post=await fetch(secondBase+'/_runtime-version',{method:'POST'});
    assert.equal(post.status,405);
  }finally{await new Promise(resolve=>second.close(resolve));}
});
