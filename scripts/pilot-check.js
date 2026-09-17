'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const npm=process.platform==='win32'?'npm.cmd':'npm';
const pass=[];
const fail=[];
const warn=[];

function run(label,command,args){
  process.stdout.write(`\n== ${label} ==\n`);
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit',env:process.env});
  if(result.error||result.status!==0){fail.push(label);return false}
  pass.push(label);return true;
}

function walk(dir,files=[]){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(['node_modules','dist','.git'].includes(entry.name))continue;
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())walk(full,files);
    else if(/\.(?:js|cjs|mjs)$/.test(entry.name))files.push(full);
  }
  return files;
}

function syntaxCheck(){
  process.stdout.write('\n== JavaScript syntax ==\n');
  for(const file of walk(root)){
    const result=spawnSync(process.execPath,['--check',file],{cwd:root,encoding:'utf8'});
    if(result.status!==0){
      process.stderr.write(result.stderr||`Syntaxfel i ${path.relative(root,file)}\n`);
      fail.push('JavaScript syntax');
      return false;
    }
  }
  pass.push('JavaScript syntax');
  return true;
}

function verifyStaticDemo(){
  process.stdout.write('\n== Static demo safety ==\n');
  const dist=path.join(root,'dist');
  if(!fs.existsSync(dist)){fail.push('Static demo safety');return false}
  const forbidden=[];
  function inspect(dir){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const full=path.join(dir,entry.name);
      if(entry.isDirectory())inspect(full);
      else if(/(^\.env(?:\.|$)|\.sqlite(?:3)?$|\.db$|^store\.json$)/i.test(entry.name))forbidden.push(path.relative(dist,full));
    }
  }
  inspect(dist);
  if(forbidden.length){
    console.error(`Otillåtna datafiler i statisk demo: ${forbidden.join(', ')}`);
    fail.push('Static demo safety');return false;
  }
  pass.push('Static demo safety');return true;
}

run('Content validation',process.execPath,['scripts/validate-content.js']);
syntaxCheck();
run('Full testsuite',npm,['test']);
run('Production dependency audit',npm,['audit','--omit=dev','--audit-level=high']);
if(run('Static demo build',npm,['run','build:static']))verifyStaticDemo();
else fail.push('Static demo safety');

try{
  require.resolve('playwright',{paths:[root]});
  if(fs.existsSync(path.join(root,'test','payables-browser.test.cjs')))run('Supplier browser flow',npm,['run','test:browser:payables']);
}catch{
  warn.push('Chromium/browserflödet kördes inte eftersom Playwright inte är installerat lokalt; det ska fortfarande köras i CI.');
}

console.log('\nROLANDS PILOT READINESS');
console.log('\nPASS:');
for(const item of pass)console.log(`- ${item}`);
console.log('\nFAIL:');
if(fail.length)for(const item of [...new Set(fail)])console.log(`- ${item}`);else console.log('- Inga blockerande automatiska kontroller misslyckades.');
console.log('\nWARN:');
if(warn.length)for(const item of warn)console.log(`- ${item}`);else console.log('- Inga automatiska varningar.');

if(fail.length){
  console.log('\nNOT READY');
  process.exitCode=1;
}else{
  console.log('\nAUTOMATED CHECKS PASS – manuell UAT och driftkontroller krävs fortfarande före pilotbeslut.');
}
