'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {outsideRepository}=require('./pilot-preflight.js');
const {validateOperationsFile}=require('./pilot-operations.js');

const PLACEHOLDER=/REPLACE_WITH|example\.invalid|changeme|placeholder|TBD|TO_BE_DECIDED/i;
const MAX_LOGGING_EVIDENCE_AGE_MS=24*60*60*1000;
const REQUEST_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function loggingError(message,code='STAGING_LOGGING_EVIDENCE_FAILED'){
  const error=new Error(message);
  error.code=code;
  return error;
}
function required(value,label,minLength=1){
  const normalized=String(value??'').trim();
  if(normalized.length<minLength||PLACEHOLDER.test(normalized)){
    throw loggingError(label+' saknas, är för kort eller ser ut som ett exempelvärde.','STAGING_LOGGING_VALUE_REQUIRED');
  }
  return normalized;
}
function requiredFlag(env,name){
  if(String(env?.[name]||'').trim()!=='1'){
    throw loggingError(name+' måste vara 1 först efter att kontrollen faktiskt är uppfylld.','STAGING_LOGGING_CONFIRMATION_REQUIRED');
  }
  return true;
}
function retentionDays(value,label='ROLLANDS_LOGGING_RETENTION_DAYS'){
  const selected=Number(value);
  if(!Number.isSafeInteger(selected)||selected<1||selected>3650){
    throw loggingError(label+' måste vara ett heltal mellan 1 och 3650.','STAGING_LOGGING_RETENTION_INVALID');
  }
  return selected;
}
function operationsRetention(env){
  const filename=required(env.ROLLANDS_PILOT_OPERATIONS_PATH,'ROLLANDS_PILOT_OPERATIONS_PATH',2);
  if(!path.isAbsolute(filename))throw loggingError('ROLLANDS_PILOT_OPERATIONS_PATH måste vara en absolut sökväg.','STAGING_LOGGING_OPERATIONS_PATH_INVALID');
  const result=validateOperationsFile(filename,{requireApproval:false});
  if(!result.ok)throw loggingError('Operationsfilen är inte giltig: '+result.fail.join(' | '),'STAGING_LOGGING_OPERATIONS_INVALID');
  return retentionDays(result.value.logRetentionDays,'operationsfilens logRetentionDays');
}
function confirmationFromEnvironment(env=process.env,{now=Date.now()}={}){
  if(String(env.ROLLANDS_STRUCTURED_LOGS||'').trim()!=='1'){
    throw loggingError('ROLLANDS_STRUCTURED_LOGS måste vara explicit 1 när loggtransporten verifieras.','STAGING_LOGGING_STRUCTURED_LOGS_REQUIRED');
  }
  const provider=required(env.ROLLANDS_LOGGING_PROVIDER,'ROLLANDS_LOGGING_PROVIDER',2);
  const destination=required(env.ROLLANDS_LOGGING_DESTINATION,'ROLLANDS_LOGGING_DESTINATION',3);
  const testRequestId=required(env.ROLLANDS_LOGGING_TEST_REQUEST_ID,'ROLLANDS_LOGGING_TEST_REQUEST_ID',36);
  if(!REQUEST_ID.test(testRequestId))throw loggingError('ROLLANDS_LOGGING_TEST_REQUEST_ID måste vara ett giltigt server-request-id (UUID).','STAGING_LOGGING_REQUEST_ID_INVALID');
  const lookupReference=required(env.ROLLANDS_LOGGING_LOOKUP_REFERENCE,'ROLLANDS_LOGGING_LOOKUP_REFERENCE',6);
  const alertingReference=required(env.ROLLANDS_LOGGING_ALERTING_REFERENCE,'ROLLANDS_LOGGING_ALERTING_REFERENCE',6);
  const observer=required(env.ROLLANDS_LOGGING_OBSERVER,'ROLLANDS_LOGGING_OBSERVER',3);
  const testedAtRaw=required(env.ROLLANDS_LOGGING_TESTED_AT,'ROLLANDS_LOGGING_TESTED_AT',10);
  const testedAt=Date.parse(testedAtRaw);
  if(!Number.isFinite(testedAt)||testedAt>now+5*60*1000){
    throw loggingError('ROLLANDS_LOGGING_TESTED_AT måste vara en giltig tidpunkt som inte ligger i framtiden.','STAGING_LOGGING_TEST_TIME_INVALID');
  }
  if(now-testedAt>MAX_LOGGING_EVIDENCE_AGE_MS){
    throw loggingError('Logguppslagningen är äldre än 24 timmar. Gör ett nytt request-id-test före evidensskrivning.','STAGING_LOGGING_TEST_TOO_OLD');
  }
  const configuredRetention=retentionDays(env.ROLLANDS_LOGGING_RETENTION_DAYS);
  const decidedRetention=operationsRetention(env);
  if(configuredRetention!==decidedRetention){
    throw loggingError('Loggretentionen matchar inte logRetentionDays i den privata operationsfilen.','STAGING_LOGGING_RETENTION_MISMATCH');
  }
  requiredFlag(env,'ROLLANDS_LOGGING_REQUEST_ID_FOUND');
  requiredFlag(env,'ROLLANDS_LOGGING_TRANSPORT_ENCRYPTED');
  requiredFlag(env,'ROLLANDS_LOGGING_ACCESS_RESTRICTED');
  requiredFlag(env,'ROLLANDS_LOGGING_ALERT_SECURITY_EVENT');
  requiredFlag(env,'ROLLANDS_LOGGING_ALERT_5XX');
  requiredFlag(env,'ROLLANDS_LOGGING_ALERT_STREAM_MISSING');
  return Object.freeze({
    provider,
    destination,
    testRequestId:testRequestId.toLowerCase(),
    testedAt:new Date(testedAt).toISOString(),
    lookupReference,
    alertingReference,
    observer,
    retentionDays:configuredRetention
  });
}
function writeEvidence(filename,value){
  fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  const temp=filename+'.tmp-'+crypto.randomUUID();
  try{
    fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
    fs.renameSync(temp,filename);
    fs.chmodSync(filename,0o600);
  }catch(error){
    fs.rmSync(temp,{force:true});
    throw error;
  }
}
function validateLoggingEvidence(filename,{now=Date.now(),maxAgeMs=MAX_LOGGING_EVIDENCE_AGE_MS,expectedRetentionDays=null}={}){
  try{
    if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile())return{ok:false,ageMs:null,retentionDays:null,testRequestId:null};
    const value=JSON.parse(fs.readFileSync(filename,'utf8'));
    if(value.schemaVersion!==1||value.environment!=='staging'||value.source!=='stderr')return{ok:false,ageMs:null,retentionDays:null,testRequestId:null};
    if(value.requestIdLookupSucceeded!==true||value.transportEncrypted!==true||value.accessRestricted!==true)return{ok:false,ageMs:null,retentionDays:null,testRequestId:null};
    const provider=String(value.provider||'').trim();
    const destination=String(value.destination||'').trim();
    const lookupReference=String(value.lookupReference||'').trim();
    const alertingReference=String(value.alertingReference||'').trim();
    const observer=String(value.observer||'').trim();
    if(provider.length<2||destination.length<3||lookupReference.length<6||alertingReference.length<6||observer.length<3)return{ok:false,ageMs:null,retentionDays:null,testRequestId:null};
    if([provider,destination,lookupReference,alertingReference,observer].some(item=>PLACEHOLDER.test(item)))return{ok:false,ageMs:null,retentionDays:null,testRequestId:null};
    const testRequestId=String(value.testRequestId||'').trim().toLowerCase();
    if(!REQUEST_ID.test(testRequestId))return{ok:false,ageMs:null,retentionDays:null,testRequestId:null};
    const selectedRetention=retentionDays(value.retentionDays,'evidensfilens retentionDays');
    if(expectedRetentionDays!==null&&selectedRetention!==Number(expectedRetentionDays))return{ok:false,ageMs:null,retentionDays:selectedRetention,testRequestId};
    const alerts=value.alerts;
    if(!alerts||alerts.securityEvent!==true||alerts.http5xx!==true||alerts.streamMissing!==true)return{ok:false,ageMs:null,retentionDays:selectedRetention,testRequestId};
    const testedAt=Date.parse(String(value.testedAt||''));
    if(!Number.isFinite(testedAt)||testedAt>now+5*60*1000)return{ok:false,ageMs:null,retentionDays:selectedRetention,testRequestId};
    const ageMs=Math.max(0,now-testedAt);
    return{ok:ageMs<=maxAgeMs,ageMs,retentionDays:selectedRetention,testRequestId};
  }catch{return{ok:false,ageMs:null,retentionDays:null,testRequestId:null}}
}
function createLoggingEvidence({env=process.env,now=Date.now()}={}){
  if(String(env.ROLLANDS_ENV||'').trim().toLowerCase()!=='staging'){
    throw loggingError('Loggbevis får i denna fas endast skapas när ROLLANDS_ENV=staging.','STAGING_LOGGING_ENV_REQUIRED');
  }
  const evidencePath=path.resolve(required(env.ROLLANDS_LOGGING_EVIDENCE_PATH,'ROLLANDS_LOGGING_EVIDENCE_PATH',2));
  if(!outsideRepository(evidencePath)){
    throw loggingError('ROLLANDS_LOGGING_EVIDENCE_PATH måste ligga utanför Git-repositoryt.','STAGING_LOGGING_EVIDENCE_PATH_UNSAFE');
  }
  const confirmation=confirmationFromEnvironment(env,{now});
  const evidence=Object.freeze({
    schemaVersion:1,
    environment:'staging',
    source:'stderr',
    provider:confirmation.provider,
    destination:confirmation.destination,
    testedAt:confirmation.testedAt,
    testRequestId:confirmation.testRequestId,
    requestIdLookupSucceeded:true,
    lookupReference:confirmation.lookupReference,
    observer:confirmation.observer,
    transportEncrypted:true,
    accessRestricted:true,
    retentionDays:confirmation.retentionDays,
    alerts:Object.freeze({securityEvent:true,http5xx:true,streamMissing:true}),
    alertingReference:confirmation.alertingReference
  });
  writeEvidence(evidencePath,evidence);
  return Object.freeze({verified:true,evidencePath,evidence});
}
function main(){
  try{
    const result=createLoggingEvidence();
    process.stdout.write(JSON.stringify({
      verified:true,
      provider:result.evidence.provider,
      destination:result.evidence.destination,
      testedAt:result.evidence.testedAt,
      testRequestId:result.evidence.testRequestId,
      evidencePath:result.evidencePath
    })+'\n');
  }catch(error){
    console.error((error?.code||'STAGING_LOGGING_EVIDENCE_FAILED')+': '+(error?.message||String(error)));
    process.exitCode=1;
  }
}
if(require.main===module)main();

module.exports=Object.freeze({
  PLACEHOLDER,
  MAX_LOGGING_EVIDENCE_AGE_MS,
  REQUEST_ID,
  required,
  retentionDays,
  operationsRetention,
  confirmationFromEnvironment,
  writeEvidence,
  validateLoggingEvidence,
  createLoggingEvidence,
  main
});
