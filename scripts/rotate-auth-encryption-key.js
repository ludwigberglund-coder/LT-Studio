'use strict';

const path=require('node:path');
const Auth=require('../apps/api/auth.js');
const Db=require('../apps/api/database.js');
const {assertOutsideRepository,requiredEnv}=require('./rotate-password.js');

function rotationError(message,code='AUTH_KEY_ROTATION_ERROR'){const e=new Error(message);e.code=code;return e}
function validateKey(value,name){
  const key=String(value||'');
  if(key.length<32||new Set(key).size<10)throw rotationError(`${name} måste vara minst 32 tecken och tillräckligt varierad.`,'AUTH_KEY_TOO_WEAK');
  return key;
}
function prepareRotation(db,{oldKey,newKey}){
  const previous=validateKey(oldKey,'Gammal autentiseringsnyckel');
  const next=validateKey(newKey,'Ny autentiseringsnyckel');
  if(Auth.safeEqualText(previous,next))throw rotationError('Ny autentiseringsnyckel måste skilja sig från den gamla.','AUTH_KEY_UNCHANGED');
  const rows=db.prepare("SELECT id,username,mfa_secret_encrypted AS mfaSecretEncrypted FROM users WHERE mfa_secret_encrypted IS NOT NULL AND mfa_secret_encrypted<>'' ORDER BY id").all();
  const prepared=[];
  for(const row of rows){
    let secret;
    try{secret=Auth.decryptSecret(row.mfaSecretEncrypted,previous)}
    catch{throw rotationError(`MFA-hemligheten för användare ${row.username} kunde inte dekrypteras med gammal nyckel. Ingen rotation har gjorts.`,'AUTH_KEY_DECRYPT_FAILED')}
    prepared.push({userId:row.id,username:row.username,encrypted:Auth.encryptSecret(secret,next)});
  }
  return prepared;
}
function rotateAuthEncryptionKey(db,{oldKey,newKey}){
  const prepared=prepareRotation(db,{oldKey,newKey});
  const affectedIds=new Set(prepared.map(row=>row.userId));
  const memberships=db.prepare('SELECT company_id AS companyId,user_id AS userId FROM memberships WHERE user_id=? ORDER BY company_id');
  Db.transaction(db,()=>{
    for(const row of prepared)db.prepare('UPDATE users SET mfa_secret_encrypted=? WHERE id=?').run(row.encrypted,row.userId);
    if(affectedIds.size){
      const placeholders=[...affectedIds].map(()=>'?').join(',');
      db.prepare(`DELETE FROM sessions WHERE user_id IN (${placeholders})`).run(...affectedIds);
      db.prepare(`DELETE FROM mfa_used_steps WHERE user_id IN (${placeholders})`).run(...affectedIds);
    }
    for(const row of prepared){
      for(const membership of memberships.all(row.userId)){
        Db.appendAudit(db,{
          companyId:membership.companyId,
          userId:row.userId,
          action:'USER_AUTH_ENCRYPTION_KEY_ROTATED',
          entityType:'user',
          entityId:row.userId,
          details:{username:row.username,sessionsRevoked:true,mfaUsedStepsCleared:true}
        });
      }
    }
  });
  return{usersRotated:prepared.length};
}
function main(){
  if(!process.argv.includes('--apply')){
    console.log('Ingen ändring gjord. Kör med --apply efter verifierad backup och kontroll av både gammal och ny autentiseringsnyckel.');
    process.exitCode=2;return;
  }
  const root=path.resolve(__dirname,'..');
  const databasePath=assertOutsideRepository(root,requiredEnv('ROLLANDS_DATABASE_PATH'));
  const oldKey=requiredEnv('ROLLANDS_AUTH_ENCRYPTION_KEY');
  const newKey=requiredEnv('ROLLANDS_NEW_AUTH_ENCRYPTION_KEY');
  const db=Db.openDatabase(databasePath);
  try{
    const result=rotateAuthEncryptionKey(db,{oldKey,newKey});
    console.log(`MFA-hemligheter omkrypterade: ${result.usersRotated}`);
    console.log('Berörda sessioner återkallade: ja');
    console.log('Gamla och nya nyckelvärden har inte skrivits till loggen.');
    console.log('Uppdatera därefter secret manager till den nya nyckeln innan normal inloggning återupptas.');
  }finally{db.close()}
}
if(require.main===module){try{main()}catch(error){console.error(error.message);process.exitCode=1}}
module.exports=Object.freeze({validateKey,prepareRotation,rotateAuthEncryptionKey,main});
