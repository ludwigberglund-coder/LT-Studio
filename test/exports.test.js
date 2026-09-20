'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Payables=require('../apps/api/payables.js');
const Bank=require('../apps/api/bank-payments.js');
const Accounting=require('../apps/api/accounting-store.js');
const Exports=require('../apps/api/exports.js');
const {createServer}=require('../apps/api/server.js');

function seed(){
  const db=Db.openDatabase(':memory:');
  Payables.initializePayables(db);Bank.initializeBankPayments(db);Accounting.initializeAccountingStore(db);
  const company=Db.createCompany(db,{legalName:'Export Test AB',displayName:'Export Test',orgNumber:'559990-1001'});
  const user=Db.createUser(db,{username:'export.user',displayName:'Export User',passwordHash:Auth.hashPassword('Sakert exportlosenord 2026!')});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  const customer=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-1',name:'=HYPERLINK("https://evil.invalid")'});
  Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'310001',invoiceDate:'2026-09-01',postingDate:'2026-09-01',dueDate:'2026-09-30',totalOre:125000,remainingOre:125000,vatOre:25000,status:'Bokförd'});
  Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'310002',invoiceDate:'2026-08-01',postingDate:'2026-08-01',dueDate:'2026-08-31',totalOre:50000,remainingOre:0,vatOre:10000,status:'Betald'});
  const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-1',name:'+SUM(1,1)',orgNumber:'559990-2002',bankgiro:'123-4567'});
  const supplierInvoice=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'@INV-1',invoiceDate:'2026-09-05',dueDate:'2026-10-05',totalOre:100000,vatOre:20000,registeredBy:user.id});
  Bank.create(db,{companyId:company.id,externalId:'EXP-IN-1',bookingDate:'2026-09-15',amountOre:55000,reference:'EXP-IN',payerName:'Export Kund',createdBy:user.id});
  db.prepare(`INSERT INTO supplier_payments(id,company_id,supplier_invoice_id,payment_date,amount_ore,account,status,prepared_by,recipient_name,recipient_bankgiro,created_at,updated_at)
    VALUES('EXP-OUT-1',?,?,?,?,?,'paid',?,?,?,'2026-09-16T10:00:00.000Z','2026-09-16T10:00:00.000Z')`).run(company.id,supplierInvoice.id,'2026-09-16',100000,'1930',user.id,'+SUM(1,1)','123-4567');
  Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-10',description:'@journal export',sourceType:'manual',sourceId:'exp-1',createdBy:user.id,lines:[{account:'1930',debitOre:100000,creditOre:0,text:'Bank'},{account:'3001',debitOre:0,creditOre:100000,text:'=sales'}]});
  return{db,company,user};
}

test('kundreskontraexport använder datum och statusfilter',()=>{
  const {db,company}=seed();
  try{
    const dataset=Exports.receivables(db,company.id,{from:'2026-09-01',to:'2026-09-30',status:'Bokförd'});
    assert.equal(dataset.rows.length,1);assert.equal(dataset.rows[0].invoiceNumber,'310001');
    const csv=Exports.buildCsv(dataset);
    assert.ok(csv.startsWith('\uFEFF'));
    assert.match(csv,/"'=HYPERLINK\(""https:\/\/evil\.invalid""\)"/);
    assert.equal(csv.includes('"310002"'),false);
  }finally{db.close()}
});

test('inbetalningsexport följer datumfilter och neutraliserar kundnamn',()=>{
  const {db,company}=seed();
  try{
    const invoice=db.prepare("SELECT id FROM invoices WHERE company_id=? AND invoice_number='310001'").get(company.id);
    db.prepare(`INSERT INTO invoice_transactions(id,company_id,invoice_id,transaction_type,payment_method,payment_date,posting_date,amount_ore,approved,account,bank_reference,created_at)
      VALUES('tx-exp-1',?,?, 'payment','Bankgiro','2026-09-15','2026-09-15',-125000,1,'1930','BG-1','2026-09-15T12:00:00.000Z')`).run(company.id,invoice.id);
    const dataset=Exports.receipts(db,company.id,{from:'2026-09-01',to:'2026-09-30'});
    assert.equal(dataset.rows.length,1);
    const csv=Exports.buildCsv(dataset);
    assert.match(csv,/2026-09-15/);
    assert.match(csv,/"'=HYPERLINK\(""https:\/\/evil\.invalid""\)"/);
  }finally{db.close()}
});

test('leverantörs- och huvudboksexport neutraliserar formelceller',()=>{
  const {db,company}=seed();
  try{
    const payables=Exports.buildCsv(Exports.payables(db,company.id,{from:'2026-09-01',to:'2026-09-30'}));
    assert.match(payables,/"'\+SUM\(1,1\)"/);
    assert.match(payables,/"'@INV-1"/);
    const ledger=Exports.buildCsv(Exports.ledger(db,company.id,{from:'2026-09-01',to:'2026-09-30'}));
    assert.match(ledger,/"'=sales"/);
    assert.match(ledger,/"'@journal export"/);
  }finally{db.close()}
});

test('betalningsöversiktsexport återanvänder vyfilter, sortering och formelskydd',()=>{
  const {db,company}=seed();
  try{
    const dataset=Exports.paymentOverview(db,company.id,{mode:'month',date:'2026-09-20',query:'+sum',account:'1930',sort:'amount',order:'desc'});
    assert.equal(dataset.rows.length,1);
    assert.equal(dataset.rows[0].direction,'Utbetalning');
    assert.equal(dataset.rows[0].amountOre,-100000);
    const csv=Exports.buildCsv(dataset);
    assert.match(csv,/"'\+SUM\(1,1\)"/);
    assert.equal(csv.includes('Export Kund'),false);
  }finally{db.close()}
});

test('ogiltiga exportfilter stoppas',()=>{
  const {db,company}=seed();
  try{
    assert.throws(()=>Exports.receivables(db,company.id,{from:'2026-09-31',to:'2026-10-01'}),e=>e.code==='INVALID_EXPORT_RANGE');
    assert.throws(()=>Exports.ledger(db,company.id,{from:'',to:''}),e=>e.code==='EXPORT_RANGE_REQUIRED');
    assert.throws(()=>Exports.select(db,company.id,'unknown',{}),e=>e.code==='EXPORT_NOT_FOUND'&&e.statusCode===404);
  }finally{db.close()}
});

test('HTTP-export kräver personlig session och skickar fil som bilaga',async()=>{
  const runtime=createServer({databasePath:':memory:',db:Db.openDatabase(':memory:'),secureCookies:false});
  const company=Db.createCompany(runtime.db,{legalName:'HTTP Export AB',displayName:'HTTP Export',orgNumber:'559990-3003'});
  const user=Db.createUser(runtime.db,{username:'http.export',displayName:'HTTP Export',passwordHash:'test-only'});
  Db.addMembership(runtime.db,{companyId:company.id,userId:user.id});
  const customer=Db.createCustomer(runtime.db,{companyId:company.id,customerNumber:'K-HTTP',name:'HTTP Kund'});
  Db.createInvoice(runtime.db,{companyId:company.id,customerId:customer.id,invoiceNumber:'320001',invoiceDate:'2026-09-01',postingDate:'2026-09-01',dueDate:'2026-09-30',totalOre:10000,remainingOre:10000,vatOre:2000,status:'Bokförd'});
  const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
  Db.createSession(runtime.db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId:user.id,companyId:company.id,expiresAt:new Date(Date.now()+60000).toISOString()});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  try{
    assert.equal((await fetch(base+'/api/v1/exports/receivables?from=2026-09-01&to=2026-09-30')).status,401);
    const response=await fetch(base+'/api/v1/exports/receivables?from=2026-09-01&to=2026-09-30',{headers:{Cookie:`rollands_session=${token}`}});
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/^text\/csv/);
    assert.match(response.headers.get('content-disposition'),/kundreskontra\.csv/);
    assert.match(await response.text(),/320001/);
  }finally{await new Promise(resolve=>runtime.close(resolve))}
});
