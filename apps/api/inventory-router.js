'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Access=require('../../packages/access-control/authorization.js');
const Auth=require('./auth.js');
const Db=require('./database.js');
const Inventory=require('./inventory.js');
const {readJson,securityHeaders}=require('./app.js');

const DEFAULT_ACCESS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','access-control.json'),'utf8'));
function routeError(message,code='INVENTORY_ROUTE_ERROR',statusCode=400){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function send(res,status,body){if(res.writableEnded)return;res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}

function createInventoryRouter(options){
  const db=options?.db;if(!db)throw new Error('Databas krävs.');Inventory.initializeInventory(db);
  const accessModel=Access.createModel(options.accessConfig||DEFAULT_ACCESS);
  function session(req){const token=Auth.parseCookies(req.headers.cookie).rollands_session;if(!token)return null;const s=Db.sessionByTokenHash(db,Auth.hashToken(token));if(!s||s.disabled)return null;s.actor={id:s.userId,name:s.displayName,companyId:s.companyId,authenticated:true,membershipActive:true,disabled:Boolean(s.disabled)};return s}
  function requireSession(req){const s=session(req);if(!s)throw routeError('Personlig inloggning krävs.','AUTH_REQUIRED',401);return s}
  function csrf(req,s){const supplied=String(req.headers['x-csrf-token']||'');if(!supplied||!Auth.safeEqualText(Auth.hashToken(supplied),s.csrfHash))throw routeError('Säkerhetskontrollen misslyckades.','CSRF_FAILED',403)}
  function permission(s,id){const d=Access.authorize(accessModel,s.actor,id);if(!d.allowed)throw routeError('Du saknar behörighet för åtgärden.','ACCESS_DENIED',403)}

  async function handle(req,res){
    let url;try{url=new URL(req.url,'http://localhost')}catch{return false}
    if(!url.pathname.startsWith('/api/v1/inventory/'))return false;
    try{
      const s=requireSession(req);if(req.method!=='GET')csrf(req,s);
      if(url.pathname==='/api/v1/inventory/items'&&req.method==='GET'){permission(s,'inventory.view');return send(res,200,{items:Inventory.listItems(db,s.companyId)}),true}
      if(url.pathname==='/api/v1/inventory/items'&&req.method==='POST'){permission(s,'inventory.manage');const body=await readJson(req,res);if(!body)return true;const result=Db.transaction(db,()=>{const value=Inventory.createItemIdempotent(db,{...body,companyId:s.companyId});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'INVENTORY_ITEM_CREATED',entityType:'inventory-item',entityId:value.item.id,details:{sku:value.item.sku,name:value.item.name,unit:value.item.unit}});return value});return send(res,result.duplicate?200:201,result),true}
      if(url.pathname==='/api/v1/inventory/movements'&&req.method==='GET'){permission(s,'inventory.view');const itemId=String(url.searchParams.get('itemId')||'');return send(res,200,{movements:Inventory.listMovements(db,s.companyId,{itemId})}),true}
      if(url.pathname==='/api/v1/inventory/movements'&&req.method==='POST'){permission(s,'inventory.manage');const body=await readJson(req,res);if(!body)return true;const result=Db.transaction(db,()=>{const value=Inventory.addMovementIdempotent(db,{...body,companyId:s.companyId,actorId:s.userId});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'INVENTORY_MOVEMENT_CREATED',entityType:'inventory-movement',entityId:value.movement.id,details:{itemId:value.movement.itemId,type:value.movement.type,quantityMilli:value.movement.quantityMilli,requestId:body.requestId}});return value});return send(res,result.duplicate?200:201,result),true}
      if(url.pathname==='/api/v1/inventory/adjustments'&&req.method==='GET'){permission(s,'inventory.view');const status=String(url.searchParams.get('status')||'pending');return send(res,200,{adjustments:Inventory.listAdjustments(db,s.companyId,{status})}),true}
      if(url.pathname==='/api/v1/inventory/adjustments'&&req.method==='POST'){permission(s,'inventory.manage');const body=await readJson(req,res);if(!body)return true;const result=Db.transaction(db,()=>{const value=Inventory.createAdjustmentIdempotent(db,{...body,companyId:s.companyId,countedBy:s.userId});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'INVENTORY_ADJUSTMENT_REQUESTED',entityType:'inventory-adjustment',entityId:value.adjustment.id,details:{itemId:value.adjustment.itemId,differenceMilli:value.adjustment.differenceMilli,requestId:body.requestId}});return value});return send(res,result.duplicate?200:201,result),true}
      const approve=url.pathname.match(/^\/api\/v1\/inventory\/adjustments\/([^/]+)\/approve$/);
      if(approve&&req.method==='POST'){permission(s,'inventory.adjust');const current=Inventory.adjustmentById(db,s.companyId,approve[1]);if(!current)throw routeError('Lagerjusteringen hittades inte.','ADJUSTMENT_NOT_FOUND',404);const workflow=Access.evaluateWorkflowAction(accessModel,s.actor,'inventory-adjustment',{countedBy:current.countedBy,approvedBy:s.userId});if(!workflow.allowed)throw routeError(workflow.reason,workflow.code,409);const result=Db.transaction(db,()=>{const value=Inventory.approveAdjustmentIdempotent(db,{companyId:s.companyId,adjustmentId:current.id,approvedBy:s.userId});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'INVENTORY_ADJUSTMENT_APPROVED',entityType:'inventory-adjustment',entityId:current.id,details:{itemId:current.itemId,differenceMilli:current.differenceMilli,movementId:value.movement.id}});return value});return send(res,200,result),true}
      const reject=url.pathname.match(/^\/api\/v1\/inventory\/adjustments\/([^/]+)\/reject$/);
      if(reject&&req.method==='POST'){permission(s,'inventory.adjust');const result=Db.transaction(db,()=>{const value=Inventory.rejectAdjustmentIdempotent(db,{companyId:s.companyId,adjustmentId:reject[1],rejectedBy:s.userId});if(!value.duplicate)Db.appendAudit(db,{companyId:s.companyId,userId:s.userId,action:'INVENTORY_ADJUSTMENT_REJECTED',entityType:'inventory-adjustment',entityId:value.adjustment.id,details:{itemId:value.adjustment.itemId,differenceMilli:value.adjustment.differenceMilli}});return value});return send(res,200,result),true}
      send(res,404,{error:'Hittades inte.',code:'NOT_FOUND'});return true;
    }catch(error){const status=Number(error.statusCode||500);if(status>=500)console.error(error);send(res,status,{error:status>=500?'Ett internt serverfel uppstod.':String(error.message||'Begäran misslyckades.'),code:error.code||'INTERNAL_ERROR'});return true}
  }
  return Object.freeze({handle,accessModel});
}
module.exports=Object.freeze({createInventoryRouter});
