'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Payables=require('../apps/api/payables.js');
const Accounting=require('../apps/api/accounting-store.js');
const Reports=require('../apps/api/reports.js');
const OpeningMigration=require('../apps/api/opening-migration-import.js');
const {createServer}=require('../apps/api/server.js');

function goodPackage(){
  return{
    year:'2026',
    postingDate:'2026-01-01',
    confirmImport:true,
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
async function fixture(){
  const db=Db.openDatabase(':memory:');
  const company=Db.createCompany(db,{legalName:'Opening Import AB',displayName:'Opening Import',orgNumber:'559970-1001'});
  const user=Db.createUser(db,{username:'opening.import',displayName:'Opening Import User',passwordHash:'test-only'});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  Db.createCustomer(db,{companyId:company.id,customerNumber:'K-1001',name:'Historisk Kund AB'});
  Payables.initializePayables(db);
  Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-1001',name:'Historisk Leverantör AB',bankgiro:'555-1001',defaultCostAccount:'4010'});

  const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
  Db.createSession(db,{
    tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId:user.id,companyId:company.id,
    expiresAt:new Date(Date.now()+3600000).toISOString(),absoluteExpiresAt:new Date(Date.now()+7200000).toISOString()
  });
  const runtime=createServer({databasePath:':memory:',db,secureCookies:false});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  return{
    db,company,user,runtime,
    base:`http://127.0.0.1:${runtime.server.address().port}`,
    headers:{Cookie:`rollands_session=${token}`,'Content-Type':'application/json','X-CSRF-Token':csrf},
    async close(){await new Promise(resolve=>runtime.close(resolve))}
  };
}
function counts(db,companyId){
  return{
    entries:Number(db.prepare('SELECT COUNT(*) AS n FROM accounting_entries WHERE company_id=?').get(companyId).n),
    invoices:Number(db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE company_id=?').get(companyId).n),
    supplierInvoices:Number(db.prepare('SELECT COUNT(*) AS n FROM supplier_invoices WHERE company_id=?').get(companyId).n),
    imports:Number(db.prepare('SELECT COUNT(*) AS n FROM opening_migration_imports WHERE company_id=?').get(companyId).n),
    audit:Number(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE company_id=? AND action='OPENING_MIGRATION_IMPORTED'").get(companyId).n)
  };
}

test('systembytesimport skapar en avstämd ingående balans och öppna reskontraposter atomiskt',async()=>{
  const f=await fixture();
  try{
    const payload=goodPackage();
    const first=await fetch(f.base+'/api/v1/accounting/opening-migration/import',{
      method:'POST',headers:f.headers,body:JSON.stringify(payload)
    });
    const body=await first.json();
    assert.equal(first.status,201);
    assert.equal(body.duplicate,false);
    assert.equal(body.entry.number,'IB1');
    assert.equal(body.import.receivableCount,1);
    assert.equal(body.import.payableCount,1);
    assert.equal(body.import.receivablesOre,125000);
    assert.equal(body.import.payablesOre,50000);

    const receivable=Db.listReceivables(f.db,f.company.id).find(row=>row.invoiceNumber==='K-OLD-001');
    assert.ok(receivable);
    assert.equal(receivable.status,'Importerad');
    assert.equal(receivable.totalOre,150000);
    assert.equal(receivable.remainingOre,125000);
    assert.equal(receivable.postingDate,'2026-01-01');
    assert.equal(receivable.invoiceDate,'2025-12-15');

    const payable=Payables.listInvoices(f.db,f.company.id).find(row=>row.supplierInvoiceNumber==='L-OLD-001');
    assert.ok(payable);
    assert.equal(payable.status,'approved');
    assert.equal(payable.totalOre,70000);
    assert.equal(payable.openAmountOre,50000);
    assert.equal(payable.liabilityAccountingEntryId,body.entry.id);

    const rc=Reports.receivablesControl(f.db,f.company.id);
    const pc=Reports.payablesControl(f.db,f.company.id);
    assert.equal(rc.integrityOk,true);
    assert.equal(rc.subledgerOpenOre,125000);
    assert.equal(rc.ledger1510Ore,125000);
    assert.equal(rc.sourceChecks.find(row=>row.invoiceId===receivable.id).sourceKind,'opening-migration');
    assert.equal(pc.integrityOk,true);
    assert.equal(pc.subledgerOpenOre,50000);
    assert.equal(pc.ledger2440Ore,50000);
    assert.equal(pc.sourceChecks.find(row=>row.invoiceId===payable.id).sourceKind,'opening-migration');

    const read=await fetch(f.base+'/api/v1/accounting/opening-migration/imports/2026',{headers:{Cookie:f.headers.Cookie}});
    const readBody=await read.json();
    assert.equal(read.status,200);
    assert.equal(readBody.import.packageSha256,body.import.packageSha256);
    assert.equal(readBody.entry.id,body.entry.id);

    const beforeRetry=counts(f.db,f.company.id);
    const retry=await fetch(f.base+'/api/v1/accounting/opening-migration/import',{
      method:'POST',headers:f.headers,body:JSON.stringify(payload)
    });
    const retryBody=await retry.json();
    assert.equal(retry.status,200);
    assert.equal(retryBody.duplicate,true);
    assert.equal(retryBody.entry.id,body.entry.id);
    assert.deepEqual(counts(f.db,f.company.id),beforeRetry);
    assert.equal(beforeRetry.audit,1);

    const changed=structuredClone(payload);
    changed.lines[1].debitOre=100001;
    changed.lines[3].creditOre=175001;
    const conflict=await fetch(f.base+'/api/v1/accounting/opening-migration/import',{
      method:'POST',headers:f.headers,body:JSON.stringify(changed)
    });
    assert.equal(conflict.status,409);
    assert.equal((await conflict.json()).code,'OPENING_MIGRATION_IDEMPOTENCY_CONFLICT');
    assert.deepEqual(counts(f.db,f.company.id),beforeRetry);
  }finally{await f.close()}
});

test('systembytesimport kräver uttrycklig bekräftelse och preview-fel skriver ingenting',async()=>{
  const f=await fixture();
  try{
    const payload=goodPackage();
    const before=counts(f.db,f.company.id);

    const missingConfirm=await fetch(f.base+'/api/v1/accounting/opening-migration/import',{
      method:'POST',headers:f.headers,body:JSON.stringify({...payload,confirmImport:false})
    });
    assert.equal(missingConfirm.status,422);
    assert.equal((await missingConfirm.json()).code,'OPENING_MIGRATION_CONFIRMATION_REQUIRED');
    assert.deepEqual(counts(f.db,f.company.id),before);

    const invalid=structuredClone(payload);
    invalid.receivables[0].remainingOre=124999;
    const blocked=await fetch(f.base+'/api/v1/accounting/opening-migration/import',{
      method:'POST',headers:f.headers,body:JSON.stringify(invalid)
    });
    const blockedBody=await blocked.json();
    assert.equal(blocked.status,409);
    assert.equal(blockedBody.code,'OPENING_MIGRATION_PREVIEW_BLOCKED');
    assert.ok(blockedBody.details.blockers.some(row=>row.code==='RECEIVABLE_CONTROL_MISMATCH'));
    assert.deepEqual(counts(f.db,f.company.id),before);
  }finally{await f.close()}
});

test('fel mitt i systembytesimporten rullar tillbaka hela paketet',async()=>{
  const f=await fixture();
  try{
    const before=counts(f.db,f.company.id);
    f.db.exec(`CREATE TRIGGER fail_opening_supplier_import
      BEFORE INSERT ON supplier_invoices
      WHEN NEW.supplier_invoice_number='L-OLD-001'
      BEGIN SELECT RAISE(ABORT,'OPENING_IMPORT_TEST_ABORT'); END;`);

    const response=await fetch(f.base+'/api/v1/accounting/opening-migration/import',{
      method:'POST',headers:f.headers,body:JSON.stringify(goodPackage())
    });
    assert.equal(response.status,500);

    assert.deepEqual(counts(f.db,f.company.id),before);
    assert.equal(Accounting.entryBySource(f.db,f.company.id,'opening-balance','2026'),null);
    assert.equal(Db.listReceivables(f.db,f.company.id).some(row=>row.invoiceNumber==='K-OLD-001'),false);
    assert.equal(Payables.listInvoices(f.db,f.company.id).some(row=>row.supplierInvoiceNumber==='L-OLD-001'),false);
    assert.equal(OpeningMigration.importByYear(f.db,f.company.id,'2026'),null);
  }finally{await f.close()}
});

test('systembytesimport läcker inte masterdata från annat företag',async()=>{
  const f=await fixture();
  try{
    const other=Db.createCompany(f.db,{legalName:'Hemligt Annat AB',displayName:'Hemligt Annat',orgNumber:'559970-2002'});
    Db.createCustomer(f.db,{companyId:other.id,customerNumber:'SECRET-K',name:'Hemlig Kund Som Inte Får Läckas'});
    Payables.createSupplier(f.db,{companyId:other.id,supplierNumber:'SECRET-L',name:'Hemlig Leverantör Som Inte Får Läckas',defaultCostAccount:'4010'});

    const payload=goodPackage();
    payload.receivables[0].customerNumber='SECRET-K';
    payload.payables[0].supplierNumber='SECRET-L';
    const response=await fetch(f.base+'/api/v1/accounting/opening-migration/import',{
      method:'POST',headers:f.headers,body:JSON.stringify(payload)
    });
    const body=await response.json();
    assert.equal(response.status,409);
    assert.equal(body.code,'OPENING_MIGRATION_PREVIEW_BLOCKED');
    assert.match(JSON.stringify(body.details),/SECRET-K|SECRET-L/);
    assert.doesNotMatch(JSON.stringify(body),/Hemlig Kund Som Inte Får Läckas|Hemlig Leverantör Som Inte Får Läckas|Hemligt Annat/);
    assert.equal(counts(f.db,f.company.id).imports,0);
  }finally{await f.close()}
});
