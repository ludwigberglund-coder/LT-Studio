'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Bank=require('../apps/api/bank-payments.js');
const Payables=require('../apps/api/payables.js');
const Overview=require('../apps/api/payment-overview.js');
const {createServer}=require('../apps/api/server.js');

function seed(){
  const db=Db.openDatabase(':memory:');Bank.initializeBankPayments(db);Payables.initializePayables(db);
  const company=Db.createCompany(db,{legalName:'Betaltest AB',displayName:'Betaltest',orgNumber:'559980-1001'});
  const other=Db.createCompany(db,{legalName:'Annat Betaltest AB',displayName:'Annat',orgNumber:'559980-1002'});
  const user=Db.createUser(db,{username:'payment.user',displayName:'Payment User',passwordHash:'test-only'});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  Bank.create(db,{companyId:company.id,externalId:'IN-1',bookingDate:'2026-09-07',amountOre:20000,reference:'INREF',payerName:'Kund A',createdBy:user.id});
  Bank.create(db,{companyId:company.id,externalId:'IN-2',bookingDate:'2026-09-14',amountOre:30000,reference:'INREF2',payerName:'Kund B',createdBy:user.id});
  Bank.create(db,{companyId:other.id,externalId:'OTHER',bookingDate:'2026-09-07',amountOre:999999,reference:'OTHER',payerName:'Annat',createdBy:null});
  const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-1',name:'Leverantör A',bankgiro:'123-4567'});
  const invoice=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'L-INV-1',invoiceDate:'2026-09-01',dueDate:'2026-09-30',totalOre:12500,vatOre:2500,registeredBy:user.id});
  db.prepare(`INSERT INTO supplier_payments(id,company_id,supplier_invoice_id,payment_date,amount_ore,account,status,prepared_by,recipient_name,recipient_bankgiro,created_at,updated_at)
    VALUES('OUT-1',?,?,?,?,?,'paid',?,?,?,'2026-09-08T10:00:00.000Z','2026-09-08T10:00:00.000Z')`)
    .run(company.id,invoice.id,'2026-09-08',12500,'1930',user.id,'Leverantör A','123-4567');
  return{db,company,user};
}

test('periodgränser för vecka, månad och kvartal är deterministiska',()=>{
  assert.deepEqual(Overview.periodBounds({mode:'week',date:'2026-09-09'}),{from:'2026-09-07',to:'2026-09-13',label:'2026-09-07 – 2026-09-13',mode:'week'});
  assert.deepEqual(Overview.periodBounds({mode:'month',date:'2026-09-09'}),{from:'2026-09-01',to:'2026-09-30',label:'2026-09',mode:'month'});
  assert.deepEqual(Overview.periodBounds({mode:'quarter',date:'2026-09-09'}),{from:'2026-07-01',to:'2026-09-30',label:'2026 Q3',mode:'quarter'});
});

test('betalningsöversikt summerar in och ut utan data från andra företag',()=>{
  const {db,company}=seed();try{
    const report=Overview.paymentOverview(db,company.id,{mode:'week',date:'2026-09-09'});
    assert.equal(report.rows.length,2);
    assert.equal(report.summary.incomingOre,20000);
    assert.equal(report.summary.outgoingOre,12500);
    assert.equal(report.summary.netOre,7500);
    assert.equal(report.rows.some(row=>row.amountOre===999999),false);
    const incomingOnly=Overview.paymentOverview(db,company.id,{mode:'week',date:'2026-09-09',direction:'in'});
    assert.equal(incomingOnly.rows.length,1);assert.equal(incomingOnly.summary.outgoingOre,0);
  }finally{db.close()}
});

test('HTTP betalningsöversikt kräver personlig session',async()=>{
  const runtime=createServer({databasePath:':memory:',db:Db.openDatabase(':memory:'),secureCookies:false});
  const company=Db.createCompany(runtime.db,{legalName:'HTTP Betal AB',displayName:'HTTP Betal',orgNumber:'559980-2002'});
  const user=Db.createUser(runtime.db,{username:'http.payment',displayName:'HTTP Payment',passwordHash:'test-only'});
  Db.addMembership(runtime.db,{companyId:company.id,userId:user.id});
  Bank.create(runtime.db,{companyId:company.id,externalId:'HTTP-IN',bookingDate:'2026-09-20',amountOre:45000,reference:'HTTP',payerName:'HTTP Kund',createdBy:user.id});
  const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
  Db.createSession(runtime.db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId:user.id,companyId:company.id,expiresAt:new Date(Date.now()+60000).toISOString()});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  try{
    assert.equal((await fetch(base+'/api/v1/reports/payments-overview?mode=day&date=2026-09-20')).status,401);
    const response=await fetch(base+'/api/v1/reports/payments-overview?mode=day&date=2026-09-20',{headers:{Cookie:`rollands_session=${token}`}});
    assert.equal(response.status,200);const body=await response.json();assert.equal(body.summary.incomingOre,45000);assert.equal(body.summary.count,1);
  }finally{await new Promise(resolve=>runtime.close(resolve))}
});
