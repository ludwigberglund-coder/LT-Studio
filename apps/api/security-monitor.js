'use strict';

const DEFAULT_SCAN_INTERVAL_MS=30_000;
const MIN_SCAN_INTERVAL_MS=5_000;
const MAX_SCAN_INTERVAL_MS=300_000;

const READINESS_RULES=Object.freeze({
  databaseRead:{severity:'critical',category:'Databas',title:'Databasen kan inte läsas',message:'Plattformens databas klarar inte den aktiva läskontrollen.'},
  databaseWrite:{severity:'critical',category:'Databas',title:'Databasen kan inte skrivas',message:'Plattformens databas klarar inte den aktiva skrivkontrollen.'},
  diskSpace:{severity:'critical',category:'Drift',title:'För lite diskutrymme',message:'Tillgängligt diskutrymme ligger under den säkra driftgränsen.'},
  backup:{severity:'critical',category:'Backup',title:'Backupkontrollen är inte godkänd',message:'Senaste lokala backupen saknas, är för gammal eller kan inte verifieras.'},
  offsiteBackup:{severity:'critical',category:'Backup',title:'Offsite-backup är inte verifierad',message:'Säkerhetskopian utanför primärmiljön saknar färskt verifierat bevis.'},
  r2StagingAudit:{severity:'warning',category:'Lagring',title:'R2-audit behöver uppmärksamhet',message:'Den aktiva kontrollen av privat staginglagring är inte godkänd.'},
  restoreDrill:{severity:'critical',category:'Backup',title:'Restore-test är inte godkänt',message:'Systemet saknar ett färskt verifierat återställningstest.'},
  r2RestoreDrill:{severity:'warning',category:'Backup',title:'R2 restore-test behöver uppmärksamhet',message:'Återställningskontrollen för offsite-lagringen är inte godkänd.'},
  stagingEvidenceConsistent:{severity:'critical',category:'Drift',title:'Stagingbevis matchar inte',message:'Säkerhetsbevisen för staging pekar inte på samma verifierade data.'},
  monitoring:{severity:'critical',category:'Övervakning',title:'Extern övervakning är inte verifierad',message:'Readiness eller larmleverans saknar ett färskt godkänt övervakningsbevis.'},
  alertDelivery:{severity:'critical',category:'Övervakning',title:'Extern larmleverans är inte verifierad',message:'Säkerhetslarmens externa kanal saknar en färsk godkänd testleverans.'},
  auditAnchor:{severity:'critical',category:'Audit',title:'Auditankaret är inte verifierat',message:'Den skyddade revisionskedjan saknar ett färskt matchande auditbevis.'},
  platformAdmin:{severity:'critical',category:'Åtkomst',title:'LT Studio global admin är inte redo',message:'Det saknas en aktiv global LT Studio-admin med fungerande MFA.'}
});

function monitorError(message,code='SECURITY_MONITOR_ERROR'){
  const error=new Error(message);
  error.code=code;
  return error;
}
function normalizeInterval(value){
  const interval=Number(value??DEFAULT_SCAN_INTERVAL_MS);
  if(!Number.isSafeInteger(interval)||interval<MIN_SCAN_INTERVAL_MS||interval>MAX_SCAN_INTERVAL_MS){
    throw monitorError('Ogiltigt intervall för säkerhetsövervakning.','SECURITY_MONITOR_INVALID_INTERVAL');
  }
  return interval;
}
function finding({code,severity='warning',category='Säkerhet',title,message}){
  return Object.freeze({code:String(code),severity,category,title,message});
}
function counts(findings){
  const result={critical:0,warning:0,info:0,total:findings.length};
  for(const item of findings)if(Object.hasOwn(result,item.severity))result[item.severity]+=1;
  return Object.freeze(result);
}
function statusFor(summary){
  if(summary.critical>0)return 'critical';
  if(summary.warning>0)return 'attention';
  return 'healthy';
}
function scanSecurityState(db,{readinessProvider=()=>({ok:false,checks:{}}),nowMs=Date.now(),scanIntervalMs=DEFAULT_SCAN_INTERVAL_MS}={}){
  if(!db||typeof db.prepare!=='function')throw monitorError('Databas krävs för säkerhetsövervakning.','SECURITY_MONITOR_DATABASE_REQUIRED');
  const checkedAt=new Date(Number(nowMs)).toISOString();
  const findings=[];

  let readiness;
  try{readiness=readinessProvider()||{ok:false,checks:{}}}
  catch{readiness={ok:false,checks:{},providerFailed:true}}
  if(readiness.providerFailed){
    findings.push(finding({code:'READINESS_PROVIDER_FAILED',severity:'critical',category:'Övervakning',title:'Readiness-kontrollen kunde inte köras',message:'Säkerhetsmotorn kunde inte läsa plattformens tekniska hälsokontroller.'}));
  }
  const readinessChecks=readiness?.checks&&typeof readiness.checks==='object'?readiness.checks:{};
  let explicitReadinessFailures=0;
  for(const [key,rule] of Object.entries(READINESS_RULES)){
    if(readinessChecks[key]===false){
      explicitReadinessFailures+=1;
      findings.push(finding({code:'READINESS_'+key.toUpperCase(),...rule}));
    }
  }
  if(readiness?.ok===false&&!readiness.providerFailed&&explicitReadinessFailures===0){
    findings.push(finding({
      code:'READINESS_INCOMPLETE',
      severity:'critical',
      category:'Övervakning',
      title:'Readiness är inte godkänd',
      message:'Plattformens samlade readiness är underkänd utan en specificerad kontroll i monitorunderlaget.'
    }));
  }

  const activeUsers=Number(db.prepare(`SELECT COUNT(*) AS count FROM users u
    WHERE u.disabled=0
      AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id)`).get()?.count||0);
  const usersWithoutMfa=Number(db.prepare(`SELECT COUNT(*) AS count FROM users u
    WHERE u.disabled=0
      AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id)
      AND (u.mfa_secret_encrypted IS NULL OR trim(u.mfa_secret_encrypted)='')`).get()?.count||0);
  if(usersWithoutMfa>0){
    findings.push(finding({
      code:'CUSTOMER_MFA_GAP',
      severity:'warning',
      category:'Åtkomst',
      title:'Aktiva användare saknar MFA',
      message:`${usersWithoutMfa} av ${activeUsers} aktiva användare saknar konfigurerad MFA.`
    }));
  }

  const operatorsWithoutMfa=Number(db.prepare(`SELECT COUNT(*) AS count FROM platform_operators
    WHERE disabled=0 AND (mfa_secret_encrypted IS NULL OR trim(mfa_secret_encrypted)='')`).get()?.count||0);
  if(operatorsWithoutMfa>0){
    findings.push(finding({
      code:'OPERATOR_MFA_GAP',
      severity:'critical',
      category:'Åtkomst',
      title:'LT Studio-operatör saknar MFA',
      message:`${operatorsWithoutMfa} aktivt operatörskonto saknar MFA och måste åtgärdas.`
    }));
  }

  const nowIso=checkedAt;
  const loginRows=db.prepare(`SELECT failure_count AS failureCount FROM login_attempts
    WHERE reset_at>? AND failure_count>=3`).all(nowIso);
  const maxFailures=loginRows.reduce((max,row)=>Math.max(max,Number(row.failureCount||0)),0);
  if(loginRows.length){
    findings.push(finding({
      code:'ACTIVE_LOGIN_ATTACK',
      severity:maxFailures>=5?'critical':'warning',
      category:'Inloggning',
      title:maxFailures>=5?'Pågående upprepade inloggningsförsök':'Ovanligt många misslyckade inloggningar',
      message:`${loginRows.length} aktivt spärrfönster har minst tre misslyckade inloggningsförsök.`
    }));
  }

  const recentSince=new Date(Number(nowMs)-60*60*1000).toISOString();
  const recent=db.prepare(`SELECT severity,COUNT(*) AS count FROM security_events
    WHERE created_at>=? AND created_at<=?
    GROUP BY severity`).all(recentSince,nowIso);
  const eventCounts={critical:0,warning:0,info:0};
  for(const row of recent)if(Object.hasOwn(eventCounts,row.severity))eventCounts[row.severity]=Number(row.count||0);
  if(eventCounts.critical>0){
    findings.push(finding({
      code:'RECENT_CRITICAL_SECURITY_EVENTS',
      severity:'critical',
      category:'Säkerhetshändelser',
      title:'Kritiska säkerhetshändelser har registrerats',
      message:`${eventCounts.critical} kritisk${eventCounts.critical===1?'':'a'} säkerhetshändelse${eventCounts.critical===1?'':'r'} har registrerats den senaste timmen.`
    }));
  }else if(eventCounts.warning>0){
    findings.push(finding({
      code:'RECENT_WARNING_SECURITY_EVENTS',
      severity:'warning',
      category:'Säkerhetshändelser',
      title:'Nya säkerhetsvarningar har registrerats',
      message:`${eventCounts.warning} säkerhetsvarning${eventCounts.warning===1?'':'ar'} har registrerats den senaste timmen.`
    }));
  }

  const summary=counts(findings);
  return Object.freeze({
    active:true,
    status:statusFor(summary),
    checkedAt,
    scanIntervalSeconds:Math.round(Number(scanIntervalMs)/1000),
    counts:summary,
    findings:Object.freeze(findings),
    signals:Object.freeze({
      activeUsers,
      usersWithoutMfa,
      operatorsWithoutMfa,
      activeLoginWindows:loginRows.length,
      recentCriticalEvents:eventCounts.critical,
      recentWarningEvents:eventCounts.warning
    })
  });
}
function createSecurityMonitor({db,readinessProvider,scanIntervalMs=DEFAULT_SCAN_INTERVAL_MS,now=()=>Date.now(),autoStart=true}={}){
  const intervalMs=normalizeInterval(scanIntervalMs);
  let current=null,timer=null,scanCount=0;
  function refresh(){
    try{
      current=scanSecurityState(db,{readinessProvider,nowMs:now(),scanIntervalMs:intervalMs});
    }catch{
      const checkedAt=new Date(Number(now())).toISOString();
      const findings=[finding({code:'SECURITY_MONITOR_SCAN_FAILED',severity:'critical',category:'Övervakning',title:'Säkerhetsmotorn kunde inte slutföra skanningen',message:'Den aktiva säkerhetskontrollen misslyckades och behöver undersökas.'})];
      current=Object.freeze({active:false,status:'critical',checkedAt,scanIntervalSeconds:Math.round(intervalMs/1000),counts:counts(findings),findings:Object.freeze(findings),signals:Object.freeze({})});
    }
    scanCount+=1;
    return current;
  }
  function snapshot(){return current||refresh()}
  function start(){
    if(timer)return;
    refresh();
    timer=setInterval(refresh,intervalMs);
    if(typeof timer.unref==='function')timer.unref();
  }
  function stop(){if(timer){clearInterval(timer);timer=null}}
  if(autoStart)start();
  return Object.freeze({snapshot,refresh,start,stop,get scanCount(){return scanCount},scanIntervalMs:intervalMs});
}
module.exports=Object.freeze({
  DEFAULT_SCAN_INTERVAL_MS,
  MIN_SCAN_INTERVAL_MS,
  MAX_SCAN_INTERVAL_MS,
  READINESS_RULES,
  scanSecurityState,
  createSecurityMonitor
});
