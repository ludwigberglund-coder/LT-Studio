'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {validateOperationsFile}=require('./pilot-operations.js');

function required(name){const value=String(process.env[name]||'').trim();if(!value)throw new Error(`${name} måste anges.`);return value}
function readOperations(filename){
  const result=validateOperationsFile(filename);
  if(!result.ok)throw new Error('PILOT_OPERATIONS_INVALID: '+result.fail.join(' '));
  return JSON.parse(fs.readFileSync(filename,'utf8'));
}
function parseBackupName(name){
  const match=String(name||'').match(/^(rollands-.+?\.sqlite)(?:\.enc)?(?:\.sha256)?$/);
  return match?match[1]:null;
}
function backupFamilies(backupDir){
  const families=new Map();
  for(const entry of fs.readdirSync(backupDir,{withFileTypes:true})){
    if(!entry.isFile())continue;
    const base=parseBackupName(entry.name);if(!base)continue;
    const filename=path.join(backupDir,entry.name),stat=fs.statSync(filename);
    if(!families.has(base))families.set(base,{base,files:[],mtimeMs:0});
    const family=families.get(base);family.files.push(filename);family.mtimeMs=Math.max(family.mtimeMs,stat.mtimeMs);
  }
  return [...families.values()].sort((a,b)=>b.mtimeMs-a.mtimeMs||a.base.localeCompare(b.base));
}
function retentionPlan({backupDir,retentionDays,now=Date.now()}){
  if(!Number.isSafeInteger(retentionDays)||retentionDays<1||retentionDays>3650)throw new Error('backupRetentionDays måste vara ett heltal mellan 1 och 3650.');
  const families=backupFamilies(backupDir),cutoff=now-retentionDays*24*60*60*1000;
  const newest=families[0]?.base||null;
  const remove=families.filter(row=>row.base!==newest&&row.mtimeMs<cutoff);
  return{retentionDays,cutoffIso:new Date(cutoff).toISOString(),newest,keptFamilies:families.length-remove.length,removedFamilies:remove.length,remove};
}
function applyPlan(plan){
  const removed=[];
  for(const family of plan.remove){
    for(const filename of family.files){fs.rmSync(filename,{force:false});removed.push(filename)}
  }
  return removed;
}
function main(argv=process.argv.slice(2)){
  const backupDir=path.resolve(required('ROLLANDS_BACKUP_PATH'));
  const operationsPath=path.resolve(required('ROLLANDS_PILOT_OPERATIONS_PATH'));
  if(!fs.existsSync(backupDir)||!fs.statSync(backupDir).isDirectory())throw new Error('ROLLANDS_BACKUP_PATH måste peka på en befintlig katalog.');
  const operations=readOperations(operationsPath);
  const plan=retentionPlan({backupDir,retentionDays:Number(operations.backupRetentionDays)});
  const apply=argv.includes('--apply');
  const removed=apply?applyPlan(plan):[];
  console.log(JSON.stringify({
    mode:apply?'apply':'dry-run',
    retentionDays:plan.retentionDays,
    cutoffIso:plan.cutoffIso,
    newest:plan.newest,
    candidateFamilies:plan.remove.map(row=>({base:row.base,files:row.files.map(file=>path.basename(file))})),
    removedFiles:removed.map(file=>path.basename(file))
  }));
  if(!apply&&plan.remove.length)console.log('Dry-run: inga filer raderades. Kör med --apply efter granskning.');
}
if(require.main===module){try{main()}catch(error){console.error(error.message);process.exitCode=1}}
module.exports=Object.freeze({parseBackupName,backupFamilies,retentionPlan,applyPlan,readOperations,main});
