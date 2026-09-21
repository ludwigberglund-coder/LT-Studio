'use strict';

const fs=require('node:fs');
const crypto=require('node:crypto');

const SOURCE_ENV=Object.freeze({
  uat:'ROLLANDS_UAT_EVIDENCE_PATH',
  r2Audit:'R2_STAGING_AUDIT_EVIDENCE_PATH',
  offsiteBackup:'ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH',
  restoreDrill:'ROLLANDS_RESTORE_DRILL_EVIDENCE_PATH',
  r2RestoreDrill:'ROLLANDS_R2_RESTORE_DRILL_EVIDENCE_PATH',
  monitoring:'ROLLANDS_MONITORING_EVIDENCE_PATH'
});
const REQUIRED_CHECKS=Object.freeze([
  'preflight','r2Audit','offsiteBackup','restoreDrill','r2RestoreDrill','monitoring','sameBackupArtifact'
]);

function sha256File(filename){return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')}
function validCommit(value){return /^[a-f0-9]{40}$/.test(String(value||'').trim().toLowerCase())}

function validateStagingSignoff(value,{expectedCommit='',sourcePaths={},now=Date.now()}={}){
  const fail=[];
  if(!value||typeof value!=='object'||Array.isArray(value))return{ok:false,fail:['Staging-signoff måste vara ett JSON-objekt.']};
  if(value.schemaVersion!==1)fail.push('schemaVersion måste vara 1.');
  if(value.environment!=='staging')fail.push('environment måste vara staging.');
  if(value.readyForPilotDecision!==true)fail.push('readyForPilotDecision måste vara true.');
  const commit=String(value.releaseCommit||'').trim().toLowerCase();
  if(!validCommit(commit))fail.push('releaseCommit måste vara en fullständig 40-teckens Git-SHA.');
  const expected=String(expectedCommit||'').trim().toLowerCase();
  if(expected&&(!validCommit(expected)||commit!==expected))fail.push('Staging-signoff gäller inte den release-commit som ska köras.');

  const createdAt=Date.parse(String(value.createdAt||''));
  if(!Number.isFinite(createdAt)||createdAt>now+5*60*1000)fail.push('createdAt måste vara en giltig tidpunkt som inte ligger i framtiden.');
  const uatCompletedAt=Date.parse(String(value.uatCompletedAt||''));
  if(!Number.isFinite(uatCompletedAt)||uatCompletedAt>now+5*60*1000)fail.push('uatCompletedAt måste vara en giltig tidpunkt som inte ligger i framtiden.');
  else if(Number.isFinite(createdAt)&&uatCompletedAt>createdAt)fail.push('uatCompletedAt får inte ligga efter staging-signoffens createdAt.');

  const checks=value.checks;
  if(!checks||typeof checks!=='object')fail.push('checks saknas.');
  else for(const key of REQUIRED_CHECKS)if(checks[key]!==true)fail.push('Staging-signoff saknar godkänd kontroll: '+key+'.');

  const hashes=value.sourceEvidenceSha256;
  if(!hashes||typeof hashes!=='object')fail.push('sourceEvidenceSha256 saknas.');
  else{
    for(const key of Object.keys(SOURCE_ENV)){
      const expectedHash=String(hashes[key]||'').trim().toLowerCase();
      if(!/^[a-f0-9]{64}$/.test(expectedHash)){fail.push('Staging-signoff saknar giltig SHA-256 för '+key+'.');continue}
      if(sourcePaths[key]){
        try{
          const actual=sha256File(sourcePaths[key]);
          if(actual!==expectedHash)fail.push('Evidensfilen '+key+' har ändrats efter staging-signoff.');
        }catch{fail.push('Evidensfilen '+key+' kunde inte verifieras mot staging-signoff.')}
      }
    }
  }
  return{ok:fail.length===0,fail,value};
}

function validateStagingSignoffFile(filename,options={}){
  if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile())return{ok:false,fail:['Staging-signofffilen saknas eller är inte en fil.']};
  try{
    const value=JSON.parse(fs.readFileSync(filename,'utf8'));
    const result=validateStagingSignoff(value,options);
    return{...result,sha256:sha256File(filename)};
  }catch(error){return{ok:false,fail:['Staging-signofffilen kunde inte läsas som JSON: '+error.message]}}
}

module.exports=Object.freeze({
  SOURCE_ENV,
  REQUIRED_CHECKS,
  sha256File,
  validCommit,
  validateStagingSignoff,
  validateStagingSignoffFile
});
