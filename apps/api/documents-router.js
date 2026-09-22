'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const Documents=require('./documents.js');
const PdfSecurity=require('./pdf-upload-security.js');
const {readJson,securityHeaders}=require('./app.js');

const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));
function routeError(message,code='DOCUMENT_ROUTE_ERROR',statusCode=400){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function send(res,status,body){if(res.writableEnded)return;res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}
function readBinary(req,res,maxBytes){return new Promise((resolve,reject)=>{const declared=Number(req.headers['content-length']||0);if(Number.isFinite(declared)&&declared>maxBytes){send(res,413,{error:'Dokumentet är för stort.',code:'DOCUMENT_TOO_LARGE'});req.resume();return resolve(null)}const chunks=[];let size=0;req.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){if(!res.writableEnded)send(res,413,{error:'Dokumentet är för stort.',code:'DOCUMENT_TOO_LARGE'});chunks.length=0;req.destroy();return}chunks.push(chunk)});req.on('end',()=>{if(res.writableEnded)return resolve(null);resolve(Buffer.concat(chunks))});req.on('error',reject)})}

function createDocumentsRouter(options){
  const db=options?.db;if(!db)throw new Error('Databas krävs.');Documents.initializeDocuments(db);
  const accessModel=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
  function session(req){const token=Auth.parseCookies(req.headers.cookie).rollands_session;if(!token)return null;const s=Db.sessionByTokenHash(db,Auth.hashToken(token));if(!s||s.disabled)return null;s.actor={id:s.userId,name:s.displayName,companyId:s.companyId,authenticated:true,membershipActive:true,disabled:Boolean(s.disabled)};return s}
  function requireSession(req){const s=session(req);if(!s)throw routeError('Personlig inloggning krävs.','AUTH_REQUIRED',401);return s}
  function csrf(req,s){const supplied=String(req.headers['x-csrf-token']||'');if(!supplied||!Auth.safeEqualText(Auth.hashToken(supplied),s.csrfHash))throw routeError('Säkerhetskontrollen misslyckades.','CSRF_FAILED',403)}
  function permission(s,id){const d=Access.authorize(accessModel,s.actor,id);if(!d.allowed)throw routeError('Du saknar behörighet för dokumentarkivet.','ACCESS_DENIED',403)}
  async function handle(req,res){
    let url;try{url=new URL(req.url,'http://localhost')}catch{return false}
    if(!url.pathname.startsWith('/api/v1/documents'))return false;
    try{
      const s=requireSession(req);if(req.method!=='GET')csrf(req,s);
      if(url.pathname==='/api/v1/documents'&&req.method==='GET'){permission(s,'documents.view');const documents=Documents.listDocuments(db,s.companyId,{category:String(url.searchParams.get('category')||''),entityType:String(url.searchParams.get('entityType')||''),entityId:String(url.searchParams.get('entityId')||'')});return send(res,200,{documents}),true}
      if(url.pathname==='/api/v1/documents'&&req.method==='POST'){permission(s,'documents.upload');const body=await readJson(req,res);if(!body)return true;const result=Db.transaction(db,()=>{const value=Documents.createPendingIdempotent(db,{...body,companyId:s.companyId,uploadedBy:s.userId});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'DOCUMENT_REGISTERED',entityType:'document',entityId:value.document.id,details:{title:value.document.title,category:value.document.category,fileName:value.document.fileName,mimeType:value.document.mimeType,links:value.document.links,requestId:body.requestId}});return value});return send(res,result.duplicate?200:201,result),true}
      const contentMatch=url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/content$/);
      if(contentMatch&&req.method==='PUT'){permission(s,'documents.upload');const doc=Documents.documentById(db,s.companyId,contentMatch[1]);if(!doc)throw routeError('Dokumentet hittades inte.','DOCUMENT_NOT_FOUND',404);const contentType=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();if(contentType!==doc.mimeType)throw routeError('Filtypen stämmer inte med dokumentregistreringen.','DOCUMENT_CONTENT_TYPE_MISMATCH',415);const bytes=await readBinary(req,res,Documents.MAX_BYTES);if(!bytes)return true;await PdfSecurity.assertSafePdfDeep(bytes,{fileName:doc.fileName,maxBytes:Documents.MAX_BYTES});const result=Db.transaction(db,()=>{const before=Documents.documentById(db,s.companyId,doc.id);const duplicate=before?.status==='ready';const document=Documents.storeContent(db,{companyId:s.companyId,documentId:doc.id,bytes});if(!duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'DOCUMENT_CONTENT_STORED',entityType:'document',entityId:document.id,details:{sha256:document.sha256,sizeBytes:document.sizeBytes,mimeType:document.mimeType}});return{document,duplicate}});return send(res,200,result),true}
      if(contentMatch&&req.method==='GET'){permission(s,'documents.view');const doc=Documents.content(db,s.companyId,contentMatch[1]);res.writeHead(200,{...securityHeaders(),'Content-Type':doc.mimeType,'Content-Disposition':`attachment; filename="${String(doc.fileName).replace(/["\r\n\\/]/g,'_')}"`,'Content-Security-Policy':"sandbox; default-src 'none'; object-src 'none'; frame-ancestors 'none'",'Content-Length':doc.sizeBytes,'X-Document-SHA256':doc.sha256});res.end(doc.bytes);return true}
      const linkMatch=url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/links$/);
      if(linkMatch&&req.method==='POST'){permission(s,'documents.upload');const body=await readJson(req,res);if(!body)return true;const result=Db.transaction(db,()=>{const value=Documents.linkDocumentIdempotent(db,{companyId:s.companyId,documentId:linkMatch[1],entityType:body.entityType,entityId:body.entityId,label:body.label});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'DOCUMENT_LINKED',entityType:'document',entityId:linkMatch[1],details:{entityType:body.entityType,entityId:body.entityId,label:body.label||''}});return value});return send(res,200,result),true}
      const detailMatch=url.pathname.match(/^\/api\/v1\/documents\/([^/]+)$/);
      if(detailMatch&&req.method==='GET'){permission(s,'documents.view');const document=Documents.documentById(db,s.companyId,detailMatch[1]);if(!document||document.status!=='ready')throw routeError('Dokumentet hittades inte.','DOCUMENT_NOT_FOUND',404);return send(res,200,{document}),true}
      send(res,404,{error:'Hittades inte.',code:'NOT_FOUND'});return true;
    }catch(error){const status=Number(error.statusCode||500);if(status>=500)console.error(error);send(res,status,{error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Begäran misslyckades.'),code:error.code||'INTERNAL_ERROR'});return true}
  }
  return Object.freeze({handle,accessModel});
}
module.exports=Object.freeze({createDocumentsRouter});
