'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');

function required(name){const value=String(process.env[name]||'').trim();if(!value)throw new Error(`${name} måste anges.`);return value}
function sqlLiteral(value){return `'${String(value).replaceAll("'","''")}'`}
function sha256(filename){return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')}

function main(){
  const source=path.resolve(required('ROLLANDS_DATABASE_PATH'));
  const backupDir=path.resolve(required('ROLLANDS_BACKUP_PATH'));
  if(!fs.existsSync(source))throw new Error('Produktionsdatabasen finns inte. Ingen backup skapades.');
  fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const target=path.join(backupDir,`rollands-${stamp}.sqlite`);
  if(fs.existsSync(target))throw new Error('Backupfilen finns redan. Ingen fil skrevs över.');

  const db=new DatabaseSync(source,{timeout:5000});
  try{
    const integrity=db.prepare('PRAGMA integrity_check').get();
    if(integrity.integrity_check!=='ok')throw new Error('Databasens integrity_check misslyckades. Backup avbruten.');
    db.exec(`VACUUM INTO ${sqlLiteral(target)}`);
  }finally{db.close()}
  fs.chmodSync(target,0o600);
  const digest=sha256(target);
  fs.writeFileSync(`${target}.sha256`,`${digest}  ${path.basename(target)}\n`,{mode:0o600});
  const verify=new DatabaseSync(target,{readOnly:true});
  try{if(verify.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Den skapade backupfilen klarade inte integrity_check.');}
  finally{verify.close()}
  console.log(`Backup skapad: ${target}`);
  console.log(`SHA-256: ${digest}`);
  console.log('Backupen är lokalt verifierad. Kopiera den därefter till separat/offsite lagring enligt driftinstruktionen.');
}

if(require.main===module){try{main()}catch(error){console.error(error.message);process.exitCode=1}}
module.exports={main,sha256};
