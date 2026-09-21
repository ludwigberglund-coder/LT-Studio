'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');

const repositoryRoot=path.resolve(__dirname,'..');

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

const STREAMS=Object.freeze([
  Object.freeze({
    name:'auditEvents',
    table:'audit_events',
    select:'id,company_id,user_id,action,entity_type,entity_id,details_json,created_at',
    fields:Object.freeze(['id','company_id','user_id','action','entity_type','entity_id','details_json','created_at'])
  }),
  Object.freeze({
    name:'securityEvents',
    table:'security_events',
    select:'id,kind,severity,fingerprint_hash,details_json,created_at',
    fields:Object.freeze(['id','kind','severity','fingerprint_hash','details_json','created_at'])
  }),
  Object.freeze({
    name:'operatorAuditEvents',
    table:'platform_operator_audit_events',
    select:'id,operator_id,action,details_json,created_at',
    fields:Object.freeze(['id','operator_id','action','details_json','created_at'])
  })
]);

function anchorError(message,code='AUDIT_ANCHOR_ERROR'){
  const error=new Error(message);
  error.code=code;
  return error;
}
function sha256Bytes(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}
function canonicalRow(row,fields){return JSON.stringify(fields.map(field=>row[field]??null))+'\n'}

function assertTables(db){
  const present=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  for(const stream of STREAMS){
    if(!present.has(stream.table))throw anchorError('Audit-tabell saknas: '+stream.table+'.','AUDIT_ANCHOR_SCHEMA_INCOMPLETE');
  }
}

function streamDigest(db,stream,{limit=null}={}){
  const limitSql=limit===null?'':' LIMIT ?';
  const statement=db.prepare(`SELECT ${stream.select} FROM ${stream.table} ORDER BY created_at,id${limitSql}`);
  const rows=limit===null?statement.all():statement.all(limit);
  const hash=crypto.createHash('sha256');
  for(const row of rows)hash.update(canonicalRow(row,stream.fields));
  const first=rows[0]||null,last=rows[rows.length-1]||null;
  return Object.freeze({
    name:stream.name,
    table:stream.table,
    count:rows.length,
    sha256:hash.digest('hex'),
    first:first?Object.freeze({createdAt:first.created_at,id:first.id}):null,
    last:last?Object.freeze({createdAt:last.created_at,id:last.id}):null
  });
}

function rootDigest(streams){
  const canonical={
    schemaVersion:1,
    streams:STREAMS.map(def=>{
      const row=streams[def.name];
      return{
        name:def.name,
        table:def.table,
        count:row.count,
        sha256:row.sha256,
        first:row.first,
        last:row.last
      };
    })
  };
  return sha256Bytes(Buffer.from(JSON.stringify(canonical)));
}

function createAuditAnchorFromDatabase(filename,{now=Date.now()}={}){
  const resolved=path.resolve(String(filename||''));
  if(!fs.existsSync(resolved)||!fs.statSync(resolved).isFile()){
    throw anchorError('Databasfilen saknas.','AUDIT_ANCHOR_DATABASE_REQUIRED');
  }
  const db=new DatabaseSync(resolved,{readOnly:true});
  try{
    assertTables(db);
    const integrity=db.prepare('PRAGMA integrity_check').all();
    if(integrity.length!==1||integrity[0].integrity_check!=='ok'){
      throw anchorError('SQLite integrity_check misslyckades.','AUDIT_ANCHOR_DATABASE_INTEGRITY_FAILED');
    }
    const streams={};
    for(const stream of STREAMS)streams[stream.name]=streamDigest(db,stream);
    const rootSha256=rootDigest(streams);
    return Object.freeze({
      schemaVersion:1,
      anchoredAt:new Date(now).toISOString(),
      rootSha256,
      streams:Object.freeze(streams)
    });
  }finally{db.close()}
}

function validateAnchorShape(anchor){
  const fail=[];
  if(!anchor||typeof anchor!=='object'||Array.isArray(anchor))return{ok:false,fail:['Ankaret måste vara ett JSON-objekt.']};
  if(anchor.schemaVersion!==1)fail.push('schemaVersion måste vara 1.');
  if(!/^[a-f0-9]{64}$/.test(String(anchor.rootSha256||'')))fail.push('rootSha256 är ogiltig.');
  const anchoredAt=Date.parse(String(anchor.anchoredAt||''));
  if(!Number.isFinite(anchoredAt))fail.push('anchoredAt är ogiltig.');
  if(!anchor.streams||typeof anchor.streams!=='object')fail.push('streams saknas.');
  else{
    for(const stream of STREAMS){
      const row=anchor.streams[stream.name];
      if(!row){fail.push('Stream saknas: '+stream.name+'.');continue}
      if(row.name!==stream.name||row.table!==stream.table)fail.push('Stream-identitet är ogiltig för '+stream.name+'.');
      if(!Number.isSafeInteger(Number(row.count))||Number(row.count)<0)fail.push('count är ogiltig för '+stream.name+'.');
      if(!/^[a-f0-9]{64}$/.test(String(row.sha256||'')))fail.push('sha256 är ogiltig för '+stream.name+'.');
    }
  }
  if(fail.length===0&&rootDigest(anchor.streams)!==anchor.rootSha256)fail.push('rootSha256 matchar inte stream-summeringarna.');
  return{ok:fail.length===0,fail};
}

function verifyAuditAnchor(filename,anchor){
  const shape=validateAnchorShape(anchor);
  if(!shape.ok)return{ok:false,fail:shape.fail};
  const resolved=path.resolve(String(filename||''));
  if(!fs.existsSync(resolved)||!fs.statSync(resolved).isFile())return{ok:false,fail:['Databasfilen saknas.']};
  const db=new DatabaseSync(resolved,{readOnly:true});
  const fail=[];
  try{
    assertTables(db);
    for(const stream of STREAMS){
      const expected=anchor.streams[stream.name];
      const currentCount=Number(db.prepare(`SELECT COUNT(*) AS n FROM ${stream.table}`).get().n);
      if(currentCount<expected.count){
        fail.push(stream.name+': databasen innehåller färre poster än det ankrade prefixet.');
        continue;
      }
      const actual=streamDigest(db,stream,{limit:expected.count});
      if(actual.sha256!==expected.sha256)fail.push(stream.name+': det ankrade historikprefixets SHA-256 matchar inte.');
      if(JSON.stringify(actual.first)!==JSON.stringify(expected.first))fail.push(stream.name+': första ankrade posten matchar inte.');
      if(JSON.stringify(actual.last)!==JSON.stringify(expected.last))fail.push(stream.name+': sista ankrade posten matchar inte.');
    }
    return{ok:fail.length===0,fail};
  }finally{db.close()}
}

function writeAnchor(filename,anchor){
  const resolved=path.resolve(String(filename||''));
  fs.mkdirSync(path.dirname(resolved),{recursive:true,mode:0o700});
  const temp=resolved+'.tmp-'+crypto.randomUUID();
  try{
    const bytes=Buffer.from(JSON.stringify(anchor,null,2)+'\n');
    fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});
    fs.renameSync(temp,resolved);
    fs.chmodSync(resolved,0o600);
    return Object.freeze({filename:resolved,sha256:sha256Bytes(bytes),sizeBytes:bytes.length});
  }catch(error){
    fs.rmSync(temp,{force:true});
    throw error;
  }
}

function readAnchor(filename){
  const resolved=path.resolve(String(filename||''));
  if(!fs.existsSync(resolved)||!fs.statSync(resolved).isFile())throw anchorError('Audit-ankaret saknas.','AUDIT_ANCHOR_FILE_REQUIRED');
  let anchor;
  try{anchor=JSON.parse(fs.readFileSync(resolved,'utf8'))}
  catch{throw anchorError('Audit-ankaret är inte giltig JSON.','AUDIT_ANCHOR_JSON_INVALID')}
  const shape=validateAnchorShape(anchor);
  if(!shape.ok)throw anchorError('Audit-ankaret är ogiltigt: '+shape.fail.join(' | '),'AUDIT_ANCHOR_INVALID');
  return anchor;
}

function required(name){const value=String(process.env[name]||'').trim();if(!value)throw anchorError(name+' saknas.','AUDIT_ANCHOR_ENV_REQUIRED');return value}

function createMain(){
  const databasePath=path.resolve(required('ROLLANDS_DATABASE_PATH'));
  const anchorPath=path.resolve(required('ROLLANDS_AUDIT_ANCHOR_PATH'));
  if(!outsideRepository(anchorPath))throw anchorError('ROLLANDS_AUDIT_ANCHOR_PATH måste ligga utanför Git-repositoryt.','AUDIT_ANCHOR_PATH_UNSAFE');
  const anchor=createAuditAnchorFromDatabase(databasePath);
  const written=writeAnchor(anchorPath,anchor);
  process.stdout.write(JSON.stringify({verified:true,rootSha256:anchor.rootSha256,anchorSha256:written.sha256,path:written.filename,streams:Object.fromEntries(Object.entries(anchor.streams).map(([key,value])=>[key,value.count]))})+'\n');
}

function verifyMain(){
  const databasePath=path.resolve(required('ROLLANDS_DATABASE_PATH'));
  const anchorPath=path.resolve(required('ROLLANDS_AUDIT_ANCHOR_PATH'));
  if(!outsideRepository(anchorPath))throw anchorError('ROLLANDS_AUDIT_ANCHOR_PATH måste ligga utanför Git-repositoryt.','AUDIT_ANCHOR_PATH_UNSAFE');
  const result=verifyAuditAnchor(databasePath,readAnchor(anchorPath));
  if(!result.ok){
    for(const item of result.fail)console.error('AUDIT_ANCHOR_VERIFY_FAILED: '+item);
    process.exitCode=1;
    return;
  }
  process.stdout.write(JSON.stringify({verified:true,path:anchorPath})+'\n');
}

if(require.main===module){
  if(process.argv.includes('--verify'))verifyMain();
  else createMain();
}

module.exports=Object.freeze({
  STREAMS,
  sha256Bytes,
  canonicalRow,
  streamDigest,
  rootDigest,
  createAuditAnchorFromDatabase,
  validateAnchorShape,
  verifyAuditAnchor,
  writeAnchor,
  readAnchor,
  outsideRepository,
  createMain,
  verifyMain
});
