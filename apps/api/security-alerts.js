'use strict';

const crypto=require('node:crypto');
const net=require('node:net');
const Db=require('./database.js');

const DEFAULT_COOLDOWN_MS=15*60*1000;
const DEFAULT_TIMEOUT_MS=5000;
const DEFAULT_RETRY_BASE_MS=30*1000;
const MAX_RETRY_MS=15*60*1000;
const DEFAULT_TEST_MAX_AGE_MS=7*24*60*60*1000;
const TEST_CODE='SECURITY_ALERT_TEST';

function alertError(message,code='SECURITY_ALERT_ERROR',statusCode=500){
  const error=new Error(message);
  error.code=code;
  error.statusCode=statusCode;
  return error;
}
function intSetting(env,name,fallback,{min,max}){
  const raw=env?.[name];
  if(raw===undefined||raw==='')return fallback;
  const value=Number(raw);
  if(!Number.isSafeInteger(value)||value<min||value>max)throw alertError(name+' har ett ogiltigt värde.','SECURITY_ALERT_INVALID_CONFIGURATION',500);
  return value;
}
function cleanText(value,max){
  return String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
function privateIpLiteral(hostname){
  const host=String(hostname||'').replace(/^\[|\]$/g,'').toLowerCase();
  const family=net.isIP(host);
  if(family===4){
    const parts=host.split('.').map(Number);
    const [a,b]=parts;
    return a===0||a===10||a===127||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||
      (a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===198&&(b===18||b===19))||a>=224;
  }
  if(family===6){
    const compact=host.replace(/^0+(?=[0-9a-f])/,'');
    return host==='::'||host==='::1'||/^f[cd][0-9a-f]{2}:/i.test(host)||/^fe[89ab][0-9a-f]:/i.test(host)||/^ff/i.test(compact);
  }
  return false;
}
function localHostname(hostname){
  const host=String(hostname||'').replace(/^\[|\]$/g,'').toLowerCase().replace(/\.$/,'');
  return host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.home.arpa');
}
function parseWebhookUrl(raw){
  const value=String(raw||'').trim();
  if(!value)return null;
  let parsed;
  try{parsed=new URL(value)}catch{throw alertError('Webhook-adressen för säkerhetslarm är ogiltig.','SECURITY_ALERT_INVALID_WEBHOOK_URL',500)}
  const host=parsed.hostname.toLowerCase();
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash||!host||privateIpLiteral(host)||localHostname(host)){
    throw alertError('Webhook-adressen för säkerhetslarm måste vara en extern HTTPS-adress utan inbyggda inloggningsuppgifter eller lokal nätverksdestination.','SECURITY_ALERT_INVALID_WEBHOOK_URL',500);
  }
  return parsed.toString();
}
function fingerprint(code,severity){
  return crypto.createHash('sha256').update('lt-studio-security-alert-v1|'+code+'|'+severity).digest('hex');
}
function safeFinding(value){
  const code=cleanText(value?.code,100);
  const severity=cleanText(value?.severity,20);
  if(!/^[A-Z0-9_:-]+$/.test(code)||!['warning','critical'].includes(severity))return null;
  return Object.freeze({
    code,
    severity,
    category:cleanText(value?.category||'Säkerhet',100)||'Säkerhet',
    title:cleanText(value?.title||'Säkerhetsvarning',180)||'Säkerhetsvarning'
  });
}
function toIso(ms){return new Date(Number(ms)).toISOString()}
function parseTime(value){
  const parsed=Date.parse(String(value||''));
  return Number.isFinite(parsed)?parsed:null;
}
function createSecurityAlertService({db,env=process.env,fetchImpl=globalThis.fetch,now=()=>Date.now()}={}){
  if(!db||typeof db.prepare!=='function')throw alertError('Databas krävs för säkerhetslarm.','SECURITY_ALERT_DATABASE_REQUIRED',500);
  const webhookUrl=parseWebhookUrl(env.ROLLANDS_SECURITY_ALERT_WEBHOOK_URL);
  const token=String(env.ROLLANDS_SECURITY_ALERT_WEBHOOK_TOKEN||'');
  const cooldownMs=intSetting(env,'ROLLANDS_SECURITY_ALERT_COOLDOWN_SECONDS',Math.round(DEFAULT_COOLDOWN_MS/1000),{min:60,max:86400})*1000;
  const timeoutMs=intSetting(env,'ROLLANDS_SECURITY_ALERT_TIMEOUT_MS',DEFAULT_TIMEOUT_MS,{min:1000,max:30000});
  const retryBaseMs=intSetting(env,'ROLLANDS_SECURITY_ALERT_RETRY_BASE_SECONDS',Math.round(DEFAULT_RETRY_BASE_MS/1000),{min:10,max:900})*1000;
  const testMaxAgeMs=intSetting(env,'ROLLANDS_SECURITY_ALERT_TEST_MAX_AGE_HOURS',Math.round(DEFAULT_TEST_MAX_AGE_MS/3600000),{min:1,max:24*30})*3600000;
  if(webhookUrl&&typeof fetchImpl!=='function')throw alertError('HTTP-klient saknas för säkerhetslarm.','SECURITY_ALERT_FETCH_UNAVAILABLE',500);

  const testFingerprint=fingerprint(TEST_CODE,'info');
  let timer=null;
  let running=null;

  function rowByFingerprint(hash){
    return db.prepare(`SELECT fingerprint_hash AS fingerprintHash,code,severity,category,title,active,last_status AS lastStatus,
      last_attempt_at AS lastAttemptAt,last_delivered_at AS lastDeliveredAt,next_retry_at AS nextRetryAt,
      consecutive_failures AS consecutiveFailures,is_test AS isTest,updated_at AS updatedAt
      FROM security_alert_states WHERE fingerprint_hash=?`).get(hash)||null;
  }
  function latestAttempt(){
    return db.prepare(`SELECT last_status AS lastStatus,last_attempt_at AS lastAttemptAt,last_delivered_at AS lastDeliveredAt,is_test AS isTest
      FROM security_alert_states WHERE last_attempt_at IS NOT NULL
      ORDER BY last_attempt_at DESC,fingerprint_hash DESC LIMIT 1`).get()||null;
  }
  function status(){
    const test=rowByFingerprint(testFingerprint);
    const latest=latestAttempt();
    return Object.freeze({
      configured:Boolean(webhookUrl),
      channel:'webhook',
      lastTestAt:test?.lastAttemptAt||null,
      lastTestSucceeded:test?.lastStatus==='delivered',
      lastDeliveryAt:latest?.lastDeliveredAt||latest?.lastAttemptAt||null,
      lastDeliveryStatus:latest?.lastStatus||null
    });
  }
  function readiness(){
    const current=status();
    const testAt=parseTime(current.lastTestAt);
    const ageMs=testAt===null?null:Math.max(0,Number(now())-testAt);
    return Object.freeze({
      ...current,
      ok:Boolean(current.configured&&current.lastTestSucceeded&&ageMs!==null&&ageMs<=testMaxAgeMs),
      testAgeMs:ageMs
    });
  }
  function syncSnapshot(snapshot){
    const checkedAt=Number(now());
    const checkedAtIso=toIso(checkedAt);
    const findings=(Array.isArray(snapshot?.findings)?snapshot.findings:[]).map(safeFinding).filter(Boolean);
    const wanted=new Map(findings.map(item=>[fingerprint(item.code,item.severity),item]));
    Db.transaction(db,()=>{
      const existing=db.prepare(`SELECT fingerprint_hash AS fingerprintHash,active,last_status AS lastStatus,last_delivered_at AS lastDeliveredAt
        FROM security_alert_states WHERE is_test=0`).all();
      const byHash=new Map(existing.map(row=>[row.fingerprintHash,row]));
      for(const row of existing){
        if(row.active&&!wanted.has(row.fingerprintHash)){
          db.prepare('UPDATE security_alert_states SET active=0,updated_at=? WHERE fingerprint_hash=?').run(checkedAtIso,row.fingerprintHash);
        }
      }
      for(const [hash,item] of wanted){
        const previous=byHash.get(hash);
        if(!previous){
          db.prepare(`INSERT INTO security_alert_states(
            fingerprint_hash,code,severity,category,title,active,last_status,last_attempt_at,last_delivered_at,next_retry_at,consecutive_failures,is_test,updated_at
          ) VALUES(?,?,?,?,?,1,'pending',NULL,NULL,NULL,0,0,?)`)
            .run(hash,item.code,item.severity,item.category,item.title,checkedAtIso);
          continue;
        }
        if(Number(previous.active)===1){
          db.prepare(`UPDATE security_alert_states SET code=?,severity=?,category=?,title=?,active=1,updated_at=? WHERE fingerprint_hash=?`)
            .run(item.code,item.severity,item.category,item.title,checkedAtIso,hash);
          continue;
        }
        const lastDelivered=parseTime(previous.lastDeliveredAt);
        const withinCooldown=lastDelivered!==null&&checkedAt-lastDelivered<cooldownMs;
        db.prepare(`UPDATE security_alert_states SET code=?,severity=?,category=?,title=?,active=1,last_status=?,
          last_attempt_at=CASE WHEN ?='pending' THEN NULL ELSE last_attempt_at END,
          next_retry_at=NULL,consecutive_failures=0,updated_at=? WHERE fingerprint_hash=?`)
          .run(item.code,item.severity,item.category,item.title,withinCooldown?'delivered':'pending',withinCooldown?'delivered':'pending',checkedAtIso,hash);
      }
    });
  }
  function classifyFailure(error,response){
    if(response){
      const status=Number(response.status)||0;
      return {errorCode:status>=500?'WEBHOOK_HTTP_5XX':'WEBHOOK_HTTP_4XX',httpStatus:status};
    }
    if(error?.name==='AbortError')return{errorCode:'WEBHOOK_TIMEOUT',httpStatus:null};
    return{errorCode:'WEBHOOK_NETWORK_ERROR',httpStatus:null};
  }
  async function attempt(row,{operatorId=null,test=false}={}){
    if(!webhookUrl)throw alertError('Extern larmkanal är inte konfigurerad.','SECURITY_ALERT_NOT_CONFIGURED',503);
    const attemptMs=Number(now());
    const attemptAt=toIso(attemptMs);
    const payload=Object.freeze({
      schemaVersion:1,
      source:'lt-studio-security',
      type:test?'security-alert-test':'security-alert',
      test:Boolean(test),
      code:row.code,
      severity:row.severity,
      category:row.category,
      title:row.title,
      observedAt:attemptAt
    });
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    if(typeof timeout.unref==='function')timeout.unref();
    let response=null,error=null;
    try{
      const headers={'Content-Type':'application/json','Accept':'application/json','User-Agent':'LT-Studio-Security-Alerts/1'};
      if(token)headers.Authorization='Bearer '+token;
      response=await fetchImpl(webhookUrl,{method:'POST',headers,body:JSON.stringify(payload),signal:controller.signal,redirect:'error'});
      if(!response||response.ok!==true)throw alertError('Webhook svarade inte med godkänd status.','SECURITY_ALERT_WEBHOOK_REJECTED',502);
    }catch(caught){error=caught}
    finally{clearTimeout(timeout)}

    if(!error){
      Db.transaction(db,()=>{
        db.prepare(`UPDATE security_alert_states SET last_status='delivered',last_attempt_at=?,last_delivered_at=?,next_retry_at=NULL,
          consecutive_failures=0,updated_at=? WHERE fingerprint_hash=?`).run(attemptAt,attemptAt,attemptAt,row.fingerprintHash);
        Db.appendPlatformOperatorAudit(db,{operatorId,action:'SECURITY_ALERT_DELIVERY_SUCCEEDED',details:{
          channel:'webhook',code:row.code,severity:row.severity,test:Boolean(test),result:'delivered',httpStatus:Number(response.status)||200
        }});
      });
      return Object.freeze({ok:true,httpStatus:Number(response.status)||200});
    }

    const failure=classifyFailure(error,response);
    const previousFailures=Math.max(0,Number(row.consecutiveFailures||0));
    const failures=previousFailures+1;
    const retryMs=Math.min(MAX_RETRY_MS,retryBaseMs*(2**Math.min(5,failures-1)));
    const nextRetryAt=toIso(attemptMs+retryMs);
    Db.transaction(db,()=>{
      db.prepare(`UPDATE security_alert_states SET last_status='failed',last_attempt_at=?,next_retry_at=?,consecutive_failures=?,updated_at=?
        WHERE fingerprint_hash=?`).run(attemptAt,nextRetryAt,failures,attemptAt,row.fingerprintHash);
      Db.appendPlatformOperatorAudit(db,{operatorId,action:'SECURITY_ALERT_DELIVERY_FAILED',details:{
        channel:'webhook',code:row.code,severity:row.severity,test:Boolean(test),result:'failed',httpStatus:failure.httpStatus,errorCode:failure.errorCode
      }});
    });
    return Object.freeze({ok:false,httpStatus:failure.httpStatus,errorCode:failure.errorCode,nextRetryAt});
  }
  async function drain(){
    if(!webhookUrl)return Object.freeze({attempted:0,succeeded:0,failed:0});
    const nowIso=toIso(now());
    const rows=db.prepare(`SELECT fingerprint_hash AS fingerprintHash,code,severity,category,title,active,last_status AS lastStatus,
      last_attempt_at AS lastAttemptAt,last_delivered_at AS lastDeliveredAt,next_retry_at AS nextRetryAt,
      consecutive_failures AS consecutiveFailures,is_test AS isTest,updated_at AS updatedAt
      FROM security_alert_states
      WHERE is_test=0 AND active=1 AND (
        last_status='pending' OR (last_status='failed' AND (next_retry_at IS NULL OR next_retry_at<=?))
      )
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,updated_at
      LIMIT 20`).all(nowIso);
    let succeeded=0,failed=0;
    for(const row of rows){
      const result=await attempt(row);
      if(result.ok)succeeded+=1;else failed+=1;
    }
    return Object.freeze({attempted:rows.length,succeeded,failed});
  }
  async function dispatchSnapshot(snapshot){
    if(running)return running;
    running=(async()=>{syncSnapshot(snapshot);return drain()})();
    try{return await running}finally{running=null}
  }
  async function test({operatorId=null}={}){
    if(!webhookUrl)throw alertError('Extern larmkanal är inte konfigurerad.','SECURITY_ALERT_NOT_CONFIGURED',503);
    const updatedAt=toIso(now());
    Db.transaction(db,()=>{
      db.prepare(`INSERT INTO security_alert_states(
        fingerprint_hash,code,severity,category,title,active,last_status,last_attempt_at,last_delivered_at,next_retry_at,consecutive_failures,is_test,updated_at
      ) VALUES(?,?,?,?,?,0,'pending',NULL,NULL,NULL,0,1,?)
      ON CONFLICT(fingerprint_hash) DO UPDATE SET code=excluded.code,severity=excluded.severity,category=excluded.category,title=excluded.title,
        active=0,last_status='pending',next_retry_at=NULL,consecutive_failures=0,is_test=1,updated_at=excluded.updated_at`)
        .run(testFingerprint,TEST_CODE,'info','Övervakning','Testlarm från LT Studio',updatedAt);
    });
    return attempt(rowByFingerprint(testFingerprint),{operatorId,test:true});
  }
  function start({snapshotProvider,intervalMs=30000}={}){
    if(typeof snapshotProvider!=='function')throw alertError('Snapshot-provider krävs för säkerhetslarm.','SECURITY_ALERT_SNAPSHOT_PROVIDER_REQUIRED',500);
    const safeInterval=Number(intervalMs);
    if(!Number.isSafeInteger(safeInterval)||safeInterval<5000||safeInterval>300000)throw alertError('Ogiltigt intervall för säkerhetslarm.','SECURITY_ALERT_INVALID_INTERVAL',500);
    if(timer)return;
    const tick=()=>{
      try{Promise.resolve(dispatchSnapshot(snapshotProvider())).catch(()=>{})}catch{}
    };
    tick();
    timer=setInterval(tick,safeInterval);
    if(typeof timer.unref==='function')timer.unref();
  }
  function stop(){if(timer){clearInterval(timer);timer=null}}

  return Object.freeze({configured:Boolean(webhookUrl),channel:'webhook',status,readiness,dispatchSnapshot,test,start,stop});
}

module.exports=Object.freeze({
  DEFAULT_COOLDOWN_MS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_TEST_MAX_AGE_MS,
  createSecurityAlertService,
  privateIpLiteral,
  localHostname,
  parseWebhookUrl
});
