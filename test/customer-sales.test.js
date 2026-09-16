'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const Auth=require('../apps/api/auth.js');
const Db=require('../apps/api/database.js');
const Accounting=require('../apps/api/accounting-store.js');
const {createCustomerSalesRouter}=require('../apps/api/customer-sales-router.js');

function fixture(){
  const db=Db.openDatabase(':memory:');
  const company=Db.createCompany(db,{legalName:'Testbutiken AB',displayName:'Testbutiken',orgNumber:'559800-1000'});
  const user=Db.createUser(db,{username:'sales.test',displayName:'Säljare Test',passwordHash:'test-hash-not-used'});
  Db.addMembership(db,{companyId:company.id,userId:user.id,roles:['sales']});
  const token='customer-sales-session-token',csrf='customer-sales-csrf-token';
  Db.createSession(db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId:user.id,companyId:company.id,expiresAt:new Date(Date.now()+3600000).toISOString()});
  const router=createCustomerSalesRouter({db,businessProfile:{legalName:'Testbutiken AB',name:'Testbutiken AB',orgNumber:'559800-1000',vatNumber:'SE559800100001',registeredOffice:'Göteborg',address:'Testgatan 1\n411 01 Göteborg',paymentAccount:'BG 123-4567',phone:'031-123456',email:'ekonomi@test.example'}});
  const server=http.createServer(async(req,res)=>{if(await router.handle(req,res))return;res.writeHead(404);res.end()});
  return{db,company,user,token,csrf,server};
}
async function withFixture(callback){const f=fixture();await new Promise((resolve,reject)=>f.server.listen(0,'127.0.0.1',e=>e?reject(e):resolve()));const base=`http://127.0.0.1:${f.server.address().port}`;try{await callback({...f,base})}finally{await new Promise(resolve=>f.server.close(resolve));f.db.close()}}
function headers(f){return{Cookie:`rollands_session=${f.token}`,'Content-Type':'application/json','X-CSRF-Token':f.csrf}}
async function createCustomer(f,number='K-501'){const response=await fetch(`${f.base}/api/v1/customers`,{method:'POST',headers:headers(f),body:JSON.stringify({customerNumber:number,name:'Kundbolaget AB',orgNumber:'559900-5010',email:'ekonomi@kund.example',address:{street:'Kundgatan 8',postalCode:'412 50',city:'Göteborg'},customerType:'business',reminderFeeAgreed:true})});assert.equal(response.status,201);return(await response.json()).customer}

test('kundfaktura får professionell PDF och balanserad bokföring',()=>withFixture(async f=>{
  const customer=await createCustomer(f);
  const issue=await fetch(`${f.base}/api/v1/customer-invoices`,{method:'POST',headers:headers(f),body:JSON.stringify({customerId:customer.id,invoiceDate:'2026-09-16',dueDate:'2026-10-16',lines:[{description:'Fruktleverans',quantity:2,unit:'låda',unitPriceOre:50000,vatRate:12,account:'3010'}]})});
  const data=await issue.json();assert.equal(issue.status,201,data.error);assert.equal(data.invoice.totalOre,112000);assert.equal(data.invoice.vatOre,12000);assert.equal(data.invoice.remainingOre,112000);
  const entry=Accounting.entryBySource(f.db,f.company.id,'customer-invoice',data.invoice.id);assert.deepEqual(entry.lines.map(l=>[l.account,l.debitOre,l.creditOre]),[['1510',112000,0],['3010',0,100000],['2621',0,12000]]);
  const pdf=await fetch(`${f.base}/api/v1/customer-invoices/${data.invoice.id}/pdf`,{headers:{Cookie:`rollands_session=${f.token}`}});assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');const bytes=Buffer.from(await pdf.arrayBuffer());assert.ok(bytes.length>1500);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.match(pdf.headers.get('x-document-sha256'),/^[a-f0-9]{64}$/);
}));

test('helkreditering skapar kreditfaktura och stänger originalfakturan',()=>withFixture(async f=>{
  const customer=await createCustomer(f,'K-502');
  const original=await fetch(`${f.base}/api/v1/customer-invoices`,{method:'POST',headers:headers(f),body:JSON.stringify({customerId:customer.id,invoiceDate:'2026-09-16',dueDate:'2026-10-16',lines:[{description:'Varor',quantity:1,unitPriceOre:100000,vatRate:25,account:'3010'}]})}).then(r=>r.json());
  const response=await fetch(`${f.base}/api/v1/customer-invoices/${original.invoice.id}/credit`,{method:'POST',headers:headers(f),body:JSON.stringify({invoiceDate:'2026-09-17',dueDate:'2026-09-17',reason:'Felaktig leverans'})});const credit=await response.json();assert.equal(response.status,201,credit.error);assert.equal(credit.invoice.status,'Kreditfaktura');assert.equal(credit.invoice.totalOre,-125000);const originalAfter=Db.invoiceById(f.db,f.company.id,original.invoice.id);assert.equal(originalAfter.status,'Krediterad');assert.equal(originalAfter.remainingOre,0);const entry=Accounting.entryBySource(f.db,f.company.id,'customer-credit-invoice',credit.invoice.id);assert.deepEqual(entry.lines.map(l=>[l.account,l.debitOre,l.creditOre]),[['1510',0,125000],['3010',100000,0],['2611',25000,0]]);
}));

test('mutation kräver CSRF och företagets data är sessionsisolerad',()=>withFixture(async f=>{
  const noCsrf=await fetch(`${f.base}/api/v1/customers`,{method:'POST',headers:{Cookie:`rollands_session=${f.token}`,'Content-Type':'application/json'},body:JSON.stringify({customerNumber:'K-X',name:'X'})});assert.equal(noCsrf.status,403);
  const listed=await fetch(`${f.base}/api/v1/customers`,{headers:{Cookie:`rollands_session=${f.token}`}});assert.equal(listed.status,200);assert.deepEqual((await listed.json()).customers,[]);
}));
