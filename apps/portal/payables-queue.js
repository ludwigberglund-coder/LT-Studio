'use strict';

(function registerPayablesQueue(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RollandsPayablesQueue=api;
})(typeof globalThis!=='undefined'?globalThis:this,function createPayablesQueue(){
  const FILTERS=Object.freeze({
    open:Object.freeze(['registered','coding-review','coded','approved','payment-prepared']),
    coding:Object.freeze(['registered','coding-review']),
    approval:Object.freeze(['coded']),
    payment:Object.freeze(['approved','payment-prepared']),
    paid:Object.freeze(['paid']),
    rejected:Object.freeze(['rejected']),
    all:Object.freeze([])
  });

  function text(value){return String(value??'').trim()}
  function normalize(value){return text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('sv')}
  function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(text(value)))return false;const [y,m,d]=value.split('-').map(Number);const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d}
  function dateValue(value){return validDate(value)?Number(value.replaceAll('-','')):99999999}
  function compareInvoices(a,b){
    const statusOrder={registered:1,'coding-review':1,coded:2,approved:3,'payment-prepared':4,rejected:8,paid:9};
    const aStatus=statusOrder[a?.status]??7,bStatus=statusOrder[b?.status]??7;
    if(aStatus!==bStatus)return aStatus-bStatus;
    const due=dateValue(a?.dueDate)-dateValue(b?.dueDate);if(due)return due;
    const supplier=text(a?.supplierName).localeCompare(text(b?.supplierName),'sv');if(supplier)return supplier;
    return text(a?.supplierInvoiceNumber).localeCompare(text(b?.supplierInvoiceNumber),'sv',{numeric:true});
  }
  function matchesFilter(invoice,filter='open'){
    const key=Object.hasOwn(FILTERS,filter)?filter:'open';
    const statuses=FILTERS[key];
    return !statuses.length||statuses.includes(invoice?.status);
  }
  function matchesQuery(invoice,query=''){
    const needle=normalize(query);if(!needle)return true;
    return [invoice?.supplierName,invoice?.supplierNumber,invoice?.supplierInvoiceNumber,invoice?.orgNumber].some(value=>normalize(value).includes(needle));
  }
  function filterInvoices(invoices,{filter='open',query=''}={}){
    return [...(Array.isArray(invoices)?invoices:[])].filter(invoice=>matchesFilter(invoice,filter)&&matchesQuery(invoice,query)).sort(compareInvoices);
  }
  function daysPastDue(dueDate,today){
    if(!validDate(dueDate)||!validDate(today))return 0;
    const [dy,dm,dd]=dueDate.split('-').map(Number),[ty,tm,td]=today.split('-').map(Number);
    return Math.max(0,Math.floor((Date.UTC(ty,tm-1,td)-Date.UTC(dy,dm-1,dd))/86400000));
  }
  function summarizeInvoices(invoices,today=''){
    const source=Array.isArray(invoices)?invoices:[];
    const counts=Object.fromEntries(Object.keys(FILTERS).map(filter=>[filter,source.filter(invoice=>matchesFilter(invoice,filter)).length]));
    const amounts=Object.fromEntries(Object.keys(FILTERS).map(filter=>[filter,source.filter(invoice=>matchesFilter(invoice,filter)).reduce((sum,invoice)=>sum+Number(invoice?.totalOre||0),0)]));
    const overdue=source.filter(invoice=>matchesFilter(invoice,'open')&&daysPastDue(invoice?.dueDate,today)>0);
    return Object.freeze({
      total:source.length,
      counts:Object.freeze(counts),
      amounts:Object.freeze(amounts),
      overdueCount:overdue.length,
      overdueOre:overdue.reduce((sum,invoice)=>sum+Number(invoice?.totalOre||0),0)
    });
  }
  return Object.freeze({FILTERS,validDate,compareInvoices,matchesFilter,matchesQuery,filterInvoices,daysPastDue,summarizeInvoices});
});
