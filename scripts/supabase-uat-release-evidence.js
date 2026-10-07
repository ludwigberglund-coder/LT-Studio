'use strict';

const fs=require('node:fs');

const REQUIRED_SCENARIOS=Object.freeze([
  'auth-session-mfa',
  'customers',
  'customer-invoice',
  'customer-credit-settlement',
  'manual-customer-payment',
  'batches-approvals',
  'supplier-invoice',
  'supplier-payment',
  'bank-reconciliation',
  'unplaced-payments',
  'accounting-reports',
  'documents-pdf',
  'tenant-isolation',
  'idempotency',
  'responsive-theme'
]);

const REQUIRED_CHECKS=Object.freeze([
  'quality',
  'codeql',
  'supabaseCleanRebuild'
]);

const PLACEHOLDER=/REPLACE_WITH|TBD|TO_BE_DECIDED|example\.invalid|placeholder|changeme/i;
const DEFAULT_MAX_AGE_MS=7*24*60*60*1000;

function validCommit(value){
  return /^[a-f0-9]{40}$/.test(String(value||'').trim().toLowerCase());
}

function validateReference(value){
  const reference=String(value||'').trim();
  return reference.length>=3&&!PLACEHOLDER.test(reference);
}

function validateSupabaseUatEvidence(value,{now=Date.now(),maxAgeMs=DEFAULT_MAX_AGE_MS,expectedCommit=''}={}){
  const fail=[];

  if(!value||typeof value!=='object'||Array.isArray(value)){
    return{ok:false,fail:['Supabase-UAT-evidensen måste vara ett JSON-objekt.']};
  }

  if(value.schemaVersion!==1)fail.push('schemaVersion måste vara 1.');
  if(value.environment!=='supabase-uat')fail.push('environment måste vara supabase-uat.');
  if(value.approved!==true)fail.push('approved måste vara true efter genomförd UAT.');
  if(value.syntheticDataOnly!==true)fail.push('syntheticDataOnly måste vara true.');
  if(value.sourceOfTruthVerified!==true)fail.push('sourceOfTruthVerified måste vara true.');
  if(value.twoUsersVerified!==true)fail.push('twoUsersVerified måste vara true.');
  if(value.secondTenantVerified!==true)fail.push('secondTenantVerified måste vara true.');

  const commit=String(value.releaseCommit||'').trim().toLowerCase();
  if(!validCommit(commit))fail.push('releaseCommit måste vara en fullständig 40-teckens Git-SHA.');

  const expected=String(expectedCommit||'').trim().toLowerCase();
  if(expected&&(!validCommit(expected)||commit!==expected)){
    fail.push('UAT-evidensen gäller inte den release-commit som ska verifieras.');
  }

  const completedAt=Date.parse(String(value.completedAt||''));
  if(!Number.isFinite(completedAt)||completedAt>now+5*60*1000){
    fail.push('completedAt måste vara en giltig tidpunkt som inte ligger i framtiden.');
  }else if(now-completedAt>maxAgeMs){
    fail.push('Supabase-UAT-evidensen är äldre än 7 dagar.');
  }

  for(const key of ['tester','accountingReviewer','technicalReviewer']){
    if(!validateReference(value[key])){
      fail.push(key+' saknas, är för kort eller innehåller ett placeholder-värde.');
    }
  }

  if(!Array.isArray(value.blockingIssues)){
    fail.push('blockingIssues måste vara en lista.');
  }else if(value.blockingIssues.length){
    fail.push('blockingIssues måste vara tom före UAT-godkännande.');
  }

  const checks=value.checks;
  if(!checks||typeof checks!=='object'||Array.isArray(checks)){
    fail.push('checks måste innehålla obligatoriska CI-kontroller.');
  }else{
    for(const id of REQUIRED_CHECKS){
      const check=checks[id];
      if(!check||check.passed!==true){
        fail.push('CI-kontroll '+id+' är inte godkänd.');
        continue;
      }
      if(!validateReference(check.reference)){
        fail.push('CI-kontroll '+id+' saknar en spårbar evidensreferens.');
      }
    }
  }

  const scenarios=value.scenarios;
  if(!scenarios||typeof scenarios!=='object'||Array.isArray(scenarios)){
    fail.push('scenarios måste innehålla samtliga obligatoriska Supabase-UAT-scenarier.');
  }else{
    for(const id of REQUIRED_SCENARIOS){
      const scenario=scenarios[id];
      if(!scenario||scenario.passed!==true){
        fail.push('Supabase-UAT-scenario '+id+' är inte godkänt.');
        continue;
      }
      if(!validateReference(scenario.reference)){
        fail.push('Supabase-UAT-scenario '+id+' saknar en spårbar evidensreferens.');
      }
    }
  }

  return{
    ok:fail.length===0,
    fail,
    ageMs:Number.isFinite(completedAt)?Math.max(0,now-completedAt):null,
    value
  };
}

function validateSupabaseUatEvidenceFile(filename,options={}){
  if(!filename){
    return{ok:false,fail:['Supabase-UAT-evidensfilen saknas eller är inte en fil.']};
  }
  try{
    const raw=fs.readFileSync(filename,'utf8');
    return validateSupabaseUatEvidence(JSON.parse(raw),options);
  }catch(error){
    if(error&&['ENOENT','EISDIR','ENOTDIR'].includes(error.code)){
      return{ok:false,fail:['Supabase-UAT-evidensfilen saknas eller är inte en läsbar fil.']};
    }
    return{ok:false,fail:['Supabase-UAT-evidensfilen kunde inte läsas som JSON: '+error.message]};
  }
}

function main(){
  const filename=String(process.env.LT_SUPABASE_UAT_EVIDENCE_PATH||'').trim();
  const expectedCommit=String(process.env.LT_RELEASE_COMMIT||'').trim().toLowerCase();

  if(!validCommit(expectedCommit)){
    console.error('SUPABASE_UAT_EVIDENCE_INVALID: LT_RELEASE_COMMIT måste vara en fullständig 40-teckens Git-SHA.');
    process.exitCode=1;
    return;
  }

  const result=validateSupabaseUatEvidenceFile(filename,{expectedCommit});
  if(!result.ok){
    for(const item of result.fail)console.error('SUPABASE_UAT_EVIDENCE_INVALID: '+item);
    process.exitCode=1;
    return;
  }

  process.stdout.write(JSON.stringify({
    verified:true,
    releaseCommit:String(result.value.releaseCommit).toLowerCase(),
    completedAt:result.value.completedAt,
    scenarios:REQUIRED_SCENARIOS.length,
    checks:REQUIRED_CHECKS.length,
    twoUsersVerified:true,
    secondTenantVerified:true,
    sourceOfTruthVerified:true
  })+'\n');
}

if(require.main===module)main();

module.exports=Object.freeze({
  REQUIRED_SCENARIOS,
  REQUIRED_CHECKS,
  PLACEHOLDER,
  DEFAULT_MAX_AGE_MS,
  validCommit,
  validateSupabaseUatEvidence,
  validateSupabaseUatEvidenceFile,
  main
});
