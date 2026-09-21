'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {outsideRepository}=require('./pilot-preflight.js');

const PLACEHOLDER=/REPLACE_WITH|example\.invalid|changeme|placeholder|TBD|TO_BE_DECIDED/i;
const MAX_ALERT_CONFIRMATION_AGE_MS=24*60*60*1000;

function monitoringError(message,code='STAGING_MONITORING_EVIDENCE_FAILED'){
  const error=new Error(message);
  error.code=code;
  return error;
}

function required(value,label,minLength=1){
  const normalized=String(value??'').trim();
  if(normalized.length<minLength||PLACEHOLDER.test(normalized)){
    throw monitoringError(label+' saknas, är för kort eller ser ut som ett exempelvärde.','STAGING_MONITORING_VALUE_REQUIRED');
  }
  return normalized;
}

function normalizeEndpoint(value){
  const raw=required(value,'ROLLANDS_MONITORING_ENDPOINT',8);
  let url;
  try{url=new URL(raw)}catch{throw monitoringError('Monitoreringsendpoint är inte en giltig URL.','STAGING_MONITORING_ENDPOINT_INVALID')}
  const hostname=url.hostname.toLowerCase();
  if(url.protocol!=='https:')throw monitoringError('Monitoreringsendpoint måste använda HTTPS.','STAGING_MONITORING_HTTPS_REQUIRED');
  if(['localhost','127.0.0.1','::1'].includes(hostname))throw monitoringError('Monitoreringsendpoint måste vara extern, inte loopback.','STAGING_MONITORING_EXTERNAL_REQUIRED');
  if(url.pathname!=='/api/v1/readiness/core'||url.search||url.hash||url.username||url.password){
    throw monitoringError('Monitoreringsendpoint måste vara exakt HTTPS /api/v1/readiness/core utan query, fragment eller inloggningsuppgifter.','STAGING_MONITORING_ENDPOINT_INVALID');
  }
  return url.toString();
}

function alertConfirmationFromEnvironment(env=process.env,{now=Date.now()}={}){
  if(String(env.ROLLANDS_MONITORING_ALERT_DELIVERED||'').trim()!=='1'){
    throw monitoringError('ROLLANDS_MONITORING_ALERT_DELIVERED måste vara 1 först efter att testlarmet faktiskt har tagits emot.','STAGING_MONITORING_ALERT_NOT_CONFIRMED');
  }
  const provider=required(env.ROLLANDS_MONITORING_PROVIDER,'ROLLANDS_MONITORING_PROVIDER',2);
  const alertRoute=required(env.ROLLANDS_MONITORING_ALERT_ROUTE,'ROLLANDS_MONITORING_ALERT_ROUTE',3);
  const alertTestReference=required(env.ROLLANDS_MONITORING_ALERT_TEST_REFERENCE,'ROLLANDS_MONITORING_ALERT_TEST_REFERENCE',6);
  const alertObserver=required(env.ROLLANDS_MONITORING_ALERT_OBSERVER,'ROLLANDS_MONITORING_ALERT_OBSERVER',3);
  const alertTestedAt=required(env.ROLLANDS_MONITORING_ALERT_TESTED_AT,'ROLLANDS_MONITORING_ALERT_TESTED_AT',10);
  const parsed=Date.parse(alertTestedAt);
  if(!Number.isFinite(parsed)||parsed>now+5*60*1000){
    throw monitoringError('ROLLANDS_MONITORING_ALERT_TESTED_AT måste vara en giltig tidpunkt som inte ligger i framtiden.','STAGING_MONITORING_ALERT_TIME_INVALID');
  }
  if(now-parsed>MAX_ALERT_CONFIRMATION_AGE_MS){
    throw monitoringError('Testlarmet är äldre än 24 timmar. Gör ett nytt larmtest före evidensskrivning.','STAGING_MONITORING_ALERT_TOO_OLD');
  }
  return Object.freeze({provider,alertRoute,alertTestReference,alertObserver,alertTestedAt:new Date(parsed).toISOString()});
}

async function probeCoreReadiness(endpoint,{fetchImpl=globalThis.fetch}={}){
  if(typeof fetchImpl!=='function')throw monitoringError('HTTP-klient saknas.','STAGING_MONITORING_FETCH_REQUIRED');
  let response;
  try{
    response=await fetchImpl(endpoint,{
      method:'GET',
      headers:{accept:'application/json'},
      redirect:'error',
      signal:AbortSignal.timeout(10000)
    });
  }catch(error){
    throw monitoringError('Extern readiness-probe kunde inte ansluta.','STAGING_MONITORING_PROBE_NETWORK_FAILED');
  }
  if(!response?.ok||Number(response.status)!==200){
    throw monitoringError('Extern readiness-probe svarade inte 200 OK.','STAGING_MONITORING_PROBE_NOT_READY');
  }
  let body;
  try{body=await response.json()}catch{throw monitoringError('Readiness-probe returnerade inte giltig JSON.','STAGING_MONITORING_PROBE_JSON_INVALID')}
  if(body?.ok!==true||body?.service!=='rollands-api-v1'||!body?.checks||typeof body.checks!=='object'){
    throw monitoringError('Readiness-probe returnerade inte ett godkänt core-readiness-svar.','STAGING_MONITORING_PROBE_INVALID');
  }
  return Object.freeze({ok:true,service:body.service,checks:Object.freeze({...body.checks})});
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

async function createMonitoringEvidence({env=process.env,fetchImpl=globalThis.fetch,now=Date.now()}={}){
  if(String(env.ROLLANDS_ENV||'').trim().toLowerCase()!=='staging'){
    throw monitoringError('Monitoreringsbevis får i denna fas endast skapas när ROLLANDS_ENV=staging.','STAGING_MONITORING_ENV_REQUIRED');
  }
  const evidencePath=path.resolve(required(env.ROLLANDS_MONITORING_EVIDENCE_PATH,'ROLLANDS_MONITORING_EVIDENCE_PATH',2));
  if(!outsideRepository(evidencePath)){
    throw monitoringError('ROLLANDS_MONITORING_EVIDENCE_PATH måste ligga utanför Git-repositoryt.','STAGING_MONITORING_EVIDENCE_PATH_UNSAFE');
  }
  const endpoint=normalizeEndpoint(env.ROLLANDS_MONITORING_ENDPOINT);
  const confirmation=alertConfirmationFromEnvironment(env,{now});
  await probeCoreReadiness(endpoint,{fetchImpl});
  const checkedAt=new Date(now).toISOString();
  const evidence=Object.freeze({
    schemaVersion:1,
    provider:confirmation.provider,
    endpoint,
    alertRoute:confirmation.alertRoute,
    checkedAt,
    alertTestedAt:confirmation.alertTestedAt,
    readinessProbeSucceeded:true,
    alertDeliverySucceeded:true,
    alertTestReference:confirmation.alertTestReference,
    alertObserver:confirmation.alertObserver
  });
  writeEvidence(evidencePath,evidence);
  return Object.freeze({verified:true,evidencePath,evidence});
}

async function main(){
  const result=await createMonitoringEvidence();
  process.stdout.write(JSON.stringify({
    verified:true,
    provider:result.evidence.provider,
    endpoint:result.evidence.endpoint,
    checkedAt:result.evidence.checkedAt,
    alertTestedAt:result.evidence.alertTestedAt,
    evidencePath:result.evidencePath
  })+'\n');
}

if(require.main===module){
  main().catch(error=>{
    console.error((error?.code||'STAGING_MONITORING_EVIDENCE_FAILED')+': '+(error?.message||String(error)));
    process.exitCode=1;
  });
}

module.exports=Object.freeze({
  PLACEHOLDER,
  MAX_ALERT_CONFIRMATION_AGE_MS,
  normalizeEndpoint,
  alertConfirmationFromEnvironment,
  probeCoreReadiness,
  writeEvidence,
  createMonitoringEvidence,
  main
});
