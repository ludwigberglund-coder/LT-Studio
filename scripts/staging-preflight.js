'use strict';

const path=require('node:path');
const {validateConfig,outsideRepository}=require('./pilot-preflight.js');
const R2=require('../apps/api/r2-eu-staging-target.js');
const BackupR2=require('./r2-eu-backup-target.js');
const AuditR2=require('./audit-anchor-r2.js');

function validateStaging(env=process.env){
  const pass=[],fail=[],warn=[];
  const base=validateConfig({...env,ROLLANDS_ENV:String(env.ROLLANDS_ENV||'').trim()});
  pass.push(...base.pass);
  fail.push(...base.fail);
  warn.push(...base.warn);

  if(String(env.ROLLANDS_ENV||'').trim().toLowerCase()!=='staging'){
    fail.push('ROLLANDS_ENV måste vara staging för staging:preflight.');
  }

  let objectConfig=null;
  try{
    objectConfig=R2.configFromEnvironment(env);
    pass.push('R2 private-object staging configuration');
  }catch(error){
    fail.push('R2 private objects: '+(error?.message||String(error)));
  }

  let backupConfig=null;
  try{
    backupConfig=BackupR2.configFromEnvironment(env);
    pass.push('R2 offsite-backup configuration');
  }catch(error){
    fail.push('R2 offsite backup: '+(error?.message||String(error)));
  }

  let auditConfig=null;
  try{
    auditConfig=AuditR2.configFromEnvironment(env);
    pass.push('R2 audit-anchor configuration');
  }catch(error){
    fail.push('R2 audit anchor: '+(error?.message||String(error)));
  }

  if(objectConfig&&backupConfig&&objectConfig.bucket===backupConfig.bucket){
    fail.push('R2_STAGING_BUCKET och R2_BACKUP_BUCKET måste vara olika buckets så att runtimeobjekt och katastrofbackup inte delar samma felzon/policy.');
  }else if(objectConfig&&backupConfig){
    pass.push('Separate R2 object and backup buckets');
  }
  if(auditConfig){
    const usedBuckets=[objectConfig?.bucket,backupConfig?.bucket].filter(Boolean);
    if(usedBuckets.includes(auditConfig.bucket)){
      fail.push('R2_AUDIT_BUCKET måste vara separat från både R2_STAGING_BUCKET och R2_BACKUP_BUCKET.');
    }else{
      pass.push('Separate R2 audit-anchor bucket');
    }
    const usedAccessKeys=[objectConfig?.accessKeyId,backupConfig?.accessKeyId].filter(Boolean);
    if(usedAccessKeys.includes(auditConfig.accessKeyId)){
      fail.push('R2_AUDIT_ACCESS_KEY_ID måste använda separat credential-scope.');
    }else{
      pass.push('Separate R2 audit-anchor credential scope');
    }
  }

  const evidencePaths=new Map();
  for(const name of [
    'R2_STAGING_AUDIT_EVIDENCE_PATH',
    'ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH',
    'ROLLANDS_RESTORE_DRILL_EVIDENCE_PATH',
    'ROLLANDS_R2_RESTORE_DRILL_EVIDENCE_PATH',
    'ROLLANDS_MONITORING_EVIDENCE_PATH',
    'ROLLANDS_LOGGING_EVIDENCE_PATH',
    'ROLLANDS_AUDIT_ANCHOR_PATH',
    'ROLLANDS_AUDIT_ANCHOR_EVIDENCE_PATH'
  ]){
    const value=String(env[name]||'').trim();
    if(!value){
      fail.push(name+' saknas.');
      continue;
    }
    if(!path.isAbsolute(value)){
      fail.push(name+' måste vara en absolut sökväg.');
      continue;
    }
    try{
      if(!outsideRepository(value)){
        fail.push(name+' måste ligga utanför Git-repositoryt.');
        continue;
      }
      const normalized=path.resolve(value);
      const previous=evidencePaths.get(normalized);
      if(previous){
        fail.push(name+' och '+previous+' måste använda separata evidensfiler.');
      }else{
        evidencePaths.set(normalized,name);
        pass.push(name+' outside repository');
      }
    }catch(error){
      fail.push(name+' kunde inte verifieras: '+(error?.message||String(error)));
    }
  }

  if(objectConfig&&backupConfig&&objectConfig.accountId===backupConfig.accountId){
    warn.push('R2 stagingobjekt och offsite-backup använder samma R2-konto. Separata buckets är ett minimum; separat konto/credential-scope ger starkare isolering.');
  }
  if(auditConfig&&[objectConfig?.accountId,backupConfig?.accountId].includes(auditConfig.accountId)){
    warn.push('R2 auditankaret delar R2-konto med annan lagring. Separat bucket och credential-scope krävs; separat konto ger starkare oberoende.');
  }

  return{pass:[...new Set(pass)],fail:[...new Set(fail)],warn:[...new Set(warn)]};
}

function main(){
  const result=validateStaging(process.env);
  console.log('ROLLANDS STAGING PREFLIGHT');
  console.log('\nPASS:');
  if(result.pass.length)result.pass.forEach(item=>console.log('- '+item));else console.log('- Inga.');
  console.log('\nFAIL:');
  if(result.fail.length)result.fail.forEach(item=>console.log('- '+item));else console.log('- Inga blockerande konfigurationsfel.');
  console.log('\nWARN:');
  if(result.warn.length)result.warn.forEach(item=>console.log('- '+item));else console.log('- Inga.');
  if(result.fail.length){
    console.log('\nSTAGING NOT READY');
    process.exitCode=1;
  }else{
    console.log('\nSTAGING CONFIGURATION PASS - verklig R2-readback, backup/restore, HTTPS, central loggtransport och larmtest återstår som driftbevis.');
  }
}

if(require.main===module)main();
module.exports=Object.freeze({validateStaging});
