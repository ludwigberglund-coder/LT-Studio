'use strict';

const crypto=require('node:crypto');

function inventoryError(message,code='INVENTORY_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function id(prefix){return `${prefix}_${crypto.randomUUID()}`}
function text(v){return String(v??'').trim()}
function nowIso(){return new Date().toISOString()}
function validDate(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(text(v)))return false;const [y,m,d]=text(v).split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d}

function initializeInventory(db){db.exec(`
  CREATE TABLE IF NOT EXISTS inventory_items(
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL CHECK(unit IN ('st','kg','l')),
    purchase_account TEXT NOT NULL,
    inventory_account TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(company_id,sku)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS inventory_movements(
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    movement_date TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('receipt','sale','waste','adjustment')),
    quantity_milli INTEGER NOT NULL,
    unit_cost_ore INTEGER,
    reference_type TEXT,
    reference_id TEXT,
    note TEXT,
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS inventory_adjustments(
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    adjustment_date TEXT NOT NULL,
    current_quantity_milli INTEGER NOT NULL,
    counted_quantity_milli INTEGER NOT NULL,
    difference_milli INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
    counted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    approved_at TEXT,
    rejected_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    rejected_at TEXT,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_inventory_movement_company_item_date ON inventory_movements(company_id,item_id,movement_date,created_at);
  CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_company_status ON inventory_adjustments(company_id,status,created_at);
`)}

function validateAccount(v){if(!/^\d{4}$/.test(text(v)))throw inventoryError('Kontot måste bestå av fyra siffror.','INVALID_ACCOUNT')}
function createItem(db,input){const companyId=text(input.companyId),sku=text(input.sku).toUpperCase(),name=text(input.name),unit=text(input.unit||'st').toLowerCase(),purchaseAccount=text(input.purchaseAccount||'4010'),inventoryAccount=text(input.inventoryAccount||'1460');if(!companyId||!sku||sku.length>60||name.length<2||name.length>160)throw inventoryError('Företag, artikelnummer och artikelnamn krävs.','INVALID_ITEM');if(!['st','kg','l'].includes(unit))throw inventoryError('Enheten måste vara st, kg eller l.','INVALID_UNIT');validateAccount(purchaseAccount);validateAccount(inventoryAccount);if(db.prepare(`SELECT id FROM inventory_items WHERE company_id=? AND sku=?`).get(companyId,sku))throw inventoryError('Artikelnumret används redan.','DUPLICATE_ITEM',409);const itemId=input.id||id('item'),now=nowIso();db.prepare(`INSERT INTO inventory_items(id,company_id,sku,name,unit,purchase_account,inventory_account,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(itemId,companyId,sku,name,unit,purchaseAccount,inventoryAccount,now,now);return itemById(db,companyId,itemId)}
function itemById(db,companyId,itemId){return db.prepare(`SELECT id,company_id AS companyId,sku,name,unit,purchase_account AS purchaseAccount,inventory_account AS inventoryAccount,active,created_at AS createdAt,updated_at AS updatedAt FROM inventory_items WHERE company_id=? AND id=?`).get(companyId,itemId)||null}
function balanceMilli(db,companyId,itemId){const row=db.prepare(`SELECT COALESCE(SUM(quantity_milli),0) AS quantityMilli FROM inventory_movements WHERE company_id=? AND item_id=?`).get(companyId,itemId);return Number(row?.quantityMilli||0)}
function listItems(db,companyId){return db.prepare(`SELECT i.id,i.company_id AS companyId,i.sku,i.name,i.unit,i.purchase_account AS purchaseAccount,i.inventory_account AS inventoryAccount,i.active,COALESCE(SUM(m.quantity_milli),0) AS quantityMilli FROM inventory_items i LEFT JOIN inventory_movements m ON m.company_id=i.company_id AND m.item_id=i.id WHERE i.company_id=? GROUP BY i.id ORDER BY i.name,i.sku`).all(companyId).map(row=>({...row,quantityMilli:Number(row.quantityMilli||0),active:Boolean(row.active)}))}

function addMovement(db,{companyId,itemId,movementDate,type,quantityMilli,unitCostOre=null,referenceType='',referenceId='',note='',actorId}){const item=itemById(db,companyId,itemId);if(!item)throw inventoryError('Artikeln hittades inte.','ITEM_NOT_FOUND',404);if(!validDate(movementDate))throw inventoryError('Lagerdatumet är ogiltigt.','INVALID_MOVEMENT_DATE');if(!['receipt','sale','waste','adjustment'].includes(type))throw inventoryError('Okänd lagerrörelse.','INVALID_MOVEMENT_TYPE');if(!Number.isSafeInteger(quantityMilli)||quantityMilli===0)throw inventoryError('Kvantiteten måste anges i tusendelar och får inte vara noll.','INVALID_QUANTITY');if(type==='receipt'&&quantityMilli<0)throw inventoryError('En inleverans måste öka lagret.','INVALID_RECEIPT_QUANTITY');if(['sale','waste'].includes(type)&&quantityMilli>0)throw inventoryError('Försäljning och svinn måste minska lagret.','INVALID_OUTFLOW_QUANTITY');if(unitCostOre!==null&&(!Number.isSafeInteger(unitCostOre)||unitCostOre<0))throw inventoryError('Inköpspriset måste vara heltal i ören.','INVALID_UNIT_COST');const current=balanceMilli(db,companyId,itemId);if(current+quantityMilli<0)throw inventoryError('Lagerrörelsen skulle ge negativt lagersaldo.','NEGATIVE_STOCK',409);const movementId=id('imov'),createdAt=nowIso();db.prepare(`INSERT INTO inventory_movements(id,company_id,item_id,movement_date,type,quantity_milli,unit_cost_ore,reference_type,reference_id,note,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(movementId,companyId,itemId,movementDate,type,quantityMilli,unitCostOre,text(referenceType)||null,text(referenceId)||null,text(note).slice(0,500)||null,actorId,createdAt);return movementById(db,companyId,movementId)}
function movementById(db,companyId,movementId){return db.prepare(`SELECT id,company_id AS companyId,item_id AS itemId,movement_date AS movementDate,type,quantity_milli AS quantityMilli,unit_cost_ore AS unitCostOre,reference_type AS referenceType,reference_id AS referenceId,note,actor_id AS actorId,created_at AS createdAt FROM inventory_movements WHERE company_id=? AND id=?`).get(companyId,movementId)||null}
function listMovements(db,companyId,{itemId='',limit=200}={}){const safe=Math.max(1,Math.min(1000,Number(limit)||200));return itemId?db.prepare(`SELECT id,item_id AS itemId,movement_date AS movementDate,type,quantity_milli AS quantityMilli,unit_cost_ore AS unitCostOre,reference_type AS referenceType,reference_id AS referenceId,note,actor_id AS actorId,created_at AS createdAt FROM inventory_movements WHERE company_id=? AND item_id=? ORDER BY movement_date DESC,created_at DESC LIMIT ?`).all(companyId,itemId,safe):db.prepare(`SELECT id,item_id AS itemId,movement_date AS movementDate,type,quantity_milli AS quantityMilli,unit_cost_ore AS unitCostOre,reference_type AS referenceType,reference_id AS referenceId,note,actor_id AS actorId,created_at AS createdAt FROM inventory_movements WHERE company_id=? ORDER BY movement_date DESC,created_at DESC LIMIT ?`).all(companyId,safe)}

function createAdjustment(db,{companyId,itemId,adjustmentDate,countedQuantityMilli,reason,countedBy}){const item=itemById(db,companyId,itemId);if(!item)throw inventoryError('Artikeln hittades inte.','ITEM_NOT_FOUND',404);if(!validDate(adjustmentDate))throw inventoryError('Inventeringsdatumet är ogiltigt.','INVALID_ADJUSTMENT_DATE');if(!Number.isSafeInteger(countedQuantityMilli)||countedQuantityMilli<0)throw inventoryError('Räknat saldo måste anges i tusendelar och får inte vara negativt.','INVALID_COUNTED_QUANTITY');const current=balanceMilli(db,companyId,itemId),difference=countedQuantityMilli-current;if(difference===0)throw inventoryError('Inventeringen ger ingen differens att justera.','NO_ADJUSTMENT_REQUIRED');const adjustmentId=id('iadj'),createdAt=nowIso();db.prepare(`INSERT INTO inventory_adjustments(id,company_id,item_id,adjustment_date,current_quantity_milli,counted_quantity_milli,difference_milli,reason,status,counted_by,created_at) VALUES(?,?,?,?,?,?,?,?,'pending',?,?)`).run(adjustmentId,companyId,itemId,adjustmentDate,current,countedQuantityMilli,difference,text(reason).slice(0,500)||'Inventeringsdifferens',countedBy,createdAt);return adjustmentById(db,companyId,adjustmentId)}
function adjustmentById(db,companyId,adjustmentId){return db.prepare(`SELECT a.id,a.company_id AS companyId,a.item_id AS itemId,a.adjustment_date AS adjustmentDate,a.current_quantity_milli AS currentQuantityMilli,a.counted_quantity_milli AS countedQuantityMilli,a.difference_milli AS differenceMilli,a.reason,a.status,a.counted_by AS countedBy,a.approved_by AS approvedBy,a.approved_at AS approvedAt,a.rejected_by AS rejectedBy,a.rejected_at AS rejectedAt,a.created_at AS createdAt,i.sku,i.name,i.unit FROM inventory_adjustments a JOIN inventory_items i ON i.id=a.item_id AND i.company_id=a.company_id WHERE a.company_id=? AND a.id=?`).get(companyId,adjustmentId)||null}
function listAdjustments(db,companyId,{status='pending'}={}){const allowed=['pending','approved','rejected','all'];const filter=allowed.includes(status)?status:'pending';const base=`SELECT a.id,a.item_id AS itemId,a.adjustment_date AS adjustmentDate,a.current_quantity_milli AS currentQuantityMilli,a.counted_quantity_milli AS countedQuantityMilli,a.difference_milli AS differenceMilli,a.reason,a.status,a.counted_by AS countedBy,a.approved_by AS approvedBy,a.approved_at AS approvedAt,a.created_at AS createdAt,i.sku,i.name,i.unit FROM inventory_adjustments a JOIN inventory_items i ON i.id=a.item_id AND i.company_id=a.company_id WHERE a.company_id=?`;return filter==='all'?db.prepare(`${base} ORDER BY a.created_at DESC`).all(companyId):db.prepare(`${base} AND a.status=? ORDER BY a.created_at DESC`).all(companyId,filter)}
function approveAdjustment(db,{companyId,adjustmentId,approvedBy}){const adjustment=adjustmentById(db,companyId,adjustmentId);if(!adjustment)throw inventoryError('Lagerjusteringen hittades inte.','ADJUSTMENT_NOT_FOUND',404);if(adjustment.status!=='pending')throw inventoryError('Lagerjusteringen är redan behandlad.','ADJUSTMENT_ALREADY_DECIDED',409);if(adjustment.countedBy===approvedBy)throw inventoryError('Den som inventerade får inte ensam godkänna samma lagerjustering.','SEPARATION_OF_DUTIES_FAILED',409);const current=balanceMilli(db,companyId,adjustment.itemId);if(current!==adjustment.currentQuantityMilli)throw inventoryError('Lagersaldot har ändrats sedan inventeringen. Gör en ny inventering.','STOCK_CHANGED_SINCE_COUNT',409);const movement=addMovement(db,{companyId,itemId:adjustment.itemId,movementDate:adjustment.adjustmentDate,type:'adjustment',quantityMilli:adjustment.differenceMilli,referenceType:'inventory-adjustment',referenceId:adjustment.id,note:adjustment.reason,actorId:approvedBy});const approvedAt=nowIso();db.prepare(`UPDATE inventory_adjustments SET status='approved',approved_by=?,approved_at=? WHERE company_id=? AND id=? AND status='pending'`).run(approvedBy,approvedAt,companyId,adjustmentId);return{adjustment:adjustmentById(db,companyId,adjustmentId),movement}}
function rejectAdjustment(db,{companyId,adjustmentId,rejectedBy}){const adjustment=adjustmentById(db,companyId,adjustmentId);if(!adjustment)throw inventoryError('Lagerjusteringen hittades inte.','ADJUSTMENT_NOT_FOUND',404);if(adjustment.status!=='pending')throw inventoryError('Lagerjusteringen är redan behandlad.','ADJUSTMENT_ALREADY_DECIDED',409);const rejectedAt=nowIso();db.prepare(`UPDATE inventory_adjustments SET status='rejected',rejected_by=?,rejected_at=? WHERE company_id=? AND id=? AND status='pending'`).run(rejectedBy,rejectedAt,companyId,adjustmentId);return adjustmentById(db,companyId,adjustmentId)}

module.exports=Object.freeze({initializeInventory,createItem,itemById,listItems,balanceMilli,addMovement,movementById,listMovements,createAdjustment,adjustmentById,listAdjustments,approveAdjustment,rejectAdjustment});
