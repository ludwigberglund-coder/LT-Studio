'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Rotation=require('../scripts/rotate-auth-encryption-key.js');
const {rotatePassword}=require('../scripts/rotate-password.js');
const {rotateMfa}=require('../scripts/rotate-mfa.js');

const OLD_KEY='Old-Auth-Master-Key-2026-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NEW_KEY='New-Auth-Master-Key-2026-ZYXWVUTSRQPONMLKJIHGFEDCBA';
const MFA_A='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const MFA_B='JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

function fixture(){
  const db=Db.openDatabase(':memory:');
  const company=Db.createCompany(db,{legalName:'Recovery Test AB',displayName:'Recovery Test',orgNumber:'559922-1001'});
  const userA=Db.createUser(db,{username:'recovery.a',displayName:'Recovery A',passwordHash:Auth.hashPassword('Gammalt sakert lösenord A 2026!'),mfaSecretEncrypted:Auth.encryptSecret(MFA_A,OLD_KEY)});
  const userB=Db.createUser(db,{username:'recovery.b',displayName:'Recovery B',passwordHash:Auth.hashPassword('Gammalt sakert lösenord B 2026!'),mfaSecretEncrypted:Auth.encryptSecret(MFA_B,OLD_KEY)});
  Db.addMembership(db,{companyId:company.id,userId:userA.id});Db.addMembership(db,{companyId:company.id,userId:userB.id});
  return{db,company,userA,userB};
}
function session(db,userId,companyId,suffix){
  Db.createSession(db,{tokenHash:'token-'+suffix,csrfHash:'csrf-'+suffix,userId,companyId,expiresAt:'2099-01-01T00:00:00.000Z',absoluteExpiresAt:'2099-01-01T01:00:00.000Z'});
}

test('master-key-rotation omkrypterar alla MFA-hemligheter atomiskt och återkallar sessioner',()=>{
  const {db,company,userA,userB}=fixture();
  try{
    session(db,userA.id,company.id,'a');session(db,userB.id,company.id,'b');
    Db.consumeMfaStep(db,{userId:userA.id,totpCounter:123456});
    Db.consumeMfaStep(db,{userId:userB.id,totpCounter:123457});
    const result=Rotation.rotateAuthEncryptionKey(db,{oldKey:OLD_KEY,newKey:NEW_KEY});
    assert.equal(result.usersRotated,2);

    const a=Db.userById(db,userA.id),b=Db.userById(db,userB.id);
    assert.equal(Auth.decryptSecret(a.mfaSecretEncrypted,NEW_KEY),MFA_A);
    assert.equal(Auth.decryptSecret(b.mfaSecretEncrypted,NEW_KEY),MFA_B);
    assert.throws(()=>Auth.decryptSecret(a.mfaSecretEncrypted,OLD_KEY));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mfa_used_steps').get().n,0);
    const events=Db.auditForCompany(db,company.id).filter(row=>row.action==='USER_AUTH_ENCRYPTION_KEY_ROTATED');
    assert.equal(events.length,2);
    assert.ok(events.every(row=>row.details.sessionsRevoked===true&&row.details.mfaUsedStepsCleared===true));
  }finally{db.close()}
});

test('korrupt MFA-hemlighet stoppar master-key-rotation innan någon användare ändras',()=>{
  const {db,userA,userB}=fixture();
  try{
    const beforeA=Db.userById(db,userA.id).mfaSecretEncrypted;
    const beforeB=Db.userById(db,userB.id).mfaSecretEncrypted;
    db.prepare("UPDATE users SET mfa_secret_encrypted='corrupt-value' WHERE id=?").run(userB.id);
    assert.throws(()=>Rotation.rotateAuthEncryptionKey(db,{oldKey:OLD_KEY,newKey:NEW_KEY}),e=>e.code==='AUTH_KEY_DECRYPT_FAILED');
    assert.equal(Db.userById(db,userA.id).mfaSecretEncrypted,beforeA);
    assert.equal(Db.userById(db,userB.id).mfaSecretEncrypted,'corrupt-value');
    assert.notEqual(beforeB,'corrupt-value');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='USER_AUTH_ENCRYPTION_KEY_ROTATED'").get().n,0);
  }finally{db.close()}
});

test('befintlig konto-recovery för lösenord och MFA återkallar sessioner och auditeras',()=>{
  const {db,company,userA}=fixture();
  try{
    session(db,userA.id,company.id,'pw');
    rotatePassword(db,{username:'recovery.a',newPassword:'Nytt mycket sakert lösenord A 2026!'});
    assert.equal(Auth.verifyPassword('Nytt mycket sakert lösenord A 2026!',Db.userById(db,userA.id).passwordHash),true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(userA.id).n,0);
    assert.equal(Db.auditForCompany(db,company.id).filter(row=>row.action==='USER_PASSWORD_ROTATED').length,1);

    session(db,userA.id,company.id,'mfa');
    Db.consumeMfaStep(db,{userId:userA.id,totpCounter:222222});
    rotateMfa(db,{username:'recovery.a',newMfaSecret:MFA_B,encryptionKey:OLD_KEY});
    assert.equal(Auth.decryptSecret(Db.userById(db,userA.id).mfaSecretEncrypted,OLD_KEY),MFA_B);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(userA.id).n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mfa_used_steps WHERE user_id=?').get(userA.id).n,0);
    assert.equal(Db.auditForCompany(db,company.id).filter(row=>row.action==='USER_MFA_ROTATED').length,1);
  }finally{db.close()}
});
