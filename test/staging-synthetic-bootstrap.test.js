'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {spawnSync}=require('node:child_process');
const {bootstrapSyntheticStaging,SYNTHETIC_TENANTS}=require('../scripts/bootstrap-staging-synthetic.js');
const {assertSyntheticStagingDatabase}=require('../apps/api/staging-data-policy.js');
const Db=require('../apps/api/database.js');
const {verifyDatabase}=require('../scripts/pilot-restore-verify.js');

const root=path.resolve(__dirname,'..');

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-staging-synthetic-'));
  return{
    dir,
    env:{
      ROLLANDS_ENV:'staging',
      ROLLANDS_DATA_CLASSIFICATION:'synthetic',
      ROLLANDS_REAL_DATA_ALLOWED:'0',
      ROLLANDS_DEMO_DATA:'0',
      ROLLANDS_DATABASE_PATH:path.join(dir,'platform.sqlite'),
      ROLLANDS_AUTH_ENCRYPTION_KEY:'synthetic-staging-auth-key-1234567890-ABCDEFG',
      ROLLANDS_STAGING_ALPHA_PASSWORD:'Synthetic-Alpha-Password-12345',
      ROLLANDS_STAGING_BETA_PASSWORD:'Synthetic-Beta-Password-67890',
      ROLLANDS_STAGING_ALPHA_MFA_SECRET:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ROLLANDS_STAGING_BETA_MFA_SECRET:'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    }
  };
}

test('synthetic staging bootstrap creates exactly two isolated fictitious tenants in a new 0600 database',()=>{
  const {dir,env}=fixture();
  try{
    const result=bootstrapSyntheticStaging({env,root});
    assert.equal(fs.realpathSync(result.databasePath),fs.realpathSync(env.ROLLANDS_DATABASE_PATH));
    assert.equal(fs.statSync(env.ROLLANDS_DATABASE_PATH).mode&0o777,0o600);

    const db=new DatabaseSync(env.ROLLANDS_DATABASE_PATH,{readOnly:true});
    try{
      const companies=db.prepare('SELECT legal_name AS legalName,org_number AS orgNumber,display_name AS displayName FROM companies ORDER BY display_name').all();
      const users=db.prepare('SELECT username,display_name AS displayName FROM users ORDER BY username').all();
      const memberships=db.prepare('SELECT company_id AS companyId,user_id AS userId FROM memberships').all();
      const audits=db.prepare("SELECT action,details_json AS detailsJson FROM audit_events WHERE action='SYNTHETIC_STAGING_BOOTSTRAP'").all();

      assert.equal(companies.length,2);
      assert.equal(users.length,2);
      assert.equal(memberships.length,2);
      assert.equal(audits.length,2);
      assert.deepEqual(companies.map(row=>row.orgNumber).sort(),SYNTHETIC_TENANTS.map(row=>row.orgNumber).sort());
      assert.ok(companies.every(row=>row.legalName.startsWith('Synthetic Staging Company ')));
      assert.ok(users.every(row=>row.username.startsWith('staging-')));
      assert.ok(audits.every(row=>JSON.parse(row.detailsJson).dataClassification==='synthetic'));

      for(const membership of memberships){
        const count=db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE user_id=?').get(membership.userId).n;
        assert.equal(count,1);
      }
    }finally{db.close()}
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('synthetic staging bootstrap refuses non-staging or any real-data allowance',()=>{
  for(const mutate of [
    env=>{env.ROLLANDS_ENV='pilot'},
    env=>{env.ROLLANDS_DATA_CLASSIFICATION='real'},
    env=>{env.ROLLANDS_REAL_DATA_ALLOWED='1'},
    env=>{env.ROLLANDS_DEMO_DATA='1'}
  ]){
    const {dir,env}=fixture();
    try{
      mutate(env);
      assert.throws(()=>bootstrapSyntheticStaging({env,root}));
      assert.equal(fs.existsSync(env.ROLLANDS_DATABASE_PATH),false);
    }finally{fs.rmSync(dir,{recursive:true,force:true})}
  }
});

test('synthetic staging bootstrap refuses to touch an existing database',()=>{
  const {dir,env}=fixture();
  try{
    fs.writeFileSync(env.ROLLANDS_DATABASE_PATH,'do-not-touch');
    const before=fs.readFileSync(env.ROLLANDS_DATABASE_PATH);
    assert.throws(
      ()=>bootstrapSyntheticStaging({env,root}),
      /helt ny databasfil/
    );
    assert.deepEqual(fs.readFileSync(env.ROLLANDS_DATABASE_PATH),before);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('synthetic staging bootstrap validates credentials before creating the database',()=>{
  const {dir,env}=fixture();
  try{
    env['ROLLANDS_STAGING_BETA_PASSWORD']=env['ROLLANDS_STAGING_ALPHA_PASSWORD'];
    assert.throws(
      ()=>bootstrapSyntheticStaging({env,root}),
      /olika lösenord/
    );
    assert.equal(fs.existsSync(env.ROLLANDS_DATABASE_PATH),false);
    assert.equal(fs.existsSync(env.ROLLANDS_DATABASE_PATH+'-wal'),false);
    assert.equal(fs.existsSync(env.ROLLANDS_DATABASE_PATH+'-shm'),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});


test('generic platform bootstrap is blocked in staging before it can create a database',()=>{
  const {dir,env}=fixture();
  try{
    const result=spawnSync(process.execPath,['scripts/bootstrap-platform.js','--apply'],{
      cwd:root,
      encoding:'utf8',
      env:{...process.env,...env}
    });
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Generisk bootstrap är blockerad i staging/);
    assert.equal(fs.existsSync(env.ROLLANDS_DATABASE_PATH),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('synthetic staging bootstrap rejects a path whose real parent resolves inside the repository',()=>{
  const {dir,env}=fixture();
  const link=path.join(dir,'repo-link');
  try{
    fs.symlinkSync(root,link,'dir');
    env.ROLLANDS_DATABASE_PATH=path.join(link,'should-never-exist.sqlite');
    assert.throws(
      ()=>bootstrapSyntheticStaging({env,root}),
      /utanför Git-repositoryt/
    );
    assert.equal(fs.existsSync(path.join(root,'should-never-exist.sqlite')),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});


test('staging runtime gate accepts only the approved synthetic bootstrap database',()=>{
  const {dir,env}=fixture();
  try{
    bootstrapSyntheticStaging({env,root});
    const db=Db.openDatabase(env.ROLLANDS_DATABASE_PATH);
    try{
      const result=assertSyntheticStagingDatabase(db,env);
      assert.equal(result.required,true);
      assert.equal(result.ok,true);
      assert.equal(result.companies,2);
    }finally{db.close()}
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('staging runtime gate refuses a database containing any non-approved company identity',()=>{
  const {dir,env}=fixture();
  try{
    const db=Db.openDatabase(env.ROLLANDS_DATABASE_PATH);
    try{
      Db.createCompany(db,{legalName:'Example Real-Looking Customer AB',displayName:'Example Customer',orgNumber:'559999-9999'});
      assert.throws(()=>assertSyntheticStagingDatabase(db,env),error=>error?.code==='UNSAFE_STAGING_DATA');
    }finally{db.close()}
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});


test('staging restore verification accepts a synthetic staging database',()=>{
  const {dir,env}=fixture();
  try{
    bootstrapSyntheticStaging({env,root});
    const result=verifyDatabase(env.ROLLANDS_DATABASE_PATH,{requireSyntheticStaging:true});
    assert.equal(result.sqliteIntegrity,true);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('staging restore verification rejects a non-synthetic customer database',()=>{
  const {dir,env}=fixture();
  try{
    const db=Db.openDatabase(env.ROLLANDS_DATABASE_PATH);
    try{
      Db.createCompany(db,{legalName:'Real Customer Example AB',displayName:'Real Customer Example',orgNumber:'559111-2222'});
    }finally{db.close()}
    assert.throws(
      ()=>verifyDatabase(env.ROLLANDS_DATABASE_PATH,{requireSyntheticStaging:true}),
      error=>error?.code==='UNSAFE_STAGING_DATA'
    );
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
