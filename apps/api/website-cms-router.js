'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const Cms=require('./website-cms.js');
const {readJson,securityHeaders}=require('./app.js');
const {staticHeaders}=require('./private-runtime.js');
const root=path.resolve(__dirname,'..','..');
const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(root,'config','access-control.json'),'utf8'));
const previewAssets=new Map([
  ['/website-preview/', ['apps/website/index.html','text/html; charset=utf-8']],
  ['/website-preview/app.js', ['apps/website/app.js','application/javascript; charset=utf-8']],
  ['/website-preview/styles.css', ['apps/website/styles.css','text/css; charset=utf-8']],
  ['/website-preview/shared/content.js', ['packages/shared/browser/content.js','application/javascript; charset=utf-8']]
]);
function routeError(message,code='WEBSITE_CMS_ROUTE_ERROR',statusCode=400){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function send(res,status,body){if(res.writableEnded)return;res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}
function assertRevision(db,companyId,body,{publishing=false}={}) {
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1)throw routeError('Versionskontroll saknas. H\u00e4mta senaste utkastet innan du sparar.','CMS_PRECONDITION_REQUIRED',428);
  const current=Cms.state(db,companyId);
  if(body.expectedRevision!==current.draft.revision)throw routeError('Utkastet har \u00e4ndrats i en annan flik eller av en annan anv\u00e4ndare. Dina osparade \u00e4ndringar finns kvar i formul\u00e4ret.','CMS_REVISION_CONFLICT',409);
  if(publishing&&body.expectedPublishedVersion!==current.published.version)throw routeError('En annan publicering har redan genomf\u00f6rts. H\u00e4mta senaste versionen.','CMS_PUBLICATION_CONFLICT',409);
}
function createWebsiteCmsRouter(options){
  const db=options?.db;if(!db)throw new Error('Databas kr\u00e4vs.');
  Cms.initializeWebsiteCms(db);const accessModel=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
  function requireSession(req){
    const token=Auth.parseCookies(req.headers.cookie).rollands_session;
    const s=token?Db.sessionByTokenHash(db,Auth.hashToken(token)):null;
    if(!s||s.disabled)throw routeError('Personlig inloggning kr\u00e4vs.','AUTH_REQUIRED',401);
    s.actor={id:s.userId,name:s.displayName,companyId:s.companyId,authenticated:true,membershipActive:true,disabled:Boolean(s.disabled)};return s;
  }
  function csrf(req,s){const supplied=String(req.headers['x-csrf-token']||'');if(!supplied||!Auth.safeEqualText(Auth.hashToken(supplied),s.csrfHash))throw routeError('S\u00e4kerhetskontrollen misslyckades.','CSRF_FAILED',403)}
  function permission(s){if(!Access.authorize(accessModel,s.actor,'website.manage').allowed)throw routeError('Du saknar beh\u00f6righet f\u00f6r \u00e5tg\u00e4rden.','ACCESS_DENIED',403)}
  async function handle(req,res){
    let url;try{url=new URL(req.url,'http://localhost')}catch{return false}
    const isPreview=url.pathname.startsWith('/website-preview/');
    if(!isPreview&&!url.pathname.startsWith('/api/v1/website/'))return false;
    try{
      const s=requireSession(req);permission(s);
      if(isPreview){
        const asset=previewAssets.get(url.pathname);
        if(!asset||!['GET','HEAD'].includes(req.method))throw routeError('Hittades inte.','NOT_FOUND',404);
        const bytes=fs.readFileSync(path.join(root,asset[0]));
        res.writeHead(200,{...staticHeaders(asset[1]),'X-Robots-Tag':'noindex, nofollow','Content-Length':bytes.length});
        res.end(req.method==='HEAD'?undefined:bytes);return true;
      }
      if(req.method!=='GET')csrf(req,s);
      if(url.pathname==='/api/v1/website/cms'&&req.method==='GET'){
        send(res,200,{state:Cms.state(db,s.companyId),revisions:Cms.listRevisions(db,s.companyId)});return true;
      }
      const restore=url.pathname.match(/^\/api\/v1\/website\/cms\/revisions\/(\d+)\/restore$/);
      const saving=url.pathname==='/api/v1/website/cms/draft'&&req.method==='PUT';
      const publishing=url.pathname==='/api/v1/website/cms/publish'&&req.method==='POST';
      if(saving||publishing||(restore&&req.method==='POST')){
        const body=await readJson(req,res);if(!body)return true;
        const value=Db.transaction(db,()=>{
          assertRevision(db,s.companyId,body,{publishing});
          const before=Cms.state(db,s.companyId);
          const next=saving?Cms.saveDraft(db,{companyId:s.companyId,site:body.site,company:body.company,userId:s.userId}):
            publishing?Cms.publish(db,{companyId:s.companyId,userId:s.userId}):
            Cms.restoreToDraft(db,{companyId:s.companyId,version:Number(restore[1]),userId:s.userId});
          Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,
            action:saving?'WEBSITE_DRAFT_SAVED':publishing?'WEBSITE_VERSION_PUBLISHED':'WEBSITE_REVISION_RESTORED_TO_DRAFT',
            entityType:'website-content',entityId:s.companyId,
            details:{previousDraftRevision:before.draft.revision,draftRevision:next.draft.revision,
              previousPublishedVersion:before.published.version,publishedVersion:next.published.version,
              ...(restore?{sourceVersion:Number(restore[1])}:{})}});
          return next;
        });
        const message=saving?'Utkastet sparades p\u00e5 servern. Den publika webbplatsen \u00e4r of\u00f6r\u00e4ndrad.':
          publishing?`Version ${value.published.version} sparades som publicerad i CMS. Koppling till den publika webbplatsens drift \u00e5terst\u00e5r.`:
          `Version ${restore[1]} \u00e5terst\u00e4lldes som utkast. Den publicerade versionen \u00e4ndrades inte.`;
        send(res,publishing?201:200,{state:value,revisions:Cms.listRevisions(db,s.companyId),message});return true;
      }
      send(res,404,{error:'Hittades inte.',code:'NOT_FOUND'});return true;
    }catch(error){const status=Number(error.statusCode||500);if(status>=500)console.error('Website CMS request failed',{code:error.code||'INTERNAL_ERROR'});send(res,status,{error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Beg\u00e4ran misslyckades.'),code:error.code||'INTERNAL_ERROR'});return true}
  }
  return Object.freeze({handle,accessModel});
}
module.exports=Object.freeze({createWebsiteCmsRouter});
