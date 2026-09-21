'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Payables=require('../apps/api/payables.js');
const Release=require('../apps/api/payment-release.js');
const SupplierAccounting=require('../apps/api/supplier-accounting.js');
const Accounting=require('../apps/api/accounting-store.js');
const AccountingAdmin=require('../apps/api/accounting-admin.js');
const Domain=require('../packages/payables/supplier-invoices.js');

async function expectNotFound(response,code){
  assert.equal(response.status,404);
  const body=await response.json();
  if(code)assert.equal(body.code,code);
}

test('finansiella objekt från annat företag kan inte läsas eller muteras via HTTP',async()=>{
  const f=await fixture();
  try{
    const foreignApprover=Db.createUser(f.db,{username:'foreign.approver',displayName:'Foreign Approver',passwordHash:'test-only-hash'});
    const foreignAccountant=Db.createUser(f.db,{username:'foreign.accountant',displayName:'Foreign Accountant',passwordHash:'test-only-hash'});
    Db.addMembership(f.db,{companyId:f.b.id,userId:foreignApprover.id});
    Db.addMembership(f.db,{companyId:f.b.id,userId:foreignAccountant.id});

    const foreignInvoice=f.otherPayable;
    const coding=Domain.buildCoding({
      totalOre:foreignInvoice.totalOre,
      vatOre:foreignInvoice.vatOre,
      costAccount:'5460'
    }).lines;
    Payables.saveCoding(f.db,{companyId:f.b.id,invoiceId:foreignInvoice.id,lines:coding});
    let current=Payables.invoiceById(f.db,f.b.id,foreignInvoice.id);
    Payables.approve(f.db,{
      companyId:f.b.id,
      invoiceId:foreignInvoice.id,
      actorId:foreignApprover.id,
      expectedCodingSha256:current.codingSha256,
      expectedDocumentSha256:current.documentSha256
    });
    const posted=SupplierAccounting.postSupplierInvoice(f.db,{
      companyId:f.b.id,
      invoiceId:foreignInvoice.id,
      actorId:foreignAccountant.id
    });
    const payment=Payables.preparePayment(f.db,{
      companyId:f.b.id,
      invoiceId:foreignInvoice.id,
      paymentDate:'2026-09-20',
      amountOre:foreignInvoice.totalOre,
      account:'1930',
      preparedBy:f.other.id
    });
    Release.releasePayment(f.db,{companyId:f.b.id,paymentId:payment.id,releasedBy:foreignApprover.id});
    SupplierAccounting.confirmSupplierPayment(f.db,{
      companyId:f.b.id,
      paymentId:payment.id,
      confirmationReference:'FOREIGN-BANK-REF-001',
      postingDate:'2026-09-20',
      actorId:foreignAccountant.id
    });

    const foreignEntry=Accounting.postEntry(f.db,{
      companyId:f.b.id,
      postingDate:'2026-09-20',
      description:'Främmande manuell verifikation',
      sourceType:'manual',
      sourceId:'foreign-manual-entry-001',
      createdBy:foreignAccountant.id,
      lines:[
        {account:'1930',debitOre:10000,creditOre:0,text:'Bank'},
        {account:'2999',debitOre:0,creditOre:10000,text:'Motkonto'}
      ]
    }).entry;
    AccountingAdmin.lockPeriod(f.db,{companyId:f.b.id,period:'2026-10',lockedBy:foreignAccountant.id});
    const unlock=AccountingAdmin.requestUnlock(f.db,{
      companyId:f.b.id,
      period:'2026-10',
      reason:'Kontrollerad främmande upplåsningsbegäran',
      requestedBy:f.other.id
    });

    const headers=await f.login(f.admin.username);
    const invoiceBefore=Payables.invoiceById(f.db,f.b.id,foreignInvoice.id);
    const paymentBefore=SupplierAccounting.paymentForConfirmation(f.db,f.b.id,payment.id);
    const bEntriesBefore=Accounting.listEntries(f.db,f.b.id).length;
    const aAuditBefore=Db.auditForCompany(f.db,f.a.id).length;
    const bAuditBefore=Db.auditForCompany(f.db,f.b.id).length;

    await expectNotFound(
      await fetch(f.base+'/api/v1/payables/invoices/'+foreignInvoice.id,{headers}),
      'INVOICE_NOT_FOUND'
    );
    await expectNotFound(
      await fetch(f.base+'/api/v1/payables/invoices/'+foreignInvoice.id+'/coding',{
        method:'PUT',headers,body:JSON.stringify({lines:coding})
      }),
      'INVOICE_NOT_FOUND'
    );
    await expectNotFound(
      await fetch(f.base+'/api/v1/payables/invoices/'+foreignInvoice.id+'/approve',{
        method:'POST',headers,body:JSON.stringify({
          expectedCodingSha256:invoiceBefore.codingSha256,
          expectedDocumentSha256:invoiceBefore.documentSha256
        })
      }),
      'INVOICE_NOT_FOUND'
    );
    await expectNotFound(
      await fetch(f.base+'/api/v1/payables/invoices/'+foreignInvoice.id+'/post',{
        method:'POST',headers,body:JSON.stringify({})
      }),
      'INVOICE_NOT_FOUND'
    );
    await expectNotFound(
      await fetch(f.base+'/api/v1/payables/invoices/'+foreignInvoice.id+'/prepare-payment',{
        method:'POST',headers,body:JSON.stringify({paymentDate:'2026-09-21',account:'1930'})
      }),
      'INVOICE_NOT_FOUND'
    );

    await expectNotFound(
      await fetch(f.base+'/api/v1/payables/payments/'+payment.id+'/release',{
        method:'POST',headers,body:JSON.stringify({})
      }),
      'PAYMENT_NOT_FOUND'
    );
    await expectNotFound(
      await fetch(f.base+'/api/v1/payables/payments/'+payment.id+'/confirm-post',{
        method:'POST',headers,body:JSON.stringify({confirmationReference:'ATTACK-REF',postingDate:'2026-09-21'})
      }),
      'PAYMENT_NOT_FOUND'
    );
    await expectNotFound(
      await fetch(f.base+'/api/v1/payables/payments/'+payment.id+'/correct',{
        method:'POST',headers,body:JSON.stringify({
          requestId:'foreign-payment-correction-0001',
          correctionDate:'2026-09-21',
          reason:'Otillåtet korsföretagsförsök'
        })
      }),
      'PAYMENT_NOT_FOUND'
    );

    await expectNotFound(
      await fetch(f.base+'/api/v1/accounting/entries/'+foreignEntry.id,{headers}),
      'ENTRY_NOT_FOUND'
    );
    await expectNotFound(
      await fetch(f.base+'/api/v1/accounting/entries/'+foreignEntry.id+'/correct',{
        method:'POST',headers,body:JSON.stringify({
          postingDate:'2026-09-21',
          reason:'Otillåten rättelse av främmande verifikation'
        })
      }),
      'ENTRY_NOT_FOUND'
    );
    await expectNotFound(
      await fetch(f.base+'/api/v1/accounting/unlock-requests/'+unlock.id+'/approve',{
        method:'POST',headers,body:JSON.stringify({reason:'Otillåtet godkännande'})
      }),
      'UNLOCK_REQUEST_NOT_FOUND'
    );
    await expectNotFound(
      await fetch(f.base+'/api/v1/accounting/unlock-requests/'+unlock.id+'/reject',{
        method:'POST',headers,body:JSON.stringify({reason:'Otillåtet avslag'})
      }),
      'UNLOCK_REQUEST_NOT_FOUND'
    );

    assert.deepEqual(Payables.invoiceById(f.db,f.b.id,foreignInvoice.id),invoiceBefore);
    assert.deepEqual(SupplierAccounting.paymentForConfirmation(f.db,f.b.id,payment.id),paymentBefore);
    assert.equal(Accounting.listEntries(f.db,f.b.id).length,bEntriesBefore);
    assert.equal(AccountingAdmin.unlockRequestById(f.db,f.b.id,unlock.id).status,'pending');
    assert.equal(AccountingAdmin.periodStatus(f.db,f.b.id,'2026-10').status,'locked');
    assert.equal(Db.auditForCompany(f.db,f.a.id).length,aAuditBefore);
    assert.equal(Db.auditForCompany(f.db,f.b.id).length,bAuditBefore);
    assert.ok(posted.entry.id);
  }finally{
    await f.close();
  }
});
