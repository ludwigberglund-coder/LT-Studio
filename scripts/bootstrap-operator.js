'use strict';

const path=require('node:path');
const Auth=require('../apps/api/auth.js');
const Db=require('../apps/api/database.js');

function requiredEnv(name){
  const value=String(process.env[name]||'').trim();
  if(!value)throw new Error(`${name} måste anges.`);
  return value;
}
function assertOutsideRepository(root,filename){
  const resolved=path.resolve(filename);
  const relative=path.relative(root,resolved);
  if(!relative||(!relative.startsWith('..')&&!path.isAbsolute(relative)))throw new Error('ROLLANDS_DATABASE_PATH måste ligga utanför repositoryt i pilot/produktion.');
  return resolved;
}
function bootstrapOperator(db,{username,displayName,password,mfaSecret,encryptionKey}){
  const normalized=Auth.normalizeUsername(username);
  if(Db.platformOperatorByUsername(db,normalized))throw new Error('Operatören finns redan. Bootstrap får aldrig skriva över ett befintligt konto.');
  if(String(encryptionKey||'').length<32)throw new Error('ROLLANDS_AUTH_ENCRYPTION_KEY måste vara minst 32 tecken.');
  Auth.totpCode(mfaSecret,Date.now());
  const passwordHash=Auth.hashPassword(password);
  const encryptedMfa=Auth.encryptSecret(mfaSecret,encryptionKey);
  let operator;
  Db.transaction(db,()=>{
    operator=Db.createPlatformOperator(db,{username:normalized,displayName,passwordHash,mfaSecretEncrypted:encryptedMfa});
    Db.appendPlatformOperatorAudit(db,{operatorId:operator.id,action:'OPERATOR_CREATED',details:{username:normalized}});
  });
  return{operatorId:operator.id,username:operator.username,displayName:operator.displayName};
}
function main(){
  if(!process.argv.includes('--apply')){
    console.log('Ingen ändring gjord. Kör med --apply när operatörsuppgifterna är kontrollerade.');
    process.exitCode=2;
    return;
  }
  const root=path.resolve(__dirname,'..');
  const databasePath=assertOutsideRepository(root,requiredEnv('ROLLANDS_DATABASE_PATH'));
  const db=Db.openDatabase(databasePath);
  try{
    const result=bootstrapOperator(db,{
      username:requiredEnv('ROLLANDS_OPERATOR_BOOTSTRAP_USERNAME'),
      displayName:requiredEnv('ROLLANDS_OPERATOR_BOOTSTRAP_DISPLAY_NAME'),
      password:requiredEnv('ROLLANDS_OPERATOR_BOOTSTRAP_PASSWORD'),
      mfaSecret:requiredEnv('ROLLANDS_OPERATOR_BOOTSTRAP_MFA_SECRET'),
      encryptionKey:requiredEnv('ROLLANDS_AUTH_ENCRYPTION_KEY')
    });
    console.log(`LT Studio-operatör skapad: ${result.username}`);
    console.log(`Operatörs-id: ${result.operatorId}`);
    console.log(`Databas: ${databasePath}`);
    console.log('Lösenord, MFA-hemlighet och krypteringsnyckel har inte skrivits till loggen.');
  }finally{db.close()}
}
if(require.main===module){
  try{main()}catch(error){console.error(error.message);process.exitCode=1}
}
module.exports={main,requiredEnv,assertOutsideRepository,bootstrapOperator};
