'use strict';

const path=require('node:path');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');

function requiredEnv(name){
  const value=String(process.env[name]||'').trim();
  if(!value)throw new Error(`${name} måste anges.`);
  return value;
}
function assertOutsideRepository(root,filename){
  const resolved=path.resolve(filename),relative=path.relative(root,resolved);
  if(!relative||(!relative.startsWith('..')&&!path.isAbsolute(relative)))throw new Error('ROLLANDS_DATABASE_PATH måste ligga utanför repositoryt.');
  return resolved;
}
function main(){
  if(!process.argv.includes('--apply')){
    console.log('Ingen ändring gjord. Kontrollera användarnamn och kör sedan med --apply.');
    process.exitCode=2;return;
  }
  const enable=process.argv.includes('--enable'),disable=process.argv.includes('--disable');
  if(enable===disable)throw new Error('Ange exakt en av --enable eller --disable.');
  if(String(process.env.ROLLANDS_ENV||'').trim()==='staging')throw new Error('Global admin får inte ändras med detta verktyg i staging.');
  const root=path.resolve(__dirname,'..');
  const databasePath=assertOutsideRepository(root,requiredEnv('ROLLANDS_DATABASE_PATH'));
  const username=Auth.normalizeUsername(requiredEnv('ROLLANDS_GLOBAL_ADMIN_USERNAME'));
  const db=Db.openDatabase(databasePath);
  try{
    const user=Db.userByUsername(db,username);
    if(!user)throw new Error('Användarkontot hittades inte.');
    Db.transaction(db,()=>{
      Db.setUserPlatformAdmin(db,{userId:user.id,enabled:enable});
      Db.deleteSessionsForUser(db,user.id);
      Db.appendAudit(db,{companyId:null,userId:user.id,action:'PLATFORM_ADMIN_ACCESS_CHANGED',entityType:'user',entityId:user.id,details:{enabled:enable}});
    });
    console.log(`Global LT Studio-admin ${enable?'aktiverad':'avstängd'} för ${username}. Alla befintliga sessioner återkallades.`);
  }finally{db.close()}
}
if(require.main===module){try{main()}catch(error){console.error(error.message);process.exitCode=1}}
module.exports={main,requiredEnv,assertOutsideRepository};
