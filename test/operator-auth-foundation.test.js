'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const OperatorAuth=require('../apps/api/operator-auth.js');

const MFA_SECRET='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const ENCRYPTION_KEY='operator-auth-test-key-longer-than-thirty-two-characters';

test('operatörsidentitet och session är helt separerade från kundsessionen',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const company=Db.createCompany(db,{legalName:'Kundbolag AB',displayName:'Kundbolag',orgNumber:'559900-8001'});
    const user=Db.createUser(db,{username:'kund.user',displayName:'Kundanvändare',passwordHash:Auth.hashPassword('Kundens sakra testlosenord 2026!')});
    Db.addMembership(db,{companyId:company.id,userId:user.id});

    const operator=Db.createPlatformOperator(db,{
      username:'lt.operator',
      displayName:'LT Operator',
      passwordHash:Auth.hashPassword('Operatorens sakra testlosenord 2026!'),
      mfaSecretEncrypted:Auth.encryptSecret(MFA_SECRET,ENCRYPTION_KEY)
    });

    const customerToken=Auth.randomToken(),customerCsrf=Auth.randomToken();
    const operatorToken=Auth.randomToken(),operatorCsrf=Auth.randomToken();
    const expiresAt='2099-01-01T01:00:00.000Z',absoluteExpiresAt='2099-01-01T02:00:00.000Z';
    Db.createSession(db,{tokenHash:Auth.hashToken(customerToken),csrfHash:Auth.hashToken(customerCsrf),userId:user.id,companyId:company.id,expiresAt,absoluteExpiresAt});
    Db.createPlatformOperatorSession(db,{tokenHash:Auth.hashToken(operatorToken),csrfHash:Auth.hashToken(operatorCsrf),operatorId:operator.id,expiresAt,absoluteExpiresAt});

    assert.equal(Db.sessionByTokenHash(db,Auth.hashToken(customerToken)).userId,user.id);
    assert.equal(Db.platformOperatorSessionByTokenHash(db,Auth.hashToken(customerToken)),null);
    assert.equal(Db.sessionByTokenHash(db,Auth.hashToken(operatorToken)),null);
    const operatorSession=Db.platformOperatorSessionByTokenHash(db,Auth.hashToken(operatorToken));
    assert.equal(operatorSession.operatorId,operator.id);
    assert.equal(operatorSession.username,'lt.operator');

    const customerCookie=Auth.sessionCookie(customerToken,{secure:false});
    const operatorCookie=OperatorAuth.operatorSessionCookie(operatorToken,{secure:false});
    assert.match(customerCookie,/^rollands_session=/);
    assert.doesNotMatch(customerCookie,/lt_operator_session/);
    assert.match(operatorCookie,/^lt_operator_session=/);
    assert.doesNotMatch(operatorCookie,/rollands_session=/);

    const request={headers:{cookie:operatorCookie}};
    assert.equal(OperatorAuth.operatorTokenFromRequest(request),operatorToken);
    assert.match(OperatorAuth.clearOperatorSessionCookie({secure:false}),/^lt_operator_session=;/);
  }finally{db.close()}
});

test('operatörens MFA-replay och audit är separata plattformskontroller',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const operator=Db.createPlatformOperator(db,{
      username:'audit.operator',
      displayName:'Audit Operator',
      passwordHash:Auth.hashPassword('Audit operator testlosenord 2026!'),
      mfaSecretEncrypted:Auth.encryptSecret(MFA_SECRET,ENCRYPTION_KEY)
    });
    Db.consumePlatformOperatorMfaStep(db,{operatorId:operator.id,totpCounter:12345});
    assert.throws(()=>Db.consumePlatformOperatorMfaStep(db,{operatorId:operator.id,totpCounter:12345}),error=>error.code==='OPERATOR_MFA_CODE_REPLAYED');

    Db.appendPlatformOperatorAudit(db,{operatorId:operator.id,action:'OPERATOR_SESSION_LOGIN',details:{mfaRequired:true}});
    const audit=Db.platformOperatorAudit(db);
    assert.equal(audit.length,1);
    assert.equal(audit[0].operatorId,operator.id);
    assert.equal(audit[0].action,'OPERATOR_SESSION_LOGIN');
    assert.deepEqual(audit[0].details,{mfaRequired:true});
  }finally{db.close()}
});

test('operatörscookien är HttpOnly, Strict och Secure som standard',()=>{
  const cookie=OperatorAuth.operatorSessionCookie('operator-token');
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/SameSite=Strict/);
  assert.match(cookie,/Secure/);
  assert.match(cookie,/Max-Age=7200/);
});
