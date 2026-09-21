'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Inventory=require('../apps/api/private-object-inventory.js');

const repositoryRoot=path.resolve(__dirname,'..');
const databasePath=path.resolve(
  process.argv[2]||
  process.env.ROLLANDS_DATABASE_PATH||
  path.join(repositoryRoot,'data','platform.sqlite')
);

if(!fs.existsSync(databasePath)){
  console.error('Databasen hittades inte: '+databasePath);
  process.exitCode=2;
}else{
  let db;
  try{
    db=new DatabaseSync(databasePath,{readOnly:true});
    const report=Inventory.buildPrivateObjectInventory(db,{provider:'sqlite'});
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    if(!report.ok)process.exitCode=1;
  }catch(error){
    console.error(error?.stack||error?.message||String(error));
    process.exitCode=2;
  }finally{
    try{db?.close()}catch{}
  }
}
