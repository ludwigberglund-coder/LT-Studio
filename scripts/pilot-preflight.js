'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {validateOperationsFile}=require('./pilot-operations.js');

const root=path.resolve(__dirname,'..');
const PLACEHOLDER=/REPLACE_WITH|example\.invalid|changeme|default|placeholder/i;

function resolvedStoragePath(filename){
  const absolute=path.resolve(filename);
  let parent=absolute;
  const tail=[];
  while(!fs.existsSync(parent)){
    const next=path.dirname(parent);
    if(next===parent)break;
    tail.unshift(path.basename(parent));parent=next;
  }
  return path.join(fs.realpathSync(parent),...tail);
}
function outsideRepository(filename){
  const relative=path.relative(fs.realpathSync(root),resolvedStoragePath(filename));
  return Boolean(relative && (relative==='..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)));
}

function writableDirectory(target){
  const dir=fs.existsSync(target)&&fs.statSync(target).isDirectory()?target:path.dirname(target);
  if(!fs.existsSync(dir))return false;
  try{fs.accessSync(dir,fs.constants.R_OK|fs.constants.W_OK);return true}catch{return false}
}

function validateConfig(env=process.env){
  const pass=[],fail=[],warn=[];
  const requireValue=name=>{
    const value=String(env[name]||'').trim();
    if(!value)fail.push(`${name} saknas.`);
    return value;
  };

  const mode=requireValue('ROLLANDS_ENV');
  if(mode&&!['staging','pilot','production'].includes(mode))fail.push('ROLLANDS_ENV måste vara staging, pilot eller production.');
  if(String(env.NODE_ENV||'')!=='production')fail.push('NODE_ENV måste vara production.');
  if(String(env.ROLLANDS_DEMO_DATA||'0')!=='0')fail.push('ROLLANDS_DEMO_DATA måste vara 0 i pilot/produktion.');

  const databasePath=requireValue('ROLLANDS_DATABASE_PATH');
  const backupPath=requireValue('ROLLANDS_BACKUP_PATH');
  const operationsPath=requireValue('ROLLANDS_PILOT_OPERATIONS_PATH');
  const offsiteEvidencePath=requireValue('ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH');
  if(databasePath){
    if(!path.isAbsolute(databasePath))fail.push('ROLLANDS_DATABASE_PATH måste vara en absolut sökväg.');
    else if(!outsideRepository(databasePath))fail.push('ROLLANDS_DATABASE_PATH måste ligga utanför Git-repositoryt.');
    else if(!writableDirectory(databasePath))fail.push('Katalogen för ROLLANDS_DATABASE_PATH saknas eller är inte skrivbar.');
    else pass.push('Persistent database path');
  }
  if(backupPath){
    if(!path.isAbsolute(backupPath))fail.push('ROLLANDS_BACKUP_PATH måste vara en absolut sökväg.');
    else if(!outsideRepository(backupPath))fail.push('ROLLANDS_BACKUP_PATH måste ligga utanför Git-repositoryt.');
    else if(!writableDirectory(backupPath))fail.push('ROLLANDS_BACKUP_PATH saknas eller är inte skrivbar.');
    else pass.push('Backup path');
  }
  if(databasePath&&backupPath&&path.resolve(databasePath).startsWith(path.resolve(backupPath)+path.sep))fail.push('Produktionsdatabasen får inte ligga inne i backup-katalogen.');
  if(operationsPath){
    if(!path.isAbsolute(operationsPath))fail.push('ROLLANDS_PILOT_OPERATIONS_PATH måste vara en absolut sökväg.');
    else if(!outsideRepository(operationsPath))fail.push('ROLLANDS_PILOT_OPERATIONS_PATH måste ligga utanför Git-repositoryt.');
    else {
      const operations=validateOperationsFile(operationsPath,{requireApproval:['pilot','production'].includes(mode)});
      if(!operations.ok)operations.fail.forEach(item=>fail.push('Pilot operations: '+item));
      else pass.push(mode==='staging'?'Staging operations responsibilities':'Pilot operations decisions');
    }
  }
  if(offsiteEvidencePath){
    if(!path.isAbsolute(offsiteEvidencePath))fail.push('ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH måste vara en absolut sökväg.');
    else if(!outsideRepository(offsiteEvidencePath))fail.push('ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH måste ligga utanför Git-repositoryt.');
    else pass.push('Offsite backup evidence path');
  }

  const backupKey=requireValue('ROLLANDS_BACKUP_ENCRYPTION_KEY');
  if(backupKey&&(backupKey.length<32||PLACEHOLDER.test(backupKey)||new Set(backupKey).size<10))fail.push('ROLLANDS_BACKUP_ENCRYPTION_KEY är för svag eller ser ut som ett exempelvärde.');
  else if(backupKey)pass.push('Backup encryption key configured');

  const key=requireValue('ROLLANDS_AUTH_ENCRYPTION_KEY');
  if(key&&(key.length<32||PLACEHOLDER.test(key)||new Set(key).size<10))fail.push('ROLLANDS_AUTH_ENCRYPTION_KEY är för svag eller ser ut som ett exempelvärde.');
  else if(key)pass.push('MFA encryption key configured');

  if(String(env.ROLLANDS_API_SECURE_COOKIE||'')!=='1')fail.push('ROLLANDS_API_SECURE_COOKIE måste vara 1.');
  else pass.push('Secure cookies');

  const host=requireValue('ROLLANDS_API_HOST');
  const allowed=requireValue('ROLLANDS_ALLOWED_HOSTS');
  if(host&&host!=='127.0.0.1'&&host!=='::1'&&host!=='localhost')warn.push('API:t är inte bundet till loopback. Säkerställ brandvägg och HTTPS-terminering.');
  if(allowed&&PLACEHOLDER.test(allowed))fail.push('ROLLANDS_ALLOWED_HOSTS innehåller ett placeholder-värde.');
  else if(allowed)pass.push('Allowed hosts configured');

  if(databasePath&&fs.existsSync(databasePath)){
    const modeBits=fs.statSync(databasePath).mode&0o777;
    if((modeBits&0o077)!==0)fail.push(`Databasfilens rättigheter är för öppna (${modeBits.toString(8)}). Använd 600.`);
    else pass.push('Database file permissions');
  }else if(databasePath){warn.push('Databasfilen finns inte ännu. Det är normalt före första bootstrap, men kontrollera rättigheter efter skapandet.');}

  if(mode==='staging')warn.push('Staging kräver inte approvedForPilot=true. Slutligt pilotgodkännande måste registreras och preflight köras om efter byte till ROLLANDS_ENV=pilot.');
  warn.push('Preflight verifierar konfigurerade privata sökvägar men ersätter inte verkligt offsite-upload/readback-bevis, fjärretention, larmleverans, restore-drill, HTTPS/DNS eller central logginsamling.');
  return{pass,fail,warn};
}

function main(){
  const result=validateConfig(process.env);
  console.log('ROLLANDS PILOT SERVER PREFLIGHT');
  console.log('\nPASS:');
  if(result.pass.length)result.pass.forEach(item=>console.log(`- ${item}`));else console.log('- Inga.');
  console.log('\nFAIL:');
  if(result.fail.length)result.fail.forEach(item=>console.log(`- ${item}`));else console.log('- Inga blockerande konfigurationsfel.');
  console.log('\nWARN:');
  result.warn.forEach(item=>console.log(`- ${item}`));
  if(result.fail.length){console.log('\nNOT READY FOR PILOT DEPLOYMENT');process.exitCode=1;}
  else console.log('\nPREFLIGHT PASS - manuell driftkontroll och UAT krävs fortfarande.');
}

if(require.main===module)main();
module.exports={validateConfig,outsideRepository,writableDirectory};
