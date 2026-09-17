'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const {rotatePassword}=require('../scripts/rotate-password.js');

test('lösenordsrotation byter hash, återkallar sessioner och loggar händelsen',()=>{
  const db=Db.openDatabase(':memory:');
  try {
    const company=Db.createCompany(db,{legalName:'Test AB',displayName:'Test',orgNumber:'556000-0000'});
    const oldPassword='Ett gammalt langt testlosenord 2026!';
    const user=Db.createUser(db,{username:'ekonom',displayName:'Ekonom',passwordHash:Auth.hashPassword(oldPassword)});
    Db.addMembership(db,{companyId:company.id,userId:user.id,roles:['accountant']});
    Db.createSession(db,{tokenHash:'tokenhash',csrfHash:'csrfhash',userId:user.id,companyId:company.id,expiresAt:'2099-01-01T00:00:00.000Z'});

    const newPassword='Ett helt nytt langt testlosenord 2026!';
    rotatePassword(db,{username:'EKONOM',newPassword});

    const updated=Db.userByUsername(db,'ekonom');
    assert.equal(Auth.verifyPassword(oldPassword,updated.passwordHash),false);
    assert.equal(Auth.verifyPassword(newPassword,updated.passwordHash),true);
    assert.equal(db.prepare('SELECT count(*) AS count FROM sessions WHERE user_id=?').get(user.id).count,0);
    const audit=Db.auditForCompany(db,company.id);
    assert.equal(audit[0].action,'USER_PASSWORD_ROTATED');
    assert.equal(audit[0].details.sessionsRevoked,true);
  } finally { db.close(); }
});

test('lösenordsrotation vägrar okänd användare och svagt lösenord',()=>{
  const db=Db.openDatabase(':memory:');
  try {
    assert.throws(()=>rotatePassword(db,{username:'saknas',newPassword:'Ett langt nog testlosenord 2026!'}),/Användaren finns inte/);
    const user=Db.createUser(db,{username:'ekonom',displayName:'Ekonom',passwordHash:Auth.hashPassword('Ett gammalt langt testlosenord 2026!')});
    assert.throws(()=>rotatePassword(db,{username:user.username,newPassword:'kort'}),error=>error.code==='WEAK_PASSWORD');
  } finally { db.close(); }
});
