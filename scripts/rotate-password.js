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

function rotatePassword(db,{username,newPassword}) {
  const normalized=Auth.normalizeUsername(username);
  const user=Db.userByUsername(db,normalized);
  if(!user) throw new Error('Användaren finns inte.');
  const passwordHash=Auth.hashPassword(newPassword);
  const memberships=Db.membershipsForUser(db,user.id);
  Db.transaction(db,()=>{
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash,user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    for(const membership of memberships) {
      Db.appendAudit(db,{
        companyId:membership.companyId,
        userId:user.id,
        action:'USER_PASSWORD_ROTATED',
        entityType:'user',
        entityId:user.id,
        details:{username:normalized,sessionsRevoked:true}
      });
    }
  });
  return {userId:user.id,username:normalized,companies:memberships.length};
}

function main() {
  if(!process.argv.includes('--apply')) {
    console.log('Ingen ändring gjord. Kör med --apply efter att användarnamn och databas har kontrollerats.');
    process.exitCode=2;
    return;
  }
  const root=path.resolve(__dirname,'..');
  const databasePath=assertOutsideRepository(root,requiredEnv('ROLLANDS_DATABASE_PATH'));
  const username=requiredEnv('ROLLANDS_PASSWORD_USERNAME');
  const newPassword=requiredEnv('ROLLANDS_NEW_PASSWORD');
  const db=Db.openDatabase(databasePath);
  try {
    const result=rotatePassword(db,{username,newPassword});
    console.log(`Lösenord roterat för: ${result.username}`);
    console.log(`Aktiva sessioner återkallade: ja`);
    console.log(`Databas: ${databasePath}`);
    console.log('Det nya lösenordet har inte skrivits till loggen.');
  } finally {
    db.close();
  }
}

if(require.main===module) {
  try { main(); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}

module.exports={main,requiredEnv,assertOutsideRepository,rotatePassword};
