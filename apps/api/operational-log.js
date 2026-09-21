'use strict';

const crypto=require('node:crypto');

const SAFE_LEVELS=new Set(['info','warning','error']);
const SAFE_EVENTS=new Set(['http_request','service_started','request_handler_error']);

function routeClass(url){
  const path=String(url||'/').split('?')[0]||'/';
  if(path==='/api/v1/readiness/core')return'readiness-core';
  if(path==='/api/v1/readiness')return'readiness';
  if(path==='/_runtime-version')return'runtime-version';
  if(path.startsWith('/api/operator/v1/'))return'operator-api';
  if(path.startsWith('/api/v1/'))return'private-api';
  if(path.startsWith('/website-preview/'))return'website-preview';
  return'static';
}
function requestId(){return crypto.randomUUID()}
function safeStatus(value){const n=Number(value);return Number.isSafeInteger(n)&&n>=100&&n<=599?n:0}
function safeDuration(value){const n=Number(value);return Number.isFinite(n)&&n>=0?Math.ceil(n):0}
function safeCode(value){
  const code=String(value||'').trim().toUpperCase();
  return/^[A-Z0-9_]{2,80}$/.test(code)?code:'';
}
function record({level='info',event,timestamp=new Date().toISOString(),runtimeId='',requestId='',method='',route='',statusCode=0,durationMs=0,code=''}={}){
  const selectedLevel=SAFE_LEVELS.has(level)?level:'info';
  if(!SAFE_EVENTS.has(event))throw new Error('Invalid operational log event');
  const value={
    schemaVersion:1,
    timestamp:String(timestamp),
    service:'rollands-api-v1',
    level:selectedLevel,
    event
  };
  if(runtimeId)value.runtimeId=String(runtimeId);
  if(requestId)value.requestId=String(requestId);
  if(method)value.method=String(method).toUpperCase().slice(0,12);
  if(route)value.routeClass=String(route);
  const status=safeStatus(statusCode);if(status)value.statusCode=status;
  if(event==='http_request')value.durationMs=safeDuration(durationMs);
  const selectedCode=safeCode(code);if(selectedCode)value.code=selectedCode;
  return Object.freeze(value);
}
function createOperationalLogger({writer}={}){
  const selected=typeof writer==='function'?writer:null;
  function emit(input){
    if(!selected)return null;
    const value=record(input);
    try{selected(JSON.stringify(value)+'\n');}
    catch{return null}
    return value;
  }
  return Object.freeze({emit,enabled:Boolean(selected)});
}
function defaultWriter(env=process.env){
  const mode=String(env.ROLLANDS_ENV||'').trim().toLowerCase();
  const configured=String(env.ROLLANDS_STRUCTURED_LOGS||'').trim();
  if(configured==='0')return null;
  if(configured==='1'||['staging','pilot','production'].includes(mode)){
    return line=>process.stderr.write(line);
  }
  return null;
}

module.exports=Object.freeze({SAFE_LEVELS,SAFE_EVENTS,routeClass,requestId,safeCode,record,createOperationalLogger,defaultWriter});
