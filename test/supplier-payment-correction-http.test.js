'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Payables=require('../apps/api/payables.js');
const Release=require('../apps/api/payment-release.js');
const SupplierAccounting=require('../apps/api/supplier-accounting.js');
const Domain=require('../packages/payables/supplier-invoices.js');
const Accounting=require('../apps/api/accounting-store.js');
const {createServer}=require('../apps/api/server.js');

function createPaidSupplierFlow(db,{company,number,userPrefix}){
  const hash=Auth.hashPassword('Sakert source correction test 2026!');
  const preparer=Db.createUser(db,{username:`${userPrefix}.prep`,displayName:'Förberedare',passwordHash:hash});
  const approver=Db.createUser(db,{username:`${userPrefix}.approve`,displayName:'Attestant',passwordHash:hash});
  const accountant=Db.createUser(db,{username:`${userPrefix}.account`,displayName:'Ekonom',passwordHash:hash});
  Db.addMembership(db,{companyId:company.id,userId:accountant.id});
  const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:`L-${number}`,name:`Leverantör ${number} AB`,bankgiro:'123-4567',defaultCostAccount:'4010'});
  const invoice=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:number,invoiceDate:'2026-09-01',dueDate:'2026-09-20',totalOre:125000,vatOre:25000,registeredBy:preparer.id});
  Payables.storeDocument(db,{companyId:company.id,invoiceId:invoice.id,name:`${number}.pdf`,bytes:Buffer.from('%PDF-1.4\nsource correction test\n')});
  Payables.saveCoding(db,{companyId:company.id,invoiceId:invoice.id,lines:Domain.buildCoding({totalOre:125000,vatOre:25000,costAccount:'4010'}).lines});
  const reviewed=Payables.invoiceById(db,company.id,invoice.id);
  Payables.approve(db,{companyId:company.id,invoiceId:invoice.id,actorId:approver.id,expectedCodingSha256:reviewed.codingSha256,expectedDocumentSha256:reviewed.documentSha256});
  SupplierAccounting.postSupplierInvoice(db,{companyId:company.id,invoiceId:invoice.id,actorId:accountant.id});
  const payment=Payables.preparePayment(db,{companyId:company.id,invoiceId:invoice.id,paymentDate:'2026-09-20',amountOre:125000,account:'1930',preparedBy:preparer.id});
  Release.releasePayment(db,{companyId:company.id,paymentId:payment.id,releasedBy:approver.id});
  SupplierAccounting.confirmSupplierPayment(db,{companyId:company.id,paymentId:payment.id,confirmationReference:`BANK-${number}`,postingDate:'2026-09-20',actorId:accountant.id});
  return{preparer,approver,accountant,supplier,invoice,payment};
}

test('privat API rättar leverantörsbetalning atomiskt, isolerat och retry-säkert',async()=>{
  const db=Db.openDatabase(':memory:');
  const runtime=createServer({databasePath:':memory:',db,secureCookies:false});
  const companyA=Db.createCompany(db,{legalName:'Correction A AB',displayName:'Correction A',orgNumber:'559970-1001'});
  const companyB=Db.createCompany(db,{legalName:'Correction B AB',displayName:'Correction B',orgNumber:'559970-1002'});
  const a=createPaidSupplierFlow(db,{company:companyA,number:'CORR-A',userPrefix:'corr-a'});
  const b=createPaidSupplierFlow(db,{company:companyB,number:'CORR-B',userPrefix:'corr-b'});
  const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
  Db.createSession(db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),companyId:companyA.id,userId:a.accountant.id,expiresAt:new Date(Date.now()+60000).toISOString()});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  const headers={Cookie:`rollands_session=${token}`,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
  const payload={requestId:'supplier-http-correction-0001',correctionDate:'2026-09-21',reason:'Fel betalningsbokföring ska återföras.'};
  try{
    const noCsrf=await fetch(base+`/api/v1/payables/payments/${a.payment.id}/correct`,{method:'POST',headers:{Cookie:headers.Cookie,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    assert.equal(noCsrf.status,403);

    const foreign=await fetch(base+`/api/v1/payables/payments/${b.payment.id}/correct`,{method:'POST',headers,body:JSON.stringify(payload)});
    assert.equal(foreign.status,404);
    assert.equal(SupplierAccounting.paymentForConfirmation(db,companyB.id,b.payment.id).status,'paid');

    const first=await fetch(base+`/api/v1/payables/payments/${a.payment.id}/correct`,{method:'POST',headers,body:JSON.stringify(payload)});
    const one=await first.json();
    assert.equal(first.status,201);
    assert.equal(one.duplicate,false);
    assert.equal(one.payment.status,'released');
    assert.equal(one.invoice.status,'payment-prepared');
    assert.equal(one.invoice.openAmountOre,125000);

    const retry=await fetch(base+`/api/v1/payables/payments/${a.payment.id}/correct`,{method:'POST',headers,body:JSON.stringify(payload)});
    const two=await retry.json();
    assert.equal(retry.status,200);
    assert.equal(two.duplicate,true);
    assert.equal(two.reversal.id,one.reversal.id);

    const conflict=await fetch(base+`/api/v1/payables/payments/${a.payment.id}/correct`,{method:'POST',headers,body:JSON.stringify({...payload,reason:'En annan rättelseorsak.'})});
    assert.equal(conflict.status,409);
    assert.equal((await conflict.json()).code,'PAYMENT_CORRECTION_IDEMPOTENCY_CONFLICT');

    const repost=await fetch(base+`/api/v1/payables/payments/${a.payment.id}/confirm-post`,{method:'POST',headers,body:JSON.stringify({confirmationReference:'BANK-CORR-A',postingDate:'2026-09-21'})});
    const repostBody=await repost.json();
    assert.equal(repost.status,200);
    assert.equal(repostBody.duplicate,false);
    assert.equal(repostBody.attempt.attemptNumber,2);
    assert.equal(repostBody.payment.status,'paid');
    assert.equal(Payables.invoiceById(db,companyA.id,a.invoice.id).openAmountOre,0);
    assert.equal(Accounting.listEntries(db,companyA.id).filter(entry=>['supplier-payment','supplier-payment-reversal','supplier-payment-repost'].includes(entry.sourceType)).length,3);
    assert.equal(Db.auditForCompany(db,companyA.id).filter(event=>event.action==='SUPPLIER_PAYMENT_CORRECTED').length,1);
  }finally{
    await new Promise(resolve=>runtime.close(resolve));
  }
});
