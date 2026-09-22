'use strict';

const crypto = require('node:crypto');

const PASSWORD_PREFIX = 'scrypt-v1';
// OWASP Password Storage Cheat Sheet lists N=2^15, r=8, p=3 as an acceptable
// scrypt work factor. Existing hashes keep their embedded parameters and are
// upgraded after a successful MFA-protected login instead of being invalidated.
const SCRYPT = Object.freeze({N: 32768, r: 8, p: 3, keyLength: 64, maxmem: 128 * 1024 * 1024});
const SCRYPT_VERIFY_MAXMEM = 256 * 1024 * 1024;
const SCRYPT_ACCEPTED_POLICY = Object.freeze([
  Object.freeze({N:131072,p:1}),
  Object.freeze({N:65536,p:2}),
  Object.freeze({N:32768,p:3}),
  Object.freeze({N:16384,p:5}),
  Object.freeze({N:8192,p:10})
]);
let dummyPasswordHashCache = '';

function authError(message, code = 'AUTH_ERROR', statusCode = 401) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeUsername(value) {
  const username = String(value || '').trim().toLocaleLowerCase('sv');
  if (!/^[a-z0-9._@+-]{3,120}$/.test(username)) throw authError('Användarnamnet har ogiltigt format.', 'INVALID_USERNAME', 422);
  return username;
}

function assertPassword(value) {
  const password = String(value || '');
  if (password.length < 14 || password.length > 256) throw authError('Lösenordet måste vara minst 14 tecken.', 'WEAK_PASSWORD', 422);
  return password;
}

function hashPassword(password) {
  const value = assertPassword(password);
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(value, salt, SCRYPT.keyLength, {N:SCRYPT.N, r:SCRYPT.r, p:SCRYPT.p, maxmem:SCRYPT.maxmem});
  return [PASSWORD_PREFIX, SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

function passwordParameters(encoded) {
  const [prefix,nRaw,rRaw,pRaw,saltRaw,hashRaw,...extra] = String(encoded || '').split('

function randomToken(bytes = 32) {
  if (!Number.isSafeInteger(bytes) || bytes < 24 || bytes > 128) throw authError('Ogiltig tokenlängd.', 'INVALID_TOKEN_LENGTH', 500);
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a,b);
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    const name = index < 0 ? trimmed : trimmed.slice(0,index);
    try { result[name] = decodeURIComponent(index < 0 ? '' : trimmed.slice(index + 1)); }
    catch { result[name] = ''; }
  }
  return result;
}

function sessionCookie(token, {secure = true, maxAgeSeconds = 8 * 60 * 60} = {}) {
  return `rollands_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function clearSessionCookie({secure = true} = {}) {
  return `rollands_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (clean.length < 16) throw authError('MFA-hemligheten har ogiltigt format.', 'INVALID_MFA_SECRET', 500);
  let bits = '';
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw authError('MFA-hemligheten har ogiltigt format.', 'INVALID_MFA_SECRET', 500);
    bits += index.toString(2).padStart(5,'0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index,index+8),2));
  return Buffer.from(bytes);
}

function totpCode(secretBase32, atMs = Date.now(), stepSeconds = 30, digits = 6) {
  const counter = Math.floor(atMs / 1000 / stepSeconds);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secretBase32)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits);
  return String(number).padStart(digits,'0');
}

function totpMatchCounter(secretBase32, suppliedCode, {now = Date.now(), window = 1} = {}) {
  const code = String(suppliedCode || '').trim();
  if (!/^\d{6}$/.test(code)) return null;
  const currentCounter = Math.floor(now / 1000 / 30);
  for (let offset = -window; offset <= window; offset += 1) {
    if (safeEqualText(totpCode(secretBase32, now + offset * 30000), code)) return currentCounter + offset;
  }
  return null;
}

function verifyTotp(secretBase32, suppliedCode, options = {}) {
  return totpMatchCounter(secretBase32, suppliedCode, options) !== null;
}

function encryptionKey(raw) {
  const value = String(raw || '');
  if (value.length < 32) throw authError('ROLLANDS_AUTH_ENCRYPTION_KEY måste vara minst 32 tecken.', 'MISSING_ENCRYPTION_KEY', 500);
  return crypto.createHash('sha256').update(value,'utf8').digest();
}

function encryptSecret(plainText, keyMaterial) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(keyMaterial), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText || ''),'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes256gcm-v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptSecret(encoded, keyMaterial) {
  const [version,ivRaw,tagRaw,cipherRaw] = String(encoded || '').split('.');
  if (version !== 'aes256gcm-v1' || !ivRaw || !tagRaw || !cipherRaw) throw authError('Den krypterade MFA-hemligheten är ogiltig.', 'INVALID_ENCRYPTED_SECRET', 500);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(keyMaterial), Buffer.from(ivRaw,'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(cipherRaw,'base64url')), decipher.final()]).toString('utf8');
}

module.exports = Object.freeze({
  normalizeUsername,
  assertPassword,
  hashPassword,
  verifyPassword,
  passwordParameters,
  passwordHashMeetsPolicy,
  needsPasswordRehash,
  dummyPasswordHash,
  randomToken,
  hashToken,
  safeEqualText,
  parseCookies,
  sessionCookie,
  clearSessionCookie,
  totpCode,
  totpMatchCounter,
  verifyTotp,
  encryptSecret,
  decryptSecret
});
);
  if (prefix !== PASSWORD_PREFIX || !saltRaw || !hashRaw || extra.length) return null;
  const N = Number(nRaw), r = Number(rRaw), p = Number(pRaw);
  if (![N,r,p].every(Number.isSafeInteger)) return null;
  if (N < 8192 || N > 131072 || (N & (N - 1)) !== 0 || r !== 8 || p < 1 || p > 16) return null;
  const salt=Buffer.from(saltRaw,'base64url'),expected=Buffer.from(hashRaw,'base64url');
  if (salt.length < 16 || salt.length > 64 || expected.length !== SCRYPT.keyLength) return null;
  return {N,r,p,salt,expected};
}

function passwordHashMeetsPolicy(encoded) {
  const params=passwordParameters(encoded);
  if(!params)return false;
  return SCRYPT_ACCEPTED_POLICY.some(policy=>params.N>=policy.N&&params.p>=policy.p);
}

function needsPasswordRehash(encoded) {
  return !passwordHashMeetsPolicy(encoded);
}

function verifyPassword(password, encoded) {
  try {
    const params=passwordParameters(encoded);
    if(!params)return false;
    const actual = crypto.scryptSync(String(password || ''), params.salt, params.expected.length, {
      N:params.N,r:params.r,p:params.p,maxmem:SCRYPT_VERIFY_MAXMEM
    });
    return crypto.timingSafeEqual(params.expected, actual);
  } catch {
    return false;
  }
}

function dummyPasswordHash() {
  if(!dummyPasswordHashCache)dummyPasswordHashCache=hashPassword('LT Studio synthetic password verification value 2026!');
  return dummyPasswordHashCache;
}

function randomToken(bytes = 32) {
  if (!Number.isSafeInteger(bytes) || bytes < 24 || bytes > 128) throw authError('Ogiltig tokenlängd.', 'INVALID_TOKEN_LENGTH', 500);
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a,b);
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    const name = index < 0 ? trimmed : trimmed.slice(0,index);
    try { result[name] = decodeURIComponent(index < 0 ? '' : trimmed.slice(index + 1)); }
    catch { result[name] = ''; }
  }
  return result;
}

function sessionCookie(token, {secure = true, maxAgeSeconds = 8 * 60 * 60} = {}) {
  return `rollands_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function clearSessionCookie({secure = true} = {}) {
  return `rollands_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (clean.length < 16) throw authError('MFA-hemligheten har ogiltigt format.', 'INVALID_MFA_SECRET', 500);
  let bits = '';
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw authError('MFA-hemligheten har ogiltigt format.', 'INVALID_MFA_SECRET', 500);
    bits += index.toString(2).padStart(5,'0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index,index+8),2));
  return Buffer.from(bytes);
}

function totpCode(secretBase32, atMs = Date.now(), stepSeconds = 30, digits = 6) {
  const counter = Math.floor(atMs / 1000 / stepSeconds);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secretBase32)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits);
  return String(number).padStart(digits,'0');
}

function totpMatchCounter(secretBase32, suppliedCode, {now = Date.now(), window = 1} = {}) {
  const code = String(suppliedCode || '').trim();
  if (!/^\d{6}$/.test(code)) return null;
  const currentCounter = Math.floor(now / 1000 / 30);
  for (let offset = -window; offset <= window; offset += 1) {
    if (safeEqualText(totpCode(secretBase32, now + offset * 30000), code)) return currentCounter + offset;
  }
  return null;
}

function verifyTotp(secretBase32, suppliedCode, options = {}) {
  return totpMatchCounter(secretBase32, suppliedCode, options) !== null;
}

function encryptionKey(raw) {
  const value = String(raw || '');
  if (value.length < 32) throw authError('ROLLANDS_AUTH_ENCRYPTION_KEY måste vara minst 32 tecken.', 'MISSING_ENCRYPTION_KEY', 500);
  return crypto.createHash('sha256').update(value,'utf8').digest();
}

function encryptSecret(plainText, keyMaterial) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(keyMaterial), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText || ''),'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes256gcm-v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptSecret(encoded, keyMaterial) {
  const [version,ivRaw,tagRaw,cipherRaw] = String(encoded || '').split('.');
  if (version !== 'aes256gcm-v1' || !ivRaw || !tagRaw || !cipherRaw) throw authError('Den krypterade MFA-hemligheten är ogiltig.', 'INVALID_ENCRYPTED_SECRET', 500);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(keyMaterial), Buffer.from(ivRaw,'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(cipherRaw,'base64url')), decipher.final()]).toString('utf8');
}

module.exports = Object.freeze({
  normalizeUsername,
  assertPassword,
  hashPassword,
  verifyPassword,
  randomToken,
  hashToken,
  safeEqualText,
  parseCookies,
  sessionCookie,
  clearSessionCookie,
  totpCode,
  totpMatchCounter,
  verifyTotp,
  encryptSecret,
  decryptSecret
});
