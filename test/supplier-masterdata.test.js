'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Payables=require('../apps/api/payables.js');
const SupplierAccounting=require('../apps/api/supplier-accounting.js');
const Master=require('../apps/api/supplier-masterdata.js');
const Domain=require('../packages/payables/supplier-invoices.js');

function seed(){const db=Db.openDatabase(':memory:');Master.initializeSupplierMasterdata(db);SupplierAccounting.initializeSupplierAccounting(db);const company=Db.createCompany(db,{legalName:'Testbolag AB',displayName:'Testbolag',orgNumber:'559900-3030'});const hash=Auth.hashPassword('Sakert masterdatatest 2026!');const requester=Db.createUser(db,{username:'requester',displayName:'Begärare',passwordHash:hash});const approver=Db.createUser(db,{username:'approver-md',displayName:'Godkännare',passwordHash:hash});const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-10',name:'Leverantör AB',bankgiro:'111-2222',defaultCostAccount:'4010'});return{db,company,requester,approver,supplier}}
function approvedInvoice(db,company,userA,userB,supplier){const invoice=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'F-10',invoiceDate:'2026-09-01',dueDate:'2026-09-16',totalOre:100000,vatOre:20000,registeredBy:userA.id});Payables.storeDocument(db,{companyId:company.id,invoiceId:invoice.id,name:'f.pdf',bytes:Buffer.from('%PDF-1.4\n% masterdata\n')});Payables.saveCoding(db,{companyId:company.id,invoiceId:invoice.id,lines:Domain.buildCoding({totalOre:100000,vatOre:20000}).lines});const reviewed=Payables.invoiceById(db,company.id,invoice.id);return Payables.approve(db,{companyId:company.id,invoiceId:invoice.id,actorId:userB.id,expectedCodingSha256:reviewed.codingSha256,expectedDocumentSha256:reviewed.documentSha256})}

test('profiländring aktiveras direkt men loggas med före/efter-värden',()=>{const {db,company,requester,supplier}=seed();try{const request=Master.requestChange(db,{companyId:company.id,supplierId:supplier.id,kind:'profile',changes:{name:'Nytt Leverantörsnamn AB',defaultCostAccount:'5460'},requestedBy:requester.id});assert.equal(request.status,'approved');const changed=Payables.supplierById(db,company.id,supplier.id);assert.equal(changed.name,'Nytt Leverantörsnamn AB');assert.equal(changed.defaultCostAccount,'5460');const history=Master.history(db,company.id,supplier.id);assert.equal(history.length,1);assert.equal(history[0].before.name,'Leverantör AB');assert.equal(history[0].after.defaultCostAccount,'5460');}finally{db.close()}});

test('betalningsuppgifter kräver separat godkännare',()=>{const {db,company,requester,approver,supplier}=seed();try{const request=Master.requestChange(db,{companyId:company.id,supplierId:supplier.id,kind:'payment-details',changes:{bankgiro:'999-8888'},requestedBy:requester.id});assert.equal(request.status,'pending');assert.equal(Payables.supplierById(db,company.id,supplier.id).bankgiro,'111-2222');assert.throws(()=>Master.approvePaymentChange(db,{companyId:company.id,requestId:request.id,approvedBy:requester.id}),e=>e.code==='SEPARATION_OF_DUTIES_FAILED');const approved=Master.approvePaymentChange(db,{companyId:company.id,requestId:request.id,approvedBy:approver.id});assert.equal(approved.request.status,'approved');assert.equal(approved.supplier.bankgiro,'999-8888');}finally{db.close()}});

test('endast en väntande betalningsändring tillåts per leverantör',()=>{const {db,company,requester,supplier}=seed();try{Master.requestChange(db,{companyId:company.id,supplierId:supplier.id,kind:'payment-details',changes:{bankgiro:'222-3333'},requestedBy:requester.id});assert.throws(()=>Master.requestChange(db,{companyId:company.id,supplierId:supplier.id,kind:'payment-details',changes:{bankgiro:'333-4444'},requestedBy:requester.id}),e=>e.code==='PAYMENT_CHANGE_PENDING');}finally{db.close()}});

test('förberedd betalning behåller mottagaruppgifterna även efter senare leverantörsändring',()=>{const {db,company,requester,approver,supplier}=seed();try{const invoice=approvedInvoice(db,company,requester,approver,supplier);SupplierAccounting.postSupplierInvoice(db,{companyId:company.id,invoiceId:invoice.id,actorId:requester.id});const payment=Payables.preparePayment(db,{companyId:company.id,invoiceId:invoice.id,paymentDate:'2026-09-16',amountOre:100000,account:'1930',preparedBy:requester.id});assert.equal(payment.bankgiro,'111-2222');const change=Master.requestChange(db,{companyId:company.id,supplierId:supplier.id,kind:'payment-details',changes:{bankgiro:'777-6666'},requestedBy:requester.id});Master.approvePaymentChange(db,{companyId:company.id,requestId:change.id,approvedBy:approver.id});assert.equal(Payables.supplierById(db,company.id,supplier.id).bankgiro,'777-6666');assert.equal(Payables.paymentById(db,company.id,payment.id).bankgiro,'111-2222');}finally{db.close()}});


test('leverantörsprofil kan återförsökas med samma request-id utan dubbla historikrader',()=>{const {db,company,requester,supplier}=seed();try{
  const input={companyId:company.id,supplierId:supplier.id,kind:'profile',changes:{name:'Retry Leverantör AB',defaultCostAccount:'5460'},requestedBy:requester.id,requestKey:'supplier-profile-0001'};
  const first=Master.requestChangeIdempotent(db,input);
  const retry=Master.requestChangeIdempotent(db,input);
  assert.equal(first.duplicate,false);assert.equal(retry.duplicate,true);assert.equal(retry.request.id,first.request.id);
  assert.equal(Master.history(db,company.id,supplier.id).length,1);
  assert.equal(Payables.supplierById(db,company.id,supplier.id).name,'Retry Leverantör AB');
  assert.throws(()=>Master.requestChangeIdempotent(db,{...input,changes:{name:'Annat namn AB',defaultCostAccount:'5460'}}),e=>e.code==='SUPPLIER_IDEMPOTENCY_CONFLICT'&&e.statusCode===409);
  assert.equal(Master.history(db,company.id,supplier.id).length,1);
}finally{db.close()}});

test('betalningsändring kan återförsökas med samma request-id men nytt innehåll blockeras',()=>{const {db,company,requester,supplier}=seed();try{
  const input={companyId:company.id,supplierId:supplier.id,kind:'payment-details',changes:{bankgiro:'222-3333'},requestedBy:requester.id,requestKey:'supplier-payment-0001'};
  const first=Master.requestChangeIdempotent(db,input);
  const retry=Master.requestChangeIdempotent(db,input);
  assert.equal(first.duplicate,false);assert.equal(retry.duplicate,true);assert.equal(retry.request.id,first.request.id);
  assert.equal(Master.listPending(db,company.id).length,1);
  assert.throws(()=>Master.requestChangeIdempotent(db,{...input,changes:{bankgiro:'333-4444'}}),e=>e.code==='SUPPLIER_IDEMPOTENCY_CONFLICT'&&e.statusCode===409);
  assert.equal(Master.listPending(db,company.id).length,1);
}finally{db.close()}});

test('supplier-masterdata init migrerar äldre schema med request-key idempotent',()=>{const db=Db.openDatabase(':memory:');try{
  Payables.initializePayables(db);
  db.exec(`
    CREATE TABLE supplier_change_requests(
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,status TEXT NOT NULL,changes_json TEXT NOT NULL,
      requested_by TEXT NOT NULL REFERENCES users(id),requested_at TEXT NOT NULL,
      approved_by TEXT,approved_at TEXT,rejected_by TEXT,rejected_at TEXT,decision_reason TEXT
    ) STRICT;
    CREATE TABLE supplier_change_history(
      id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      request_id TEXT,change_type TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,changed_by TEXT NOT NULL,changed_at TEXT NOT NULL
    ) STRICT;
  `);
  Master.initializeSupplierMasterdata(db);
  assert.ok(db.prepare('PRAGMA table_info(supplier_change_requests)').all().some(row=>row.name==='request_key'));
  Master.initializeSupplierMasterdata(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_supplier_change_requests_company_key'").get().n,1);
}finally{db.close()}});
