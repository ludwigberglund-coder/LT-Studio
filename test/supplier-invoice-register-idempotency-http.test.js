'use strict';

// CI sync marker: verify this retry regression against the latest main base.

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Payables=require('../apps/api/payables.js');

test('identisk leverantörsfakturaregistrering återanvänder fakturan utan ny audit',async()=>{
  const f=await fixture();
  try{
    const supplier=Payables.createSupplier(f.db,{
      companyId:f.a.id,
      supplierNumber:'L-IDEMP-1',
      name:'Idempotent Leverantör AB',
      orgNumber:'559900-8810',
      bankgiro:'555-8810',
      defaultCostAccount:'4010'
    });
    const headers=await f.login(f.admin.username);
    const payload={
      supplierId:supplier.id,
      supplierInvoiceNumber:'IDEMP-2026-001',
      invoiceDate:'2026-09-21',
      dueDate:'2026-10-21',
      totalOre:125000,
      vatOre:25000,
      currency:'SEK',
      vatTreatment:'se-domestic-full-input-vat'
    };

    const first=await fetch(f.base+'/api/v1/payables/invoices',{
      method:'POST',headers,body:JSON.stringify(payload)
    });
    const firstBody=await first.json();
    assert.equal(first.status,201);
    assert.equal(firstBody.duplicate,false);

    const retry=await fetch(f.base+'/api/v1/payables/invoices',{
      method:'POST',headers,body:JSON.stringify(payload)
    });
    const retryBody=await retry.json();
    assert.equal(retry.status,200);
    assert.equal(retryBody.duplicate,true);
    assert.equal(retryBody.invoice.id,firstBody.invoice.id);

    assert.equal(
      f.db.prepare('SELECT COUNT(*) AS n FROM supplier_invoices WHERE company_id=? AND supplier_id=? AND supplier_invoice_number=?')
        .get(f.a.id,supplier.id,payload.supplierInvoiceNumber).n,
      1
    );
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='SUPPLIER_INVOICE_REGISTERED'&&event.entityId===firstBody.invoice.id).length,
      1
    );

    const changedAmount=await fetch(f.base+'/api/v1/payables/invoices',{
      method:'POST',headers,body:JSON.stringify({...payload,totalOre:130000,vatOre:26000})
    });
    assert.equal(changedAmount.status,409);
    assert.equal((await changedAmount.json()).code,'SUPPLIER_INVOICE_IDEMPOTENCY_CONFLICT');

    const changedDueDate=await fetch(f.base+'/api/v1/payables/invoices',{
      method:'POST',headers,body:JSON.stringify({...payload,dueDate:'2026-10-22'})
    });
    assert.equal(changedDueDate.status,409);
    assert.equal((await changedDueDate.json()).code,'SUPPLIER_INVOICE_IDEMPOTENCY_CONFLICT');

    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='SUPPLIER_INVOICE_REGISTERED'&&event.entityId===firstBody.invoice.id).length,
      1
    );
  }finally{
    await f.close();
  }
});
