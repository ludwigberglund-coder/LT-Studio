'use strict';

const path = require('node:path');
const fs = require('node:fs');
const Access = require('../packages/access-control/authorization.js');
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

function main() {
  if (!process.argv.includes('--apply')) {
    console.log('Ingen ändring gjord. Kör med --apply när bootstrap-inställningarna är kontrollerade.');
    process.exitCode = 2;
    return;
  }

  if (String(process.env.ROLLANDS_ENV || '').trim() === 'staging') {
    throw new Error('Generisk bootstrap är blockerad i staging. Använd npm run staging:bootstrap:synthetic -- --apply.');
  }

  const root = path.resolve(__dirname,'..');
  const accessConfig = JSON.parse(fs.readFileSync(path.join(root,'config','access-control.json'),'utf8'));
  const accessModel = Access.createModel(accessConfig);
  const databasePath = assertOutsideRepository(root,requiredEnv('ROLLANDS_DATABASE_PATH'));
  const companyConfig = {
    legalName: requiredEnv('ROLLANDS_BOOTSTRAP_COMPANY_LEGAL_NAME'),
    displayName: requiredEnv('ROLLANDS_BOOTSTRAP_COMPANY_DISPLAY_NAME'),
    orgNumber: requiredEnv('ROLLANDS_BOOTSTRAP_COMPANY_ORG_NUMBER')
  };
  const username = Auth.normalizeUsername(requiredEnv('ROLLANDS_BOOTSTRAP_USERNAME'));
  const displayName = requiredEnv('ROLLANDS_BOOTSTRAP_DISPLAY_NAME');
  const password = requiredEnv('ROLLANDS_BOOTSTRAP_PASSWORD');
  const requiresMfa = true;
  let encryptedMfa = null;
  if (requiresMfa) {
    const mfaSecret = requiredEnv('ROLLANDS_BOOTSTRAP_MFA_SECRET');
    const encryptionKey = requiredEnv('ROLLANDS_AUTH_ENCRYPTION_KEY');
    if (encryptionKey.length < 32) throw new Error('ROLLANDS_AUTH_ENCRYPTION_KEY måste vara minst 32 tecken.');
    Auth.totpCode(mfaSecret, Date.now());
    encryptedMfa = Auth.encryptSecret(mfaSecret,encryptionKey);
  }

  const db = Db.openDatabase(databasePath);
  try {
    Db.transaction(db,() => {
      const existingCompany = db.prepare('SELECT id FROM companies WHERE org_number=?').get(companyConfig.orgNumber);
      const company = existingCompany
        ? Db.companyById(db,existingCompany.id)
        : Db.createCompany(db,companyConfig);

      const existingUser = Db.userByUsername(db,username);
      if (existingUser) throw new Error('Bootstrap-användaren finns redan. Bootstrap får aldrig skriva över ett befintligt konto.');

      const user = Db.createUser(db,{
        username,
        displayName,
        passwordHash:Auth.hashPassword(password),
        mfaSecretEncrypted:encryptedMfa
      });
      Db.addMembership(db,{companyId:company.id,userId:user.id});
      Db.appendAudit(db,{companyId:company.id,userId:user.id,action:'BOOTSTRAP_USER_CREATED',entityType:'user',entityId:user.id,details:{username}});
      console.log(`Företag klart: ${company.displayName} (${company.id})`);
      console.log(`Personligt konto skapat: ${username}`);
    });
  } finally {
    db.close();
  }
  console.log(`Databas: ${databasePath}`);
  console.log('Lösenord, MFA-hemlighet och krypteringsnyckel har inte skrivits till loggen.');
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports={main,requiredEnv,assertOutsideRepository};
