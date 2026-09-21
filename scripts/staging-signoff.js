'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateEvidenceChain}=require('./staging-evidence-verify.js');
const {validateUatEvidenceFile}=require('./pilot-uat-evidence.js');
const {verifyRelease}=require('./pilot-release-verify.js');
const {
  SOURCE_ENV,
  REQUIRED_CHECKS,
  sha256File,
  validCommit,
  validateStagingSignoff,
  validateStagingSignoffFile
}=require('./staging-signoff-format.js');

const repositoryRoot=path.resolve(__dirname,'..');

function signoffError(message,code='STAGING_SIGNOFF_FAILED'){
  const error=new Error(message);
  error.code=code;
  return error;
}

function resolvedStoragePath(filename){
  const absolute=path.resolve(filename);
  let parent=absolute;
  const tail=[];
  while(!fs.existsSync(parent)){
    const next=path.dirname(parent);
    if(next===parent)break;
    tail.unshift(path.basename(parent));
    parent=next;
  }
  return path.join(fs.realpathSync(parent),...tail);
}

function outsideRepository(filename){
  const relative=path.relative(fs.realpathSync(repositoryRoot),resolvedStoragePath(filename));
  return Boolean(relative&&(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)));
}

function requiredFile(env,name){
  const raw=String(env[name]||'').trim();
  if(!raw)throw signoffError(name+' saknas.','STAGING_SIGNOFF_PATH_REQUIRED');
  if(!path.isAbsolute(raw))throw signoffError(name+' måste vara en absolut sökväg.','STAGING_SIGNOFF_PATH_INVALID');
  const resolved=path.resolve(raw);
  if(!outsideRepository(resolved))throw signoffError(name+' måste ligga utanför Git-repositoryt.','STAGING_SIGNOFF_PATH_UNSAFE');
  if(!fs.existsSync(resolved)||!fs.statSync(resolved).isFile())throw signoffError(name+' saknas eller är inte en fil.','STAGING_SIGNOFF_SOURCE_MISSING');
  return resolved;
}

function outputPath(env){
  const raw=String(env.ROLLANDS_STAGING_SIGNOFF_PATH||'').trim();
  if(!raw)throw signoffError('ROLLANDS_STAGING_SIGNOFF_PATH saknas.','STAGING_SIGNOFF_OUTPUT_REQUIRED');
  if(!path.isAbsolute(raw))throw signoffError('ROLLANDS_STAGING_SIGNOFF_PATH måste vara en absolut sökväg.','STAGING_SIGNOFF_OUTPUT_INVALID');
  const resolved=path.resolve(raw);
  if(!outsideRepository(resolved))throw signoffError('ROLLANDS_STAGING_SIGNOFF_PATH måste ligga utanför Git-repositoryt.','STAGING_SIGNOFF_OUTPUT_UNSAFE');
  return resolved;
}

function writeAtomic(filename,value){
  fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  const temp=filename+'.tmp-'+crypto.randomUUID();
  try{
    fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
    fs.renameSync(temp,filename);
    fs.chmodSync(filename,0o600);
  }catch(error){
    fs.rmSync(temp,{force:true});
    throw error;
  }
}

function createStagingSignoff(env=process.env,{now=Date.now(),cwd=repositoryRoot}={}){
  if(String(env.ROLLANDS_ENV||'').trim()!=='staging'){
    throw signoffError('Staging-signoff får endast skapas med ROLLANDS_ENV=staging.','STAGING_SIGNOFF_ENV_REQUIRED');
  }
  const releaseCommit=String(env.ROLLANDS_RELEASE_COMMIT||'').trim().toLowerCase();
  if(!validCommit(releaseCommit)){
    throw signoffError('ROLLANDS_RELEASE_COMMIT måste vara en fullständig 40-teckens Git-SHA.','STAGING_SIGNOFF_COMMIT_INVALID');
  }
  verifyRelease({cwd,expectedCommit:releaseCommit});

  const chain=validateEvidenceChain(env,{now});
  if(!chain.ok){
    throw signoffError('Stagingens driftbevis är inte gröna: '+chain.fail.join(' | '),'STAGING_SIGNOFF_EVIDENCE_FAILED');
  }

  const sourcePaths={};
  for(const [key,name] of Object.entries(SOURCE_ENV))sourcePaths[key]=requiredFile(env,name);

  const uat=validateUatEvidenceFile(sourcePaths.uat,{now,expectedCommit:releaseCommit});
  if(!uat.ok){
    throw signoffError('UAT-evidensen är inte godkänd: '+uat.fail.join(' | '),'STAGING_SIGNOFF_UAT_FAILED');
  }

  const signoff=Object.freeze({
    schemaVersion:3,
    environment:'staging',
    createdAt:new Date(now).toISOString(),
    releaseCommit,
    readyForPilotDecision:true,
    uatCompletedAt:String(uat.value.completedAt),
    checks:Object.freeze({...chain.checks}),
    evidence:Object.freeze({...chain.evidence}),
    sourceEvidenceSha256:Object.freeze(Object.fromEntries(
      Object.entries(sourcePaths).map(([key,filename])=>[key,sha256File(filename)])
    ))
  });

  const filename=outputPath(env);
  writeAtomic(filename,signoff);
  return Object.freeze({filename,signoff,sha256:sha256File(filename)});
}

function main(){
  try{
    const result=createStagingSignoff(process.env);
    process.stdout.write(JSON.stringify({
      verified:true,
      releaseCommit:result.signoff.releaseCommit,
      stagingSignoffSha256:result.sha256,
      path:result.filename
    })+'\n');
  }catch(error){
    console.error((error?.code||'STAGING_SIGNOFF_FAILED')+': '+(error?.message||String(error)));
    process.exitCode=1;
  }
}

if(require.main===module)main();

module.exports=Object.freeze({
  SOURCE_ENV,
  REQUIRED_CHECKS,
  sha256File,
  validateStagingSignoff,
  validateStagingSignoffFile,
  createStagingSignoff,
  main
});
