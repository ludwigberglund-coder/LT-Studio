'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Cms=require('../apps/api/website-cms.js');
const Db=require('../apps/api/database.js');
async function run(callback){const f=await fixture();try{await callback(f);}finally{await f.close();}}
async function json(base,path,headers,method='GET',body){const res=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});return{res,data:await res.json()};}
test('private preview requires authentication and active company membership for HTML and assets',()=>run(async f=>{
  for(const route of ['/website-preview/','/website-preview/app.js','/website-preview/shared/content.js']){
    assert.equal((await fetch(f.base+route)).status,401);
    assert.equal((await fetch(f.base+route,{headers:await f.login(f.auditor.username)})).status,200);
    const res=await fetch(f.base+route,{headers:await f.login()});assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
    assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  }
  const headers=await f.login();
  assert.equal((await fetch(f.base+'/website-preview/../../package.json',{headers})).status,404);
  const injected=await json(f.base,`/api/v1/website/cms?companyId=${f.b.id}`,headers);
  assert.equal(injected.res.status,422);
  assert.equal(injected.data.code,'UNEXPECTED_QUERY_PARAMETER');
  const own=await json(f.base,'/api/v1/website/cms',headers);
  assert.equal(own.res.status,200);
  assert.equal(own.data.state.companyId,f.a.id);
  assert.equal(own.data.state.draft.site.hero.title,'Privat utkast Testbutik A');
}));
test('draft save preserves published content and refuses stale writes or missing preconditions',()=>run(async f=>{
  const headers=await f.login(),before=Cms.state(f.db,f.a.id),body={site:before.draft.site,company:before.draft.company,expectedRevision:before.draft.revision};
  body.site.hero.title='Ny rubrik A';
  const noCsrf=await json(f.base,'/api/v1/website/cms/draft',{...headers,'X-CSRF-Token':''},'PUT',body);assert.equal(noCsrf.res.status,403);
  const noRevision=await json(f.base,'/api/v1/website/cms/draft',headers,'PUT',{site:body.site,company:body.company});assert.equal(noRevision.res.status,428);
  const first=await json(f.base,'/api/v1/website/cms/draft',headers,'PUT',body);assert.equal(first.res.status,200);
  assert.equal(first.data.state.draft.revision,before.draft.revision+1);assert.deepEqual(first.data.state.published,before.published);
  const second=await json(f.base,'/api/v1/website/cms/draft',headers,'PUT',{...body,site:{...body.site,hero:{...body.site.hero,title:'Stale overwrite'}}});assert.equal(second.res.status,409);
  assert.equal(Cms.state(f.db,f.a.id).draft.site.hero.title,'Ny rubrik A');
  assert.equal(Cms.state(f.db,f.b.id).draft.site.hero.title,'Privat utkast Testbutik B');
}));
test('parallel publication creates one revision and restore changes only the draft',()=>run(async f=>{
  const headers=await f.login(),before=Cms.state(f.db,f.a.id);
  const body={expectedRevision:before.draft.revision,expectedPublishedVersion:before.published.version};
  const results=await Promise.all([1,2].map(()=>json(f.base,'/api/v1/website/cms/publish',headers,'POST',body)));
  assert.deepEqual(results.map(x=>x.res.status).sort(),[200,201]);
  assert.deepEqual(results.map(x=>x.data.duplicate).sort(),[false,true]);
  assert.equal(Cms.listRevisions(f.db,f.a.id).length,1);
  const current=Cms.state(f.db,f.a.id);
  const restored=await json(f.base,'/api/v1/website/cms/revisions/1/restore',headers,'POST',{expectedRevision:current.draft.revision});
  assert.equal(restored.res.status,200);assert.equal(restored.data.state.draft.revision,current.draft.revision+1);
  assert.deepEqual(restored.data.state.published,current.published);
  assert.equal(Db.auditForCompany(f.db,f.a.id).filter(x=>x.action==='WEBSITE_VERSION_PUBLISHED').length,1);
}));
test('CMS audit failure rolls back content and revision together',()=>run(async f=>{
  const headers=await f.login(),before=Cms.state(f.db,f.a.id);
  f.db.exec("CREATE TEMP TRIGGER fail_cms_audit BEFORE INSERT ON audit_events WHEN NEW.action='WEBSITE_DRAFT_SAVED' BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END;");
  const body={site:{...before.draft.site,hero:{...before.draft.site.hero,title:'Must roll back'}},company:before.draft.company,expectedRevision:before.draft.revision};
  const result=await json(f.base,'/api/v1/website/cms/draft',headers,'PUT',body);assert.equal(result.res.status,500);
  assert.doesNotMatch(JSON.stringify(result.data),/TEST_FAILURE|INSERT|\.js:/);
  assert.deepEqual(Cms.state(f.db,f.a.id),before);
}));
test('supplier PDF is downloadable only after object-level authentication and cannot be framed',()=>run(async f=>{
  const route='/api/v1/payables/invoices/'+f.payable.id+'/document';
  assert.equal((await fetch(f.base+route)).status,401);
  const headers=await f.login();const res=await fetch(f.base+route,{headers});assert.equal(res.status,200);
  assert.equal(res.headers.get('x-frame-options'),'DENY');assert.match(res.headers.get('content-security-policy'),/sandbox/);assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(res.headers.get('content-disposition')||'',/^attachment;/);
  assert.equal(res.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await res.arrayBuffer()),f.pdf);
  const foreign=await fetch(f.base+'/api/v1/payables/invoices/'+f.otherPayable.id+'/document',{headers});assert.equal(foreign.status,404);assert.equal(foreign.headers.get('x-frame-options'),'DENY');
}));
test('bankimport och matchning är idempotenta genom det privata HTTP-API:t',()=>run(async f=>{
  const headers=await f.login();
  const input={
    externalId:'HTTP-BANK-IDEMP-1',
    bookingDate:'2026-09-20',
    valueDate:'2026-09-21',
    amountOre:f.issued.invoice.totalOre,
    currency:'SEK',
    reference:f.issued.invoice.ocr||f.issued.invoice.invoiceNumber,
    message:'Idempotens banktest',
    payerName:'Fiktiv testkund AB',
    payerAccount:'SE0000000000000000000000'
  };
  const first=await json(f.base,'/api/v1/bank/payments',headers,'POST',input);
  assert.equal(first.res.status,201);assert.equal(first.data.duplicate,false);
  const retry=await json(f.base,'/api/v1/bank/payments',headers,'POST',input);
  assert.equal(retry.res.status,200);assert.equal(retry.data.duplicate,true);assert.equal(retry.data.payment.id,first.data.payment.id);

  const conflict=await json(f.base,'/api/v1/bank/payments',headers,'POST',{...input,amountOre:input.amountOre+100});
  assert.equal(conflict.res.status,409);assert.equal(conflict.data.code,'BANK_IDEMPOTENCY_CONFLICT');

  const firstMatch=await json(f.base,`/api/v1/bank/payments/${first.data.payment.id}/match`,headers,'POST');
  assert.equal(firstMatch.res.status,200);assert.equal(firstMatch.data.duplicate,false);assert.ok(firstMatch.data.proposal?.id);
  const secondMatch=await json(f.base,`/api/v1/bank/payments/${first.data.payment.id}/match`,headers,'POST');
  assert.equal(secondMatch.res.status,200);assert.equal(secondMatch.data.duplicate,true);assert.equal(secondMatch.data.proposal.id,firstMatch.data.proposal.id);

  const audit=Db.auditForCompany(f.db,f.a.id);
  assert.equal(audit.filter(x=>x.action==='BANK_PAYMENT_IMPORTED'&&x.entityId===first.data.payment.id).length,1);
  assert.equal(audit.filter(x=>x.action==='BANK_PAYMENT_MATCH_PROPOSED'&&x.entityId===first.data.payment.id).length,1);
}));

test('draft revision schema migration is repeatable and preserves existing content',()=>run(async f=>{
  const before=Cms.state(f.db,f.a.id);f.db.exec('ALTER TABLE website_cms_state DROP COLUMN draft_revision');
  Cms.initializeWebsiteCms(f.db);const migrated=Cms.state(f.db,f.a.id);
  assert.equal(migrated.draft.revision,1);assert.deepEqual(migrated.draft.site,before.draft.site);assert.deepEqual(migrated.published,before.published);
  Cms.initializeWebsiteCms(f.db);assert.equal(Cms.state(f.db,f.a.id).draft.revision,1);
}));

test('private PDF response supports international file names without unsafe response headers',()=>run(async f=>{
  const Payables=require('../apps/api/payables.js');
  const name='faktura-\u6e2c\u8a66-\u00e5\u00e4\u00f6.pdf';
  Payables.storeDocument(f.db,{companyId:f.a.id,invoiceId:f.payable.id,name,bytes:f.pdf});
  const response=await fetch(f.base+'/api/v1/payables/invoices/'+f.payable.id+'/document',{headers:await f.login()});
  assert.equal(response.status,200);
  const disposition=response.headers.get('content-disposition');
  assert.match(disposition,/^attachment; filename="invoice\.pdf"; filename\*=UTF-8''/);
  assert.equal(decodeURIComponent(disposition.split("UTF-8''")[1]),name);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.pdf);
}));

test('changed supplier PDF bytes cannot be served or approved using an old fingerprint',()=>run(async f=>{
  const Payables=require('../apps/api/payables.js');
  Payables.saveCoding(f.db,{companyId:f.a.id,invoiceId:f.payable.id,lines:[
    {account:'5460',text:'Test',debitOre:100000,creditOre:0},
    {account:'2641',text:'VAT',debitOre:25000,creditOre:0},
    {account:'2440',text:'Payable',debitOre:0,creditOre:125000}
  ]});
  // Test-only corruption: keep the old digest while changing the PDF bytes.
  f.db.prepare('UPDATE supplier_invoices SET document_blob=? WHERE id=?').run(Buffer.concat([f.pdf,Buffer.from('\n% changed')]),f.payable.id);
  const response=await fetch(f.base+'/api/v1/payables/invoices/'+f.payable.id+'/document',{headers:await f.login()});
  assert.equal(response.status,409);
  const body=await response.json();assert.equal(body.code,'DOCUMENT_INTEGRITY_ERROR');
  assert.doesNotMatch(JSON.stringify(body),/%PDF|document_blob|SELECT|\.js:/);
  Db.addMembership(f.db,{companyId:f.a.id,userId:f.auditor.id});
  const reviewed=Payables.invoiceById(f.db,f.a.id,f.payable.id);
  const approval=await json(f.base,'/api/v1/payables/invoices/'+f.payable.id+'/approve',await f.login(f.auditor.username),'POST',{expectedCodingSha256:reviewed.codingSha256,expectedDocumentSha256:reviewed.documentSha256});
  assert.equal(approval.res.status,409);assert.equal(approval.data.code,'DOCUMENT_INTEGRITY_ERROR');
  assert.equal(Payables.invoiceById(f.db,f.a.id,f.payable.id).status,'coded');
  assert.equal(Db.auditForCompany(f.db,f.a.id).filter(x=>x.action==='SUPPLIER_INVOICE_APPROVED').length,0);
}));
