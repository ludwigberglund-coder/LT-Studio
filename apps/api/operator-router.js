'use strict';

const crypto=require('node:crypto');
const Auth=require('./auth.js');
const OperatorAuth=require('./operator-auth.js');
const Db=require('./database.js');
const RequestSecurity=require('./request-security.js');
const {platformOverview}=require('./platform-overview.js');

const BODY_LIMIT=64*1024;

function operatorError(message,code='OPERATOR_API_ERROR',statusCode=400){
  const error=new Error(message);error.code=code;error.statusCode=statusCode;return error;
}
function securityHeaders(){
  return {
    'Cache-Control':'no-store',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Cross-Origin-Opener-Policy':'same-origin',
    'Cross-Origin-Resource-Policy':'same-origin',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY'
  };
}
function send(res,status,body,extraHeaders={}){
  if(res.writableEnded)return;
  res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8',...extraHeaders});
  res.end(JSON.stringify(body));
}
function readJson(req,res){
  return new Promise((resolve,reject)=>{
    const contentType=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
    if(contentType!=='application/json'){
      send(res,415,{error:'Operator-API som ändrar data måste använda application/json.',code:'UNSUPPORTED_MEDIA_TYPE'});
      return resolve(null);
    }
    const declared=Number(req.headers['content-length']||0);
    if(Number.isFinite(declared)&&declared>BODY_LIMIT){
      send(res,413,{error:'Begäran är för stor.',code:'BODY_TOO_LARGE'});req.resume();return resolve(null);
    }
    const chunks=[];let size=0;
    req.on('data',chunk=>{
      size+=chunk.length;
      if(size>BODY_LIMIT){
        if(!res.writableEnded)send(res,413,{error:'Begäran är för stor.',code:'BODY_TOO_LARGE'});
        chunks.length=0;req.destroy();return;
      }
      chunks.push(chunk);
    });
    req.on('end',()=>{
      if(res.writableEnded)return resolve(null);
      try{
        const value=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};
        if(!value||typeof value!=='object'||Array.isArray(value))throw operatorError('JSON-innehållet måste vara ett objekt.','INVALID_JSON',400);
        resolve(RequestSecurity.validateJsonInput(req,value));
      }catch(error){reject(error)}
    });
    req.on('error',reject);
  });
}
function base32Encode(buffer){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits='',output='';
  for(const byte of buffer)bits+=byte.toString(2).padStart(8,'0');
  for(let index=0;index<bits.length;index+=5){
    const chunk=bits.slice(index,index+5).padEnd(5,'0');
    output+=alphabet[parseInt(chunk,2)];
  }
  return output;
}
function companyAdminDetail(db,companyId){
  const company=Db.companyById(db,companyId);
  if(!company)throw operatorError('Kundföretaget hittades inte.','COMPANY_NOT_FOUND',404);
  const now=new Date().toISOString();
  const stats=db.prepare(`SELECT
    (SELECT COUNT(*) FROM memberships WHERE company_id=?) AS memberCount,
    (SELECT COUNT(*) FROM sessions WHERE company_id=? AND expires_at>? AND absolute_expires_at>?) AS activeSessionCount,
    (SELECT COUNT(*) FROM customers WHERE company_id=?) AS customerRecordCount,
    (SELECT COUNT(*) FROM invoices WHERE company_id=?) AS invoiceRecordCount,
    (SELECT MAX(created_at) FROM audit_events WHERE company_id=?) AS lastActivityAt`).get(companyId,companyId,now,now,companyId,companyId,companyId);
  const platformAdmins=db.prepare(`SELECT id AS userId,username,display_name AS displayName,disabled,
    mfa_secret_encrypted AS mfaSecretEncrypted,created_at AS createdAt
    FROM users WHERE platform_admin=1 ORDER BY disabled,display_name,username,id`).all().map(admin=>({
      userId:admin.userId,
      username:admin.username,
      displayName:admin.displayName,
      disabled:Boolean(admin.disabled),
      mfaConfigured:Boolean(String(admin.mfaSecretEncrypted||'').trim()),
      createdAt:admin.createdAt
    }));
  return {
    company,
    stats:{
      memberCount:Number(stats.memberCount||0),
      activeSessionCount:Number(stats.activeSessionCount||0),
      customerRecordCount:Number(stats.customerRecordCount||0),
      invoiceRecordCount:Number(stats.invoiceRecordCount||0),
      lastActivityAt:stats.lastActivityAt||null,
      activePlatformAdminCount:platformAdmins.filter(admin=>!admin.disabled&&admin.mfaConfigured).length
    },
    members:Db.membershipsForCompany(db,companyId).map(member=>({
      userId:member.userId,username:member.username,displayName:member.displayName,role:member.role,
      disabled:Boolean(member.disabled),platformAdmin:Boolean(member.platformAdmin),createdAt:member.createdAt
    })),
    platformAdmins,
    roles:[
      {id:'admin',label:'Admin'},
      {id:'accountant',label:'Ekonom'},
      {id:'approver',label:'Attestant'},
      {id:'readonly',label:'Läsbehörighet'}
    ]
  };
}
function createOperatorRouter(options={}){
  const db=options.db;
  if(!db)throw new Error('Databas krävs för operator-API.');
  const secureCookies=options.secureCookies!==false;
  const authEncryptionKey=String(options.authEncryptionKey||'');
  const sessionIdleMinutes=Number(options.sessionIdleMinutes||15);
  const sessionMaxMinutes=Number(options.sessionMaxMinutes||120);
  const readinessProvider=typeof options.readinessProvider==='function'?options.readinessProvider:()=>({ok:false,error:'Readiness-provider saknas.'});
  const securityMonitor=options.securityMonitor&&typeof options.securityMonitor.refresh==='function'?options.securityMonitor:null;
  const requestIp=typeof options.clientIp==='function'?options.clientIp:(req=>req.socket?.remoteAddress||'unknown');
  if(!Number.isSafeInteger(sessionIdleMinutes)||sessionIdleMinutes<5||!Number.isSafeInteger(sessionMaxMinutes)||sessionMaxMinutes<sessionIdleMinutes||sessionMaxMinutes>24*60){
    throw new Error('Ogiltiga operatörssessionstider.');
  }

  function expiryIso(minutes,fromMs=Date.now()){return new Date(fromMs+minutes*60*1000).toISOString()}
  function loginKey(req,username){
    const identity=`${requestIp(req)}|${String(username||'').toLocaleLowerCase('sv')}`;
    return crypto.createHash('sha256').update('lt-operator-login-v1|'+identity).digest('hex');
  }
  function loginAccountKey(username){
    const identity=String(username||'').toLocaleLowerCase('sv');
    return crypto.createHash('sha256').update('lt-operator-login-account-v1|'+identity).digest('hex');
  }
  function loginBlocked(req,username){
    const scoped=Db.loginAttemptState(db,{keyHash:loginKey(req,username)});
    const account=Db.loginAttemptState(db,{keyHash:loginAccountKey(username)});
    return Boolean((scoped&&scoped.failureCount>=5)||(account&&account.failureCount>=10));
  }
  function noteLoginFailure(req,username){
    const scopedKeyHash=loginKey(req,username),accountKeyHash=loginAccountKey(username);
    let scopedState,accountState;
    Db.transaction(db,()=>{
      scopedState=Db.noteLoginFailure(db,{keyHash:scopedKeyHash,windowMinutes:15});
      accountState=Db.noteLoginFailure(db,{keyHash:accountKeyHash,windowMinutes:15});
      if(scopedState.failureCount===5)Db.appendSecurityEvent(db,{
        kind:'OPERATOR_LOGIN_FAILURE_THRESHOLD',
        severity:'critical',
        fingerprintHash:scopedKeyHash,
        details:{scope:'ip-user',failureCount:scopedState.failureCount,windowMinutes:15,retryAfterSeconds:900}
      });
      if(accountState.failureCount===10)Db.appendSecurityEvent(db,{
        kind:'OPERATOR_ACCOUNT_LOGIN_FAILURE_THRESHOLD',
        severity:'critical',
        fingerprintHash:accountKeyHash,
        details:{scope:'user',failureCount:accountState.failureCount,windowMinutes:15,retryAfterSeconds:900}
      });
    });
    return{scopedState,accountState};
  }
  function currentSession(req){
    const token=OperatorAuth.operatorTokenFromRequest(req);
    if(!token)return null;
    const tokenHash=Auth.hashToken(token);
    const session=Db.platformOperatorSessionByTokenHash(db,tokenHash);
    if(!session||session.disabled)return null;
    session.tokenHash=tokenHash;
    return session;
  }
  function requireSession(req){
    const session=currentSession(req);
    if(!session)throw operatorError('LT Studio-operatörsinloggning krävs.','OPERATOR_AUTH_REQUIRED',401);
    return session;
  }
  function requireCsrf(req,session){
    const supplied=String(req.headers['x-csrf-token']||'');
    if(!supplied||!Auth.safeEqualText(Auth.hashToken(supplied),session.csrfHash))throw operatorError('Operatörens säkerhetskontroll misslyckades.','OPERATOR_CSRF_FAILED',403);
  }
  async function login(req,res){
    const payload=await readJson(req,res);if(!payload)return;
    const username=Auth.normalizeUsername(payload.username);
    if(loginBlocked(req,username))return send(res,429,{error:'För många felaktiga operatörsinloggningar. Vänta 15 minuter.',code:'OPERATOR_LOGIN_RATE_LIMITED'},{'Retry-After':'900'});
    const operator=Db.platformOperatorByUsername(db,username);
    const valid=Boolean(operator&&!operator.disabled&&Auth.verifyPassword(payload.password,operator.passwordHash));
    if(!valid){noteLoginFailure(req,username);return send(res,401,{error:'Användarnamn eller lösenord är fel.',code:'OPERATOR_INVALID_CREDENTIALS'})}
    if(!authEncryptionKey)return send(res,503,{error:'Operatörs-MFA kan inte verifieras eftersom serverns krypteringsnyckel saknas.',code:'OPERATOR_MFA_SERVER_NOT_CONFIGURED'});
    let secret;
    try{secret=Auth.decryptSecret(operator.mfaSecretEncrypted,authEncryptionKey)}
    catch{return send(res,503,{error:'Operatörens MFA-konfiguration kan inte läsas.',code:'OPERATOR_MFA_SERVER_ERROR'})}
    const mfaCounter=Auth.totpMatchCounter(secret,payload.totp);
    if(mfaCounter===null){noteLoginFailure(req,username);return send(res,401,{error:'MFA-koden är felaktig eller har gått ut.',code:'OPERATOR_INVALID_MFA'})}

    const upgradedPasswordHash=Auth.passwordHashNeedsUpgrade(operator.passwordHash)?Auth.hashPassword(payload.password):'';
    const now=Date.now(),sessionToken=Auth.randomToken(32),csrfToken=Auth.randomToken(24);
    Db.transaction(db,()=>{
      Db.consumePlatformOperatorMfaStep(db,{operatorId:operator.id,totpCounter:mfaCounter});
      if(upgradedPasswordHash) Db.updatePlatformOperatorPasswordHash(db,{operatorId:operator.id,passwordHash:upgradedPasswordHash});
      Db.createPlatformOperatorSession(db,{
        tokenHash:Auth.hashToken(sessionToken),csrfHash:Auth.hashToken(csrfToken),operatorId:operator.id,
        expiresAt:expiryIso(sessionIdleMinutes,now),absoluteExpiresAt:expiryIso(sessionMaxMinutes,now)
      });
      Db.appendPlatformOperatorAudit(db,{operatorId:operator.id,action:'OPERATOR_SESSION_LOGIN',details:{sessionIdleMinutes,sessionMaxMinutes,mfaRequired:true,passwordHashUpgraded:Boolean(upgradedPasswordHash)}});
    });
    Db.clearLoginAttempts(db,loginKey(req,username));
    Db.clearLoginAttempts(db,loginAccountKey(username));
    return send(res,200,{authenticated:true,csrfToken,operator:{id:operator.id,username:operator.username,displayName:operator.displayName}},
      {'Set-Cookie':OperatorAuth.operatorSessionCookie(sessionToken,{secure:secureCookies,maxAgeSeconds:sessionMaxMinutes*60})});
  }
  async function handle(req,res){
    let url;
    try{url=new URL(req.url,'http://localhost')}
    catch{return send(res,400,{error:'Ogiltig adress.',code:'INVALID_URL'})}
    if(!url.pathname.startsWith('/api/operator/v1/'))return false;
    res.setHeader('X-Request-Id',crypto.randomUUID());
    try{
      if(req.method==='GET'&&url.pathname==='/api/operator/v1/health')return send(res,200,{ok:true,service:'lt-operator-api-v1'}),true;
      if(req.method==='POST'&&url.pathname==='/api/operator/v1/auth/login'){await login(req,res);return true}
      if(req.method==='GET'&&url.pathname==='/api/operator/v1/session'){
        const session=currentSession(req);
        if(!session){send(res,200,{authenticated:false});return true}
        Db.touchPlatformOperatorSession(db,session.tokenHash,expiryIso(sessionIdleMinutes));
        send(res,200,{authenticated:true,operator:{id:session.operatorId,username:session.username,displayName:session.displayName}});return true;
      }

      const session=requireSession(req);
      if(req.method!=='GET')requireCsrf(req,session);
      Db.touchPlatformOperatorSession(db,session.tokenHash,expiryIso(sessionIdleMinutes));

      if(req.method==='POST'&&url.pathname==='/api/operator/v1/auth/logout'){
        Db.transaction(db,()=>{
          Db.deletePlatformOperatorSession(db,session.tokenHash);
          Db.appendPlatformOperatorAudit(db,{operatorId:session.operatorId,action:'OPERATOR_SESSION_LOGOUT',details:{}});
        });
        send(res,200,{authenticated:false},{'Set-Cookie':OperatorAuth.clearOperatorSessionCookie({secure:secureCookies})});return true;
      }
      if(req.method==='GET'&&url.pathname==='/api/operator/v1/overview'){
        send(res,200,platformOverview(db));return true;
      }
      const companyMatch=url.pathname.match(/^\/api\/operator\/v1\/companies\/([^/]+)$/);
      if(req.method==='GET'&&companyMatch){
        send(res,200,companyAdminDetail(db,decodeURIComponent(companyMatch[1])));return true;
      }
      const companyUsersMatch=url.pathname.match(/^\/api\/operator\/v1\/companies\/([^/]+)\/users$/);
      if(req.method==='POST'&&companyUsersMatch){
        const companyId=decodeURIComponent(companyUsersMatch[1]);
        if(!Db.companyById(db,companyId))throw operatorError('Kundföretaget hittades inte.','COMPANY_NOT_FOUND',404);
        const payload=await readJson(req,res);if(!payload)return true;
        const username=Auth.normalizeUsername(payload.username);
        const role=Db.membershipRole(payload.role||'readonly');
        const existing=Db.userByUsername(db,username);
        if(existing){
          if(existing.disabled)throw operatorError('Det befintliga användarkontot är inaktiverat. Aktivera kontot innan det kopplas till fler företag.','USER_DISABLED',409);
          if(Db.membership(db,companyId,existing.id))throw operatorError('Användaren har redan åtkomst till kundföretaget.','MEMBERSHIP_EXISTS',409);
          Db.transaction(db,()=>{
            Db.addMembership(db,{companyId,userId:existing.id,role});
            Db.appendPlatformOperatorAudit(db,{operatorId:session.operatorId,action:'CUSTOMER_EXISTING_USER_ADDED',details:{companyId,userId:existing.id,role}});
          });
          send(res,201,{created:false,linkedExisting:true,userId:existing.id,username:existing.username,displayName:existing.displayName,role,mfaSecret:null});return true;
        }
        const displayName=String(payload.displayName||'').trim();
        if(displayName.length<2||displayName.length>120)throw operatorError('Användarens namn måste vara 2–120 tecken.','INVALID_DISPLAY_NAME',422);
        const mfaSecret=base32Encode(crypto.randomBytes(20));
        const userId=Db.transaction(db,()=>{
          const user=Db.createUser(db,{
            username,displayName,passwordHash:Auth.hashPassword(payload.password),
            mfaSecretEncrypted:Auth.encryptSecret(mfaSecret,authEncryptionKey)
          });
          Db.addMembership(db,{companyId,userId:user.id,role});
          Db.appendPlatformOperatorAudit(db,{operatorId:session.operatorId,action:'CUSTOMER_USER_CREATED',details:{companyId,userId:user.id,role}});
          return user.id;
        });
        send(res,201,{created:true,linkedExisting:false,userId,username,displayName,role,mfaSecret});return true;
      }
      const memberRoleMatch=url.pathname.match(/^\/api\/operator\/v1\/companies\/([^/]+)\/users\/([^/]+)\/role$/);
      if(req.method==='PUT'&&memberRoleMatch){
        const companyId=decodeURIComponent(memberRoleMatch[1]),userId=decodeURIComponent(memberRoleMatch[2]);
        const before=Db.membership(db,companyId,userId);
        if(!before)throw operatorError('Användaren finns inte i kundföretaget.','MEMBERSHIP_NOT_FOUND',404);
        const payload=await readJson(req,res);if(!payload)return true;
        let revokedSessionCount=0;
        const updated=Db.transaction(db,()=>{
          const membership=Db.setMembershipRole(db,{companyId,userId,role:payload.role});
          revokedSessionCount=Db.deleteSessionsForUserCompany(db,{userId,companyId});
          Db.appendPlatformOperatorAudit(db,{operatorId:session.operatorId,action:'CUSTOMER_USER_ROLE_CHANGED',details:{companyId,userId,before:before.role,after:membership.role,revokedSessionCount}});
          return membership;
        });
        send(res,200,{membership:updated,sessionsRevoked:true,revokedSessionCount,sessionScope:'company'});return true;
      }
      const memberPasswordMatch=url.pathname.match(/^\/api\/operator\/v1\/companies\/([^/]+)\/users\/([^/]+)\/password$/);
      if(req.method==='PUT'&&memberPasswordMatch){
        const companyId=decodeURIComponent(memberPasswordMatch[1]),userId=decodeURIComponent(memberPasswordMatch[2]);
        if(!Db.membership(db,companyId,userId))throw operatorError('Användaren finns inte i kundföretaget.','MEMBERSHIP_NOT_FOUND',404);
        const payload=await readJson(req,res);if(!payload)return true;
        Db.transaction(db,()=>{
          Db.updateUserPasswordHash(db,{userId,passwordHash:Auth.hashPassword(payload.password)});
          Db.deleteSessionsForUser(db,userId);
          Db.appendPlatformOperatorAudit(db,{operatorId:session.operatorId,action:'CUSTOMER_USER_PASSWORD_RESET',details:{companyId,userId}});
        });
        send(res,200,{saved:true,sessionsRevoked:true});return true;
      }
      const memberDeleteMatch=url.pathname.match(/^\/api\/operator\/v1\/companies\/([^/]+)\/users\/([^/]+)$/);
      if(req.method==='DELETE'&&memberDeleteMatch){
        const companyId=decodeURIComponent(memberDeleteMatch[1]),userId=decodeURIComponent(memberDeleteMatch[2]);
        const before=Db.membership(db,companyId,userId);
        if(!before)throw operatorError('Användaren finns inte i kundföretaget.','MEMBERSHIP_NOT_FOUND',404);
        let revokedSessionCount=0;
        Db.transaction(db,()=>{
          revokedSessionCount=Db.deleteSessionsForUserCompany(db,{userId,companyId});
          db.prepare('DELETE FROM memberships WHERE company_id=? AND user_id=?').run(companyId,userId);
          Db.appendPlatformOperatorAudit(db,{operatorId:session.operatorId,action:'CUSTOMER_USER_REMOVED',details:{companyId,userId,role:before.role,revokedSessionCount}});
        });
        send(res,200,{removed:true,sessionsRevoked:true,revokedSessionCount,sessionScope:'company'});return true;
      }
      if(req.method==='GET'&&url.pathname==='/api/operator/v1/readiness'){
        const report=readinessProvider();
        send(res,report?.ok?200:503,report||{ok:false,error:'Readiness saknas.'});return true;
      }
      if(req.method==='GET'&&url.pathname==='/api/operator/v1/security-events'){
        const limit=Math.max(1,Math.min(200,Number(url.searchParams.get('limit'))||50));
        const events=Db.securityEvents(db,{limit}).map(event=>{
          const companyId=String(event.details?.companyId||'').trim();
          const company=companyId?Db.companyById(db,companyId):null;
          return {
            kind:event.kind,
            severity:event.severity,
            createdAt:event.createdAt,
            companyId:company?.id||null,
            companyName:company?.displayName||company?.legalName||null
          };
        });
        send(res,200,{events});return true;
      }
      if(req.method==='GET'&&url.pathname==='/api/operator/v1/security-monitor'){
        if(!securityMonitor){send(res,503,{error:'Aktiv säkerhetsövervakning är inte tillgänglig.',code:'SECURITY_MONITOR_UNAVAILABLE'});return true}
        send(res,200,securityMonitor.refresh());return true;
      }
      if(req.method==='GET'&&url.pathname==='/api/operator/v1/operator-audit'){
        const limit=Math.max(1,Math.min(200,Number(url.searchParams.get('limit'))||100));
        const events=Db.platformOperatorAudit(db,{limit}).map(event=>{
          const details=event.details&&typeof event.details==='object'?event.details:{};
          const companyId=String(details.companyId||'').trim();
          const userId=String(details.userId||'').trim();
          let operator=null,company=null,user=null;
          try{if(event.operatorId)operator=Db.platformOperatorById(db,event.operatorId)}catch{}
          try{if(companyId)company=Db.companyById(db,companyId)}catch{}
          try{if(userId)user=Db.userById(db,userId)}catch{}
          return {
            action:event.action,
            createdAt:event.createdAt,
            operatorName:operator?.displayName||operator?.username||'Tidigare operatör',
            companyId:company?.id||null,
            companyName:company?.displayName||company?.legalName||null,
            targetUserName:user?.displayName||null,
            beforeRole:typeof details.before==='string'?details.before:null,
            afterRole:typeof details.after==='string'?details.after:null,
            role:typeof details.role==='string'?details.role:null
          };
        });
        send(res,200,{events});return true;
      }
      send(res,404,{error:'Hittades inte.',code:'OPERATOR_NOT_FOUND'});return true;
    }catch(error){
      const status=Number(error.statusCode||500);
      const message=status>=500?'Ett internt serverfel uppstod.':String(error.message||'Begäran kunde inte behandlas.');
      send(res,status,{error:message,code:error.code||'OPERATOR_API_ERROR'});return true;
    }
  }
  return Object.freeze({handle});
}
module.exports=Object.freeze({createOperatorRouter,operatorError,securityHeaders,send,readJson});
