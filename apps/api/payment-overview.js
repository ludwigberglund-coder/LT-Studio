'use strict';

const Reports=require('./reports.js');

function overviewError(message,code='PAYMENT_OVERVIEW_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(v){return String(v??'').trim()}
function validDate(v){return Reports.validDate(v)}
function addDays(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function periodBounds({mode='month',date}={}){
  const anchor=text(date);
  if(!validDate(anchor))throw overviewError('Ett giltigt datum krävs för betalningsperioden.','INVALID_PAYMENT_PERIOD_DATE');
  const d=new Date(anchor+'T00:00:00Z');
  if(mode==='day')return{from:anchor,to:anchor,label:anchor,mode};
  if(mode==='week'){
    const day=d.getUTCDay()||7,from=addDays(anchor,1-day),to=addDays(from,6);
    return{from,to,label:`${from} – ${to}`,mode};
  }
  if(mode==='month'){
    const from=`${anchor.slice(0,7)}-01`,last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
    return{from,to:`${anchor.slice(0,7)}-${String(last).padStart(2,'0')}`,label:anchor.slice(0,7),mode};
  }
  if(mode==='quarter'){
    const startMonth=Math.floor(d.getUTCMonth()/3)*3;
    const from=`${d.getUTCFullYear()}-${String(startMonth+1).padStart(2,'0')}-01`;
    const endMonth=startMonth+3,last=new Date(Date.UTC(d.getUTCFullYear(),endMonth,0)).getUTCDate();
    const to=`${d.getUTCFullYear()}-${String(endMonth).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
    return{from,to,label:`${d.getUTCFullYear()} Q${Math.floor(startMonth/3)+1}`,mode};
  }
  throw overviewError('Periodtypen måste vara dag, vecka, månad eller kvartal.','INVALID_PAYMENT_PERIOD_MODE');
}
function paymentOverview(db,companyId,{mode='month',date,status='',direction='',query='',account='',sort='date',order='asc'}={}){
  const bounds=periodBounds({mode,date});
  const normalizedStatus=text(status).toLowerCase(),normalizedDirection=text(direction).toLowerCase(),normalizedQuery=text(query).toLowerCase(),normalizedAccount=text(account),normalizedSort=text(sort).toLowerCase()||'date',normalizedOrder=text(order).toLowerCase()||'asc';
  if(normalizedDirection&&!['in','out'].includes(normalizedDirection))throw overviewError('Riktning måste vara in eller out.','INVALID_PAYMENT_DIRECTION');
  if(normalizedAccount&&!/^\d{4}$/.test(normalizedAccount))throw overviewError('Konto måste bestå av fyra siffror.','INVALID_PAYMENT_ACCOUNT');
  if(!['date','amount','counterparty'].includes(normalizedSort))throw overviewError('Sortering måste vara date, amount eller counterparty.','INVALID_PAYMENT_SORT');
  if(!['asc','desc'].includes(normalizedOrder))throw overviewError('Sorteringsordning måste vara asc eller desc.','INVALID_PAYMENT_ORDER');
  const incoming=db.prepare(`SELECT b.id,'in' AS direction,b.booking_date AS paymentDate,b.amount_ore AS amountOre,b.status,
    b.reference,b.payer_name AS counterparty,b.payer_account AS counterpartyAccount,NULL AS invoiceNumber,'' AS paymentAccount
    FROM bank_payments b WHERE b.company_id=? AND b.booking_date BETWEEN ? AND ? ORDER BY b.booking_date,b.created_at,b.id`).all(companyId,bounds.from,bounds.to);
  const outgoing=db.prepare(`SELECT p.id,'out' AS direction,p.payment_date AS paymentDate,p.amount_ore AS amountOre,p.status,
    COALESCE(p.recipient_bankgiro,p.recipient_plusgiro,'') AS reference,COALESCE(p.recipient_name,s.name) AS counterparty,
    COALESCE(p.recipient_bankgiro,p.recipient_plusgiro,'') AS counterpartyAccount,i.supplier_invoice_number AS invoiceNumber,p.account AS paymentAccount
    FROM supplier_payments p
    JOIN supplier_invoices i ON i.id=p.supplier_invoice_id AND i.company_id=p.company_id
    JOIN suppliers s ON s.id=i.supplier_id AND s.company_id=i.company_id
    WHERE p.company_id=? AND p.payment_date BETWEEN ? AND ? ORDER BY p.payment_date,p.created_at,p.id`).all(companyId,bounds.from,bounds.to);
  const rows=[...incoming,...outgoing].filter(row=>{
    if(normalizedStatus&&String(row.status).toLowerCase()!==normalizedStatus)return false;
    if(normalizedDirection&&row.direction!==normalizedDirection)return false;
    if(normalizedAccount&&String(row.paymentAccount||'')!==normalizedAccount)return false;
    if(normalizedQuery){
      const haystack=[row.counterparty,row.counterpartyAccount,row.invoiceNumber,row.reference].map(value=>String(value||'').toLowerCase()).join(' ');
      if(!haystack.includes(normalizedQuery))return false;
    }
    return true;
  }).sort((a,b)=>{
    let cmp=0;
    if(normalizedSort==='amount')cmp=Number(a.amountOre||0)-Number(b.amountOre||0);
    else if(normalizedSort==='counterparty')cmp=String(a.counterparty||'').localeCompare(String(b.counterparty||''),'sv');
    else cmp=String(a.paymentDate||'').localeCompare(String(b.paymentDate||''));
    if(cmp===0)cmp=String(a.id).localeCompare(String(b.id));
    return normalizedOrder==='desc'?-cmp:cmp;
  });
  const incomingOre=rows.filter(r=>r.direction==='in').reduce((s,r)=>s+Number(r.amountOre||0),0);
  const outgoingOre=rows.filter(r=>r.direction==='out').reduce((s,r)=>s+Number(r.amountOre||0),0);
  return{period:bounds,filters:{status:normalizedStatus||null,direction:normalizedDirection||null,query:normalizedQuery||null,account:normalizedAccount||null,sort:normalizedSort,order:normalizedOrder},summary:{incomingOre,outgoingOre,netOre:incomingOre-outgoingOre,count:rows.length},rows};
}
module.exports=Object.freeze({periodBounds,paymentOverview});
