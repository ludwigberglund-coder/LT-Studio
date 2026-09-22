'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {findingsInText}=require('./scan-git-history-secrets.js');

const root=path.resolve(__dirname,'..');
const BROWSER_ROOTS=['apps/portal','apps/website','apps/admin','apps/operator','public','dist'];
const SECRET_NAME=/\b(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_TUNNEL_TOKEN|CF_API_TOKEN|CF_API_KEY|TINK_CLIENT_SECRET|BANKID_CLIENT_SECRET|R2_(?:STAGING|BACKUP|AUDIT)_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)|ROLLANDS_(?:AUTH_ENCRYPTION_KEY|NEW_AUTH_ENCRYPTION_KEY|BACKUP_ENCRYPTION_KEY|ADMIN_TOKEN|BOOTSTRAP_PASSWORD|BOOTSTRAP_MFA_SECRET|NEW_MFA_SECRET))\b/;

function browserFindings(text){
  const findings=findingsInText(text).map(hit=>({rule:hit.rule,line:hit.line}));
  for(const [index,line] of String(text||'').split(/\r?\n/).entries()){
    if(SECRET_NAME.test(line))findings.push({rule:'client-secret-reference',line:index+1});
  }
  return findings;
}
function walk(directory){
  if(!fs.existsSync(directory))return[];
  const out=[];
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const target=path.join(directory,entry.name);
    if(entry.isDirectory())out.push(...walk(target));
    else if(entry.isFile()&&/\.(?:html|js|mjs|cjs|css|json|svg|txt)$/i.test(entry.name))out.push(target);
  }
  return out;
}
function scanClientArtifacts(){
  const findings=[];
  for(const relative of BROWSER_ROOTS){
    for(const filename of walk(path.join(root,relative))){
      const text=fs.readFileSync(filename,'utf8');
      for(const hit of browserFindings(text))findings.push({path:path.relative(root,filename),...hit});
    }
  }
  return findings;
}
function main(){
  const findings=scanClientArtifacts();
  if(findings.length){
    console.error('Klientskanningen hittade en möjlig secret eller serverhemlighetsreferens i browserkod. Värdet skrivs inte ut.');
    for(const hit of findings.slice(0,50))console.error(`- ${hit.rule} @ ${hit.path}:${hit.line}`);
    process.exitCode=1;
    return;
  }
  console.log('Klientkod kontrollerad: inga serverhemligheter eller högkonfidens-tokens hittades.');
}
if(require.main===module)main();
module.exports=Object.freeze({SECRET_NAME,browserFindings,scanClientArtifacts});
