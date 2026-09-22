'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const Auth=require('../apps/api/auth.js');
const Db=require('../apps/api/database.js');
const Invoicing=require('../apps/api/customer-invoicing.js');
const PdfArchiveStore=require('../apps/api/customer-invoice-pdf-archive-store.js');
const InvoiceSettings=require('../apps/api/company-invoice-settings.js');
const Accounting=require('../apps/api/accounting-store.js');
const Reports=require('../apps/api/reports.js');
const Bank=require('../apps/api/bank-payments.js');
const Queues=require('../apps/api/queues.js');
const Matcher=require('../packages/automation/bank-payment-matcher.js');
const CustomerPayment=require('../apps/api/customer-payment-posting.js');
const {createApiApp}=require('../apps/api/app.js');

const MFA='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const KEY='test-only-pdf-archive-encryption-key-longer-than-thirty-two';
const PROFILE={legalName:'Testbutiken AB',displayName:'Testbutiken',orgNumber:'559100-0001',vatNumber:'SE559100000101',address:{full:'Testgatan 1, 411 01 Göteborg'},contact:{email:'faktura@testbutiken.se'},website:'https://example.invalid',invoice:{}};

async function withApi(callback){
  const db=Db.openDatabase(':memory:');
  CustomerPayment.initializeCustomerPaymentPosting(db);
  const co1=Db.createCompany(db,{legalName:'Testbutiken AB',displayName:'Testbutiken',orgNumber:'559100-0001'});
  const co2=Db.createCompany(db,{legalName:'Annat Bolag AB',displayName:'Annat',orgNumber:'559100-0002'});
  const password='Sakert pdfarkiv testlosenord 2026!';
  const user=Db.createUser(db,{username:'pdf.test',displayName:'PDF Test',passwordHash:Auth.hashPassword(password),mfaSecretEncrypted:Auth.encryptSecret(MFA,KEY)});
  Db.addMembership(db,{companyId:co1.id,userId:user.id});
  InvoiceSettings.setInvoiceSettings(db,{companyId:co1.id,bankgiro:'123-4567',taxStatus:'Godkänd för F-skatt',vatNumber:'SE559100000101',updatedBy:user.id});
  Db.createCustomer(db,{companyId:co1.id,customerNumber:'K-100',name:'Kund Ett AB',orgNumber:'559200-0001',email:'kund@example.se',address:{full:'Kundgatan 2, Göteborg'},customerType:'business'});
  Db.createCustomer(db,{companyId:co2.id,customerNumber:'K-200',name:'Kund Två AB',address:{full:'Annan gata 1'},customerType:'business'});
  Db.createInvoice(db,{companyId:co1.id,customerId:Db.listCustomers(db,co1.id)[0].id,invoiceNumber:'310100',ocr:'310100',invoiceDate:'2026-08-01',postingDate:'2026-08-01',dueDate:'2026-08-31',totalOre:125000,remainingOre:125000,vatOre:25000,status:'Bokförd'});
  const api=createApiApp({db,secureCookies:false,authEncryptionKey:KEY,companyProfile:PROFILE});
  const server=http.createServer((req,res)=>api.handle(req,res));
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  const base='http://127.0.0.1:'+server.address().port;
  try{await callback({db,base,co1,co2,user,password});}
  finally{await new Promise(resolve=>server.close(resolve));db.close();}
}
async function login(base,password){
  const response=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'pdf.test',password,totp:Auth.totpCode(MFA)})});
  const body=await response.json(),cookie=String(response.headers.get('set-cookie')||'').split(';')[0];
  assert.equal(response.status,200);return{body,cookie};
}
function payload(requestId='invoice-request-pdf-archive-01'){return{requestId,customerNumber:'K-100',invoiceDate:'2026-09-18',postingDate:'2026-09-18',dueDate:'2026-10-18',paymentTermsDays:30,ourReference:'UAT',yourReference:'Test',notes:'Fiktiv testfaktura',lines:[{description:'Testleverans',quantity:'1',unit:'st',unitPrice:'1000,00',vatTreatment:'se-standard-25',vatRate:'25',revenueAccount:'3051'}]};}

test('utfärdad kundfaktura arkiverar och återger exakt PDF företagsisolerat',async()=>withApi(async({base,password,db,co1,co2})=>{
  const signed=await login(base,password),headers={Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken};
  const response=await fetch(base+'/api/v1/customer-invoices',{method:'POST',headers,body:JSON.stringify(payload())});
  const body=await response.json();
  assert.equal(response.status,201);
  assert.equal(body.pdfArchive.mimeType,'application/pdf');
  assert.match(body.pdfArchive.pdfSha256,/^[a-f0-9]{64}$/);
  const archived=Invoicing.pdfArchiveForInvoice(db,co1.id,body.invoice.id);
  assert.equal(archived.bytes.subarray(0,5).toString('ascii'),'%PDF-');
  const metadata=Invoicing.pdfArchivePrivateObjectMetadata(db,co1.id,body.invoice.id);
  assert.equal(metadata.companyId,co1.id);
  assert.equal(metadata.kind,'customer-invoice-pdf');
  assert.equal(metadata.objectId,body.invoice.id);
  assert.equal(metadata.objectKey,`private/${co1.id}/customer-invoices/${body.invoice.id}`);
  assert.equal(metadata.mimeType,'application/pdf');
  assert.equal(metadata.sizeBytes,archived.sizeBytes);
  assert.equal(metadata.sha256,archived.pdfSha256);
  assert.equal(metadata.createdAt,archived.createdAt);
  assert.equal(Invoicing.pdfArchivePrivateObjectMetadata(db,co2.id,body.invoice.id),null);
  const store=PdfArchiveStore.createSqliteCustomerInvoicePdfArchiveStore(db);
  assert.equal(store.exists({companyId:co1.id,invoiceId:body.invoice.id}),true);
  assert.equal(store.exists({companyId:co2.id,invoiceId:body.invoice.id}),false);
  assert.equal(store.get({companyId:co2.id,invoiceId:body.invoice.id}),null);
  assert.deepEqual(store.get({companyId:co1.id,invoiceId:body.invoice.id}).bytes,archived.bytes);
  const downloaded=await fetch(base+'/api/v1/customer-invoices/'+body.invoice.id+'/pdf',{headers:{Cookie:signed.cookie}});
  const bytes=Buffer.from(await downloaded.arrayBuffer());
  assert.equal(downloaded.status,200);
  assert.equal(downloaded.headers.get('x-document-sha256'),archived.pdfSha256);
  assert.deepEqual(bytes,archived.bytes);
  assert.throws(()=>Invoicing.pdfArchiveForInvoice(db,co2.id,body.invoice.id),error=>error.code==='INVOICE_PDF_ARCHIVE_NOT_FOUND');
}));

test('samma request-id med ändrat fakturainnehåll ger konflikt och ingen dubblett',async()=>withApi(async({base,password,db,co1})=>{
  const signed=await login(base,password),headers={Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken},requestId='invoice-request-digest-conflict-01';
  assert.equal((await fetch(base+'/api/v1/customer-invoices',{method:'POST',headers,body:JSON.stringify(payload(requestId))})).status,201);
  const changed=payload(requestId);changed.notes='Ändrat innehåll';
  const retry=await fetch(base+'/api/v1/customer-invoices',{method:'POST',headers,body:JSON.stringify(changed)}),body=await retry.json();
  assert.equal(retry.status,409);assert.equal(body.code,'INVOICE_IDEMPOTENCY_CONFLICT');
  assert.equal(Invoicing.listCustomerInvoices(db,co1.id).filter(row=>row.invoiceNumber==='310101').length,1);
}));

test('felaktiga PDF-bytes rullar tillbaka fakturan men behåller spårbar nummerreservation',async()=>withApi(async({db,co1,user})=>{
  const request=payload('invoice-request-pdf-failure-01');
  const prepared=Db.transaction(db,()=>Invoicing.prepareInvoiceIssuance(db,{companyId:co1.id,userId:user.id,payload:request,profile:PROFILE}));
  assert.equal(prepared.invoiceNumber,'310101');
  assert.throws(()=>Db.transaction(db,()=>Invoicing.finalizeInvoiceIssuance(db,{companyId:co1.id,userId:user.id,prepared,pdfBytes:Buffer.from('not-pdf')})),error=>error.code==='INVOICE_PDF_ARCHIVE_INVALID');
  assert.equal(Invoicing.listCustomerInvoices(db,co1.id).some(row=>row.invoiceNumber==='310101'),false);
  const reservation=Invoicing.reservationByRequest(db,co1.id,request.requestId);
  assert.equal(reservation.status,'reserved');assert.equal(reservation.invoiceNumber,'310101');
}));

test('kreditfaktura får ett eget oföränderligt PDF-arkiv',async()=>withApi(async({base,password})=>{
  const signed=await login(base,password),headers={Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken};
  const issued=await (await fetch(base+'/api/v1/customer-invoices',{method:'POST',headers,body:JSON.stringify(payload('invoice-request-credit-pdf-src-01'))})).json();
  const creditResponse=await fetch(base+'/api/v1/customer-invoices/'+issued.invoice.id+'/credit',{method:'POST',headers,body:JSON.stringify({requestId:'credit-request-pdf-archive-01',creditDate:'2026-09-18',reason:'Kredit för verifiering av PDF-arkiv.'})});
  const credit=await creditResponse.json();
  assert.equal(creditResponse.status,201);assert.match(credit.pdfArchive.fileName,/^Kreditfaktura-/);
  const pdf=await fetch(base+'/api/v1/customer-invoices/'+credit.invoice.id+'/pdf',{headers:{Cookie:signed.cookie}});
  const bytes=Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdf.status,200);assert.equal(bytes.subarray(0,5).toString('ascii'),'%PDF-');
  assert.equal(pdf.headers.get('x-document-sha256'),credit.pdfArchive.pdfSha256);
}));


test('delbetald kundfaktura kan helkrediteras med verifierad kundkredit som väntar på återbetalning',async()=>withApi(async({base,password,db,co1,user})=>{
  const signed=await login(base,password),headers={Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken};
  const issuedResponse=await fetch(base+'/api/v1/customer-invoices',{method:'POST',headers,body:JSON.stringify(payload('invoice-request-partial-credit-src-01'))});
  const issued=await issuedResponse.json();
  assert.equal(issuedResponse.status,201);

  const bank=Bank.create(db,{companyId:co1.id,externalId:'BANK-PARTIAL-CREDIT-1',bookingDate:'2026-09-19',amountOre:40000,reference:issued.invoice.invoiceNumber,payerName:issued.invoice.customerName,createdBy:user.id}).payment;
  const analysis=Matcher.analyzeIncomingPayment(bank,Db.listReceivables(db,co1.id));
  assert.equal(analysis.status,'proposal');
  const proposal=Queues.saveAutomationProposal(db,Matcher.createMatchProposal(bank,analysis,{createdBy:user.id}),{idempotencyKey:`partial-credit-bank-match:${bank.id}:v1`}).proposal;
  Bank.setStatus(db,co1.id,bank.id,'proposal-created');
  Queues.approveAutomationProposal(db,{companyId:co1.id,proposalId:proposal.id,userId:user.id});
  const paid=CustomerPayment.executeApprovedCustomerPayment(db,{companyId:co1.id,proposalId:proposal.id,actorId:user.id});
  assert.equal(paid.invoice.remainingOre,85000);

  const creditRequestId='credit-after-partial-payment-01';
  const creditResponse=await fetch(base+`/api/v1/customer-invoices/${issued.invoice.id}/credit`,{method:'POST',headers,body:JSON.stringify({requestId:creditRequestId,creditDate:'2026-09-20',reason:'Helkredit efter delbetalning.'})});
  const credit=await creditResponse.json();
  assert.equal(creditResponse.status,201);
  assert.equal(credit.invoice.totalOre,-125000);
  assert.equal(credit.invoice.remainingOre,-40000);
  assert.equal(credit.credit.offsetAmountOre,85000);
  assert.equal(credit.credit.refundDueOre,40000);
  assert.equal(credit.credit.refundStatus,'pending');
  assert.equal(credit.original.remainingOre,0);
  assert.equal(credit.original.status,'Krediterad');

  const reconciliation=Reports.receivablesControl(db,co1.id);
  assert.equal(reconciliation.integrityOk,true);
  assert.equal(reconciliation.differenceOre,0);

  const archived=Invoicing.pdfArchiveForInvoice(db,co1.id,credit.invoice.id);
  assert.equal(archived.bytes.subarray(0,5).toString('ascii'),'%PDF-');
  assert.equal(archived.fileName,`Kreditfaktura-${credit.invoice.invoiceNumber}.pdf`);
}));

test('faktura med helt återförd betalning kan helkrediteras utan negativ kundfordran',async()=>withApi(async({base,password,db,co1,user})=>{
  const signed=await login(base,password),headers={Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken};
  const source=(await (await fetch(base+'/api/v1/customer-invoices',{method:'POST',headers,body:JSON.stringify(payload('invoice-request-reversed-credit-src-01'))})).json());
  const targetPayload=payload('invoice-request-reversed-credit-target-01');targetPayload.customerNumber='K-100';targetPayload.notes='Målfaktura för återförd betalning';
  const target=(await (await fetch(base+'/api/v1/customer-invoices',{method:'POST',headers,body:JSON.stringify(targetPayload)})).json());

  const bank=Bank.create(db,{companyId:co1.id,externalId:'BANK-REVERSED-CREDIT-1',bookingDate:'2026-09-19',amountOre:source.invoice.totalOre,reference:source.invoice.invoiceNumber,payerName:source.invoice.customerName,createdBy:user.id}).payment;
  const analysis=Matcher.analyzeIncomingPayment(bank,Db.listReceivables(db,co1.id));
  const proposal=Queues.saveAutomationProposal(db,Matcher.createMatchProposal(bank,analysis,{createdBy:user.id}),{idempotencyKey:`reversed-credit-bank-match:${bank.id}:v1`}).proposal;
  Bank.setStatus(db,co1.id,bank.id,'proposal-created');
  Queues.approveAutomationProposal(db,{companyId:co1.id,proposalId:proposal.id,userId:user.id});
  CustomerPayment.executeApprovedCustomerPayment(db,{companyId:co1.id,proposalId:proposal.id,actorId:user.id});
  CustomerPayment.reclassifyCustomerPayment(db,{companyId:co1.id,proposalId:proposal.id,targetInvoiceId:target.invoice.id,requestId:'reversed-credit-reclass-0001',correctionDate:'2026-09-20',reason:'Betalningen hör till den andra fakturan.',actorId:user.id});

  const reopened=Db.invoiceById(db,co1.id,source.invoice.id);
  assert.equal(reopened.remainingOre,source.invoice.totalOre);
  const settlement=Invoicing.creditSettlementState(db,co1.id,reopened);
  assert.equal(settlement.settledOre,0);
  assert.equal(settlement.grossPaymentsOre,source.invoice.totalOre);
  assert.equal(settlement.reversedPaymentsOre,source.invoice.totalOre);

  const creditResponse=await fetch(base+`/api/v1/customer-invoices/${source.invoice.id}/credit`,{method:'POST',headers,body:JSON.stringify({requestId:'credit-after-reversed-payment-01',creditDate:'2026-09-21',reason:'Helkredit efter att fel betalning har omförts.'})});
  const credit=await creditResponse.json();
  assert.equal(creditResponse.status,201);
  assert.equal(credit.invoice.totalOre,-source.invoice.totalOre);
  assert.equal(credit.original.status,'Krediterad');
  assert.equal(credit.original.remainingOre,0);

  const relevant=Accounting.listEntries(db,co1.id).map(row=>Accounting.entryById(db,co1.id,row.id));
  const net1510=relevant.flatMap(entry=>entry.lines).filter(line=>line.account==='1510').reduce((sum,line)=>sum+line.debitOre-line.creditOre,0);
  assert.equal(net1510,target.invoice.totalOre-source.invoice.totalOre);
}));
