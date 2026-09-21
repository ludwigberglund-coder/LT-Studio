'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Db=require('../apps/api/database.js');
const Ledger=require('../apps/api/private-object-copy-ledger.js');
const Worker=require('../apps/api/private-object-copy-worker.js');
const R2=require('../apps/api/r2-eu-staging-target.js');

function usage(){
  return 'Användning: npm run storage:copy-one-r2 -- <companyId> <kind> <objectId> <sha256> [databasePath]';
}

async function main(){
  const [companyId,kind,objectId,sha256,databaseArg]=process.argv.slice(2);
  if(!companyId||!kind||!objectId||!/^[a-f0-9]{64}$/i.test(String(sha256||''))){
    throw Object.assign(new Error(usage()),{code:'R2_STAGING_COPY_ARGS_INVALID'});
  }

  const repositoryRoot=path.resolve(__dirname,'..');
  const databasePath=path.resolve(
    databaseArg||
    process.env.ROLLANDS_DATABASE_PATH||
    path.join(repositoryRoot,'data','platform.sqlite')
  );
  if(!fs.existsSync(databasePath)){
    throw Object.assign(new Error('Databasen hittades inte: '+databasePath),{code:'R2_STAGING_DATABASE_NOT_FOUND'});
  }

  const db=Db.openDatabase(databasePath);
  try{
    Ledger.initializePrivateObjectCopyLedger(db);
    const targetStore=R2.createR2EuStagingTarget({env:process.env});
    const result=await Worker.copyPlannedPrivateObject(db,{
      companyId:String(companyId),
      kind:String(kind),
      objectId:String(objectId),
      sha256:String(sha256).toLowerCase(),
      provider:'r2'
    },{targetStore});
    process.stdout.write(JSON.stringify({
      ok:true,
      duplicate:result.duplicate,
      companyId:result.copy.companyId,
      kind:result.copy.kind,
      objectId:result.copy.objectId,
      sha256:result.copy.sha256,
      provider:result.copy.provider,
      status:result.copy.status,
      attemptCount:result.copy.attemptCount,
      verifiedAt:result.copy.verifiedAt
    },null,2)+'\n');
  }finally{
    db.close();
  }
}

main().catch(error=>{
  console.error(`${error?.code||'R2_STAGING_COPY_FAILED'}: ${error?.message||String(error)}`);
  process.exitCode=1;
});
