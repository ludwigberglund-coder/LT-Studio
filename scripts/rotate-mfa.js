'use strict';

const path = require('node:path');
const Auth = require('../apps/api/auth.js');
const Db = require('../apps/api/database.js');

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} måste anges.`);
  return value;
}

function assertOutsideRepository(root, filename) {
  const resolved = path.resolve(filename);
  const relative = path.relative(root,resolved);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('ROLLANDS_DATABASE_PATH måste ligga utanför repositoryt i pilot/produktion.');
  }
  return resolved;
}

function rotateMfa(db,{username,newMfaSecret,encryptionKey}) {
  const normalized=Auth.normalizeUsername(username);
  const user=Db.userByUsername(db,normalized);
  if(!user) throw new Error('Användaren finns inte.');
  if(String(encryptionKey || '').length < 32) throw new Error('ROLLANDS_AUTH_ENCRYPTION_KEY måste vara minst 32 tecken.');

  // Validate the Base32 secret before any database change is made.
  Auth.totpCode(newMfaSecret,Date.now());
  const encryptedMfa=Auth.encryptSecret(newMfaSecret,encryptionKey);
  const memberships=Db.membershipsForUser(db,user.id);

  Db.transaction(db,()=>{
    db.prepare('UPDATE users SET mfa_secret_encrypted=? WHERE id=?').run(encryptedMfa,user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    db.prepare('DELETE FROM mfa_used_steps WHERE user_id=?').run(user.id);
    for(const membership of memberships) {
      Db.appendAudit(db,{
        companyId:membership.companyId,
        userId:user.id,
        action:'USER_MFA_ROTATED',
        entityType:'user',
        entityId:user.id,
        details:{username:normalized,sessionsRevoked:true,usedStepsCleared:true}
      });
    }
  });

  return {userId:user.id,username:normalized,companies:memberships.length};
}

function main() {
  if(!process.argv.includes('--apply')) {
    console.log('Ingen ändring gjord. Kör med --apply efter att användarnamn, databas och ny MFA-hemlighet har kontrollerats.');
    process.exitCode=2;
    return;
  }

  const root=path.resolve(__dirname,'..');
  const databasePath=assertOutsideRepository(root,requiredEnv('ROLLANDS_DATABASE_PATH'));
  const username=requiredEnv('ROLLANDS_MFA_USERNAME');
  const newMfaSecret=requiredEnv('ROLLANDS_NEW_MFA_SECRET');
  const encryptionKey=requiredEnv('ROLLANDS_AUTH_ENCRYPTION_KEY');

  const db=Db.openDatabase(databasePath);
  try {
    const result=rotateMfa(db,{username,newMfaSecret,encryptionKey});
    console.log(`MFA roterad för: ${result.username}`);
    console.log('Aktiva sessioner återkallade: ja');
    console.log('Tidigare använda MFA-tidsluckor rensade: ja');
    console.log(`Databas: ${databasePath}`);
    console.log('MFA-hemligheten och krypteringsnyckeln har inte skrivits till loggen.');
  } finally {
    db.close();
  }
}

if(require.main===module) {
  try { main(); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}

module.exports={main,requiredEnv,assertOutsideRepository,rotateMfa};
