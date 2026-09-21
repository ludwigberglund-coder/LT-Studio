'use strict';

const crypto=require('node:crypto');
const Auth=require('./auth.js');
const OperatorAuth=require('./operator-auth.js');
const Db=require('./database.js');
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
        resolve(value);
      }catch(error){reject(error)}
    });
    req.on('error',reject);
  });
}
function createOperatorRouter(options={}){
  const db=options.db;
  if(!db)throw new Error('Databas krävs för operator-API.');
  const secureCookies=options.secureCookies!==false;
  const authEncryptionKey=String(options.authEncryptionKey||'');
  const sessionIdleMinutes=Number(options.sessionIdleMinutes||15);
  const sessionMaxMinutes=Number(options.sessionMaxMinutes||120);
  const readinessProvider=typeof options.readinessProvider==='function'?options.readinessProvider:()=>({ok:false,error:'Readiness-provider saknas.'});
  if(!Number.isSafeInteger(sessionIdleMinutes)||sessionIdleMinutes<5||!Number.isSafeInteger(sessionMaxMinutes)||sessionMaxMinutes<sessionIdleMinutes||sessionMaxMinutes>24*60){
    throw new Error('Ogiltiga operatörssessionstider.');
  }

  function expiryIso(minutes,fromMs=Date.now()){return new Date(fromMs+minutes*60*1000).toISOString()}
  function loginKey(req,username){
    const identity=`${req.socket?.remoteAddress||'unknown'}|${String(username||'').toLocaleLowerCase('sv')}`;
    return crypto.createHash('sha256').update('lt-operator-login-v1|'+identity).digest('hex');
  }
  function loginBlocked(req,username){
    const state=Db.loginAttemptState(db,{keyHash:loginKey(req,username)});
    return Boolean(state&&state.failureCount>=5);
  }
  function noteLoginFailure(req,username){
    const keyHash=loginKey(req,username);let state;
    Db.transaction(db,()=>{
      state=Db.noteLoginFailure(db,{keyHash,windowMinutes:15});
      if(state.failureCount===5)Db.appendSecurityEvent(db,{
        kind:'OPERATOR_LOGIN_FAILURE_THRESHOLD',
        severity:'critical',
        fingerprintHash:keyHash,
        details:{failureCount:state.failureCount,windowMinutes:15,retryAfterSeconds:900}
      });
    });
    return state;
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

    const now=Date.now(),sessionToken=Auth.randomToken(32),csrfToken=Auth.randomToken(24);
    Db.transaction(db,()=>{
      Db.consumePlatformOperatorMfaStep(db,{operatorId:operator.id,totpCounter:mfaCounter});
      Db.createPlatformOperatorSession(db,{
        tokenHash:Auth.hashToken(sessionToken),csrfHash:Auth.hashToken(csrfToken),operatorId:operator.id,
        expiresAt:expiryIso(sessionIdleMinutes,now),absoluteExpiresAt:expiryIso(sessionMaxMinutes,now)
      });
      Db.appendPlatformOperatorAudit(db,{operatorId:operator.id,action:'OPERATOR_SESSION_LOGIN',details:{sessionIdleMinutes,sessionMaxMinutes,mfaRequired:true}});
    });
    Db.clearLoginAttempts(db,loginKey(req,username));
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
      if(req.method==='GET'&&url.pathname==='/api/operator/v1/readiness'){
        const report=readinessProvider();
        send(res,report?.ok?200:503,report||{ok:false,error:'Readiness saknas.'});return true;
      }
      if(req.method==='GET'&&url.pathname==='/api/operator/v1/security-events'){
        const limit=Math.max(1,Math.min(200,Number(url.searchParams.get('limit'))||50));
        const events=Db.securityEvents(db,{limit}).map(event=>({kind:event.kind,severity:event.severity,createdAt:event.createdAt}));
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
