'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Db=require('../apps/api/database.js');

test('uppgradering bevarar konton, medlemskap och audit men avslutar gamla sessioner',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rolands-membership-'));
  const file=path.join(dir,'platform.sqlite');
  let db=Db.openDatabase(file);
  try {
    const company=Db.createCompany(db,{legalName:'Migration Test AB',displayName:'Test',orgNumber:'559900-9988'});
    const user=Db.createUser(db,{username:'migration.user',displayName:'Test User',passwordHash:'test-only-preserved-hash'});
    Db.addMembership(db,{companyId:company.id,userId:user.id});
    const before=Db.membership(db,company.id,user.id);
    Db.appendAudit(db,{companyId:company.id,userId:user.id,action:'HISTORICAL_TEST',entityType:'user',entityId:user.id,details:{roles:['auditor']}});
    const audit=Db.auditForCompany(db,company.id);
    Db.createSession(db,{companyId:company.id,userId:user.id,tokenHash:'old-session',csrfHash:'old-csrf',expiresAt:new Date(Date.now()+60000).toISOString()});
    // Simulate the previous schema, including a user whose old role did not require MFA.
    db.exec(`ALTER TABLE memberships ADD COLUMN roles_json TEXT NOT NULL DEFAULT '["auditor"]'`);
    db.close();db=Db.openDatabase(file);
    assert.deepEqual(Db.membership(db,company.id,user.id),before);
    assert.equal(Db.userById(db,user.id).passwordHash,'test-only-preserved-hash');
    assert.deepEqual(Db.auditForCompany(db,company.id),audit);
    assert.equal(db.prepare('PRAGMA table_info(memberships)').all().some(c=>c.name==='roles_json'),false);
    assert.equal(Db.sessionByTokenHash(db,'old-session'),null);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    Db.createSession(db,{companyId:company.id,userId:user.id,tokenHash:'new-session',csrfHash:'new-csrf',expiresAt:new Date(Date.now()+60000).toISOString()});
    db.close();db=Db.openDatabase(file);
    assert.ok(Db.sessionByTokenHash(db,'new-session'),'repeated startup does not revoke new sessions');
    assert.deepEqual(Db.membership(db,company.id,user.id),before);
  } finally {db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('misslyckad migrering rullar tillbaka kolumnändringen utan kontoförlust',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rolands-membership-fail-'));
  const file=path.join(dir,'platform.sqlite');
  let db=Db.openDatabase(file);
  try {
    db.exec(`ALTER TABLE memberships ADD COLUMN roles_json TEXT NOT NULL DEFAULT '[]';
      CREATE TRIGGER reject_session_revoke BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'test migration failure'); END;`);
    const company=Db.createCompany(db,{legalName:'Rollback Test AB',displayName:'Test',orgNumber:'559900-9977'});
    const user=Db.createUser(db,{username:'rollback.user',displayName:'Rollback',passwordHash:'test-only-hash'});
    Db.addMembership(db,{companyId:company.id,userId:user.id});
    Db.createSession(db,{companyId:company.id,userId:user.id,tokenHash:'old',csrfHash:'csrf',expiresAt:new Date(Date.now()+60000).toISOString()});
    db.close();db=null;
    assert.throws(()=>Db.openDatabase(file),/test migration failure/);
    db=new DatabaseSync(file);
    assert.ok(db.prepare('PRAGMA table_info(memberships)').all().some(c=>c.name==='roles_json'));
    assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM memberships').get().n,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n,1);
  } finally {db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
