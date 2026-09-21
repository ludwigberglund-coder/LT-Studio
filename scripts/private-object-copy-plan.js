'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Db=require('../apps/api/database.js');
const Planner=require('../apps/api/private-object-copy-planner.js');

const repositoryRoot=path.resolve(__dirname,'..');
const targetProvider=String(process.argv[2]||'').trim().toLowerCase();
const databasePath=path.resolve(
  process.argv[3]||
  process.env.ROLLANDS_DATABASE_PATH||
  path.join(repositoryRoot,'data','platform.sqlite')
);

if(!targetProvider){
  console.error('Ange migrationstarget: r2 eller s3. Exempel: npm run storage:plan-copies -- r2');
  process.exitCode=2;
}else if(!fs.existsSync(databasePath)){
  console.error('Databasen hittades inte: '+databasePath);
  process.exitCode=2;
}else{
  let db;
  try{
    db=Db.openDatabase(databasePath);
    const result=Planner.planVerifiedPrivateObjectCopies(db,{targetProvider});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(error){
    console.error(error?.stack||error?.message||String(error));
    process.exitCode=error?.code==='PRIVATE_OBJECT_COPY_SOURCE_NOT_VERIFIED'?1:2;
  }finally{
    try{db?.close()}catch{}
  }
}
