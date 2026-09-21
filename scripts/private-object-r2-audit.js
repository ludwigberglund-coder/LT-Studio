'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const Audit=require('../apps/api/private-object-external-audit.js');
const R2=require('../apps/api/r2-eu-staging-target.js');
const {outsideRepository}=require('./pilot-preflight.js');

function required(name){
  const value=String(process.env[name]||'').trim();
  if(!value)throw Object.assign(new Error(name+' måste anges.'),{code:'R2_STAGING_AUDIT_CONFIG_REQUIRED'});
  return value;
}

function writeEvidence(filename,value){
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

async function main(){
  const repositoryRoot=path.resolve(__dirname,'..');
  const databasePath=path.resolve(
    process.argv[2]||
    process.env.ROLLANDS_DATABASE_PATH||
    path.join(repositoryRoot,'data','platform.sqlite')
  );
  if(!fs.existsSync(databasePath)){
    throw Object.assign(
      new Error('Databasen hittades inte: '+databasePath),
      {code:'R2_STAGING_AUDIT_DATABASE_NOT_FOUND'}
    );
  }

  const evidencePath=path.resolve(required('R2_STAGING_AUDIT_EVIDENCE_PATH'));
  if(!outsideRepository(evidencePath)){
    throw Object.assign(
      new Error('R2_STAGING_AUDIT_EVIDENCE_PATH måste ligga utanför Git-repositoryt.'),
      {code:'R2_STAGING_AUDIT_EVIDENCE_PATH_UNSAFE'}
    );
  }

  const config=R2.configFromEnvironment(process.env);
  const targetStore=R2.createR2EuStagingTarget({config});
  const db=new DatabaseSync(databasePath,{readOnly:true});
  try{
    db.exec('BEGIN');
    const report=await Audit.auditExternalPrivateObjects(db,{
      targetStore,
      targetProvider:'r2',
      sourceProvider:'sqlite'
    });
    db.exec('COMMIT');

    const evidence=Object.freeze({
      ...report,
      target:Object.freeze({
        provider:'r2',
        jurisdiction:config.jurisdiction,
        bucket:config.bucket
      })
    });
    writeEvidence(evidencePath,evidence);

    process.stdout.write(JSON.stringify({
      ok:evidence.ok,
      auditedAt:evidence.auditedAt,
      targetProvider:evidence.targetProvider,
      sourceManifestSha256:evidence.sourceManifestSha256,
      sourceObjectCount:evidence.sourceObjectCount,
      verifiedExternalCount:evidence.verifiedExternalCount,
      missingReadyCount:evidence.missingReadyCount,
      issueCount:evidence.issueCount,
      evidencePath
    },null,2)+'\n');

    if(!evidence.ok)process.exitCode=1;
  }catch(error){
    try{db.exec('ROLLBACK')}catch{}
    throw error;
  }finally{
    db.close();
  }
}

if(require.main===module){
  main().catch(error=>{
    console.error((error?.code||'R2_STAGING_AUDIT_FAILED')+': '+(error?.message||String(error)));
    process.exitCode=1;
  });
}

module.exports=Object.freeze({writeEvidence,main});
