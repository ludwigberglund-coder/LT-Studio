'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Db = require('../apps/api/database.js');
const Guards = require('../apps/api/tenant-integrity.js');
const Payables = require('../apps/api/payables.js');
const Documents = require('../apps/api/documents.js');
const {createServer} = require('../apps/api/server.js');
const Auth = require('../apps/api/auth.js');
function fixture() {
  const db = Db.openDatabase(':memory:');
  const a = Db.createCompany(db, {legalName:'Tenant A test', orgNumber:'TEST-TENANT-A'});
  const b = Db.createCompany(db, {legalName:'Tenant B test', orgNumber:'TEST-TENANT-B'});
  const user = Db.createUser(db, {username:'isolation-test', displayName:'Isolation Test', passwordHash:'not-a-login-hash'});
  const customerA = Db.createCustomer(db, {companyId:a.id, customerNumber:'A-1', name:'Customer A'});
  const customerB = Db.createCustomer(db, {companyId:b.id, customerNumber:'B-1', name:'Customer B'});
  const fields = {invoiceNumber:'1', invoiceDate:'2026-09-18', dueDate:'2026-10-18', totalOre:125000, vatOre:25000};
  const invoiceA = Db.createInvoice(db, {...fields, companyId:a.id, customerId:customerA.id});
  const invoiceB = Db.createInvoice(db, {...fields, companyId:b.id, customerId:customerB.id});
  return {db,a,b,user,customerA,customerB,invoiceA,invoiceB,fields};
}
function rawCopy(db, table, original, patch) {
  const row = {...db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(original), ...patch};
  const names = Object.keys(row);
  return db.prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`).run(...Object.values(row));
}
function dropGuards(db) {
  for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'tenant_%'").all()) db.exec(`DROP TRIGGER "${row.name}"`);
}
test('cross-company invoice creation is rejected by the database, not hidden by a join', () => {
  const f=fixture();try {
    assert.throws(() => Db.createInvoice(f.db, {...f.fields, invoiceNumber:'2', companyId:f.a.id, customerId:f.customerB.id}), /TENANT_RELATION_MISMATCH/);
    assert.throws(() => rawCopy(f.db, 'invoices', f.invoiceB.id, {id:'forged-raw', company_id:f.a.id}), /TENANT_RELATION_MISMATCH/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,2);
    assert.equal(Guards.inspectTenantRelations(f.db).ok,true);
  } finally {f.db.close();}
});
test('transaction reassignment and parent company moves are rejected', () => {
  const f=fixture();try {
    assert.throws(() => Db.addInvoiceTransaction(f.db,{companyId:f.a.id,invoiceId:f.invoiceB.id,transactionType:'payment',amountOre:-125000}), /TENANT_RELATION_MISMATCH/);
    const tx=Db.addInvoiceTransaction(f.db,{companyId:f.a.id,invoiceId:f.invoiceA.id,transactionType:'payment',amountOre:-1000});
    assert.throws(() => f.db.prepare('UPDATE invoice_transactions SET invoice_id=? WHERE id=?').run(f.invoiceB.id,tx.id), /TENANT_RELATION_MISMATCH/);
    assert.throws(() => f.db.prepare('UPDATE customers SET company_id=? WHERE id=?').run(f.a.id,f.customerB.id), /TENANT_OBJECT_IDENTITY_IMMUTABLE/);
    assert.throws(() => f.db.prepare('UPDATE invoices SET company_id=? WHERE id=?').run(f.a.id,f.invoiceB.id), /TENANT_/);
    assert.equal(Db.transactionById(f.db,f.a.id,tx.id).invoiceId,f.invoiceA.id);
  } finally {f.db.close();}
});
test('existing invalid data stops guard installation without deleting or reassigning history', () => {
  const f=fixture();try {
    dropGuards(f.db);
    rawCopy(f.db,'invoices',f.invoiceB.id,{id:'historical-invalid',invoice_number:'2',company_id:f.a.id});
    assert.equal(Guards.inspectTenantRelations(f.db).ok,false);
    assert.throws(() => Guards.installTenantGuards(f.db), e=>e.code==='TENANT_INTEGRITY_ERROR');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,3);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'tenant_%'").get().n,0);
  } finally {f.db.close();}
});
test('complete API startup guards supplier and document relationships as well', () => {
  const f=fixture();try {
    createServer({db:f.db,port:4180,secureCookies:false});
    const supplier=Payables.createSupplier(f.db,{companyId:f.b.id,supplierNumber:'B-S',name:'Supplier B'});
    const inv=Payables.createSupplierInvoice(f.db,{companyId:f.b.id,supplierId:supplier.id,supplierInvoiceNumber:'B-1',invoiceDate:'2026-09-18',dueDate:'2026-10-18',totalOre:125000,vatOre:25000,registeredBy:f.user.id});
    assert.throws(() => rawCopy(f.db,'supplier_invoices',inv.id,{id:'forged-supplier',company_id:f.a.id}),/TENANT_RELATION_MISMATCH/);
    const doc=Documents.createPending(f.db,{companyId:f.b.id,uploadedBy:f.user.id,title:'Test PDF',fileName:'test.pdf'});
    assert.throws(() => f.db.prepare("INSERT INTO document_links(document_id,company_id,entity_type,entity_id,created_at) VALUES(?,?,'invoice',?,'2026-09-18')").run(doc.id,f.a.id,f.invoiceA.id),/TENANT_RELATION_MISMATCH/);
    const report=Guards.installTenantGuards(f.db);
    assert.equal(report.ok,true);
    assert.ok(report.checkedRelations>=10,JSON.stringify(report));
  } finally {f.db.close();}
});
test('repeated initialization is safe and does not prohibit multi-company memberships', () => {
  const f=fixture();try {
    Db.addMembership(f.db,{companyId:f.a.id,userId:f.user.id});
    Db.addMembership(f.db,{companyId:f.b.id,userId:f.user.id});
    const one=Guards.installTenantGuards(f.db),two=Guards.installTenantGuards(f.db);
    assert.deepEqual(two,one);
    assert.equal(Db.membershipsForUser(f.db,f.user.id).length,2);
  } finally {f.db.close();}
});
test('real HTTP API refuses anonymous requests and other-company invoice IDs', async () => {
  const f=fixture();const runtime=createServer({db:f.db,port:4180,secureCookies:false});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}/api/v1`;
  try {
    const routes=['/receivables','/customers','/customer-invoices','/payables/invoices','/suppliers','/bank/payments','/documents','/accounting/entries','/payroll/runs','/inventory/items','/automation/proposals','/website/cms','/reports/trial-balance?from=2026-09-01&to=2026-09-30','/audit'];
    for (const route of routes) assert.equal((await fetch(base+route)).status,401,route);
    Db.addMembership(f.db,{companyId:f.a.id,userId:f.user.id});
    const token=Auth.randomToken(),csrf=Auth.randomToken();
    Db.createSession(f.db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),companyId:f.a.id,userId:f.user.id,expiresAt:new Date(Date.now()+60000).toISOString()});
    const headers={Cookie:`rollands_session=${token}`};
    const listed=await fetch(base+'/receivables',{headers});
    assert.equal(listed.status,200);
    assert.deepEqual((await listed.json()).invoices.map(row=>row.id),[f.invoiceA.id]);
    const foreign=await fetch(base+`/invoices/${f.invoiceB.id}/comments`,{headers});
    assert.equal(foreign.status,404);
    const forbidden=await fetch(base+'/website/cms',{headers});
    assert.equal(forbidden.status,200);
    assert.equal((await fetch(base+`/invoices/${f.invoiceA.id}/comments`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({text:'Missing CSRF test'})})).status,403);
  } finally {await new Promise(resolve=>runtime.close(resolve));}
});


test('HTTP object-ID matrix denies other-company reads and mutations with valid session and CSRF', async () => {
  const f=fixture();
  Payables.initializePayables(f.db);Documents.initializeDocuments(f.db);
  const Accounting=require('../apps/api/accounting-store.js');Accounting.initializeAccountingStore(f.db);
  const supplierB=Payables.createSupplier(f.db,{companyId:f.b.id,supplierNumber:'B-OBJ',name:'Supplier B Obj'});
  const supplierInvoiceB=Payables.createSupplierInvoice(f.db,{companyId:f.b.id,supplierId:supplierB.id,supplierInvoiceNumber:'B-OBJ-1',invoiceDate:'2026-09-18',dueDate:'2026-10-18',totalOre:125000,vatOre:25000,registeredBy:f.user.id});
  Payables.storeDocument(f.db,{companyId:f.b.id,invoiceId:supplierInvoiceB.id,name:'b.pdf',bytes:Buffer.from('%PDF-1.4\nB tenant\n')});
  const entryB=Accounting.postEntry(f.db,{companyId:f.b.id,postingDate:'2026-09-18',description:'Tenant B',sourceType:'tenant-matrix',sourceId:'b',createdBy:f.user.id,lines:[{account:'1930',debitOre:1000,creditOre:0,text:'Bank'},{account:'2999',debitOre:0,creditOre:1000,text:'Motkonto'}]}).entry;
  const pendingB=Documents.createPending(f.db,{companyId:f.b.id,uploadedBy:f.user.id,title:'Tenant B document',fileName:'tenant-b.pdf'});
  Documents.storeContent(f.db,{companyId:f.b.id,documentId:pendingB.id,bytes:Buffer.from('%PDF-1.4\nprivate b\n')});
  const runtime=createServer({db:f.db,port:4180,secureCookies:false});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}/api/v1`;
  try {
    Db.addMembership(f.db,{companyId:f.a.id,userId:f.user.id});
    const token=Auth.randomToken(),csrf=Auth.randomToken();
    Db.createSession(f.db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),companyId:f.a.id,userId:f.user.id,expiresAt:new Date(Date.now()+60000).toISOString()});
    const headers={Cookie:`rollands_session=${token}`};
    const mutationHeaders={...headers,'Content-Type':'application/json','X-CSRF-Token':csrf};
    const getRoutes=[
      `/payables/invoices/${supplierInvoiceB.id}`,
      `/payables/invoices/${supplierInvoiceB.id}/document`,
      `/accounting/entries/${entryB.id}`,
      `/documents/${pendingB.id}`,
      `/documents/${pendingB.id}/content`
    ];
    for(const route of getRoutes)assert.equal((await fetch(base+route,{headers})).status,404,route);
    const mutations=[
      [`/invoices/${f.invoiceB.id}/comments`,{text:'cross tenant'}],
      [`/payables/invoices/${supplierInvoiceB.id}/coding`,{lines:[{account:'4010',text:'X',debitOre:100000,creditOre:0},{account:'2641',text:'Moms',debitOre:25000,creditOre:0},{account:'2440',text:'Skuld',debitOre:0,creditOre:125000}]}],
      [`/accounting/entries/${entryB.id}/correct`,{postingDate:'2026-09-19',reason:'cross tenant correction'}]
    ];
    for(const [route,body] of mutations)assert.equal((await fetch(base+route,{method:'POST',headers:mutationHeaders,body:JSON.stringify(body)})).status,404,route);
    assert.equal(Db.commentsForInvoice(f.db,f.b.id,f.invoiceB.id).length,0);
    assert.equal(Payables.invoiceById(f.db,f.b.id,supplierInvoiceB.id).coding.length,0);
    assert.equal(Accounting.listEntries(f.db,f.b.id).length,1);
  } finally {await new Promise(resolve=>runtime.close(resolve));}
});


test('full private runtime has an explicit tenant scope for every database table', () => {
  const runtime=createServer({databasePath:':memory:',secureCookies:false});
  try {
    const report=Guards.inspectTenantCoverage(runtime.db);
    assert.equal(report.ok,true,JSON.stringify(report));
    assert.deepEqual(report.rootTables,['companies','login_attempts','mfa_used_steps','users']);
    assert.ok(report.directTenantTables.includes('invoices'));
    assert.ok(report.directTenantTables.includes('supplier_invoices'));
    assert.ok(report.directTenantTables.includes('website_cms_state'));
    assert.ok(report.inheritedTenantTables.some(row=>row.table==='accounting_entry_lines'&&row.via.some(v=>v.targetTable==='accounting_entries')));
    assert.ok(report.inheritedTenantTables.some(row=>row.table==='accounting_entry_seals'&&row.via.some(v=>v.targetTable==='accounting_entries')));
    assert.deepEqual(report.unscopedTables,[]);
  } finally {runtime.close(()=>{});}
});

test('startup guard rejects a new private table whose tenant scope is undefined', () => {
  const db=Db.openDatabase(':memory:');
  try {
    db.exec(`CREATE TABLE unsafe_private_notes(id TEXT PRIMARY KEY,note TEXT NOT NULL) STRICT;`);
    const report=Guards.inspectTenantCoverage(db);
    assert.equal(report.ok,false);
    assert.deepEqual(report.unscopedTables,['unsafe_private_notes']);
    assert.throws(()=>Guards.installTenantGuards(db),error=>error?.code==='TENANT_INTEGRITY_ERROR'&&/unsafe_private_notes/.test(error.message));
  } finally {db.close();}
});

test('tenant scope can be inherited through a mandatory parent relationship', () => {
  const db=Db.openDatabase(':memory:');
  try {
    db.exec(`CREATE TABLE invoice_private_metadata(
      invoice_id TEXT PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
      payload_json TEXT NOT NULL
    ) STRICT;`);
    const report=Guards.inspectTenantCoverage(db);
    assert.equal(report.ok,true,JSON.stringify(report));
    const inherited=report.inheritedTenantTables.find(row=>row.table==='invoice_private_metadata');
    assert.ok(inherited);
    assert.ok(inherited.via.some(v=>v.column==='invoice_id'&&v.targetTable==='invoices'));
    assert.doesNotThrow(()=>Guards.installTenantGuards(db));
  } finally {db.close();}
});
