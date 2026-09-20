'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Bank=require('../apps/api/bank-payments.js');
const Payables=require('../apps/api/payables.js');
const Overview=require('../apps/api/payments-overview.js');
const {createServer}=require('../apps/api/server.js');

function seedCompany(db,suffix){
  const company=Db.createCompany(db,{legalName:`Betaltest ${suffix} AB`,displayName:`Betaltest ${suffix}`,orgNumber:`559920-${suffix}`});
  const user=Db.createUser(db,{username:`payments.${suffix}`,displayName:`Payments ${suffix}`,passwordHash:Auth.hashPassword('Ett sakert betalningslosenord 2026!')});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  return{company,user};
}
function seedOutgoing(db,company,user,{date='2026-09-18',amountOre=40000,account='1930',supplierName='Leverantör AB',number='LF-1'}={}){
  Payables.initializePayables(db);
  const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-'+number,name:supplierName,bankgiro:'555-0000'});
  const invoice=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:number,invoiceDate:date,dueDate:date,totalOre:amountOre,vatOre:0,registeredBy:user.id});
  const id='spay_'+number.replace(/[^A-Za-z0-9]/g,'');
  const now=new Date().toISOString();
  db.prepare(`INSERT INTO supplier_payments(id,company_id,supplier_invoice_id,payment_date,amount_ore,account,status,prepared_by,recipient_name,recipient_bankgiro,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'prepared',?,?,?,?,?)`).run(id,company.id,invoice.id,date,amountOre,account,user.id,supplierName,'555-0000',now,now);
  return{id,invoice};
}

test('dag vecka månad och kvartal ger korrekta datumgränser',()=>{
  assert.deepEqual(Overview.bounds('2026-09-20','day'),{from:'2026-09-20',to:'2026-09-20'});
  assert.deepEqual(Overview.bounds('2026-09-20','week'),{from:'2026-09-14',to:'2026-09-20'});
  assert.deepEqual(Overview.bounds('2026-09-20','month'),{from:'2026-09-01',to:'2026-09-30'});
  assert.deepEqual(Overview.bounds('2026-09-20','quarter'),{from:'2026-07-01',to:'2026-09-30'});
});

test('översikten kombinerar in- och utbetalningar och räknar totalsummor',()=>{
  const db=Db.openDatabase(':memory:');Bank.initializeBankPayments(db);Payables.initializePayables(db);
  try{
    const {company,user}=seedCompany(db,'1001');
    Bank.create(db,{companyId:company.id,externalId:'BANK-1',bookingDate:'2026-09-17',amountOre:100000,payerName:'Kund AB',payerAccount:'1930',status:'unmatched',createdBy:user.id});
    seedOutgoing(db,company,user,{date:'2026-09-18',amountOre:40000,account:'1930'});
    const result=Overview.list(db,company.id,{date:'2026-09-20',period:'week'});
    assert.equal(result.rows.length,2);
    assert.deepEqual(result.totals,{incomingOre:100000,outgoingOre:40000,netOre:60000,count:2});
    assert.deepEqual(new Set(result.rows.map(r=>r.direction)),new Set(['in','out']));
  }finally{db.close()}
});

test('filter på riktning konto motpart status och belopp tillämpas utan att ändra källdata',()=>{
  const db=Db.openDatabase(':memory:');Bank.initializeBankPayments(db);Payables.initializePayables(db);
  try{
    const {company,user}=seedCompany(db,'1002');
    Bank.create(db,{companyId:company.id,externalId:'BANK-2',bookingDate:'2026-09-15',amountOre:75000,payerName:'Alfa Kund',payerAccount:'1930',createdBy:user.id});
    seedOutgoing(db,company,user,{date:'2026-09-16',amountOre:55000,account:'1930',supplierName:'Beta Grossist',number:'LF-2'});
    const filtered=Overview.list(db,company.id,{from:'2026-09-01',to:'2026-09-30',direction:'out',account:'1930',status:'prepared',counterparty:'beta',minOre:'50000',maxOre:'60000'});
    assert.equal(filtered.rows.length,1);
    assert.equal(filtered.rows[0].counterparty,'Beta Grossist');
    assert.equal(Bank.list(db,company.id).length,1);
    assert.equal(Payables.listPayments(db,company.id).length,1);
  }finally{db.close()}
});

test('företagsisolering gäller även i den kombinerade betalningsöversikten',()=>{
  const db=Db.openDatabase(':memory:');Bank.initializeBankPayments(db);Payables.initializePayables(db);
  try{
    const a=seedCompany(db,'1003'),b=seedCompany(db,'1004');
    Bank.create(db,{companyId:a.company.id,externalId:'A-IN',bookingDate:'2026-09-19',amountOre:1000,payerName:'A Kund',createdBy:a.user.id});
    Bank.create(db,{companyId:b.company.id,externalId:'B-IN',bookingDate:'2026-09-19',amountOre:999999,payerName:'B Kund',createdBy:b.user.id});
    seedOutgoing(db,b.company,b.user,{date:'2026-09-19',amountOre:888888,supplierName:'B Leverantör',number:'B-LF'});
    const result=Overview.list(db,a.company.id,{from:'2026-09-01',to:'2026-09-30'});
    assert.equal(result.rows.length,1);
    assert.equal(result.rows[0].counterparty,'A Kund');
    assert.equal(result.totals.incomingOre,1000);
  }finally{db.close()}
});

test('HTTP-översikten kräver session och använder serverns företagsmedlemskap',async()=>{
  const db=Db.openDatabase(':memory:');Bank.initializeBankPayments(db);Payables.initializePayables(db);
  const {company,user}=seedCompany(db,'1005');
  Bank.create(db,{companyId:company.id,externalId:'HTTP-IN',bookingDate:'2026-09-20',amountOre:25000,payerName:'HTTP Kund',createdBy:user.id});
  const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
  Db.createSession(db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId:user.id,companyId:company.id,expiresAt:new Date(Date.now()+60000).toISOString()});
  const runtime=createServer({db,databasePath:':memory:',secureCookies:false});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  try{
    const port=runtime.server.address().port;
    const url=`http://127.0.0.1:${port}/api/v1/bank/overview?date=2026-09-20&period=day`;
    assert.equal((await fetch(url)).status,401);
    const response=await fetch(url,{headers:{Cookie:`rollands_session=${token}`}});
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.rows.length,1);
    assert.equal(body.totals.incomingOre,25000);
  }finally{await new Promise(resolve=>runtime.close(resolve))}
});
