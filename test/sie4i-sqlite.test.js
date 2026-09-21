'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const Db=require('../apps/api/database.js');
const Accounting=require('../apps/api/accounting-store.js');

const root=path.resolve(__dirname,'..');
const exporter=path.join(root,'scripts','export-sie4i.js');

function seedDatabase(filename,{tamper=false}={}){
  const db=Db.openDatabase(filename);
  Accounting.initializeAccountingStore(db);
  try{
    const companyA=Db.createCompany(db,{legalName:'SQLite Export AB',displayName:'SQLite Export',orgNumber:'559999-1001'});
    const companyB=Db.createCompany(db,{legalName:'Other Tenant AB',displayName:'Other Tenant',orgNumber:'559999-1002'});
    const user=Db.createUser(db,{username:'sie.export.test',displayName:'SIE Export Test',passwordHash:'test-hash'});
    Db.addMembership(db,{companyId:companyA.id,userId:user.id});
    Db.addMembership(db,{companyId:companyB.id,userId:user.id});

    const first=Accounting.postEntry(db,{
      companyId:companyA.id,
      postingDate:'2026-09-15',
      description:'Verifierad exportpost',
      sourceType:'test-sie',
      sourceId:'source-a',
      createdBy:user.id,
      series:'A',
      lines:[
        {account:'1930',text:'Bank',debitOre:12550,creditOre:0},
        {account:'3051',text:'Försäljning',debitOre:0,creditOre:10040},
        {account:'2611',text:'Moms',debitOre:0,creditOre:2510}
      ]
    }).entry;
    Accounting.postEntry(db,{
      companyId:companyB.id,
      postingDate:'2026-09-15',
      description:'Annan kunds post',
      sourceType:'test-sie',
      sourceId:'source-b',
      createdBy:user.id,
      series:'A',
      lines:[
        {account:'1930',text:'Bank',debitOre:99900,creditOre:0},
        {account:'3051',text:'Försäljning',debitOre:0,creditOre:99900}
      ]
    });

    if(tamper){
      db.exec('DROP TRIGGER history_accounting_entry_lines_update');
      db.prepare('UPDATE accounting_entry_lines SET debit_ore=debit_ore+1 WHERE entry_id=? AND line_number=1').run(first.id);
    }
    return{companyA,companyB};
  }finally{
    db.close();
  }
}

test('standardkommandot export:sie4i läser verifierad privat SQLite och håller företag isolerade',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-sie-sqlite-'));
  try{
    const database=path.join(dir,'platform.sqlite');
    const output=path.join(dir,'exports','current.SI');
    const {companyA}=seedDatabase(database);
    const result=spawnSync(process.execPath,[
      exporter,
      '--database='+database,
      '--company-id='+companyA.id,
      '--year=2026',
      '--company-type=AB',
      '--date=2026-09-21',
      '--output='+output
    ],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||result.stdout);
    assert.match(result.stdout,/SIE 4I skapad från privat SQLite/);
    assert.equal(fs.existsSync(output),true);
    assert.equal(fs.existsSync(output+'.sha256'),true);

    const bytes=fs.readFileSync(output);
    const ascii=bytes.toString('latin1');
    assert.match(ascii,/#FNAMN "SQLite Export AB"/);
    assert.match(ascii,/#ORGNR 559999-1001/);
    assert.match(ascii,/#FTYP AB/);
    assert.match(ascii,/#RAR 0 20260101 20261231/);
    assert.match(ascii,/#TRANS 1930 \{\} 125\.50 ""/);
    assert.match(ascii,/#TRANS 3051 \{\} -100\.40 ""/);
    assert.match(ascii,/#TRANS 2611 \{\} -25\.10 ""/);
    assert.doesNotMatch(ascii,/999\.00/);
    assert.match(fs.readFileSync(output+'.sha256','utf8'),/^[a-f0-9]{64}  current\.SI\n$/);
    if(process.platform!=='win32')assert.equal(fs.statSync(output).mode&0o777,0o600);
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('SIE-CLI kräver explicit företag, år, företagsform och output',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-sie-required-'));
  try{
    const database=path.join(dir,'platform.sqlite');
    seedDatabase(database);
    const result=spawnSync(process.execPath,[exporter,'--database='+database],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,1);
    assert.match(result.stderr,/--company-id/);
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('SIE-export stoppar manipulerad journal även när SQLite integrity_check är tekniskt grön',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-sie-tamper-'));
  try{
    const database=path.join(dir,'platform.sqlite');
    const output=path.join(dir,'tampered.SI');
    const {companyA}=seedDatabase(database,{tamper:true});
    const result=spawnSync(process.execPath,[
      exporter,
      '--database='+database,
      '--company-id='+companyA.id,
      '--year=2026',
      '--company-type=AB',
      '--date=2026-09-21',
      '--output='+output
    ],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,1);
    assert.match(result.stderr,/integritetskontrollen/);
    assert.equal(fs.existsSync(output),false);
    assert.equal(fs.existsSync(output+'.sha256'),false);
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
