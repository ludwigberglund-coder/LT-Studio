'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Auth = require('../apps/api/auth.js');

function legacyPasswordHash(password) {
  const salt=Buffer.from('legacy-salt-2026','utf8');
  const derived=crypto.scryptSync(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return ['scrypt-v1',16384,8,1,salt.toString('base64url'),derived.toString('base64url')].join('

test('personliga lösenord lagras med scrypt och fel lösenord godkänns aldrig', () => {
  const password='Ett mycket langt testlosenord 2026!';
  const encoded=Auth.hashPassword(password);
  assert.match(encoded,/^scrypt-v1\$/);
  const params=Auth.passwordParameters(encoded);
  assert.deepEqual({N:params.N,r:params.r,p:params.p},{N:32768,r:8,p:3});
  assert.equal(Auth.passwordHashMeetsPolicy(encoded),true);
  assert.equal(Auth.needsPasswordRehash(encoded),false);
  assert.equal(Auth.verifyPassword(password,encoded),true);
  assert.equal(Auth.verifyPassword('helt-fel-losenord',encoded),false);
  assert.throws(()=>Auth.hashPassword('kort'),error=>error.code==='WEAK_PASSWORD');
});


test('äldre scrypt-hash kan verifieras men markeras för säker uppgradering', () => {
  const password='Ett gammalt kompatibelt testlosenord 2026!';
  const legacy=legacyPasswordHash(password);
  assert.equal(Auth.verifyPassword(password,legacy),true);
  assert.equal(Auth.verifyPassword('fel lösenord',legacy),false);
  assert.equal(Auth.passwordHashMeetsPolicy(legacy),false);
  assert.equal(Auth.needsPasswordRehash(legacy),true);
  assert.equal(Auth.passwordHashMeetsPolicy(Auth.dummyPasswordHash()),true);
});

test('sessionstoken och csrf-token kan endast jämföras via hash', () => {
  const token=Auth.randomToken(32);
  const hash=Auth.hashToken(token);
  assert.equal(hash.length,64);
  assert.equal(Auth.safeEqualText(Auth.hashToken(token),hash),true);
  assert.equal(Auth.safeEqualText(Auth.hashToken(token+'x'),hash),false);
});

test('TOTP följer standardalgoritmen och accepterar endast tidsnära kod', () => {
  const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const at=59_000;
  assert.equal(Auth.totpCode(secret,at),'287082');
  assert.equal(Auth.totpMatchCounter(secret,'287082',{now:at,window:0}),1);
  assert.equal(Auth.verifyTotp(secret,'287082',{now:at,window:0}),true);
  assert.equal(Auth.totpMatchCounter(secret,'287082',{now:at+120_000,window:0}),null);
  assert.equal(Auth.verifyTotp(secret,'287082',{now:at+120_000,window:0}),false);
});

test('MFA-hemlighet krypteras med autentiserad AES-GCM och kan inte öppnas med fel nyckel', () => {
  const key='test-only-encryption-key-that-is-longer-than-32-characters';
  const other='another-test-only-encryption-key-longer-than-32-chars';
  const encrypted=Auth.encryptSecret('JBSWY3DPEHPK3PXP',key);
  assert.ok(!encrypted.includes('JBSWY3DPEHPK3PXP'));
  assert.equal(Auth.decryptSecret(encrypted,key),'JBSWY3DPEHPK3PXP');
  assert.throws(()=>Auth.decryptSecret(encrypted,other));
});

test('sessionscookies är HttpOnly SameSite Strict och Secure i skarp standard', () => {
  const cookie=Auth.sessionCookie('abc');
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/SameSite=Strict/);
  assert.match(cookie,/Secure/);
  assert.match(Auth.clearSessionCookie(),/Max-Age=0/);
});
);
}

test('personliga lösenord lagras med scrypt och fel lösenord godkänns aldrig', () => {
  const password='Ett mycket langt testlosenord 2026!';
  const encoded=Auth.hashPassword(password);
  assert.match(encoded,/^scrypt-v1\$/);
  assert.equal(Auth.verifyPassword(password,encoded),true);
  assert.equal(Auth.verifyPassword('helt-fel-losenord',encoded),false);
  assert.throws(()=>Auth.hashPassword('kort'),error=>error.code==='WEAK_PASSWORD');
});

test('sessionstoken och csrf-token kan endast jämföras via hash', () => {
  const token=Auth.randomToken(32);
  const hash=Auth.hashToken(token);
  assert.equal(hash.length,64);
  assert.equal(Auth.safeEqualText(Auth.hashToken(token),hash),true);
  assert.equal(Auth.safeEqualText(Auth.hashToken(token+'x'),hash),false);
});

test('TOTP följer standardalgoritmen och accepterar endast tidsnära kod', () => {
  const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const at=59_000;
  assert.equal(Auth.totpCode(secret,at),'287082');
  assert.equal(Auth.totpMatchCounter(secret,'287082',{now:at,window:0}),1);
  assert.equal(Auth.verifyTotp(secret,'287082',{now:at,window:0}),true);
  assert.equal(Auth.totpMatchCounter(secret,'287082',{now:at+120_000,window:0}),null);
  assert.equal(Auth.verifyTotp(secret,'287082',{now:at+120_000,window:0}),false);
});

test('MFA-hemlighet krypteras med autentiserad AES-GCM och kan inte öppnas med fel nyckel', () => {
  const key='test-only-encryption-key-that-is-longer-than-32-characters';
  const other='another-test-only-encryption-key-longer-than-32-chars';
  const encrypted=Auth.encryptSecret('JBSWY3DPEHPK3PXP',key);
  assert.ok(!encrypted.includes('JBSWY3DPEHPK3PXP'));
  assert.equal(Auth.decryptSecret(encrypted,key),'JBSWY3DPEHPK3PXP');
  assert.throws(()=>Auth.decryptSecret(encrypted,other));
});

test('sessionscookies är HttpOnly SameSite Strict och Secure i skarp standard', () => {
  const cookie=Auth.sessionCookie('abc');
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/SameSite=Strict/);
  assert.match(cookie,/Secure/);
  assert.match(Auth.clearSessionCookie(),/Max-Age=0/);
});
