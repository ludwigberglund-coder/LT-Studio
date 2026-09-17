'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');

function required(name){const value=String(process.env[name]||'').trim();if(!value)throw new Error(`${name} måste anges.`);return value}
function sha256(filename){return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')}

function main(){
  const source=path.resolve(required('ROLLANDS_RESTORE_SOURCE'));
  const target=path.resolve(required('ROLLANDS_RESTORE_TARGET'));
  const production=process.env.ROLLANDS_DATABASE_PATH?path.resolve(process.env.ROLLANDS_DATABASE_PATH):'';
  if(!fs.existsSync(source))throw new Error('Backupfilen som ska återställas finns inte.');
  if(fs.existsSync(target))throw new Error('Restore-target finns redan. Scriptet vägrar skriva över befintlig fil.');
  if(production&&target===production)throw new Error('Restore-target får aldrig vara samma fil som produktionsdatabasen.');
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});

  const checksumFile=`${source}.sha256`;
  if(fs.existsSync(checksumFile)){
    const expected=fs.readFileSync(checksumFile,'utf8').trim().split(/\s+/)[0];
    if(expected!==sha256(source))throw new Error('Backupens SHA-256 stämmer inte. Restore avbruten.');
  }

  fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target,0o600);
  const db=new DatabaseSync(target,{readOnly:true});
  try{
    const integrity=db.prepare('PRAGMA integrity_check').get();
    if(integrity.integrity_check!=='ok')throw new Error('Den återställda databasen klarade inte integrity_check.');
    const requiredTables=['companies','users','memberships','audit_events'];
    const present=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    for(const table of requiredTables)if(!present.has(table))throw new Error(`Den återställda databasen saknar tabellen ${table}.`);
  }finally{db.close()}
  console.log(`Restore verifierad i separat fil: ${target}`);
  console.log('Produktionsdatabasen har inte skrivits över. Starta en separat testinstans mot restore-filen för manuell UAT.');
}

if(require.main===module){try{main()}catch(error){console.error(error.message);process.exitCode=1}}
module.exports={main,sha256};
