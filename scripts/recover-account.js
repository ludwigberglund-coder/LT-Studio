'use strict';

const path=require('node:path');
const Auth=require('../apps/api/auth.js');
const Db=require('../apps/api/database.js');
const {assertOutsideRepository,requiredEnv}=require('./rotate-password.js');

function recoveryError(message,code='ACCOUNT_RECOVERY_ERROR'){const e=new Error(message);e.code=code;return e}
function normalizeReference(value){
  const ref=String(value||'').trim();
  if(ref.length<6||ref.length>120)throw recoveryError('Recoveryärendet måste anges med 6–120 tecken.','RECOVERY_REFERENCE_REQUIRED');
  return ref;
}
function approver(db,username,targetUserId){
  const normalized=Auth.normalizeUsername(username);
  const user=Db.userByUsername(db,normalized);
  if(!user||user.disabled)throw recoveryError('Godkännaren måste vara en aktiv personlig användare.','RECOVERY_APPROVER_INVALID');
  if(user.id===targetUserId)throw recoveryError('Kontoinnehavaren får inte godkänna sin egen recovery.','RECOVERY_SELF_APPROVAL');
  return user;
}
function commonCompanyIds(db,userA,userB){
  const a=new Set(Db.membershipsForUser(db,userA).map(row=>row.companyId));
  return Db.membershipsForUser(db,userB).map(row=>row.companyId).filter(id=>a.has(id));
}
function recoverAccount(db,{username,newPassword,newMfaSecret,encryptionKey,approverOneUsername,approverTwoUsername,recoveryReference}){
  const normalized=Auth.normalizeUsername(username);
  const target=Db.userByUsername(db,normalized);
  if(!target)throw recoveryError('Användaren finns inte.','RECOVERY_USER_NOT_FOUND');
  if(target.disabled)throw recoveryError('Avstängt konto måste hanteras separat innan recovery.','RECOVERY_USER_DISABLED');
  if(String(encryptionKey||'').length<32)throw recoveryError('ROLLANDS_AUTH_ENCRYPTION_KEY måste vara minst 32 tecken.','RECOVERY_AUTH_KEY_INVALID');
  const reference=normalizeReference(recoveryReference);
  const first=approver(db,approverOneUsername,target.id),second=approver(db,approverTwoUsername,target.id);
  if(first.id===second.id)throw recoveryError('Två olika godkännare krävs.','RECOVERY_TWO_APPROVERS_REQUIRED');

  const targetCompanies=Db.membershipsForUser(db,target.id).map(row=>row.companyId);
  if(!targetCompanies.length)throw recoveryError('Kontot saknar företagsmedlemskap.','RECOVERY_NO_COMPANY_ACCESS');
  const firstShared=new Set(commonCompanyIds(db,target.id,first.id));
  const secondShared=new Set(commonCompanyIds(db,target.id,second.id));
  const uncovered=targetCompanies.filter(companyId=>!firstShared.has(companyId)||!secondShared.has(companyId));
  if(uncovered.length)throw recoveryError('Båda godkännarna måste vara aktiva medlemmar i samtliga företag som kontot tillhör.','RECOVERY_APPROVER_SCOPE_MISMATCH');

  const passwordHash=Auth.hashPassword(newPassword);
  Auth.totpCode(newMfaSecret,Date.now());
  const encryptedMfa=Auth.encryptSecret(newMfaSecret,encryptionKey);

  Db.transaction(db,()=>{
    db.prepare('UPDATE users SET password_hash=?,mfa_secret_encrypted=? WHERE id=?').run(passwordHash,encryptedMfa,target.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
    db.prepare('DELETE FROM mfa_used_steps WHERE user_id=?').run(target.id);
    for(const companyId of targetCompanies){
      Db.appendAudit(db,{
        companyId,
        userId:target.id,
        action:'USER_ACCOUNT_RECOVERED',
        entityType:'user',
        entityId:target.id,
        details:{
          username:normalized,
          recoveryReference:reference,
          approverOneUserId:first.id,
          approverOneUsername:first.username,
          approverTwoUserId:second.id,
          approverTwoUsername:second.username,
          passwordRotated:true,
          mfaRotated:true,
          sessionsRevoked:true,
          mfaUsedStepsCleared:true,
          loginThrottlePreserved:true
        }
      });
    }
  });
  return{userId:target.id,username:normalized,companies:targetCompanies.length,approverOne:first.username,approverTwo:second.username,recoveryReference:reference};
}

function main(){
  if(!process.argv.includes('--apply')){
    console.log('Ingen ändring gjord. Kör med --apply först efter dokumenterat recoveryärende och tvåpersonsgodkännande.');
    process.exitCode=2;return;
  }
  const root=path.resolve(__dirname,'..');
  const databasePath=assertOutsideRepository(root,requiredEnv('ROLLANDS_DATABASE_PATH'));
  const db=Db.openDatabase(databasePath);
  try{
    const result=recoverAccount(db,{
      username:requiredEnv('ROLLANDS_RECOVERY_USERNAME'),
      newPassword:requiredEnv('ROLLANDS_RECOVERY_NEW_PASSWORD'),
      newMfaSecret:requiredEnv('ROLLANDS_RECOVERY_NEW_MFA_SECRET'),
      encryptionKey:requiredEnv('ROLLANDS_AUTH_ENCRYPTION_KEY'),
      approverOneUsername:requiredEnv('ROLLANDS_RECOVERY_APPROVER_ONE'),
      approverTwoUsername:requiredEnv('ROLLANDS_RECOVERY_APPROVER_TWO'),
      recoveryReference:requiredEnv('ROLLANDS_RECOVERY_REFERENCE')
    });
    console.log(`Kontorecovery genomförd för: ${result.username}`);
    console.log(`Recoveryärende: ${result.recoveryReference}`);
    console.log(`Godkännare: ${result.approverOne}, ${result.approverTwo}`);
    console.log('Lösenord och MFA roterade: ja');
    console.log('Aktiva sessioner återkallade: ja');
    console.log('Den befintliga inloggningsspärren rensas inte av recovery och kan därför ligga kvar tills dess 15-minutersfönster löper ut.');
    console.log('Nytt lösenord, MFA-hemlighet och krypteringsnyckel har inte skrivits till loggen.');
  }finally{db.close()}
}
if(require.main===module){try{main()}catch(error){console.error(error.message);process.exitCode=1}}
module.exports=Object.freeze({normalizeReference,approver,commonCompanyIds,recoverAccount,main});
