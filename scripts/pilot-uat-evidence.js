'use strict';

const fs=require('node:fs');

const REQUIRED_SCENARIOS=Object.freeze([
  'supplier-invoice',
  'customer-invoice',
  'correction',
  'period-lock',
  'idempotency',
  'backup-restore',
  'tenant-isolation'
]);
const PLACEHOLDER=/REPLACE_WITH|TBD|TO_BE_DECIDED|example\.invalid|placeholder|changeme/i;
const DEFAULT_UAT_MAX_AGE_MS=7*24*60*60*1000;

function validCommit(value){return /^[a-f0-9]{40}$/.test(String(value||'').trim().toLowerCase())}
function validateUatEvidence(value,{now=Date.now(),maxAgeMs=DEFAULT_UAT_MAX_AGE_MS,expectedCommit=''}={}){
  const fail=[];
  if(!value||typeof value!=='object'||Array.isArray(value))return{ok:false,fail:['UAT-evidensen måste vara ett JSON-objekt.']};
  if(value.schemaVersion!==1)fail.push('schemaVersion måste vara 1.');
  if(value.environment!=='staging')fail.push('environment måste vara staging.');
  if(value.approved!==true)fail.push('approved måste vara true efter genomförd och godkänd UAT.');
  if(value.testDataOnly!==true)fail.push('testDataOnly måste vara true; skarpa verksamhetsdata får inte användas i staging-UAT.');

  const commit=String(value.stagingCommit||'').trim().toLowerCase();
  if(!validCommit(commit))fail.push('stagingCommit måste vara en fullständig 40-teckens Git-SHA.');
  const expected=String(expectedCommit||'').trim().toLowerCase();
  if(expected&&(!validCommit(expected)||commit!==expected))fail.push('UAT gäller inte den release-commit som ska godkännas.');

  const completedAt=Date.parse(String(value.completedAt||''));
  if(!Number.isFinite(completedAt)||completedAt>now+5*60*1000)fail.push('completedAt måste vara en giltig tidpunkt som inte ligger i framtiden.');
  else if(now-completedAt>maxAgeMs)fail.push('UAT-evidensen är äldre än 7 dagar och måste förnyas för pilotbeslutet.');

  for(const key of ['tester','accountingReviewer','technicalReviewer']){
    const selected=String(value[key]||'').trim();
    if(selected.length<3||PLACEHOLDER.test(selected))fail.push(key+' saknas, är för kort eller innehåller ett placeholder-värde.');
  }

  if(value.secondTenantVerified!==true)fail.push('secondTenantVerified måste vara true efter stagingtest med kund nummer två.');
  if(!Array.isArray(value.blockingIssues))fail.push('blockingIssues måste vara en lista.');
  else if(value.blockingIssues.length)fail.push('blockingIssues måste vara tom före pilotbeslut.');

  const scenarios=value.scenarios;
  if(!scenarios||typeof scenarios!=='object'||Array.isArray(scenarios)){
    fail.push('scenarios måste innehålla samtliga obligatoriska UAT-scenarier.');
  }else{
    for(const id of REQUIRED_SCENARIOS){
      const scenario=scenarios[id];
      if(!scenario||scenario.passed!==true){
        fail.push('UAT-scenario '+id+' är inte godkänt.');
        continue;
      }
      const reference=String(scenario.reference||'').trim();
      if(reference.length<3||PLACEHOLDER.test(reference))fail.push('UAT-scenario '+id+' saknar en spårbar evidensreferens.');
    }
  }

  return{ok:fail.length===0,fail,ageMs:Number.isFinite(completedAt)?Math.max(0,now-completedAt):null,value};
}

function validateUatEvidenceFile(filename,options={}){
  if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile())return{ok:false,fail:['UAT-evidensfilen saknas eller är inte en fil.']};
  try{return validateUatEvidence(JSON.parse(fs.readFileSync(filename,'utf8')),options)}
  catch(error){return{ok:false,fail:['UAT-evidensfilen kunde inte läsas som JSON: '+error.message]}}
}


function main(){
  const filename=String(process.env.ROLLANDS_UAT_EVIDENCE_PATH||'').trim();
  const expectedCommit=String(process.env.ROLLANDS_RELEASE_COMMIT||'').trim().toLowerCase();
  if(!validCommit(expectedCommit)){
    console.error('UAT_EVIDENCE_INVALID: ROLLANDS_RELEASE_COMMIT måste vara en fullständig 40-teckens Git-SHA.');
    process.exitCode=1;
    return;
  }
  const result=validateUatEvidenceFile(filename,{expectedCommit});
  if(!result.ok){
    for(const item of result.fail)console.error('UAT_EVIDENCE_INVALID: '+item);
    process.exitCode=1;
    return;
  }
  process.stdout.write(JSON.stringify({
    verified:true,
    stagingCommit:String(result.value.stagingCommit).toLowerCase(),
    completedAt:result.value.completedAt,
    secondTenantVerified:true,
    scenarios:REQUIRED_SCENARIOS.length
  })+'\n');
}

if(require.main===module)main();

module.exports=Object.freeze({
  REQUIRED_SCENARIOS,
  PLACEHOLDER,
  DEFAULT_UAT_MAX_AGE_MS,
  validCommit,
  validateUatEvidence,
  validateUatEvidenceFile,
  main
});
