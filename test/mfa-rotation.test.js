'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Auth=require('../apps/api/auth.js');
const Db=require('../apps/api/database.js');
const {rotateMfa}=require('../scripts/rotate-mfa.js');

test('MFA-rotation ersätter hemligheten, återkallar sessioner och rensar använda TOTP-steg',()=>{
  const db=Db.openDatabase(':memory:');
  const key='test-only-mfa-rotation-key-123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const oldSecret='JBSWY3DPEHPK3PXP';
  const newSecret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  try {
    const company=Db.createCompany(db,{legalName:'Testbolag AB',displayName:'Testbolag',orgNumber:'559999-1000'});
    const user=Db.createUser(db,{
      username:'mfa.test',
      displayName:'MFA Test',
      passwordHash:Auth.hashPassword('Ett mycket langt testlosenord 2026!'),
      mfaSecretEncrypted:Auth.encryptSecret(oldSecret,key)
    });
    Db.addMembership(db,{companyId:company.id,userId:user.id});
    Db.createSession(db,{
      tokenHash:'session-hash',
      csrfHash:'csrf-hash',
      userId:user.id,
      companyId:company.id,
      expiresAt:'2099-01-01T01:00:00.000Z',
      absoluteExpiresAt:'2099-01-01T08:00:00.000Z'
    });
    Db.consumeMfaStep(db,{userId:user.id,totpCounter:12345});

    const result=rotateMfa(db,{username:'mfa.test',newMfaSecret:newSecret,encryptionKey:key});
    assert.equal(result.username,'mfa.test');

    const refreshed=Db.userByUsername(db,'mfa.test');
    assert.equal(Auth.decryptSecret(refreshed.mfaSecretEncrypted,key),newSecret);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id=?').get(user.id).count),0);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM mfa_used_steps WHERE user_id=?').get(user.id).count),0);

    const audit=db.prepare("SELECT details_json AS detailsJson FROM audit_events WHERE action='USER_MFA_ROTATED' AND user_id=?").get(user.id);
    assert.ok(audit);
    assert.equal(JSON.parse(audit.detailsJson).sessionsRevoked,true);
  } finally {
    db.close();
  }
});
