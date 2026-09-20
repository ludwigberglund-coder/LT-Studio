'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Recovery=require('../scripts/recover-account.js');
const KeyRotation=require('../scripts/rotate-auth-encryption-key.js');

const OLD_KEY='Old-Auth-Key-2026-ABCDEFGHIJKLMNOPQRSTUVWXYZ-123456';
const NEW_KEY='New-Auth-Key-2026-ZYXWVUTSRQPONMLKJIHGFEDCBA-654321';
const MFA='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const NEW_MFA='JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const OLD_PASSWORD='Gammalt sakert testlosenord 2026!';
const NEW_PASSWORD='Nytt sakert testlosenord 2026!';

function fixture(){
  const db=Db.openDatabase(':memory:');
  const company=Db.createCompany(db,{legalName:'Recovery AB',displayName:'Recovery',orgNumber:'559922-1001'});
  const target=Db.createUser(db,{username:'target.user',displayName:'Target User',passwordHash:Auth.hashPassword(OLD_PASSWORD),mfaSecretEncrypted:Auth.encryptSecret(MFA,OLD_KEY)});
  const a=Db.createUser(db,{username:'approver.one',displayName:'Approver One',passwordHash:Auth.hashPassword(OLD_PASSWORD),mfaSecretEncrypted:Auth.encryptSecret(MFA,OLD_KEY)});
  const b=Db.createUser(db,{username:'approver.two',displayName:'Approver Two',passwordHash:Auth.hashPassword(OLD_PASSWORD),mfaSecretEncrypted:Auth.encryptSecret(MFA,OLD_KEY)});
  for(const user of [target,a,b])Db.addMembership(db,{companyId:company.id,userId:user.id});
  const token=Auth.randomToken(32);
  Db.createSession(db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(Auth.randomToken(24)),userId:target.id,companyId:company.id,expiresAt:new Date(Date.now()+60000).toISOString()});
  Db.consumeMfaStep(db,{userId:target.id,totpCounter:123456});
  return{db,company,target,a,b,token};
}

test('kontorecovery roterar lösenord och MFA atomiskt, återkallar session och skapar audit',()=>{
  const {db,company,target}=fixture();
  try{
    const result=Recovery.recoverAccount(db,{
      username:'target.user',newPassword:NEW_PASSWORD,newMfaSecret:NEW_MFA,encryptionKey:OLD_KEY,
      approverOneUsername:'approver.one',approverTwoUsername:'approver.two',recoveryReference:'INC-2026-0001'
    });
    assert.equal(result.companies,1);
    const user=Db.userById(db,target.id);
    assert.equal(Auth.verifyPassword(NEW_PASSWORD,user.passwordHash),true);
    assert.equal(Auth.verifyPassword(OLD_PASSWORD,user.passwordHash),false);
    assert.equal(Auth.decryptSecret(user.mfaSecretEncrypted,OLD_KEY),NEW_MFA);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(target.id).n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mfa_used_steps WHERE user_id=?').get(target.id).n,0);
    const events=Db.auditForCompany(db,company.id).filter(row=>row.action==='USER_ACCOUNT_RECOVERED');
    assert.equal(events.length,1);
    assert.equal(events[0].details.recoveryReference,'INC-2026-0001');
    assert.equal(events[0].details.approverOneUsername,'approver.one');
    assert.equal(events[0].details.approverTwoUsername,'approver.two');
    assert.equal(JSON.stringify(events[0].details).includes(NEW_PASSWORD),false);
    assert.equal(JSON.stringify(events[0].details).includes(NEW_MFA),false);
  }finally{db.close()}
});

test('kontoinnehavaren eller samma person två gånger får inte godkänna recovery',()=>{
  const {db}=fixture();
  try{
    const base={username:'target.user',newPassword:NEW_PASSWORD,newMfaSecret:NEW_MFA,encryptionKey:OLD_KEY,recoveryReference:'INC-2026-0002'};
    assert.throws(()=>Recovery.recoverAccount(db,{...base,approverOneUsername:'target.user',approverTwoUsername:'approver.two'}),e=>e.code==='RECOVERY_SELF_APPROVAL');
    assert.throws(()=>Recovery.recoverAccount(db,{...base,approverOneUsername:'approver.one',approverTwoUsername:'approver.one'}),e=>e.code==='RECOVERY_TWO_APPROVERS_REQUIRED');
    assert.equal(Auth.verifyPassword(OLD_PASSWORD,Db.userByUsername(db,'target.user').passwordHash),true);
  }finally{db.close()}
});

test('båda godkännarna måste täcka alla företag som kontot tillhör',()=>{
  const {db,target,a,b}=fixture();
  try{
    const second=Db.createCompany(db,{legalName:'Recovery Two AB',displayName:'Recovery Two',orgNumber:'559922-1002'});
    Db.addMembership(db,{companyId:second.id,userId:target.id});
    Db.addMembership(db,{companyId:second.id,userId:a.id});
    assert.throws(()=>Recovery.recoverAccount(db,{
      username:'target.user',newPassword:NEW_PASSWORD,newMfaSecret:NEW_MFA,encryptionKey:OLD_KEY,
      approverOneUsername:a.username,approverTwoUsername:b.username,recoveryReference:'INC-2026-0003'
    }),e=>e.code==='RECOVERY_APPROVER_SCOPE_MISMATCH');
    assert.equal(Auth.verifyPassword(OLD_PASSWORD,Db.userById(db,target.id).passwordHash),true);
  }finally{db.close()}
});

test('auth-nyckelrotation omkrypterar alla MFA-hemligheter och återkallar sessioner',()=>{
  const {db,target,a,b}=fixture();
  try{
    const result=KeyRotation.rotateAuthEncryptionKey(db,{oldKey:OLD_KEY,newKey:NEW_KEY});
    assert.equal(result.usersRotated,3);
    for(const user of [target,a,b]){
      const current=Db.userById(db,user.id);
      assert.throws(()=>Auth.decryptSecret(current.mfaSecretEncrypted,OLD_KEY));
      assert.equal(Auth.decryptSecret(current.mfaSecretEncrypted,NEW_KEY),MFA);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mfa_used_steps').get().n,0);
  }finally{db.close()}
});

test('fel gammal auth-nyckel lämnar samtliga MFA-hemligheter oförändrade',()=>{
  const {db,target,a,b}=fixture();
  try{
    const before=new Map([target,a,b].map(user=>[user.id,Db.userById(db,user.id).mfaSecretEncrypted]));
    assert.throws(()=>KeyRotation.rotateAuthEncryptionKey(db,{oldKey:'Wrong-Auth-Key-2026-abcdefghijklmnopqrstuvwxyz-123456',newKey:NEW_KEY}),e=>e.code==='AUTH_KEY_DECRYPT_FAILED');
    for(const user of [target,a,b])assert.equal(Db.userById(db,user.id).mfaSecretEncrypted,before.get(user.id));
  }finally{db.close()}
});
