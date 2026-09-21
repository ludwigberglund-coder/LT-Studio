'use strict';

const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');

const RULES=Object.freeze([
  {id:'private-key',regex:/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/},
  {id:'aws-access-key',regex:/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/},
  {id:'github-token',regex:/\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/},
  {id:'slack-token',regex:/\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{20,}\b/},
  {id:'openai-key',regex:/\bsk-[A-Za-z0-9_-]{20,}\b/},
  {id:'stripe-secret',regex:/\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/},
  {id:'rollands-runtime-secret',regex:/\b(?:ROLLANDS_AUTH_ENCRYPTION_KEY|ROLLANDS_BACKUP_ENCRYPTION_KEY|ROLLANDS_BOOTSTRAP_PASSWORD|ROLLANDS_BOOTSTRAP_MFA_SECRET|R2_STAGING_ACCESS_KEY_ID|R2_STAGING_SECRET_ACCESS_KEY|R2_STAGING_SESSION_TOKEN|R2_BACKUP_ACCESS_KEY_ID|R2_BACKUP_SECRET_ACCESS_KEY|R2_BACKUP_SESSION_TOKEN)\s*=\s*[^\s#]{8,}/},
  {id:'database-url-password',regex:/\b(?:DATABASE_URL|POSTGRES_URL|POSTGRESQL_URL|MONGODB_URI|MYSQL_URL)\s*=\s*(?:postgres(?:ql)?|mongodb(?:\+srv)?|mysql):\/\/[^\s:@]+:[^\s@]+@[^\s]+/i}
]);
const PLACEHOLDER=/REPLACE_WITH|example\.invalid|placeholder|changeme|test-only|not-a-login-hash|=\s*['"]?<[^>\r\n]{1,80}>['"]?\s*$/i;

function findingsInText(text){
  const findings=[];
  for(const [index,line] of String(text||'').split(/\r?\n/).entries()){
    if(PLACEHOLDER.test(line))continue;
    for(const rule of RULES)if(rule.regex.test(line))findings.push({rule:rule.id,line:index+1});
  }
  return findings;
}
function git(args){return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024})}
function trackedText(commit,path){
  try{return git(['show',commit+':'+path])}catch{return''}
}
function changedPaths(commit){
  return git(['diff-tree','--root','--no-commit-id','--name-only','-r',commit]).split(/\r?\n/).filter(Boolean);
}
function loadBaseline(){
  const filename=path.resolve(__dirname,'..','config','secret-scan-baseline.json');
  if(!fs.existsSync(filename))return new Set();
  const rows=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(!Array.isArray(rows))throw new Error('secret-scan-baseline.json måste vara en array.');
  return new Set(rows.map(row=>[String(row.commit||''),String(row.path||''),String(row.rule||''),Number(row.line||0)].join('|')));
}
function scanHistory(){
  let commits;
  try{commits=git(['rev-list','--all']).split(/\r?\n/).filter(Boolean)}
  catch(error){const e=new Error('Git-historiken kunde inte läsas. Kör kontrollen i ett fullständigt Git-repository.');e.code='GIT_HISTORY_UNAVAILABLE';throw e}
  const findings=[];
  const seen=new Set();
  const baseline=loadBaseline();
  for(const commit of commits){
    for(const path of changedPaths(commit)){
      if(!/\.(?:js|cjs|mjs|json|ya?ml|env|txt|md|sh|pem|key|crt|conf|ini|toml)$/i.test(path)&&!/(^|\/)\.env(?:\.|$)/i.test(path))continue;
      const content=trackedText(commit,path);
      for(const hit of findingsInText(content)){
        const key=commit+'|'+path+'|'+hit.rule+'|'+hit.line;
        if(seen.has(key))continue;seen.add(key);
        const baselineKey=[commit,path,hit.rule,hit.line].join('|');
        if(baseline.has(baselineKey))continue;
        findings.push({commit:commit.slice(0,12),path,rule:hit.rule,line:hit.line});
      }
    }
  }
  return{commitsScanned:commits.length,findings};
}
function main(){
  const report=scanHistory();
  if(report.findings.length){
    console.error('Git-historikens hemlighetskontroll hittade möjliga högkonfidensfynd. Själva värdena skrivs inte ut.');
    for(const item of report.findings.slice(0,50))console.error('- '+item.rule+' @ '+item.commit+' '+item.path+':'+item.line);
    if(report.findings.length>50)console.error('- Ytterligare '+(report.findings.length-50)+' fynd är dolda.');
    process.exitCode=1;return;
  }
  console.log('Git-historik kontrollerad: '+report.commitsScanned+' commits, inga högkonfidensfynd.');
}
if(require.main===module)main();
module.exports={RULES,PLACEHOLDER,findingsInText,loadBaseline,scanHistory};
