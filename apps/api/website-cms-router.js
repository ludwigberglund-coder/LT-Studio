'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const Cms=require('./website-cms.js');
const {readJson,securityHeaders}=require('./app.js');
const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));

function routeError(message,code='WEBSITE_CMS_ROUTE_ERROR',statusCode=400){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function send(res,status,body){if(res.writableEnded)return;res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}
function createWebsiteCmsRouter(options){
  const db=options?.db;if(!db)throw new Error('Databas krävs.');Cms.initializeWebsiteCms(db);const accessModel=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
  function session(req){const token=Auth.parseCookies(req.headers.cookie).rollands_session;if(!token)return null;const s=Db.sessionByTokenHash(db,Auth.hashToken(token));if(!s||s.disabled)return null;s.actor={id:s.userId,name:s.displayName,roles:s.roles,disabled:Boolean(s.disabled)};return s}
  function requireSession(req){const s=session(req);if(!s)throw routeError('Personlig inloggning krävs.','AUTH_REQUIRED',401);return s}
  function csrf(req,s){const supplied=String(req.headers['x-csrf-token']||'');if(!supplied||!Auth.safeEqualText(Auth.hashToken(supplied),s.csrfHash))throw routeError('Säkerhetskontrollen misslyckades.','CSRF_FAILED',403)}
  function permission(s,id){const decision=Access.authorize(accessModel,s.actor,id);if(!decision.allowed)throw routeError('Du saknar behörighet för åtgärden.','ACCESS_DENIED',403)}
  async function handle(req,res){
    let url;try{url=new URL(req.url,'http://localhost')}catch{return false}if(!url.pathname.startsWith('/api/v1/website/'))return false;
    try{const s=requireSession(req);permission(s,'website.manage');if(req.method!=='GET')csrf(req,s);
      if(url.pathname==='/api/v1/website/cms'&&req.method==='GET'){return send(res,200,{state:Cms.state(db,s.companyId),revisions:Cms.listRevisions(db,s.companyId)}),true}
      if(url.pathname==='/api/v1/website/cms/draft'&&req.method==='PUT'){const body=await readJson(req,res);if(!body)return true;const value=Db.transaction(db,()=>{const next=Cms.saveDraft(db,{companyId:s.companyId,site:body.site,company:body.company,userId:s.userId});Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'WEBSITE_DRAFT_SAVED',entityType:'website-content',entityId:s.companyId,details:{draftUpdatedAt:next.draft.updatedAt,publishedVersion:next.published.version}});return next});return send(res,200,{state:value,message:'Utkastet sparades. Den publika versionen är oförändrad.'}),true}
      if(url.pathname==='/api/v1/website/cms/publish'&&req.method==='POST'){const value=Db.transaction(db,()=>{const next=Cms.publish(db,{companyId:s.companyId,userId:s.userId});Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'WEBSITE_VERSION_PUBLISHED',entityType:'website-content',entityId:s.companyId,details:{publishedVersion:next.published.version,publishedAt:next.published.publishedAt}});return next});return send(res,201,{state:value,revisions:Cms.listRevisions(db,s.companyId),message:`Webbplatsversion ${value.published.version} publicerades i CMS-lagret.`}),true}
      const restore=url.pathname.match(/^\/api\/v1\/website\/cms\/revisions\/(\d+)\/restore$/);if(restore&&req.method==='POST'){const value=Db.transaction(db,()=>{const next=Cms.restoreToDraft(db,{companyId:s.companyId,version:Number(restore[1]),userId:s.userId});Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'WEBSITE_REVISION_RESTORED_TO_DRAFT',entityType:'website-content',entityId:s.companyId,details:{sourceVersion:Number(restore[1]),draftUpdatedAt:next.draft.updatedAt}});return next});return send(res,200,{state:value,message:`Version ${restore[1]} återställdes som utkast. Den publicerade sidan ändrades inte.`}),true}
      send(res,404,{error:'Hittades inte.',code:'NOT_FOUND'});return true;
    }catch(error){const status=Number(error.statusCode||500);if(status>=500)console.error(error);send(res,status,{error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Begäran misslyckades.'),code:error.code||'INTERNAL_ERROR'});return true}
  }
  return Object.freeze({handle,accessModel});
}
module.exports=Object.freeze({createWebsiteCmsRouter});
