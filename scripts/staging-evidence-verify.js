'use strict';

const path=require('node:path');
const {validateStaging}=require('./staging-preflight.js');
const Readiness=require('../apps/api/readiness.js');

function requiredPath(env,name){
  const value=String(env?.[name]||'').trim();
  if(!value)throw new Error(name+' saknas.');
  return path.resolve(value);
}

function validateEvidenceChain(env=process.env,{now=Date.now()}={}){
  const fail=[],warn=[];
  const preflight=validateStaging(env);
  for(const item of preflight.fail)fail.push('Preflight: '+item);
  warn.push(...preflight.warn);

  const r2=Readiness.r2StagingAuditEvidence(
    String(env.R2_STAGING_AUDIT_EVIDENCE_PATH||''),
    {now}
  );
  const offsite=Readiness.offsiteBackupEvidence(
    String(env.ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH||''),
    {now}
  );
  const restore=Readiness.restoreDrillEvidence(
    String(env.ROLLANDS_RESTORE_DRILL_EVIDENCE_PATH||''),
    {now}
  );
  const monitoring=Readiness.monitoringEvidence(
    String(env.ROLLANDS_MONITORING_EVIDENCE_PATH||''),
    {now}
  );

  if(!r2.ok)fail.push('R2 staging-audit saknas, är ogiltig eller för gammal.');
  if(!offsite.ok)fail.push('Offsite-backupbevis saknas, är ogiltigt eller för gammalt.');
  if(!restore.ok)fail.push('Restore-drillbevis saknas, är ogiltigt eller för gammalt.');
  if(!monitoring.ok)fail.push('Monitorerings-/larmbevis saknas, är ogiltigt eller för gammalt.');

  const configuredObjectBucket=String(env.R2_STAGING_BUCKET||'').trim();
  const configuredBackupBucket=String(env.R2_BACKUP_BUCKET||'').trim();
  if(r2.ok&&r2.bucket!==configuredObjectBucket){
    fail.push('R2 staging-auditen gäller inte den nu konfigurerade stagingbucketen.');
  }
  if(offsite.ok&&offsite.bucket!==configuredBackupBucket){
    fail.push('Offsite-backupbeviset gäller inte den nu konfigurerade backupbucketen.');
  }
  if(offsite.ok&&restore.ok){
    if(offsite.sha256!==restore.sha256){
      fail.push('Restore-drillen gäller inte samma krypterade backup-SHA som verifierades från R2.');
    }
    if(offsite.encryptedFile!==restore.sourceFile){
      fail.push('Restore-drillen gäller inte samma krypterade backupfil som verifierades från R2.');
    }
  }

  const checks=Object.freeze({
    preflight:preflight.fail.length===0,
    r2Audit:r2.ok&&r2.bucket===configuredObjectBucket,
    offsiteBackup:offsite.ok&&offsite.bucket===configuredBackupBucket,
    restoreDrill:restore.ok,
    monitoring:monitoring.ok,
    sameBackupArtifact:offsite.ok&&restore.ok&&offsite.sha256===restore.sha256&&offsite.encryptedFile===restore.sourceFile
  });

  return Object.freeze({
    ok:fail.length===0,
    checks,
    fail:Object.freeze([...new Set(fail)]),
    warn:Object.freeze([...new Set(warn)]),
    evidence:Object.freeze({
      r2AuditAgeMs:r2.ageMs,
      r2AuditManifestSha256:r2.manifestSha256||null,
      r2AuditObjectCount:r2.objectCount??null,
      offsiteBackupAgeMs:offsite.ageMs,
      backupSha256:offsite.sha256||null,
      restoreDrillAgeMs:restore.ageMs,
      monitoringAgeMs:monitoring.ageMs,
      alertAgeMs:monitoring.alertAgeMs
    })
  });
}

function main(){
  try{
    for(const name of [
      'R2_STAGING_AUDIT_EVIDENCE_PATH',
      'ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH',
      'ROLLANDS_RESTORE_DRILL_EVIDENCE_PATH',
      'ROLLANDS_MONITORING_EVIDENCE_PATH'
    ])requiredPath(process.env,name);
    const result=validateEvidenceChain(process.env);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(!result.ok)process.exitCode=1;
  }catch(error){
    console.error('STAGING_EVIDENCE_CHAIN_FAILED: '+(error?.message||String(error)));
    process.exitCode=1;
  }
}

if(require.main===module)main();
module.exports=Object.freeze({requiredPath,validateEvidenceChain,main});
