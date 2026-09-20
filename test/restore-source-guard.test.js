'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const Db=require('../apps/api/database.js');
const Restore=require('../scripts/pilot-restore-verify.js');

const root=path.resolve(__dirname,'..');

test('restore source guard identifierar symlink och hardlink till produktionsdatabasen',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-restore-source-alias-'));
  try{
    const production=path.join(dir,'production.sqlite');
    const db=Db.openDatabase(production);Db.createCompany(db,{legalName:'Prod AB',displayName:'Prod',orgNumber:'559922-1001'});db.close();
    const symlink=path.join(dir,'alias-symlink.sqlite');
    const hardlink=path.join(dir,'alias-hardlink.sqlite');
    fs.symlinkSync(production,symlink);
    fs.linkSync(production,hardlink);
    assert.equal(Restore.sameExistingFile(production,symlink),true);
    assert.equal(Restore.sameExistingFile(production,hardlink),true);
    assert.equal(Restore.sameExistingFile(production,path.join(dir,'missing.sqlite')),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('restore CLI stoppar alias till levande produktionsdatabas innan checksum/restore',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-restore-source-cli-'));
  try{
    const production=path.join(dir,'production.sqlite');
    const target=path.join(dir,'restore.sqlite');
    const db=Db.openDatabase(production);Db.createCompany(db,{legalName:'Prod Guard AB',displayName:'Prod Guard',orgNumber:'559922-1002'});db.close();

    for(const [kind,makeAlias] of [
      ['symlink',(alias)=>fs.symlinkSync(production,alias)],
      ['hardlink',(alias)=>fs.linkSync(production,alias)]
    ]){
      const alias=path.join(dir,`source-${kind}.sqlite`);
      makeAlias(alias);
      const result=spawnSync(process.execPath,['scripts/pilot-restore-verify.js'],{
        cwd:root,
        encoding:'utf8',
        env:{...process.env,ROLLANDS_DATABASE_PATH:production,ROLLANDS_RESTORE_SOURCE:alias,ROLLANDS_RESTORE_TARGET:target}
      });
      assert.notEqual(result.status,0,kind);
      assert.match(result.stderr,/RESTORE_SOURCE_IS_PRODUCTION/,kind);
      assert.equal(fs.existsSync(target),false,kind);
      fs.rmSync(alias,{force:true});
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
