'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Payables=require('../apps/api/payables.js');
const Admin=require('../apps/api/accounting-admin.js');
const Preview=require('../apps/api/opening-migration-preview.js');
const {createServer}=require('../apps/api/server.js');

function seed(){
  const db=Db.openDatabase(':memory:');
  Payables.initializePayables(db);
  Admin.initializeAccountingAdmin(db);
  const company=Db.createCompany(db,{legalName:'Migration Preview AB',displayName:'Migration Preview',orgNumber:'559960-1001'});
  const user=Db.createUser(db,{username:'migration.preview',displayName:'Migration Preview User',passwordHash:'test-only'});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  Db.createCustomer(db,{companyId:company.id,customerNumber:'K-1001',name:'Befintlig Kund AB'});
  Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-1001',name:'Befintlig Leverantör AB',defaultCostAccount:'4010'});
  return{db,company,user};
}
function goodPackage(){
  return{
    year:'2026',
    postingDate:'2026-01-01',
    lines:[
      {account:'1510',text:'Öppna kundfordringar',debitOre:125000,creditOre:0},
      {account:'1930',text:'Bank',debitOre:100000,creditOre:0},
      {account:'2440',text:'Öppna leverantörsskulder',debitOre:0,creditOre:50000},
      {account:'2091',text:'Balanserat resultat',debitOre:0,creditOre:175000}
    ],
    receivables:[
      {customerNumber:'K-1001',invoiceNumber:'K-OLD-001',invoiceDate:'2025-12-15',dueDate:'2026-01-15',totalOre:150000,remainingOre:125000}
    ],
    payables:[
      {supplierNumber:'L-1001',invoiceNumber:'L-OLD-001',invoiceDate:'2025-12-10',dueDate:'2026-01-10',totalOre:70000,remainingOre:50000}
    ]
  };
}
function counts(db,companyId){
  return{
    entries:Number(db.prepare('SELECT COUNT(*) AS n FROM accounting_entries WHERE company_id=?').get(companyId).n),
    invoices:Number(db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE company_id=?').get(companyId).n),
    supplierInvoices:Number(db.prepare('SELECT COUNT(*) AS n FROM supplier_invoices WHERE company_id=?').get(companyId).n),
    audit:Number(db.prepare('SELECT COUNT(*) AS n FROM audit_events WHERE company_id=?').get(companyId).n)
  };
}

test('korrekt systembytespaket passerar kontroll utan att skriva affärsdata',()=>{
  const {db,company}=seed();
  try{
    const before=counts(db,company.id);
    const preview=Preview.previewOpeningMigration(db,{companyId:company.id,...goodPackage()});
    const after=counts(db,company.id);

    assert.equal(preview.mode,'preview-only');
    assert.equal(preview.executionSupported,false);
    assert.equal(preview.status,'pass');
    assert.equal(preview.blockers.length,0);
    assert.equal(preview.controls.openingBalance.valid,true);
    assert.equal(preview.controls.openingBalance.debitOre,225000);
    assert.equal(preview.controls.openingBalance.creditOre,225000);
    assert.deepEqual(preview.controls.receivables,{subledgerOre:125000,account1510Ore:125000,differenceOre:0,matched:true});
    assert.deepEqual(preview.controls.payables,{subledgerOre:50000,account2440Ore:50000,differenceOre:0,matched:true});
    assert.deepEqual(preview.masterdata.missingCustomerNumbers,[]);
    assert.deepEqual(preview.masterdata.missingSupplierNumbers,[]);
    assert.deepEqual(after,before);
    assert.match(preview.warnings[0].message,/Ingen faktura, reskontrapost, verifikation eller auditpost har skapats/i);
  }finally{db.close()}
});

test('preview stoppar reskontradifferenser, dubbletter och masterdata från annat företag utan informationsläckage',()=>{
  const {db,company}=seed();
  try{
    const other=Db.createCompany(db,{legalName:'Hemligt Migreringsbolag AB',displayName:'Hemligt Migreringsbolag',orgNumber:'559960-1002'});
    Db.createCustomer(db,{companyId:other.id,customerNumber:'SECRET-K',name:'Hemlig Kund Som Inte Får Läckas'});
    Payables.createSupplier(db,{companyId:other.id,supplierNumber:'SECRET-L',name:'Hemlig Leverantör Som Inte Får Läckas',defaultCostAccount:'4010'});

    const input=goodPackage();
    input.lines=[
      {account:'1510',text:'Fel kundsaldo',debitOre:120000,creditOre:0},
      {account:'1930',text:'Bank',debitOre:100000,creditOre:0},
      {account:'2440',text:'Fel leverantörssaldo',debitOre:0,creditOre:40000},
      {account:'2091',text:'Balansering',debitOre:0,creditOre:180000}
    ];
    input.receivables=[
      {customerNumber:'SECRET-K',invoiceNumber:'DUP-001',invoiceDate:'2025-12-15',dueDate:'2026-01-15',totalOre:125000,remainingOre:125000},
      {customerNumber:'SECRET-K',invoiceNumber:'DUP-001',invoiceDate:'2025-12-16',dueDate:'2026-01-16',totalOre:1000,remainingOre:1000}
    ];
    input.payables=[
      {supplierNumber:'SECRET-L',invoiceNumber:'P-001',invoiceDate:'2025-12-10',dueDate:'2026-01-10',totalOre:50000,remainingOre:50000}
    ];

    const before=counts(db,company.id);
    const preview=Preview.previewOpeningMigration(db,{companyId:company.id,...input});
    assert.equal(preview.status,'blocked');
    const codes=new Set(preview.blockers.map(row=>row.code));
    assert.ok(codes.has('RECEIVABLE_CONTROL_MISMATCH'));
    assert.ok(codes.has('PAYABLE_CONTROL_MISMATCH'));
    assert.ok(codes.has('DUPLICATE_CUSTOMER_INVOICE_IN_PACKAGE'));
    assert.ok(codes.has('CUSTOMER_MASTERDATA_MISSING'));
    assert.ok(codes.has('SUPPLIER_MASTERDATA_MISSING'));
    assert.deepEqual(preview.masterdata.missingCustomerNumbers,['SECRET-K']);
    assert.deepEqual(preview.masterdata.missingSupplierNumbers,['SECRET-L']);
    assert.doesNotMatch(JSON.stringify(preview),/Hemlig Kund Som Inte Får Läckas|Hemlig Leverantör Som Inte Får Läckas|Hemligt Migreringsbolag/);
    assert.deepEqual(counts(db,company.id),before);
  }finally{db.close()}
});

test('HTTP-preview kräver personlig session och CSRF och lämnar databasen oförändrad',async()=>{
  const db=Db.openDatabase(':memory:');
  const runtime=createServer({databasePath:':memory:',db,secureCookies:false});
  const company=Db.createCompany(db,{legalName:'HTTP Migration AB',displayName:'HTTP Migration',orgNumber:'559960-1003'});
  const user=Db.createUser(db,{username:'migration.http',displayName:'Migration HTTP User',passwordHash:'test-only'});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  Db.createCustomer(db,{companyId:company.id,customerNumber:'K-1001',name:'HTTP Kund AB'});
  Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-1001',name:'HTTP Leverantör AB',defaultCostAccount:'4010'});

  const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
  Db.createSession(db,{
    tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId:user.id,companyId:company.id,
    expiresAt:new Date(Date.now()+60000).toISOString(),absoluteExpiresAt:new Date(Date.now()+120000).toISOString()
  });
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  const body=JSON.stringify(goodPackage());
  const before=counts(db,company.id);
  try{
    const anonymous=await fetch(base+'/api/v1/accounting/opening-migration/preview',{method:'POST',headers:{'Content-Type':'application/json'},body});
    assert.equal(anonymous.status,401);

    const noCsrf=await fetch(base+'/api/v1/accounting/opening-migration/preview',{method:'POST',headers:{Cookie:`rollands_session=${token}`,'Content-Type':'application/json'},body});
    assert.equal(noCsrf.status,403);

    const response=await fetch(base+'/api/v1/accounting/opening-migration/preview',{method:'POST',headers:{Cookie:`rollands_session=${token}`,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body});
    const data=await response.json();
    assert.equal(response.status,200);
    assert.equal(data.preview.status,'pass');
    assert.equal(data.preview.executionSupported,false);
    assert.deepEqual(counts(db,company.id),before);
  }finally{
    await new Promise(resolve=>runtime.close(resolve));
  }
});
