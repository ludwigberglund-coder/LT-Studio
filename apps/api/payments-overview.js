'use strict';

function overviewError(message,code='PAYMENTS_OVERVIEW_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(v){return String(v??'').trim()}
function validDate(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(text(v)))return false;const [y,m,d]=text(v).split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d}
function dateIso(dt){return dt.toISOString().slice(0,10)}
function bounds(date,period){
  if(!validDate(date))throw overviewError('Datumet är ogiltigt.','INVALID_PAYMENT_OVERVIEW_DATE');
  const [y,m,d]=date.split('-').map(Number),dt=new Date(Date.UTC(y,m-1,d));
  if(period==='day')return{from:date,to:date};
  if(period==='week'){const dow=dt.getUTCDay()||7,start=new Date(dt);start.setUTCDate(dt.getUTCDate()-(dow-1));const end=new Date(start);end.setUTCDate(start.getUTCDate()+6);return{from:dateIso(start),to:dateIso(end)}}
  if(period==='month'){const start=new Date(Date.UTC(y,m-1,1)),end=new Date(Date.UTC(y,m,0));return{from:dateIso(start),to:dateIso(end)}}
  if(period==='quarter'){const qm=Math.floor((m-1)/3)*3,start=new Date(Date.UTC(y,qm,1)),end=new Date(Date.UTC(y,qm+3,0));return{from:dateIso(start),to:dateIso(end)}}
  throw overviewError('Period måste vara day, week, month eller quarter.','INVALID_PAYMENT_OVERVIEW_PERIOD');
}
function resolveRange({from='',to='',date='',period=''}) {
  if(period||date)return bounds(text(date),text(period).toLowerCase());
  if(!validDate(from)||!validDate(to)||from>to)throw overviewError('Datumintervallet är ogiltigt.','INVALID_PAYMENT_OVERVIEW_RANGE');
  return{from,to};
}
function incoming(db,companyId,{from,to}){
  return db.prepare(`SELECT id,booking_date AS date,payer_name AS counterparty,reference,amount_ore AS amountOre,payer_account AS account,status,
    'bank-payment' AS sourceType,id AS sourceId
    FROM bank_payments WHERE company_id=? AND booking_date BETWEEN ? AND ?`).all(companyId,from,to)
    .map(row=>({...row,direction:'in'}));
}
function outgoing(db,companyId,{from,to}){
  return db.prepare(`SELECT p.id,p.payment_date AS date,COALESCE(p.recipient_name,s.name) AS counterparty,i.supplier_invoice_number AS reference,
    p.amount_ore AS amountOre,p.account,p.status,'supplier-payment' AS sourceType,p.id AS sourceId
    FROM supplier_payments p
    JOIN supplier_invoices i ON i.id=p.supplier_invoice_id AND i.company_id=p.company_id
    JOIN suppliers s ON s.id=i.supplier_id AND s.company_id=i.company_id
    WHERE p.company_id=? AND p.payment_date BETWEEN ? AND ?`).all(companyId,from,to)
    .map(row=>({...row,direction:'out'}));
}
function matches(row,filters){
  if(filters.direction&&row.direction!==filters.direction)return false;
  if(filters.account&&text(row.account)!==filters.account)return false;
  if(filters.status&&text(row.status)!==filters.status)return false;
  if(filters.counterparty&&!text(row.counterparty).toLowerCase().includes(filters.counterparty.toLowerCase()))return false;
  if(filters.minOre!==null&&Number(row.amountOre)<filters.minOre)return false;
  if(filters.maxOre!==null&&Number(row.amountOre)>filters.maxOre)return false;
  return true;
}
function optionalOre(value,name){
  if(value===''||value===null||value===undefined)return null;
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0)throw overviewError(`${name} måste vara ett icke-negativt heltal i ören.`,'INVALID_PAYMENT_OVERVIEW_AMOUNT');
  return n;
}
function list(db,companyId,input={}){
  const range=resolveRange(input);
  const filters={
    direction:text(input.direction).toLowerCase(),
    account:text(input.account),
    status:text(input.status),
    counterparty:text(input.counterparty),
    minOre:optionalOre(input.minOre,'Minimibeloppet'),
    maxOre:optionalOre(input.maxOre,'Maximibeloppet')
  };
  if(filters.direction&&!['in','out'].includes(filters.direction))throw overviewError('Riktning måste vara in eller out.','INVALID_PAYMENT_OVERVIEW_DIRECTION');
  if(filters.account&&!/^\d{4}$/.test(filters.account))throw overviewError('Konto måste bestå av fyra siffror.','INVALID_PAYMENT_OVERVIEW_ACCOUNT');
  if(filters.minOre!==null&&filters.maxOre!==null&&filters.minOre>filters.maxOre)throw overviewError('Minimibeloppet kan inte vara större än maximibeloppet.','INVALID_PAYMENT_OVERVIEW_AMOUNT');
  const rows=[...incoming(db,companyId,range),...outgoing(db,companyId,range)]
    .filter(row=>matches(row,filters))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.direction).localeCompare(String(b.direction))||String(a.id).localeCompare(String(b.id)));
  const totals={
    incomingOre:rows.filter(r=>r.direction==='in').reduce((s,r)=>s+Number(r.amountOre||0),0),
    outgoingOre:rows.filter(r=>r.direction==='out').reduce((s,r)=>s+Number(r.amountOre||0),0)
  };
  return{...range,filters,rows,totals:{...totals,netOre:totals.incomingOre-totals.outgoingOre,count:rows.length}};
}
module.exports=Object.freeze({validDate,bounds,resolveRange,list});
