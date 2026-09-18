'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Accounting=require('../apps/api/accounting-store.js');
const {createServer}=require('../apps/api/server.js');

function makeSession(db,companyId,userId,roles){
  Db.addMembership(db,{companyId,userId,roles});
  const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
  Db.createSession(db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId,companyId,expiresAt:new Date(Date.now()+60*60*1000).toISOString()});
  return{cookie:`rollands_session=${token}`,csrf};
}
async function request(base,path,session,{method='GET',body,headers={}}={}){
  const finalHeaders={Accept:'application/json',Cookie:session.cookie,...headers};
  let finalBody=body;
  if(body!==undefined&&!(body instanceof Uint8Array)&&!Buffer.isBuffer(body)){finalHeaders['Content-Type']='application/json';finalBody=JSON.stringify(body)}
  if(method!=='GET')finalHeaders['X-CSRF-Token']=session.csrf;
  const response=await fetch(`${base}${path}`,{method,headers:finalHeaders,body:finalBody});
  const type=response.headers.get('content-type')||'';const data=type.includes('application/json')?await response.json():await response.arrayBuffer();
  return{response,data};
}
function net2440(entries){return entries.flatMap(entry=>entry.lines||[]).filter(line=>line.account==='2440').reduce((sum,line)=>sum+line.debitOre-line.creditOre,0)}

test('riktiga HTTP-rutter genomför leverantörsfakturans bokföringsflöde utan dubbletter',async()=>{
  const db=Db.openDatabase(':memory:');
  const company=Db.createCompany(db,{legalName:'HTTP Test AB',displayName:'HTTP Test',orgNumber:'559900-8811'});
  const hash=Auth.hashPassword('Sakert http testlosenord 2026!');
  const accountant=Db.createUser(db,{username:'http-accountant',displayName:'Ekonom',passwordHash:hash});
  const approver=Db.createUser(db,{username:'http-approver',displayName:'Attestant',passwordHash:hash});
  const accountantSession=makeSession(db,company.id,accountant.id,['accountant']);
  const approverSession=makeSession(db,company.id,approver.id,['approver']);
  const runtime=createServer({db,host:'127.0.0.1',secureCookies:false});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  try{
    let result=await request(base,'/api/v1/payables/suppliers',accountantSession,{method:'POST',body:{supplierNumber:'L-144',name:'Billdal Kyla & Service AB',orgNumber:'559100-1449',bankgiro:'333-4411',defaultCostAccount:'4010'}});
    assert.equal(result.response.status,201);const supplier=result.data.supplier;
    result=await request(base,'/api/v1/payables/invoices',accountantSession,{method:'POST',body:{supplierId:supplier.id,supplierInvoiceNumber:'BKS-771',invoiceDate:'2026-09-08',dueDate:'2026-09-17',totalOre:125000,vatOre:25000,currency:'SEK'}});
    assert.equal(result.response.status,201);const invoice=result.data.invoice;
    result=await request(base,`/api/v1/payables/invoices/${invoice.id}/document`,accountantSession,{method:'PUT',body:Buffer.from('%PDF-1.4\n% BKS-771 HTTP test\n'),headers:{'Content-Type':'application/pdf','X-Document-Name':'BKS-771.pdf'}});assert.equal(result.response.status,201);
    const lines=[{account:'4010',debitOre:100000,creditOre:0,text:'Servicekostnad',vatCode:'INPUT_VAT'},{account:'2641',debitOre:25000,creditOre:0,text:'Ingående moms',vatCode:'INPUT_VAT'},{account:'2440',debitOre:0,creditOre:125000,text:'Leverantörsskuld',vatCode:''}];
    result=await request(base,`/api/v1/payables/invoices/${invoice.id}/coding`,accountantSession,{method:'PUT',body:{lines}});assert.equal(result.response.status,200);const reviewed=result.data.invoice;
    result=await request(base,`/api/v1/payables/invoices/${invoice.id}/approve`,approverSession,{method:'POST',body:{}});assert.equal(result.response.status,428);assert.equal(result.data.code,'APPROVAL_PRECONDITION_REQUIRED');
    result=await request(base,`/api/v1/payables/invoices/${invoice.id}/approve`,approverSession,{method:'POST',body:{expectedCodingSha256:reviewed.codingSha256,expectedDocumentSha256:reviewed.documentSha256}});assert.equal(result.response.status,200);

    result=await request(base,`/api/v1/payables/invoices/${invoice.id}/post`,approverSession,{method:'POST',body:{}});assert.equal(result.response.status,403);assert.equal(result.data.code,'ACCESS_DENIED');
    result=await request(base,`/api/v1/payables/invoices/${invoice.id}/post`,accountantSession,{method:'POST',body:{}});assert.equal(result.response.status,200);const invoiceEntry=result.data.entry;assert.deepEqual(invoiceEntry.lines.map(line=>[line.account,line.debitOre,line.creditOre]),[['4010',100000,0],['2641',25000,0],['2440',0,125000]]);
    result=await request(base,`/api/v1/payables/invoices/${invoice.id}/post`,accountantSession,{method:'POST',body:{}});assert.equal(result.response.status,200);assert.equal(result.data.duplicate,true);assert.equal(result.data.entry.id,invoiceEntry.id);

    result=await request(base,`/api/v1/payables/invoices/${invoice.id}/prepare-payment`,accountantSession,{method:'POST',body:{paymentDate:'2026-09-17',account:'1930'}});assert.equal(result.response.status,201);const payment=result.data.payment;
    result=await request(base,`/api/v1/payables/payments/${payment.id}/release`,approverSession,{method:'POST',body:{}});assert.equal(result.response.status,200);
    result=await request(base,`/api/v1/payables/payments/${payment.id}/confirm`,accountantSession,{method:'POST',body:{confirmationReference:'BANK-BKS-OLD',postingDate:'2026-09-17'}});assert.equal(result.response.status,404);
    assert.equal(Accounting.entryBySource(db,company.id,'supplier-payment',payment.id),null);
    result=await request(base,`/api/v1/payables/payments/${payment.id}/confirm-post`,accountantSession,{method:'POST',body:{confirmationReference:'BANK-BKS-771',postingDate:'2026-09-17'}});assert.equal(result.response.status,200);const paymentEntry=result.data.entry;assert.deepEqual(paymentEntry.lines.map(line=>[line.account,line.debitOre,line.creditOre]),[['2440',125000,0],['1930',0,125000]]);
    result=await request(base,`/api/v1/payables/payments/${payment.id}/confirm-post`,accountantSession,{method:'POST',body:{confirmationReference:'BANK-BKS-771',postingDate:'2026-09-17'}});assert.equal(result.response.status,200);assert.equal(result.data.duplicate,true);assert.equal(result.data.entry.id,paymentEntry.id);
    result=await request(base,`/api/v1/payables/invoices/${invoice.id}`,accountantSession);assert.equal(result.response.status,200);assert.equal(result.data.invoice.status,'paid');assert.equal(result.data.invoice.openAmountOre,0);
    const fullEntries=[Accounting.entryBySource(db,company.id,'supplier-invoice',invoice.id),Accounting.entryBySource(db,company.id,'supplier-payment',payment.id)];assert.equal(net2440(fullEntries),0);
    assert.equal(Accounting.listEntries(db,company.id).filter(entry=>['supplier-invoice','supplier-payment'].includes(entry.sourceType)).length,2);
  }finally{
    await new Promise(resolve=>runtime.close(resolve));
  }
});
