'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const {DatabaseSync}=require('node:sqlite');
const Db=require('../apps/api/database.js');
const Accounting=require('../apps/api/accounting-store.js');

const root=path.resolve(__dirname,'..');

async function waitForFile(filename,{timeoutMs=5000}={}){
  const started=Date.now();
  while(!fs.existsSync(filename)){
    if(Date.now()-started>timeoutMs)throw new Error('Child process blev inte redo för samtidighetstest.');
    await delay(10);
  }
}

function launchPoster({dbPath,barrierPath,readyPath,companyId,userId,sourceId}){
  const script=`
'use strict';
const fs=require('node:fs');
const {setTimeout:delay}=require('node:timers/promises');
const {DatabaseSync}=require('node:sqlite');
const Accounting=require('./apps/api/accounting-store.js');

(async()=>{
  const db=new DatabaseSync(process.env.TEST_DB_PATH,{timeout:10000});
  try{
    db.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON; PRAGMA busy_timeout=10000;');
    fs.writeFileSync(process.env.TEST_READY_PATH,'ready');
    while(!fs.existsSync(process.env.TEST_BARRIER_PATH))await delay(5);
    const result=Accounting.postEntry(db,{
      companyId:process.env.TEST_COMPANY_ID,
      postingDate:'2026-09-21',
      description:'Concurrent '+process.env.TEST_SOURCE_ID,
      sourceType:'concurrency-test',
      sourceId:process.env.TEST_SOURCE_ID,
      createdBy:process.env.TEST_USER_ID,
      series:'A',
      lines:[
        {account:'1930',debitOre:1000,creditOre:0,text:'Bank'},
        {account:'2990',debitOre:0,creditOre:1000,text:'Motkonto'}
      ]
    });
    process.stdout.write(JSON.stringify({number:result.entry.number,sequence:result.entry.sequence,duplicate:result.duplicate})+'\\n');
  }finally{db.close()}
})().catch(error=>{
  process.stderr.write(String(error.code||'ERROR')+': '+String(error.message||error)+'\\n');
  process.exitCode=1;
});
`;
  const child=spawn(process.execPath,['-e',script],{
    cwd:root,
    env:{
      ...process.env,
      TEST_DB_PATH:dbPath,
      TEST_BARRIER_PATH:barrierPath,
      TEST_READY_PATH:readyPath,
      TEST_COMPANY_ID:companyId,
      TEST_USER_ID:userId,
      TEST_SOURCE_ID:sourceId
    },
    stdio:['ignore','pipe','pipe']
  });
  let stdout='',stderr='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{stdout+=chunk});
  child.stderr.on('data',chunk=>{stderr+=chunk});
  const done=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',code=>{
      if(code!==0)return reject(new Error('Child '+sourceId+' misslyckades ('+code+'): '+stderr));
      try{resolve(JSON.parse(stdout.trim()))}
      catch(error){reject(new Error('Child '+sourceId+' gav ogiltigt svar: '+stdout+' '+stderr+' '+error.message))}
    });
  });
  return{done};
}

test('två separata processer får unika sekventiella verifikationsnummer utan delvis bokföring',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-accounting-concurrency-'));
  const dbPath=path.join(dir,'platform.sqlite');
  const barrierPath=path.join(dir,'go');
  const readyA=path.join(dir,'ready-a'),readyB=path.join(dir,'ready-b');
  let companyId,userId;
  try{
    const db=Db.openDatabase(dbPath);
    try{
      Accounting.initializeAccountingStore(db);
      const company=Db.createCompany(db,{legalName:'Concurrency Test AB',displayName:'Concurrency',orgNumber:'559999-7722'});
      const user=Db.createUser(db,{username:'concurrency-test',displayName:'Concurrency Test',passwordHash:'test-only'});
      companyId=company.id;userId=user.id;
    }finally{db.close()}

    const first=launchPoster({dbPath,barrierPath,readyPath:readyA,companyId,userId,sourceId:'parallel-a'});
    const second=launchPoster({dbPath,barrierPath,readyPath:readyB,companyId,userId,sourceId:'parallel-b'});
    await Promise.all([waitForFile(readyA),waitForFile(readyB)]);
    fs.writeFileSync(barrierPath,'go');

    const posted=await Promise.all([first.done,second.done]);
    assert.deepEqual(posted.map(row=>row.duplicate),[false,false]);
    assert.deepEqual(posted.map(row=>row.sequence).sort((a,b)=>a-b),[1,2]);
    assert.deepEqual(posted.map(row=>row.number).sort(),['A1','A2']);

    const verify=new DatabaseSync(dbPath,{readOnly:true});
    try{
      const entries=verify.prepare("SELECT sequence,number,source_id AS sourceId FROM accounting_entries WHERE company_id=? AND series='A' ORDER BY sequence").all(companyId);
      assert.deepEqual(entries.map(row=>row.sequence),[1,2]);
      assert.deepEqual(entries.map(row=>row.number),['A1','A2']);
      assert.deepEqual(new Set(entries.map(row=>row.sourceId)),new Set(['parallel-a','parallel-b']));
      assert.equal(verify.prepare("SELECT last_number AS n FROM accounting_sequences WHERE company_id=? AND series='A' AND fiscal_year='2026'").get(companyId).n,2);

      const balances=verify.prepare(`SELECT e.id,SUM(l.debit_ore) AS debitOre,SUM(l.credit_ore) AS creditOre,COUNT(l.line_number) AS lineCount
        FROM accounting_entries e JOIN accounting_entry_lines l ON l.entry_id=e.id
        WHERE e.company_id=? GROUP BY e.id ORDER BY e.sequence`).all(companyId);
      assert.equal(balances.length,2);
      assert.ok(balances.every(row=>row.debitOre===1000&&row.creditOre===1000&&row.lineCount===2),JSON.stringify(balances));
    }finally{verify.close()}
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
