'use strict';
const fs=require('node:fs');
const path=require('node:path');
const configPath=path.join(__dirname,'..','supabase','config.toml');
const slugPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function expectedFunctions(config){
  if(typeof config!=='string')throw Error('Ogiltig GitHub-konfiguration.');
  const expected=new Map();
  let active=null;
  for(const line of config.split(/\r?\n/)){
    const header=/^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
    if(header){
      active=null;
      const match=/^functions\.([a-z0-9-]+)$/.exec(header[1]);
      if(match){
        const slug=match[1];
        if(!slugPattern.test(slug)||expected.has(slug))throw Error('Dubblerad eller ogiltig funktionsdefinition i config.toml.');
        expected.set(slug,null);
        active=slug;
      }
      continue;
    }
    if(active&&/^\s*verify_jwt\s*=/.test(line)){
      const value=/^\s*verify_jwt\s*=\s*(true|false)\s*(?:#.*)?$/.exec(line);
      if(!value||expected.get(active)!==null)throw Error('Ogiltig eller dubblerad verify_jwt i config.toml.');
      expected.set(active,value[1]==='true');
    }
  }
  if(expected.size===0||[...expected.values()].some(value=>typeof value!=='boolean')){
    throw Error('GitHubs Edge Function-policy saknar explicit verify_jwt.');
  }
  return expected;
}

function normalizeSnapshot(input){
  let value=input;
  for(let i=0;i<4;i+=1){
    if(typeof value==='string'){
      try{value=JSON.parse(value)}catch{throw Error('Snapshot är inte giltig JSON.')}
      continue;
    }
    if(Array.isArray(value))return value;
    if(value&&typeof value==='object'){
      if(Array.isArray(value.functions))return value.functions;
      if(typeof value.text==='string'){value=value.text;continue}
      if(value.result){value=value.result;continue}
    }
    break;
  }
  throw Error('Snapshot saknar Edge Functions-lista.');
}

function compareHostedFunctions(input,config){
  const expected=expectedFunctions(config);
  const functions=normalizeSnapshot(input);
  if(functions.length>1000)throw Error('Orimligt stor metadata-snapshot.');
  const observed=new Map();
  const issues=[];
  for(const item of functions){
    if(!item||typeof item!=='object'||!slugPattern.test(item.slug||'')){
      throw Error('Ogiltig funktionsmetadata (slug).');
    }
    if(observed.has(item.slug)){issues.push({code:'DUPLICATE',slug:item.slug});continue}
    observed.set(item.slug,item);
    if(!expected.has(item.slug)){issues.push({code:'UNEXPECTED',slug:item.slug});continue}
    if(item.status!=='ACTIVE')issues.push({code:'NOT_ACTIVE',slug:item.slug});
    if(typeof item.verify_jwt!=='boolean'||item.verify_jwt!==expected.get(item.slug)){
      issues.push({code:'JWT_POLICY_MISMATCH',slug:item.slug});
    }
  }
  for(const slug of expected.keys()){
    if(!observed.has(slug))issues.push({code:'MISSING',slug});
  }
  issues.sort((a,b)=>a.slug.localeCompare(b.slug)||a.code.localeCompare(b.code));
  return {ok:issues.length===0,expectedCount:expected.size,observedCount:functions.length,issues};
}

function main(argv=process.argv,stdin=fs.readFileSync(0,'utf8')){
  if(argv.length!==4||argv[2]!=='--environment'||!['uat','staging'].includes(argv[3])){
    throw Error('Användning: node scripts/verify-hosted-edge-parity.js --environment uat|staging < PRIVATE_METADATA.json');
  }
  let snapshot;
  try{snapshot=JSON.parse(stdin)}catch{throw Error('Snapshot är inte giltig JSON.')}
  const report=compareHostedFunctions(snapshot,fs.readFileSync(configPath,'utf8'));
  process.stdout.write(JSON.stringify({environment:argv[3],...report},null,2)+'\n');
  if(!report.ok)process.exitCode=1;
  return report;
}

if(require.main===module){
  try{main()}catch(error){
    console.error('EDGE_PARITY_INPUT_ERROR: '+(error.message||'Ogiltigt underlag.'));
    process.exitCode=2;
  }
}
module.exports=Object.freeze({expectedFunctions,normalizeSnapshot,compareHostedFunctions,main});
