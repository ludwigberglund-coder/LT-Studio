'use strict';

const crypto = require('node:crypto');

const PASSWORD_PREFIX = 'scrypt-v1';
const SCRYPT = Object.freeze({N: 16384, r: 8, p: 1, keyLength: 64, maxmem: 64 * 1024 * 1024});

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

function verifyPassword(password, encoded) {
  try {
    const [prefix,nRaw,rRaw,pRaw,saltRaw,hashRaw] = String(encoded || '').split('$');
    if (prefix !== PASSWORD_PREFIX || !saltRaw || !hashRaw) return false;
    const N = Number(nRaw), r = Number(rRaw), p = Number(pRaw);
    if (![N,r,p].every(Number.isSafeInteger) || N < 16384 || r < 8 || p < 1) return false;
    const expected = Buffer.from(hashRaw, 'base64url');
    const actual = crypto.scryptSync(String(password || ''), Buffer.from(saltRaw, 'base64url'), expected.length, {N,r,p,maxmem:SCRYPT.maxmem});
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
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
