'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Db = require('../apps/api/database.js');
const Guards = require('../apps/api/tenant-integrity.js');
const Payables = require('../apps/api/payables.js');
const Documents = require('../apps/api/documents.js');
const Bank = require('../apps/api/bank-payments.js');
const Inventory = require('../apps/api/inventory.js');
const Queues = require('../apps/api/queues.js');
const Automation = require('../packages/automation/proposals.js');
const Payroll = require('../apps/api/payroll.js');
const Cms = require('../apps/api/website-cms.js');
const SupplierAccounting = require('../apps/api/supplier-accounting.js');
const Master = require('../apps/api/supplier-masterdata.js');
const Admin = require('../apps/api/accounting-admin.js');
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
test('plattformssäkerhetshändelser är uttryckligen globalt scope och bryter inte tenant-kontraktet',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const coverage=Guards.inspectTenantCoverage(db);
    assert.equal(coverage.ok,true);
    assert.ok(coverage.rootTables.includes('security_events'));
    assert.ok(coverage.rootTables.includes('security_alert_states'));
    const event=Db.appendSecurityEvent(db,{kind:'TEST_SECURITY_SIGNAL',severity:'info',fingerprintHash:'a'.repeat(64),details:{test:true}});
    assert.equal(Db.securityEvents(db)[0].id,event.id);
  }finally{db.close()}
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
    const routes=['/receivables','/customers','/customer-invoices','/payables/invoices','/suppliers','/bank/payments','/documents','/accounting/entries','/payroll/runs','/inventory/items','/automation/proposals','/website/cms','/reports/trial-balance?from=2026-09-01&to=2026-09-30','/exports/journal?from=2026-09-01&to=2026-09-30','/audit'];
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
  Payables.initializePayables(f.db);Documents.initializeDocuments(f.db);Bank.initializeBankPayments(f.db);Inventory.initializeInventory(f.db);Queues.initializeQueues(f.db);Payroll.initializePayroll(f.db);Cms.initializeWebsiteCms(f.db);SupplierAccounting.initializeSupplierAccounting(f.db);Master.initializeSupplierMasterdata(f.db);Admin.initializeAccountingAdmin(f.db);
  const Accounting=require('../apps/api/accounting-store.js');Accounting.initializeAccountingStore(f.db);
  const supplierB=Payables.createSupplier(f.db,{companyId:f.b.id,supplierNumber:'B-OBJ',name:'Supplier B Obj',bankgiro:'555-0001',defaultCostAccount:'4010'});
  const supplierInvoiceB=Payables.createSupplierInvoice(f.db,{companyId:f.b.id,supplierId:supplierB.id,supplierInvoiceNumber:'B-OBJ-1',invoiceDate:'2026-09-18',dueDate:'2026-10-18',totalOre:125000,vatOre:25000,registeredBy:f.user.id});
  Payables.storeDocument(f.db,{companyId:f.b.id,invoiceId:supplierInvoiceB.id,name:'b.pdf',bytes:Buffer.from('%PDF-1.4\nB tenant\n')});
  const foreignApprover=Db.createUser(f.db,{username:'foreign-approver',displayName:'Foreign Approver',passwordHash:'not-a-login-hash'});
  const paymentSupplierInvoiceB=Payables.createSupplierInvoice(f.db,{companyId:f.b.id,supplierId:supplierB.id,supplierInvoiceNumber:'B-PAY-1',invoiceDate:'2026-09-18',dueDate:'2026-10-18',totalOre:125000,vatOre:25000,registeredBy:f.user.id});
  Payables.storeDocument(f.db,{companyId:f.b.id,invoiceId:paymentSupplierInvoiceB.id,name:'b-payment.pdf',bytes:Buffer.from('%PDF-1.4\nB payment tenant\n')});
  Payables.saveCoding(f.db,{companyId:f.b.id,invoiceId:paymentSupplierInvoiceB.id,lines:[
    {account:'4010',text:'Kostnad',debitOre:100000,creditOre:0},
    {account:'2641',text:'Ingående moms',debitOre:25000,creditOre:0},
    {account:'2440',text:'Leverantörsskuld',debitOre:0,creditOre:125000}
  ]});
  const paymentInvoiceReviewed=Payables.invoiceById(f.db,f.b.id,paymentSupplierInvoiceB.id);
  Payables.approve(f.db,{companyId:f.b.id,invoiceId:paymentSupplierInvoiceB.id,actorId:foreignApprover.id,expectedCodingSha256:paymentInvoiceReviewed.codingSha256,expectedDocumentSha256:paymentInvoiceReviewed.documentSha256});
  SupplierAccounting.postSupplierInvoice(f.db,{companyId:f.b.id,invoiceId:paymentSupplierInvoiceB.id,actorId:f.user.id});
  const supplierPaymentB=Payables.preparePayment(f.db,{companyId:f.b.id,invoiceId:paymentSupplierInvoiceB.id,paymentDate:'2026-09-25',amountOre:125000,account:'1930',preparedBy:f.user.id});
  const supplierChangeB=Master.requestChange(f.db,{companyId:f.b.id,supplierId:supplierB.id,kind:'payment-details',changes:{bankgiro:'999-8888'},requestedBy:f.user.id});
  Admin.lockPeriod(f.db,{companyId:f.b.id,period:'2026-08',lockedBy:f.user.id});
  const unlockRequestB=Admin.requestUnlock(f.db,{companyId:f.b.id,period:'2026-08',reason:'Tenant B controlled unlock request',requestedBy:f.user.id});
  const entryB=Accounting.postEntry(f.db,{companyId:f.b.id,postingDate:'2026-09-18',description:'Tenant B',sourceType:'tenant-matrix',sourceId:'b',createdBy:f.user.id,lines:[{account:'1930',debitOre:1000,creditOre:0,text:'Bank'},{account:'2999',debitOre:0,creditOre:1000,text:'Motkonto'}]}).entry;
  const pendingB=Documents.createPending(f.db,{companyId:f.b.id,uploadedBy:f.user.id,title:'Tenant B document',fileName:'tenant-b.pdf'});
  Documents.storeContent(f.db,{companyId:f.b.id,documentId:pendingB.id,bytes:Buffer.from('%PDF-1.4\nprivate b\n')});
  const documentA=Documents.createPending(f.db,{companyId:f.a.id,uploadedBy:f.user.id,title:'Tenant A link test',fileName:'tenant-a-link.pdf'});
  Documents.storeContent(f.db,{companyId:f.a.id,documentId:documentA.id,bytes:Buffer.from('%PDF-1.4\nprivate a link test\n')});
  const bankPaymentB=Bank.create(f.db,{companyId:f.b.id,externalId:'B-TENANT-MATRIX-1',bookingDate:'2026-09-20',amountOre:125000,currency:'SEK',reference:'B-only',createdBy:f.user.id}).payment;
  const inventoryItemB=Inventory.createItem(f.db,{companyId:f.b.id,sku:'B-TENANT-ITEM',name:'Tenant B inventory item',unit:'kg',purchaseAccount:'4010',inventoryAccount:'1460'});
  Inventory.addMovement(f.db,{companyId:f.b.id,itemId:inventoryItemB.id,movementDate:'2026-09-20',type:'receipt',quantityMilli:5000,actorId:f.user.id});
  const inventoryAdjustmentB=Inventory.createAdjustment(f.db,{companyId:f.b.id,itemId:inventoryItemB.id,adjustmentDate:'2026-09-20',countedQuantityMilli:4000,reason:'Tenant matrix',countedBy:f.user.id});
  const automationProposalB=Queues.saveAutomationProposal(f.db,Automation.createProposal({
    companyId:f.b.id,type:'booking-account-suggestion',sourceId:'tenant-b-automation',confidence:.91,deterministic:false,
    reason:'Tenant B automation proposal',evidence:[{kind:'tenant-matrix',label:'Underlag',value:'Tenant B',sourceId:'tenant-b-automation'}],suggestion:{amountOre:10000,debitAccount:'4010',creditAccount:'2440'},
    engine:{kind:'rules',name:'tenant-matrix',version:'1'},createdAt:'2026-09-20T08:00:00.000Z'
  }),{idempotencyKey:'tenant-b-automation:v1'}).proposal;
  const payrollLines=[
    {account:'7010',text:'Bruttolön',debitOre:100000,creditOre:0},
    {account:'7510',text:'Arbetsgivaravgifter',debitOre:31420,creditOre:0},
    {account:'2710',text:'Personalskatt',debitOre:0,creditOre:30000},
    {account:'2731',text:'Arbetsgivaravgifter skuld',debitOre:0,creditOre:31420},
    {account:'2910',text:'Upplupna löner',debitOre:0,creditOre:70000}
  ];
  const payrollRunB=Payroll.importRun(f.db,{
    companyId:f.b.id,period:'2026-09',payDate:'2026-09-25',sourceName:'Tenant B payroll',
    grossSalaryOre:100000,withheldTaxOre:30000,employerContributionsOre:31420,netPayOre:70000,vacationLiabilityChangeOre:0,
    importedBy:f.user.id,lines:payrollLines
  });
  const cmsASeed=Cms.state(f.db,f.a.id);
  const cmsACompany=structuredClone(cmsASeed.draft.company);
  cmsACompany.address={street:'Tenantgatan 1',postalCode:'111 11',city:'Teststad',full:'Tenantgatan 1, 111 11 Teststad'};
  cmsACompany.contact={phone:'031-00 00 00',phoneHref:'+4631000000',email:'tenant-a@example.invalid'};
  Cms.saveDraft(f.db,{companyId:f.a.id,site:cmsASeed.draft.site,company:cmsACompany,userId:f.user.id});
  const cmsABefore=Cms.state(f.db,f.a.id);
  const cmsBBefore=Cms.state(f.db,f.b.id);
  const supplierBBefore=Payables.supplierById(f.db,f.b.id,supplierB.id);
  const accountingEntriesBBefore=Accounting.listEntries(f.db,f.b.id).length;
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
      `/customer-invoices/${f.invoiceB.id}`,
      `/customer-invoices/${f.invoiceB.id}/pdf`,
      `/payables/invoices/${supplierInvoiceB.id}`,
      `/payables/invoices/${supplierInvoiceB.id}/document`,
      `/accounting/entries/${entryB.id}`,
      `/documents/${pendingB.id}`,
      `/documents/${pendingB.id}/content`,
      `/invoices/${f.invoiceB.id}/reminders`
    ];
    for(const route of getRoutes)assert.equal((await fetch(base+route,{headers})).status,404,route);

    const bankList=await fetch(base+'/bank/payments',{headers});
    assert.equal(bankList.status,200);
    assert.equal((await bankList.json()).payments.some(row=>row.id===bankPaymentB.id),false);

    const inventoryItems=await fetch(base+'/inventory/items',{headers});
    assert.equal(inventoryItems.status,200);
    assert.equal((await inventoryItems.json()).items.some(row=>row.id===inventoryItemB.id),false);

    const foreignMovements=await fetch(base+'/inventory/movements?itemId='+encodeURIComponent(inventoryItemB.id),{headers});
    assert.equal(foreignMovements.status,200);
    assert.deepEqual((await foreignMovements.json()).movements,[]);

    const inventoryAdjustments=await fetch(base+'/inventory/adjustments?status=all',{headers});
    assert.equal(inventoryAdjustments.status,200);
    assert.equal((await inventoryAdjustments.json()).adjustments.some(row=>row.id===inventoryAdjustmentB.id),false);

    const automationList=await fetch(base+'/automation/proposals',{headers});
    assert.equal(automationList.status,200);
    assert.equal((await automationList.json()).proposals.some(row=>row.id===automationProposalB.id),false);

    const payrollList=await fetch(base+'/payroll/runs',{headers});
    assert.equal(payrollList.status,200);
    assert.equal((await payrollList.json()).runs.some(row=>row.id===payrollRunB.id),false);

    const supplierList=await fetch(base+'/suppliers',{headers});
    assert.equal(supplierList.status,200);
    assert.equal((await supplierList.json()).suppliers.some(row=>row.id===supplierB.id),false);

    const pendingSupplierChanges=await fetch(base+'/suppliers/pending-changes',{headers});
    assert.equal(pendingSupplierChanges.status,200);
    assert.equal((await pendingSupplierChanges.json()).changes.some(row=>row.id===supplierChangeB.id),false);

    const foreignSupplierHistory=await fetch(base+`/suppliers/${supplierB.id}/history`,{headers});
    assert.equal(foreignSupplierHistory.status,200);
    assert.deepEqual((await foreignSupplierHistory.json()).history,[]);

    const periods=await fetch(base+'/accounting/periods?year=2026',{headers});
    assert.equal(periods.status,200);
    assert.equal((await periods.json()).periods.some(row=>row.period==='2026-08'),false);

    const unlockRequests=await fetch(base+'/accounting/unlock-requests?status=all',{headers});
    assert.equal(unlockRequests.status,200);
    assert.equal((await unlockRequests.json()).requests.some(row=>row.id===unlockRequestB.id),false);

    const generalLedger=await fetch(base+'/reports/general-ledger?from=2026-09-01&to=2026-09-30',{headers});
    assert.equal(generalLedger.status,200);
    assert.equal(JSON.stringify(await generalLedger.json()).includes('Tenant B'),false);

    const journalExport=await fetch(base+'/exports/journal?from=2026-09-01&to=2026-09-30',{headers});
    assert.equal(journalExport.status,200);
    assert.equal((await journalExport.text()).includes('Tenant B'),false);

    const payablesExport=await fetch(base+'/exports/payables?from=2026-09-01&to=2026-10-31',{headers});
    assert.equal(payablesExport.status,200);
    const payablesCsv=await payablesExport.text();
    assert.equal(payablesCsv.includes('Supplier B Obj'),false);
    assert.equal(payablesCsv.includes('B-OBJ-1'),false);

    const cmsRead=await fetch(base+'/website/cms',{headers});
    assert.equal(cmsRead.status,200);
    const cmsReadBody=await cmsRead.json();
    assert.equal(cmsReadBody.state.companyId,f.a.id);
    assert.equal(cmsReadBody.state.companyId===f.b.id,false);

    const foreignAutomationEdit=await fetch(base+`/automation/proposals/${automationProposalB.id}/suggestion`,{
      method:'PUT',headers:mutationHeaders,
      body:JSON.stringify({accountingLines:[{account:'4010',debitOre:10000,creditOre:0},{account:'2440',debitOre:0,creditOre:10000}]})
    });
    assert.equal(foreignAutomationEdit.status,404);

    const foreignSupplierProfile=await fetch(base+`/suppliers/${supplierB.id}/profile`,{
      method:'PUT',headers:mutationHeaders,body:JSON.stringify({name:'Cross tenant supplier edit'})
    });
    assert.equal(foreignSupplierProfile.status,404);

    const foreignSupplierPaymentDetails=await fetch(base+`/suppliers/${supplierB.id}/payment-details`,{
      method:'POST',headers:mutationHeaders,body:JSON.stringify({bankgiro:'111-9999'})
    });
    assert.equal(foreignSupplierPaymentDetails.status,404);

    const foreignCustomerUpdate=await fetch(base+`/customers/${f.customerB.id}`,{
      method:'PUT',headers:mutationHeaders,
      body:JSON.stringify({name:'Cross tenant customer edit',email:'cross-tenant@example.invalid',address:'Tenantgatan 99'})
    });
    assert.equal(foreignCustomerUpdate.status,404);

    const foreignSupplierInvoiceDocument=await fetch(base+`/payables/invoices/${supplierInvoiceB.id}/document`,{
      method:'PUT',
      headers:{...headers,'Content-Type':'application/pdf','X-CSRF-Token':csrf,'X-Document-Name':'cross-tenant.pdf'},
      body:Buffer.from('%PDF-1.4\nforbidden cross tenant replacement\n')
    });
    assert.equal(foreignSupplierInvoiceDocument.status,404);

    const foreignSupplierInvoiceCoding=await fetch(base+`/payables/invoices/${supplierInvoiceB.id}/coding`,{
      method:'PUT',headers:mutationHeaders,
      body:JSON.stringify({lines:[
        {account:'4010',text:'X',debitOre:100000,creditOre:0},
        {account:'2641',text:'Moms',debitOre:25000,creditOre:0},
        {account:'2440',text:'Skuld',debitOre:0,creditOre:125000}
      ]})
    });
    assert.equal(foreignSupplierInvoiceCoding.status,404);

    const foreignParentInvoice=await fetch(base+'/payables/invoices',{
      method:'POST',headers:mutationHeaders,
      body:JSON.stringify({supplierId:supplierB.id,supplierInvoiceNumber:'CROSS-TENANT-PARENT',invoiceDate:'2026-09-20',dueDate:'2026-10-20',totalOre:125000,vatOre:25000})
    });
    assert.equal(foreignParentInvoice.status,404);

    const mutations=[
      [`/invoices/${f.invoiceB.id}/comments`,{text:'cross tenant'}],
      [`/customer-invoices/${f.invoiceB.id}/credit`,{requestId:'cross-tenant-credit-0001',reason:'cross tenant'}],
      [`/bank/payments/${bankPaymentB.id}/match`,{}],
      ['/inventory/movements',{itemId:inventoryItemB.id,movementDate:'2026-09-20',type:'sale',quantityMilli:-1000}],
      ['/inventory/adjustments',{itemId:inventoryItemB.id,adjustmentDate:'2026-09-20',countedQuantityMilli:3000,reason:'cross tenant'}],
      [`/inventory/adjustments/${inventoryAdjustmentB.id}/approve`,{}],
      [`/inventory/adjustments/${inventoryAdjustmentB.id}/reject`,{}],
      [`/automation/proposals/${automationProposalB.id}/approve`,{}],
      [`/automation/proposals/${automationProposalB.id}/execute`,{}],
      [`/automation/proposals/${automationProposalB.id}/reclassify`,{targetInvoiceId:f.invoiceB.id,requestId:'cross-tenant-customer-reclass-0001',correctionDate:'2026-09-26',reason:'cross tenant reclassification'}],
      [`/automation/proposals/${automationProposalB.id}/reject`,{reason:'cross tenant'}],
      [`/payroll/runs/${payrollRunB.id}/post`,{}],
      [`/invoices/${f.invoiceB.id}/reminders/preview`,{sentDate:'2026-10-20'}],
      [`/invoices/${f.invoiceB.id}/reminders`,{sentDate:'2026-10-20',kind:'reminder'}],
      [`/payables/invoices/${supplierInvoiceB.id}/coding-suggestion`,{}],
      [`/payables/invoices/${supplierInvoiceB.id}/approve`,{expectedCodingSha256:'0'.repeat(64),expectedDocumentSha256:'0'.repeat(64)}],
      [`/payables/invoices/${supplierInvoiceB.id}/post`,{}],
      [`/payables/invoices/${supplierInvoiceB.id}/prepare-payment`,{paymentDate:'2026-09-25',account:'1930'}],
      [`/documents/${documentA.id}/links`,{entityType:'customer-invoice',entityId:f.invoiceB.id,label:'cross tenant customer invoice'}],
      [`/documents/${documentA.id}/links`,{entityType:'supplier-invoice',entityId:supplierInvoiceB.id,label:'cross tenant supplier invoice'}],
      [`/payables/payments/${supplierPaymentB.id}/release`,{}],
      [`/payables/payments/${supplierPaymentB.id}/confirm-post`,{confirmationReference:'CROSS-TENANT-REF',postingDate:'2026-09-25'}],
      [`/payables/payments/${supplierPaymentB.id}/correct`,{requestId:'cross-tenant-payment-correction-0001',correctionDate:'2026-09-26',reason:'cross tenant correction'}],
      [`/suppliers/changes/${supplierChangeB.id}/approve`,{}],
      [`/suppliers/changes/${supplierChangeB.id}/reject`,{reason:'cross tenant'}],
      [`/accounting/unlock-requests/${unlockRequestB.id}/approve`,{reason:'cross tenant'}],
      [`/accounting/unlock-requests/${unlockRequestB.id}/reject`,{reason:'cross tenant'}],
      [`/accounting/entries/${entryB.id}/correct`,{postingDate:'2026-09-19',reason:'cross tenant correction'}]
    ];
    for(const [route,body] of mutations)assert.equal((await fetch(base+route,{method:'POST',headers:mutationHeaders,body:JSON.stringify(body)})).status,404,route);

    const injectedPayroll=await fetch(base+'/payroll/runs',{
      method:'POST',headers:mutationHeaders,
      body:JSON.stringify({
        companyId:f.b.id,period:'2026-10',payDate:'2026-10-25',sourceName:'Tenant injection attempt',
        grossSalaryOre:100000,withheldTaxOre:30000,employerContributionsOre:31420,netPayOre:70000,vacationLiabilityChangeOre:0,
        lines:payrollLines
      })
    });
    assert.equal(injectedPayroll.status,422);
    assert.equal((await injectedPayroll.json()).code,'UNEXPECTED_FIELDS');
    assert.equal(Payroll.listRuns(f.db,f.a.id).some(row=>row.sourceName==='Tenant injection attempt'),false);
    assert.equal(Payroll.listRuns(f.db,f.b.id).length,1);

    const cmsSite=structuredClone(cmsABefore.draft.site);
    cmsSite.hero.title='Tenant A controlled CMS update';
    const cmsCompany=structuredClone(cmsABefore.draft.company);
    const injectedCms=await fetch(base+'/website/cms/draft',{
      method:'PUT',headers:mutationHeaders,
      body:JSON.stringify({
        companyId:f.b.id,
        expectedRevision:cmsABefore.draft.revision,
        site:cmsSite,
        company:cmsCompany
      })
    });
    assert.equal(injectedCms.status,422);
    assert.equal((await injectedCms.json()).code,'UNEXPECTED_FIELDS');
    assert.deepEqual(Cms.state(f.db,f.a.id),cmsABefore);
    assert.deepEqual(Cms.state(f.db,f.b.id),cmsBBefore);

    assert.equal(Db.commentsForInvoice(f.db,f.b.id,f.invoiceB.id).length,0);
    assert.equal(Payables.invoiceById(f.db,f.b.id,supplierInvoiceB.id).coding.length,0);
    assert.equal(Accounting.listEntries(f.db,f.b.id).length,accountingEntriesBBefore);
    assert.equal(Bank.byId(f.db,f.b.id,bankPaymentB.id).status,'unmatched');
    assert.equal(Inventory.balanceMilli(f.db,f.b.id,inventoryItemB.id),5000);
    assert.equal(Inventory.adjustmentById(f.db,f.b.id,inventoryAdjustmentB.id).status,'pending');
    assert.equal(Queues.automationProposalById(f.db,f.b.id,automationProposalB.id).status,automationProposalB.status);
    assert.equal(Payroll.runById(f.db,f.b.id,payrollRunB.id).status,'validated');
    assert.equal(Payables.paymentById(f.db,f.b.id,supplierPaymentB.id).status,'prepared');
    assert.deepEqual(Payables.supplierById(f.db,f.b.id,supplierB.id),supplierBBefore);
    assert.equal(Master.changeRequestById(f.db,f.b.id,supplierChangeB.id).status,'approved');
    assert.equal(Admin.unlockRequestById(f.db,f.b.id,unlockRequestB.id).status,'pending');
    assert.equal(f.db.prepare('SELECT status FROM accounting_periods WHERE company_id=? AND period=?').get(f.b.id,'2026-08').status,'locked');
    assert.deepEqual(Documents.linksForDocument(f.db,f.a.id,documentA.id),[]);
    const tenantAAudit=Db.auditForCompany(f.db,f.a.id);
    assert.equal(tenantAAudit.some(event=>event.action==='DOCUMENT_LINKED'&&event.entityId===documentA.id),false);
    assert.equal(tenantAAudit.some(event=>
      event.entityId===bankPaymentB.id||
      event.entityId===inventoryItemB.id||
      event.entityId===inventoryAdjustmentB.id||
      event.entityId===automationProposalB.id||
      event.entityId===payrollRunB.id||
      event.entityId===supplierPaymentB.id||
      event.entityId===supplierB.id||
      event.entityId===supplierChangeB.id||
      event.entityId===unlockRequestB.id
    ),false);
  } finally {await new Promise(resolve=>runtime.close(resolve));}
});


test('full private runtime has an explicit tenant scope for every database table', () => {
  const db=Db.openDatabase(':memory:');
  try {
    createServer({db,port:4180,secureCookies:false});
    const report=Guards.inspectTenantCoverage(db);
    assert.equal(report.ok,true,JSON.stringify(report));
    assert.deepEqual(report.rootTables,['companies','login_attempts','mfa_used_steps','platform_operator_audit_events','platform_operator_mfa_used_steps','platform_operator_sessions','platform_operators','schema_migrations','security_alert_states','security_events','security_incident_states','users']);
    assert.ok(report.directTenantTables.includes('invoices'));
    assert.ok(report.directTenantTables.includes('supplier_invoices'));
    assert.ok(report.directTenantTables.includes('website_cms_state'));
    assert.ok(report.inheritedTenantTables.some(row=>row.table==='accounting_entry_lines'&&row.via.some(v=>v.targetTable==='accounting_entries')));
    assert.ok(report.inheritedTenantTables.some(row=>row.table==='accounting_entry_seals'&&row.via.some(v=>v.targetTable==='accounting_entries')));
    assert.deepEqual(report.ambiguousInheritedTables,[]);
    assert.deepEqual(report.unscopedTables,[]);
  } finally {db.close();}
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

test('tenant scope can be inherited through one mandatory parent and cannot move across companies', () => {
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
    Guards.installTenantGuards(db);

    const a=Db.createCompany(db,{legalName:'Inherited A AB',orgNumber:'INHERITED-A'});
    const b=Db.createCompany(db,{legalName:'Inherited B AB',orgNumber:'INHERITED-B'});
    const ca=Db.createCustomer(db,{companyId:a.id,customerNumber:'A-1',name:'A Kund'});
    const cb=Db.createCustomer(db,{companyId:b.id,customerNumber:'B-1',name:'B Kund'});
    const common={invoiceDate:'2026-09-20',postingDate:'2026-09-20',dueDate:'2026-10-20',totalOre:10000,remainingOre:10000,vatOre:2000,status:'Bokförd'};
    const a1=Db.createInvoice(db,{...common,companyId:a.id,customerId:ca.id,invoiceNumber:'A-1'});
    const a2=Db.createInvoice(db,{...common,companyId:a.id,customerId:ca.id,invoiceNumber:'A-2'});
    const b1=Db.createInvoice(db,{...common,companyId:b.id,customerId:cb.id,invoiceNumber:'B-1'});
    db.prepare('INSERT INTO invoice_private_metadata(invoice_id,payload_json) VALUES(?,?)').run(a1.id,'{}');
    assert.doesNotThrow(()=>db.prepare('UPDATE invoice_private_metadata SET invoice_id=? WHERE invoice_id=?').run(a2.id,a1.id));
    assert.throws(()=>db.prepare('UPDATE invoice_private_metadata SET invoice_id=? WHERE invoice_id=?').run(b1.id,a2.id),/TENANT_INHERITED_OWNER_MISMATCH/);
  } finally {db.close();}
});
