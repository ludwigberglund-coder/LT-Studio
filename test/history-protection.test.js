'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const Db = require('../apps/api/database.js');
const Accounting = require('../apps/api/accounting-store.js');
const Invoicing = require('../apps/api/customer-invoicing.js');
function seed(filename = ':memory:') {
  const db = Db.openDatabase(filename);
  Accounting.initializeAccountingStore(db);
  const company = Db.createCompany(db, {legalName:'History test', orgNumber:'TEST-HISTORY'});
  const user = Db.createUser(db, {username:'history', displayName:'History test', passwordHash:'test-not-a-login'});
  return {db, company, user};
}
function input(company, user) {
  return {companyId:company.id, createdBy:user.id, postingDate:'2026-09-18', description:'Test journal with VAT',
    sourceType:'manual', sourceId:'original', lines:[{account:'5460',debitOre:10000},{account:'2641',debitOre:2500},{account:'1930',creditOre:12500}]};
}
function removeJournalGuards(db) {
  // PRE-UPGRADE / OFFLINE CORRUPTION fixtures only, never application code.
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'history_accounting_%'").all();
  for (const row of rows) db.exec(`DROP TRIGGER "${row.name}"`);
}
function invoiceDocument(db, company) {
  Invoicing.initializeCustomerInvoicing(db);
  const customer = Db.createCustomer(db,{companyId:company.id,customerNumber:'K1',name:'Fictional buyer'});
  const invoice = Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'310001',invoiceDate:'2026-09-18',dueDate:'2026-10-18',totalOre:12500,vatOre:2500});
  const json = JSON.stringify({invoiceNumber:'310001',totalOre:12500,vatOre:2500});
  const hash = crypto.createHash('sha256').update(json).digest('hex');
  db.prepare('INSERT INTO customer_invoice_documents VALUES(?,?,?,?,?)').run(invoice.id,company.id,json,hash,'2026-09-18T10:00:00Z');
  return invoice;
}
test('posted headers and lines reject update, delete, replace and appended lines', () => {
  const {db, company, user} = seed();
  try {
    const entry = Accounting.postEntry(db,input(company,user)).entry;
    for (const sql of [
      "UPDATE accounting_entries SET description='changed' WHERE id=?", 'DELETE FROM accounting_entries WHERE id=?',
      "UPDATE accounting_entry_lines SET account='5410' WHERE entry_id=?", 'DELETE FROM accounting_entry_lines WHERE entry_id=?',
      'INSERT OR REPLACE INTO accounting_entries SELECT * FROM accounting_entries WHERE id=?',
      'INSERT OR REPLACE INTO accounting_entry_lines SELECT * FROM accounting_entry_lines WHERE entry_id=?'
    ]) assert.throws(() => db.prepare(sql).run(entry.id), /IMMUTABLE/);
    assert.throws(() => db.prepare("INSERT INTO accounting_entry_lines VALUES(?,4,'1930','late',100,0)").run(entry.id),/IMMUTABLE/);
    assert.deepEqual(Accounting.entryById(db,company.id,entry.id),entry);
  } finally { db.close(); }
});
test('persisted guards stop replacement via rowid on a second SQLite connection', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'history-')), filename=path.join(dir,'db.sqlite');
  const {db,company,user}=seed(filename), entry=Accounting.postEntry(db,input(company,user)).entry;
  db.close();
  const other=new DatabaseSync(filename);
  try {
    other.exec('PRAGMA recursive_triggers=OFF');
    assert.throws(()=>other.prepare('INSERT OR REPLACE INTO accounting_entries SELECT * FROM accounting_entries WHERE id=?').run(entry.id),/IMMUTABLE/);
    const rowid=other.prepare('SELECT rowid FROM accounting_entries WHERE id=?').get(entry.id).rowid;
    assert.throws(()=>other.prepare(`INSERT OR REPLACE INTO accounting_entries(rowid,id,company_id,fiscal_year,series,sequence,number,posting_date,description,source_type,source_id,created_by,created_at)
      SELECT ?, 'other-id', company_id,fiscal_year,series,99,'A99',posting_date,description,source_type,'other-source',created_by,created_at FROM accounting_entries WHERE id=?`).run(rowid,entry.id),/IMMUTABLE/);
    assert.equal(other.prepare('SELECT COUNT(*) AS n FROM accounting_entries').get().n,1);
  } finally {other.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('journal seals cannot be replaced, updated or removed',()=>{
  const {db,company,user}=seed();
  try {
    const entry=Accounting.postEntry(db,input(company,user)).entry;
    for(const sql of ['UPDATE accounting_entry_seals SET content_sha256=content_sha256 WHERE entry_id=?','DELETE FROM accounting_entry_seals WHERE entry_id=?','INSERT OR REPLACE INTO accounting_entry_seals SELECT * FROM accounting_entry_seals WHERE entry_id=?'])
      assert.throws(()=>db.prepare(sql).run(entry.id),/IMMUTABLE/);
  } finally {db.close();}
});
test('audit history accepts new events but rejects rewriting, removal and replacement',()=>{
  const {db,company,user}=seed();
  try {
    Db.appendAudit(db,{companyId:company.id,userId:user.id,action:'TEST',entityType:'test',details:{before:1,after:2}});
    for(const sql of ["UPDATE audit_events SET action='CHANGED'",'DELETE FROM audit_events','INSERT OR REPLACE INTO audit_events SELECT * FROM audit_events'])
      assert.throws(()=>db.exec(sql),/IMMUTABLE/);
    assert.throws(()=>db.prepare('DELETE FROM companies WHERE id=?').run(company.id),/IMMUTABLE/);
    Db.appendAudit(db,{companyId:company.id,userId:user.id,action:'SECOND',entityType:'test'});
    assert.equal(Db.auditForCompany(db,company.id).length,2);
  }finally{db.close();}
});
test('invoice document is append-only and mismatched hash stops its reader',()=>{
  const {db,company}=seed();
  try {
    const invoice=invoiceDocument(db,company);
    assert.equal(Invoicing.documentForInvoice(db,company.id,invoice.id).document.vatOre,2500);
    assert.equal(Invoicing.documentForInvoice(db,'another-company',invoice.id),null);
    for(const sql of ["UPDATE customer_invoice_documents SET document_json='{}'",'DELETE FROM customer_invoice_documents','INSERT OR REPLACE INTO customer_invoice_documents SELECT * FROM customer_invoice_documents'])
      assert.throws(()=>db.exec(sql),/IMMUTABLE/);
    db.exec('DROP TRIGGER history_customer_invoice_documents_update'); // Offline tamper fixture.
    db.exec("UPDATE customer_invoice_documents SET document_json='{}'");
    assert.throws(()=>Invoicing.documentForInvoice(db,company.id,invoice.id),e=>e.code==='INVOICE_DOCUMENT_INTEGRITY_ERROR');
  }finally{db.close();}
});
test('valid pre-upgrade journals receive one baseline without changing entries',()=>{
  const {db,company,user}=seed();
  try {
    const entry=Accounting.postEntry(db,input(company,user)).entry;
    removeJournalGuards(db);db.exec('DROP TABLE accounting_entry_seals');
    Accounting.initializeAccountingStore(db);
    const seal=db.prepare('SELECT * FROM accounting_entry_seals').get();
    Accounting.initializeAccountingStore(db);
    assert.deepEqual(db.prepare('SELECT * FROM accounting_entry_seals').get(),seal);
    assert.deepEqual(Accounting.entryById(db,company.id,entry.id),entry);
  }finally{db.close();}
});
test('damaged pre-upgrade journal stops migration without repairing history',()=>{
  const {db,company,user}=seed();
  try {
    Accounting.postEntry(db,input(company,user));
    removeJournalGuards(db);db.exec('DROP TABLE accounting_entry_seals');
    db.exec('DELETE FROM accounting_entry_lines WHERE line_number=3');
    assert.throws(()=>Accounting.initializeAccountingStore(db),e=>e.code==='STORED_ENTRY_INTEGRITY_ERROR');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounting_entry_lines').get().n,2);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='accounting_entry_seals'").get(),undefined);
  }finally{db.close();}
});
test('subsequent initialization rejects unsealed entries instead of baselining them',()=>{
  const {db,company,user}=seed();
  try {
    db.prepare(`INSERT INTO accounting_entries VALUES('bad',?,'2026','A',1,'A1','2026-09-18','Unsealed','test','bad',?,'2026-09-18T10:00:00Z')`).run(company.id,user.id);
    assert.throws(()=>Accounting.initializeAccountingStore(db),e=>e.code==='STORED_ENTRY_INTEGRITY_ERROR');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounting_entries').get().n,1);
  }finally{db.close();}
});
test('balanced offline alteration is detected on read and restart',()=>{
  const {db,company,user}=seed();
  try {
    const entry=Accounting.postEntry(db,input(company,user)).entry, before=db.prepare('SELECT * FROM accounting_entry_seals').get();
    db.exec('DROP TRIGGER history_accounting_entry_lines_update'); // Offline tamper fixture.
    db.exec("UPDATE accounting_entry_lines SET account='5410' WHERE account='5460'");
    assert.throws(()=>Accounting.entryById(db,company.id,entry.id),e=>e.code==='STORED_ENTRY_INTEGRITY_ERROR');
    assert.throws(()=>Accounting.initializeAccountingStore(db),e=>e.code==='STORED_ENTRY_INTEGRITY_ERROR');
    assert.deepEqual(db.prepare('SELECT * FROM accounting_entry_seals').get(),before);
  }finally{db.close();}
});
test('seal insertion failure rolls back entire posting and sequence',()=>{
  const {db,company,user}=seed();
  try {
    db.exec("CREATE TEMP TRIGGER fail_seal BEFORE INSERT ON accounting_entry_seals BEGIN SELECT RAISE(ABORT,'seal failure'); END");
    assert.throws(()=>Accounting.postEntry(db,input(company,user)),/seal failure/);
    for(const table of ['accounting_entries','accounting_entry_lines','accounting_sequences','accounting_entry_seals'])
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
    db.exec('DROP TRIGGER fail_seal');
    assert.equal(Accounting.postEntry(db,input(company,user)).entry.number,'A1');
  }finally{db.close();}
});
test('issued invoice dates identity and amounts are locked; settlement status may change',()=>{
  const {db,company}=seed();
  try {
    const invoice=invoiceDocument(db,company);
    for(const change of ["total_ore=1","vat_ore=0","due_date='2027-01-01'","invoice_number='other'","payment_account='other'"])
      assert.throws(()=>db.prepare(`UPDATE invoices SET ${change} WHERE id=?`).run(invoice.id),/ISSUED_INVOICE_IMMUTABLE/);
    db.prepare("UPDATE invoices SET remaining_ore=0,status='Betald' WHERE id=?").run(invoice.id);
    assert.equal(Db.invoiceById(db,company.id,invoice.id).remainingOre,0);
    assert.equal(Invoicing.documentForInvoice(db,company.id,invoice.id).document.totalOre,12500);
  }finally{db.close();}
});
test('restore verification detects a balanced journal with mismatched seal',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'history-restore-')), filename=path.join(dir,'db.sqlite');
  const {db,company,user}=seed(filename);
  try {
    Accounting.postEntry(db,input(company,user));
    db.exec('DROP TRIGGER history_accounting_entry_lines_update'); // Offline corruption fixture.
    db.exec("UPDATE accounting_entry_lines SET account='5410' WHERE account='5460'");
  }finally{db.close();}
  try{assert.throws(()=>require('../scripts/pilot-restore-verify.js').verifyDatabase(filename),e=>e.code==='STORED_ENTRY_INTEGRITY_ERROR');}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
