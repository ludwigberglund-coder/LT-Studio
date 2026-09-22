'use strict';

const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.resolve(__dirname,'..');
const RUNTIME_ROOTS=['apps','packages'];
const ALLOWED_EXTENSIONS=new Set(['.js','.cjs','.mjs','.html']);

const RULES=Object.freeze([
  {id:'eval',regex:/\beval\s*\(/g},
  {id:'function-constructor',regex:/\bnew\s+Function\s*\(/g},
  {id:'node-vm',regex:/\brequire\s*\(\s*['"](?:node:)?vm['"]\s*\)|\bfrom\s+['"](?:node:)?vm['"]/g},
  {id:'child-process',regex:/\brequire\s*\(\s*['"](?:node:)?child_process['"]\s*\)|\bfrom\s+['"](?:node:)?child_process['"]/g},
  {id:'document-write',regex:/\bdocument\.write\s*\(/g},
  {id:'srcdoc-assignment',regex:/\.srcdoc\s*=|\bsrcdoc\s*=/g},
  {id:'string-timeout',regex:/\bsetTimeout\s*\(\s*['"`]/g},
  {id:'string-interval',regex:/\bsetInterval\s*\(\s*['"`]/g},
  {id:'javascript-url',regex:/\bjavascript\s*:/ig},
  {id:'inline-event-attribute',regex:/<[^>\n]*\son[a-z]+\s*=/ig}
]);

function walk(directory){
  if(!fs.existsSync(directory))return[];
  const out=[];
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const target=path.join(directory,entry.name);
    if(entry.isDirectory())out.push(...walk(target));
    else if(entry.isFile()&&ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))out.push(target);
  }
  return out;
}
function findingsInText(text){
  const findings=[];
  for(const [index,line] of String(text||'').split(/\r?\n/).entries()){
    for(const rule of RULES){
      rule.regex.lastIndex=0;
      if(rule.regex.test(line))findings.push({rule:rule.id,line:index+1});
    }
  }
  return findings;
}
function scanRuntime(){
  const findings=[];
  for(const rootName of RUNTIME_ROOTS){
    for(const filename of walk(path.join(ROOT,rootName))){
      const text=fs.readFileSync(filename,'utf8');
      for(const hit of findingsInText(text))findings.push({path:path.relative(ROOT,filename),...hit});
    }
  }
  return findings;
}
function main(){
  const findings=scanRuntime();
  if(findings.length){
    console.error('Runtime-kontrollen hittade kodmönster som kan tolka text som kod, starta processer eller skapa script-URL:er.');
    for(const hit of findings.slice(0,100))console.error(`- ${hit.rule} @ ${hit.path}:${hit.line}`);
    if(findings.length>100)console.error(`- Ytterligare ${findings.length-100} fynd är dolda.`);
    process.exitCode=1;
    return;
  }
  console.log('Runtime-kod kontrollerad: inga förbjudna kodexekveringsmönster hittades.');
}

if(require.main===module)main();
module.exports=Object.freeze({RULES,findingsInText,scanRuntime});
