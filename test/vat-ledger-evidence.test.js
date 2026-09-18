'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Accounting=require('../apps/api/accounting-store.js');
const Vat=require('../apps/api/vat-evidence.js');
const Reports=require('../apps/api/reports.js');
const Invoice=require('../packages/invoicing/invoice.js');

function seed(){
  const db=Db.openDatabase(':memory:');
  Accounting.initializeAccountingStore(db);
  const company=Db.createCompany(db,{legalName:'Momstest AB',displayName:'Momstest',orgNumber:'559999-1100'});
  const user=Db.createUser(db,{username:'vat',displayName:'Moms Test',passwordHash:Auth.hashPassword('Sakert momstest 2026!')});
  return{db,company,user};
}
function invoiceDocument(){
  return Invoice.prepare({
    customerNumber:'K-1',
    seller:{name:'Momstest AB',address:'Testgatan 1, 111 11 Teststad',orgNumber:'559999-1100',vatNumber:'SE559999110001',bankgiro:'123-4567'},
    buyer:{name:'Kund AB',address:'Kundvagen 2, 222 22 Kundstad'},
    invoiceDate:'2026-09-18',postingDate:'2026-09-18',dueDate:'2026-10-18',paymentTermsDays:30,currency:'SEK',
    lines:[
      {description:'Vara 25',quantity:'1',unit:'st',unitPrice:'100,00',vatRate:'25',revenueAccount:'3051'},
      {description:'Tjanst 12',quantity:'1',unit:'st',unitPrice:'100,00',vatRate:'12',revenueAccount:'3042'},
      {description:'Livsmedel 6',quantity:'1',unit:'st',unitPrice:'100,00',vatRate:'6',revenueAccount:'3053'}
    ]
  },{invoiceNumber:'310001'});
}

test('kundfaktura med 25, 12 och 6 procent sparar spårbara momsbevis och stämmer mot huvudboken',()=>{
  const {db,company,user}=seed();
  try{
    const document=invoiceDocument();
    const posted=Accounting.postEntry(db,{companyId:company.id,postingDate:document.postingDate,description:'Kundfaktura 310001',sourceType:'customer-invoice',sourceId:'inv-1',createdBy:user.id,series:'F',lines:Invoice.journalLines(document),vatEvidence:Invoice.vatEvidence(document)});
    const evidence=Vat.forEntry(db,company.id,posted.entry.id);
    assert.equal(evidence.length,3);
    const control=Vat.periodControl(db,company.id,'2026-09-01','2026-09-30');
    assert.equal(control.ledgerReconciled,true);
    assert.deepEqual(control.boxes,{'05':30000,'10':2500,'11':1200,'12':600,'48':0,'49':4300});
  }finally{db.close()}
});

test('ingående moms på svensk leverantörsfaktura stäms mot 2641 och ruta 48',()=>{
  const {db,company,user}=seed();
  try{
    const posted=Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-18',description:'Leverantorsfaktura S-1',sourceType:'supplier-invoice',sourceId:'sup-1',createdBy:user.id,series:'B',lines:[{account:'4010',debitOre:100000,creditOre:0},{account:'2641',debitOre:25000,creditOre:0},{account:'2440',debitOre:0,creditOre:125000}],vatEvidence:[{evidenceType:'input-domestic',vatCode:'INPUT_DOMESTIC',vatRateBasisPoints:null,taxableBaseOre:100000,vatOre:25000,vatAccount:'2641',declarationBaseBox:null,declarationVatBox:'48'}]});
    assert.equal(Vat.forEntry(db,company.id,posted.entry.id)[0].vatOre,25000);
    const control=Vat.periodControl(db,company.id,'2026-09-01','2026-09-30');
    assert.equal(control.ledgerReconciled,true);
    assert.equal(control.boxes['48'],25000);
    assert.equal(control.boxes['49'],-25000);
  }finally{db.close()}
});

test('fel momsbevis rullar tillbaka hela verifikationen och nummerserien',()=>{
  const {db,company,user}=seed();
  try{
    assert.throws(()=>Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-18',description:'Fel momsbevis',sourceType:'customer-invoice',sourceId:'bad',createdBy:user.id,series:'F',lines:[{account:'1510',debitOre:125000,creditOre:0},{account:'3051',debitOre:0,creditOre:100000},{account:'2611',debitOre:0,creditOre:25000}],vatEvidence:[{evidenceType:'output-domestic',vatCode:'OUTPUT_DOMESTIC_25',vatRateBasisPoints:2500,taxableBaseOre:100000,vatOre:24000,vatAccount:'2611',declarationBaseBox:'05',declarationVatBox:'10'}]}),e=>e.code==='VAT_LEDGER_EVIDENCE_MISMATCH');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounting_entries').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounting_vat_evidence').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounting_sequences').get().n,0);
  }finally{db.close()}
});

test('fel beskattningsunderlag stoppas även när momsbelopp och momskonto ser rätt ut',()=>{
  const {db,company,user}=seed();
  try{
    assert.throws(()=>Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-18',description:'Fel momsunderlag',sourceType:'customer-invoice',sourceId:'bad-base',createdBy:user.id,series:'F',lines:[{account:'1510',debitOre:125000,creditOre:0},{account:'3051',debitOre:0,creditOre:100000},{account:'2611',debitOre:0,creditOre:25000}],vatEvidence:[{evidenceType:'output-domestic',vatCode:'OUTPUT_DOMESTIC_25',vatRateBasisPoints:2500,taxableBaseOre:99999,vatOre:25000,vatAccount:'2611',declarationBaseBox:'05',declarationVatBox:'10'}]}),e=>e.code==='VAT_BASE_EVIDENCE_MISMATCH');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounting_entries').get().n,0);
  }finally{db.close()}
});

test('återförsök med samma bokföringsrader men ändrat momsunderlag stoppas',()=>{
  const {db,company,user}=seed();
  try{
    const base={companyId:company.id,postingDate:'2026-09-18',description:'Kundfaktura moms',sourceType:'customer-invoice',sourceId:'same',createdBy:user.id,series:'F',lines:[{account:'1510',debitOre:125000,creditOre:0},{account:'3051',debitOre:0,creditOre:100000},{account:'2611',debitOre:0,creditOre:25000}]};
    const evidence={evidenceType:'output-domestic',vatCode:'OUTPUT_DOMESTIC_25',vatRateBasisPoints:2500,taxableBaseOre:100000,vatOre:25000,vatAccount:'2611',declarationBaseBox:'05',declarationVatBox:'10'};
    Accounting.postEntry(db,{...base,vatEvidence:[evidence]});
    assert.throws(()=>Accounting.postEntry(db,{...base,vatEvidence:[{...evidence,vatCode:'OUTPUT_DOMESTIC_25_CHANGED'}]}),e=>e.code==='VAT_IDEMPOTENCY_CONFLICT');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounting_entries').get().n,1);
  }finally{db.close()}
});

test('bokförd moms utan momsbevis flaggas som avvikelse i momsrapporten',()=>{
  const {db,company,user}=seed();
  try{
    Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-18',description:'Manuell moms utan kod',sourceType:'manual',sourceId:'manual-1',createdBy:user.id,series:'A',lines:[{account:'5460',debitOre:10000,creditOre:0},{account:'2641',debitOre:2500,creditOre:0},{account:'1930',debitOre:0,creditOre:12500}]});
    const report=Reports.vatControl(db,company.id,{period:'2026-09'});
    assert.equal(report.ledgerReconciled,false);
    assert.equal(report.vatAccountDifferences['2641'],2500);
    assert.equal(report.declarationReady,false);
    assert.match(report.warning,/saknar matchande momsbevis/i);
  }finally{db.close()}
});

test('momsbevis är append-only och kan inte ändras eller raderas av vanlig applikationskod',()=>{
  const {db,company,user}=seed();
  try{
    const document=invoiceDocument();
    const posted=Accounting.postEntry(db,{companyId:company.id,postingDate:document.postingDate,description:'Kundfaktura 310001',sourceType:'customer-invoice',sourceId:'inv-locked',createdBy:user.id,series:'F',lines:Invoice.journalLines(document),vatEvidence:Invoice.vatEvidence(document)});
    const id=Vat.forEntry(db,company.id,posted.entry.id)[0].id;
    assert.throws(()=>db.prepare('UPDATE accounting_vat_evidence SET vat_ore=1 WHERE id=?').run(id),/HISTORY_IMMUTABLE/);
    assert.throws(()=>db.prepare('DELETE FROM accounting_vat_evidence WHERE id=?').run(id),/HISTORY_IMMUTABLE/);
  }finally{db.close()}
});

test('momsfri försäljning bokförs inte automatiskt utan särskild momskod och grund',()=>{
  const document=Invoice.prepare({customerNumber:'K-1',seller:{name:'Momstest AB',address:'Testgatan 1',orgNumber:'559999-1100',vatNumber:'SE559999110001',bankgiro:'123-4567'},buyer:{name:'Kund AB',address:'Kundvagen 2'},invoiceDate:'2026-09-18',postingDate:'2026-09-18',dueDate:'2026-10-18',lines:[{description:'Momsfri post',quantity:'1',unit:'st',unitPrice:'100,00',vatRate:'0',revenueAccount:'3054'}]},{invoiceNumber:'310002'});
  assert.throws(()=>Invoice.vatEvidence(document),/särskild momskod/i);
});
