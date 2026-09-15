'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Access = require('../packages/access-control/authorization.js');
const Auth = require('../apps/api/auth.js');
const Db = require('../apps/api/database.js');

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} måste anges.`);
  return value;
}

function main() {
  if (!process.argv.includes('--apply')) {
    console.log('Ingen ändring gjord. Kör med --apply när bootstrap-inställningarna är kontrollerade.');
    process.exitCode = 2;
    return;
  }

  const root = path.resolve(__dirname,'..');
  const companyConfig = JSON.parse(fs.readFileSync(path.join(root,'content','company.json'),'utf8'));
  const accessConfig = JSON.parse(fs.readFileSync(path.join(root,'config','access-control.json'),'utf8'));
  const accessModel = Access.createModel(accessConfig);
  const databasePath = process.env.ROLLANDS_DATABASE_PATH || path.join(root,'data','platform.sqlite');
  const username = Auth.normalizeUsername(requiredEnv('ROLLANDS_BOOTSTRAP_USERNAME'));
  const displayName = requiredEnv('ROLLANDS_BOOTSTRAP_DISPLAY_NAME');
  const password = requiredEnv('ROLLANDS_BOOTSTRAP_PASSWORD');
  const roles = String(process.env.ROLLANDS_BOOTSTRAP_ROLES || 'system-admin').split(',').map(value=>value.trim()).filter(Boolean);
  if (!roles.length) throw new Error('Minst en bootstrap-roll krävs.');
  for (const role of roles) if (!accessModel.rolesById.has(role)) throw new Error(`Okänd bootstrap-roll: ${role}`);

  const requiresMfa = roles.some(role => accessConfig.policy.mfaRequiredRoles.includes(role));
  let encryptedMfa = null;
  if (requiresMfa) {
    const mfaSecret = requiredEnv('ROLLANDS_BOOTSTRAP_MFA_SECRET');
    const encryptionKey = requiredEnv('ROLLANDS_AUTH_ENCRYPTION_KEY');
    if (encryptionKey.length < 32) throw new Error('ROLLANDS_AUTH_ENCRYPTION_KEY måste vara minst 32 tecken.');
    // Validate the secret before saving it.
    Auth.totpCode(mfaSecret, Date.now());
    encryptedMfa = Auth.encryptSecret(mfaSecret,encryptionKey);
  }

  const db = Db.openDatabase(databasePath);
  try {
    Db.transaction(db,() => {
      const existingCompany = db.prepare('SELECT id FROM companies WHERE org_number=?').get(companyConfig.orgNumber);
      const company = existingCompany
        ? Db.companyById(db,existingCompany.id)
        : Db.createCompany(db,{legalName:companyConfig.legalName,displayName:companyConfig.displayName,orgNumber:companyConfig.orgNumber});

      const existingUser = Db.userByUsername(db,username);
      if (existingUser) throw new Error('Bootstrap-användaren finns redan. Ändra användare genom den framtida användaradministrationen i stället för att skriva över kontot.');

      const user = Db.createUser(db,{
        username,
        displayName,
        passwordHash:Auth.hashPassword(password),
        mfaSecretEncrypted:encryptedMfa
      });
      Db.addMembership(db,{companyId:company.id,userId:user.id,roles});
      Db.appendAudit(db,{companyId:company.id,userId:user.id,action:'BOOTSTRAP_USER_CREATED',entityType:'user',entityId:user.id,details:{username,roles}});
      console.log(`Företag klart: ${company.displayName} (${company.id})`);
      console.log(`Personligt konto skapat: ${username} (${roles.join(', ')})`);
    });
  } finally {
    db.close();
  }
  console.log(`Databas: ${databasePath}`);
  console.log('Lösenord och MFA-hemlighet har inte skrivits till GitHub eller loggen.');
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports={main};
