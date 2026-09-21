'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {bootstrapSyntheticStaging,SYNTHETIC_TENANTS}=require('../scripts/bootstrap-staging-synthetic.js');

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
    assert.equal(result.databasePath,env.ROLLANDS_DATABASE_PATH);
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

test('synthetic staging bootstrap cleans up a newly created database after credential validation failure',()=>{
  const {dir,env}=fixture();
  try{
    env.ROLLANDS_STAGING_BETA_PASSWORD=env.ROLLANDS_STAGING_ALPHA_PASSWORD;
    assert.throws(
      ()=>bootstrapSyntheticStaging({env,root}),
      /olika lösenord/
    );
    assert.equal(fs.existsSync(env.ROLLANDS_DATABASE_PATH),false);
    assert.equal(fs.existsSync(env.ROLLANDS_DATABASE_PATH+'-wal'),false);
    assert.equal(fs.existsSync(env.ROLLANDS_DATABASE_PATH+'-shm'),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
