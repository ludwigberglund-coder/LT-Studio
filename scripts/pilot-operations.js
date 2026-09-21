'use strict';

const fs=require('node:fs');
const path=require('node:path');

const REQUIRED_STRINGS=Object.freeze([
  'technicalOwner','accountingOwner','dataProtectionOwner','backupOwner','monitoringOwner',
  'incidentContact','supportChannel','pilotStopAuthority','rollbackDecisionProcess','offsiteBackupDestination'
]);
const PLACEHOLDER=/REPLACE_WITH|TBD|TO_BE_DECIDED|example\.invalid|placeholder|changeme/i;

function operationsError(message,code='PILOT_OPERATIONS_INVALID'){const e=new Error(message);e.code=code;return e}
function readJson(filename){try{return JSON.parse(fs.readFileSync(filename,'utf8'))}catch(error){throw operationsError('Pilotens operationsfil kunde inte läsas som JSON: '+error.message)}}
function validateOperations(value,{requireApproval=true}={}){
  const fail=[];
  if(!value||typeof value!=='object'||Array.isArray(value))return{ok:false,fail:['Operationsfilen måste vara ett JSON-objekt.']};
  if(value.schemaVersion!==1)fail.push('schemaVersion måste vara 1.');
  for(const key of REQUIRED_STRINGS){
    const selected=String(value[key]||'').trim();
    if(selected.length<3)fail.push(key+' saknas eller är för kort.');
    else if(PLACEHOLDER.test(selected))fail.push(key+' innehåller ett placeholder-värde.');
  }
  for(const key of ['logRetentionDays','backupRetentionDays']){
    const selected=Number(value[key]);
    if(!Number.isSafeInteger(selected)||selected<1||selected>3650)fail.push(key+' måste vara ett heltal mellan 1 och 3650.');
  }
  const approved=value.approvedForPilot===true;
  if(value.approvedForPilot!==true&&value.approvedForPilot!==false)fail.push('approvedForPilot måste vara true eller false.');
  const approvedAt=String(value.approvedAt||'').trim();
  if(requireApproval&&!approved)fail.push('approvedForPilot måste vara true efter ett uttryckligt pilotbeslut.');
  if(approved&&!/^\d{4}-\d{2}-\d{2}$/.test(approvedAt))fail.push('approvedAt måste vara ett datum på formen ÅÅÅÅ-MM-DD när piloten är godkänd.');
  if(!approved&&approvedAt&&!/^\d{4}-\d{2}-\d{2}$/.test(approvedAt))fail.push('approvedAt måste vara tomt eller ett riktigt datum när piloten ännu inte är godkänd.');

  const approvedReleaseCommit=String(value.approvedReleaseCommit||'').trim().toLowerCase();
  const stagingSignoffSha256=String(value.stagingSignoffSha256||'').trim().toLowerCase();
  if(approved){
    if(!/^[a-f0-9]{40}$/.test(approvedReleaseCommit))fail.push('approvedReleaseCommit måste vara den fullständiga 40-teckens commit som pilotbeslutet avser.');
    if(!/^[a-f0-9]{64}$/.test(stagingSignoffSha256))fail.push('stagingSignoffSha256 måste vara SHA-256 för staging-signofffilen som pilotbeslutet avser.');
  }else{
    if(approvedReleaseCommit&& !/^[a-f0-9]{40}$/.test(approvedReleaseCommit))fail.push('approvedReleaseCommit måste vara tom eller en fullständig 40-teckens Git-SHA.');
    if(stagingSignoffSha256&& !/^[a-f0-9]{64}$/.test(stagingSignoffSha256))fail.push('stagingSignoffSha256 måste vara tom eller en giltig SHA-256.');
  }
  return{ok:fail.length===0,fail,value};
}
function validateOperationsFile(filename,options={}){
  const absolute=path.resolve(String(filename||''));
  if(!filename||!path.isAbsolute(String(filename)))return{ok:false,fail:['ROLLANDS_PILOT_OPERATIONS_PATH måste vara en absolut sökväg.']};
  if(!fs.existsSync(absolute)||!fs.statSync(absolute).isFile())return{ok:false,fail:['Pilotens operationsfil saknas eller är inte en fil.']};
  let value;try{value=readJson(absolute)}catch(error){return{ok:false,fail:[error.message]}};
  return validateOperations(value,options);
}
module.exports=Object.freeze({REQUIRED_STRINGS,PLACEHOLDER,validateOperations,validateOperationsFile});
