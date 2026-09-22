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

test('försäljningsexport summerar kunder och behåller kalkylbladsformelskyddet',()=>{
  const {db,company}=seed();
  try{
    const dataset=Exports.sales(db,company.id,{from:'2026-09-01',to:'2026-09-30'});
    assert.equal(dataset.filename,'forsaljningsrapport.csv');
    assert.equal(dataset.rows.length,1);
    assert.equal(dataset.rows[0].invoiceCount,1);
    assert.equal(dataset.rows[0].netOre,100000);
    assert.equal(dataset.rows[0].vatOre,25000);
    assert.equal(dataset.rows[0].grossOre,125000);
    assert.equal(dataset.rows[0].outstandingOre,125000);
    const csv=Exports.buildCsv(dataset);
    assert.match(csv,/"'=HYPERLINK\(""https:\/\/evil\.invalid""\)"/);
    assert.match(csv,/125000/);
  }finally{db.close()}
});

test('betalningsöversiktsexport återanvänder vyfilter, sortering och formelskydd',()=>{
  const {db,company}=seed();
  try{
    const dataset=Exports.paymentOverview(db,company.id,{mode:'month',date:'2026-09-20',query:'+sum',account:'1930',sort:'amount',order:'desc'});
    assert.equal(dataset.rows.length,1);
    assert.equal(dataset.rows[0].direction,'Utbetalning');
    assert.equal(dataset.rows[0].status,'Betald & bokförd');
    assert.equal(dataset.rows[0].amountOre,-100000);
    const csv=Exports.buildCsv(dataset);
    assert.match(csv,/Betald & bokförd/);
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

test('export-router kräver den separata reports.export-behörigheten',async()=>{
  const http=require('node:http');
  const {createExportsRouter}=require('../apps/api/exports-router.js');
  const db=Db.openDatabase(':memory:');
  const accessConfig={
    version:2,
    policy:{defaultDecision:'deny',requirePersonalAccounts:true,sessionIdleMinutes:60,sessionMaxMinutes:480,requireMfa:true},
    permissions:[{id:'reports.export',label:'Exportera rapporter',category:'Rapporter',risk:'write'}],
    roles:[{id:'admin',label:'Admin',description:'Testroll',permissions:['reports.export']}],
    workflows:[{
      id:'export-test-separation',label:'Exporttest',requiredPermission:'reports.export',distinctActors:true,
      fields:[{id:'requestedBy',label:'Begärd av'},{id:'approvedBy',label:'Godkänd av'}],reason:'Testkonfiguration'
    }]
  };
  const router=createExportsRouter({db,accessConfig});
  const company=Db.createCompany(db,{legalName:'Permission Export AB',displayName:'Permission Export',orgNumber:'559990-3999'});
  const user=Db.createUser(db,{username:'permission.export',displayName:'Permission Export',passwordHash:'test-only'});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  const customer=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-PERM',name:'Permission Kund'});
  Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'P-1001',invoiceDate:'2026-09-01',postingDate:'2026-09-01',dueDate:'2026-09-30',totalOre:10000,remainingOre:10000,vatOre:2000,status:'Bokförd'});
  const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
  Db.createSession(db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId:user.id,companyId:company.id,expiresAt:new Date(Date.now()+60000).toISOString()});
  const server=http.createServer(async(req,res)=>{
    if(await router.handle(req,res))return;
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const response=await fetch(base+'/api/v1/exports/receivables?from=2026-09-01&to=2026-09-30',{headers:{Cookie:`rollands_session=${token}`}});
    assert.equal(response.status,200);
    assert.match(await response.text(),/P-1001/);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    db.close();
  }
});

test('HTTP-export isoleras av sessionens företag även när flera företag har data i samma period',async()=>{
  const runtime=createServer({databasePath:':memory:',db:Db.openDatabase(':memory:'),secureCookies:false});
  const companyA=Db.createCompany(runtime.db,{legalName:'Export A AB',displayName:'Export A',orgNumber:'559990-4001'});
  const companyB=Db.createCompany(runtime.db,{legalName:'Export B AB',displayName:'Export B',orgNumber:'559990-4002'});
  const userA=Db.createUser(runtime.db,{username:'export.a',displayName:'Export A User',passwordHash:'test-only-a'});
  const userB=Db.createUser(runtime.db,{username:'export.b',displayName:'Export B User',passwordHash:'test-only-b'});
  Db.addMembership(runtime.db,{companyId:companyA.id,userId:userA.id});
  Db.addMembership(runtime.db,{companyId:companyB.id,userId:userB.id});
  const customerA=Db.createCustomer(runtime.db,{companyId:companyA.id,customerNumber:'KA-1',name:'Kund A'});
  const customerB=Db.createCustomer(runtime.db,{companyId:companyB.id,customerNumber:'KB-1',name:'Kund B'});
  Db.createInvoice(runtime.db,{companyId:companyA.id,customerId:customerA.id,invoiceNumber:'A-ONLY-1001',invoiceDate:'2026-09-01',postingDate:'2026-09-01',dueDate:'2026-09-30',totalOre:10000,remainingOre:10000,vatOre:2000,status:'Bokförd'});
  Db.createInvoice(runtime.db,{companyId:companyB.id,customerId:customerB.id,invoiceNumber:'B-SECRET-9001',invoiceDate:'2026-09-01',postingDate:'2026-09-01',dueDate:'2026-09-30',totalOre:90000,remainingOre:90000,vatOre:18000,status:'Bokförd'});

  const tokenA=Auth.randomToken(32),csrfA=Auth.randomToken(24);
  const tokenB=Auth.randomToken(32),csrfB=Auth.randomToken(24);
  const expiresAt=new Date(Date.now()+60000).toISOString();
  Db.createSession(runtime.db,{tokenHash:Auth.hashToken(tokenA),csrfHash:Auth.hashToken(csrfA),userId:userA.id,companyId:companyA.id,expiresAt});
  Db.createSession(runtime.db,{tokenHash:Auth.hashToken(tokenB),csrfHash:Auth.hashToken(csrfB),userId:userB.id,companyId:companyB.id,expiresAt});

  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  try{
    const exportA=await fetch(base+'/api/v1/exports/receivables?from=2026-09-01&to=2026-09-30',{headers:{Cookie:`rollands_session=${tokenA}`}});
    const textA=await exportA.text();
    assert.equal(exportA.status,200);
    assert.match(textA,/A-ONLY-1001/);
    assert.doesNotMatch(textA,/B-SECRET-9001/);

    const exportB=await fetch(base+'/api/v1/exports/receivables?from=2026-09-01&to=2026-09-30',{headers:{Cookie:`rollands_session=${tokenB}`}});
    const textB=await exportB.text();
    assert.equal(exportB.status,200);
    assert.match(textB,/B-SECRET-9001/);
    assert.doesNotMatch(textB,/A-ONLY-1001/);
  }finally{await new Promise(resolve=>runtime.close(resolve))}
});


test('ålders- och inköpsexporter återanvänder rapporternas företagsisolerade underlag',()=>{
  const {db,company,user}=seed();
  try{
    const customer2=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-2',name:'Export Aging Kund'});
    Db.createInvoice(db,{companyId:company.id,customerId:customer2.id,invoiceNumber:'330001',invoiceDate:'2026-08-01',postingDate:'2026-08-01',dueDate:'2026-09-01',totalOre:30000,remainingOre:30000,vatOre:6000,status:'Bokförd'});
    const supplier2=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-2',name:'Export Inköp AB',orgNumber:'559990-2003',bankgiro:'555-0000'});
    Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier2.id,supplierInvoiceNumber:'EXP-S-2',invoiceDate:'2026-09-20',dueDate:'2026-11-20',totalOre:120000,vatOre:20000,registeredBy:user.id});

    const receivables=Exports.receivablesAging(db,company.id,{asOf:'2026-10-20'});
    assert.equal(receivables.filename,'kundfordringar-alder-2026-10-20.csv');
    assert.ok(receivables.rows.some(row=>row.customerNumber==='K-2'&&row.overdue31to60Ore===30000));

    const payables=Exports.payablesAging(db,company.id,{asOf:'2026-10-20'});
    assert.equal(payables.filename,'leverantorsskulder-alder-2026-10-20.csv');
    assert.ok(payables.rows.some(row=>row.supplierNumber==='L-2'&&row.unpostedOpenOre===120000));

    const purchases=Exports.supplierPurchases(db,company.id,{from:'2026-09-01',to:'2026-09-30'});
    assert.equal(purchases.filename,'inkop-per-leverantor.csv');
    assert.ok(purchases.rows.some(row=>row.supplierNumber==='L-2'&&row.grossOre===120000));

    const csv=Exports.buildCsv(purchases);
    assert.match(csv,/Export Inköp AB/);
    assert.match(csv,/120000/);
  }finally{db.close()}
});

test('HTTP-export för åldersanalys är låst till sessionens företag',async()=>{
  const runtime=createServer({databasePath:':memory:',db:Db.openDatabase(':memory:'),secureCookies:false});
  const companyA=Db.createCompany(runtime.db,{legalName:'Aging A AB',displayName:'Aging A',orgNumber:'559990-5001'});
  const companyB=Db.createCompany(runtime.db,{legalName:'Aging B AB',displayName:'Aging B',orgNumber:'559990-5002'});
  const userA=Db.createUser(runtime.db,{username:'aging.a',displayName:'Aging A User',passwordHash:'test-only-a'});
  const userB=Db.createUser(runtime.db,{username:'aging.b',displayName:'Aging B User',passwordHash:'test-only-b'});
  Db.addMembership(runtime.db,{companyId:companyA.id,userId:userA.id});
  Db.addMembership(runtime.db,{companyId:companyB.id,userId:userB.id});
  const customerA=Db.createCustomer(runtime.db,{companyId:companyA.id,customerNumber:'A-K',name:'A Kund'});
  const customerB=Db.createCustomer(runtime.db,{companyId:companyB.id,customerNumber:'B-K',name:'B Hemlig Kund'});
  Db.createInvoice(runtime.db,{companyId:companyA.id,customerId:customerA.id,invoiceNumber:'A-AGING',invoiceDate:'2026-08-01',postingDate:'2026-08-01',dueDate:'2026-09-01',totalOre:10000,remainingOre:10000,vatOre:2000,status:'Bokförd'});
  Db.createInvoice(runtime.db,{companyId:companyB.id,customerId:customerB.id,invoiceNumber:'B-SECRET-AGING',invoiceDate:'2026-08-01',postingDate:'2026-08-01',dueDate:'2026-09-01',totalOre:90000,remainingOre:90000,vatOre:18000,status:'Bokförd'});
  const tokenA=Auth.randomToken(32),csrfA=Auth.randomToken(24);
  Db.createSession(runtime.db,{tokenHash:Auth.hashToken(tokenA),csrfHash:Auth.hashToken(csrfA),userId:userA.id,companyId:companyA.id,expiresAt:new Date(Date.now()+60000).toISOString()});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  try{
    const response=await fetch(base+'/api/v1/exports/receivables-aging?asOf=2026-10-20',{headers:{Cookie:`rollands_session=${tokenA}`}});
    const body=await response.text();
    assert.equal(response.status,200);
    assert.match(body,/A Kund/);
    assert.doesNotMatch(body,/B Hemlig Kund|B-SECRET-AGING|90000/);
  }finally{await new Promise(resolve=>runtime.close(resolve))}
});
