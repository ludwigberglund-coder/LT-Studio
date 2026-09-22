'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Accounting=require('../apps/api/accounting-store.js');
const Invoicing=require('../apps/api/customer-invoicing.js');
const Reports=require('../apps/api/reports.js');
const Auth=require('../apps/api/auth.js');

(async()=>{
  const f=await fixture();
  let browser,context,page;
  const out=path.resolve(__dirname,'..','test-artifacts');
  fs.mkdirSync(out,{recursive:true});
  try{
    const payload={
      customerNumber:'K-1001',
      invoiceDate:'2026-09-22',
      postingDate:'2026-09-22',
      dueDate:'2026-10-22',
      paymentTermsDays:30,
      ourReference:'Browser UAT',
      yourReference:'Kredit/återbetalning',
      notes:'Betald faktura för kredit- och återbetalnings-UAT',
      lines:[{
        description:'Betald tjänst för återbetalningstest',
        quantity:'1',
        unit:'st',
        unitPrice:'1000,00',
        vatTreatment:'se-standard-25',
        vatRate:'25',
        revenueAccount:'3051'
      }],
      requestId:'private-refund-browser-invoice-001'
    };
    const prepared=Db.transaction(f.db,()=>Invoicing.prepareInvoiceIssuance(f.db,{
      companyId:f.a.id,
      userId:f.admin.id,
      payload,
      profile:{
        legalName:f.a.legalName,
        displayName:f.a.displayName,
        orgNumber:f.a.orgNumber,
        vatNumber:'SE559900100101',
        address:{full:'Testgatan 1, Teststad'},
        contact:{email:'info@example.invalid'},
        invoice:{}
      }
    }));
    const pdfBytes=await Invoicing.renderInvoicePdf(prepared.document);
    const issued=Db.transaction(f.db,()=>Invoicing.finalizeInvoiceIssuance(f.db,{
      companyId:f.a.id,userId:f.admin.id,prepared,pdfBytes
    }));

    Db.transaction(f.db,()=>{
      const paid=Accounting.postEntry(f.db,{
        companyId:f.a.id,
        postingDate:'2026-09-22',
        description:'Browser UAT full kundbetalning',
        sourceType:'browser-credit-payment',
        sourceId:issued.invoice.id,
        createdBy:f.admin.id,
        series:'A',
        lines:[
          {account:'1930',text:'Bank',debitOre:125000,creditOre:0},
          {account:'1510',text:'Kundfordran',debitOre:0,creditOre:125000}
        ]
      });
      Db.addInvoiceTransaction(f.db,{
        companyId:f.a.id,
        invoiceId:issued.invoice.id,
        transactionType:'payment',
        paymentMethod:'Bankgiro',
        paymentDate:'2026-09-22',
        postingDate:'2026-09-22',
        journalNumber:paid.entry.number,
        amountOre:-125000,
        approved:true,
        account:'1930',
        bankReference:'browser-credit-payment-001'
      });
      f.db.prepare('UPDATE invoices SET remaining_ore=0,status=?,updated_at=? WHERE company_id=? AND id=?')
        .run('Betald',new Date().toISOString(),f.a.id,issued.invoice.id);
    });

    browser=await chromium.launch({headless:true,chromiumSandbox:true});
    context=await browser.newContext({viewport:{width:1440,height:1000}});
    page=await context.newPage();

    await page.goto(f.base+'/portal/index.html');
    await page.locator('#login-form [name=username]').fill(f.admin.username);
    await page.locator('#login-form [name=password]').fill(f.PASSWORD);
    await page.locator('#login-form [name=totp]').fill(Auth.totpCode(f.MFA));
    await Promise.all([
      page.waitForResponse(response=>response.url().endsWith('/api/v1/auth/login')&&response.status()===200),
      page.locator('#login-form button').click()
    ]);
    await page.waitForFunction(()=>Boolean(sessionStorage.getItem('rollands-csrf')));

    await page.goto(f.base+'/portal/invoices.html');
    await page.locator(`[data-preview="${issued.invoice.id}"]`).click();
    assert.equal(await page.getByRole('button',{name:'Kreditera faktura',exact:true}).count(),1,'betald faktura ska kunna krediteras');

    page.on('dialog',dialog=>{
      const message=dialog.message();
      if(dialog.type()==='prompt'&&/Belopp att kreditera/i.test(message))return dialog.accept('500,00');
      if(dialog.type()==='prompt'&&/orsaken till krediteringen/i.test(message))return dialog.accept('Prisavdrag efter att fakturan betalats.');
      if(dialog.type()==='prompt'&&/Vilket bankkonto/i.test(message))return dialog.accept('1930');
      if(dialog.type()==='prompt'&&/Återbetalningsdatum/i.test(message))return dialog.accept('2026-09-22');
      if(dialog.type()==='prompt'&&/Bankens referens/i.test(message))return dialog.accept('browser-refund-001');
      return dialog.accept();
    });

    await page.getByRole('button',{name:'Kreditera faktura',exact:true}).click();
    await page.getByRole('heading',{name:/Kreditfaktura /}).waitFor({timeout:30000});
    await page.getByText(/Återbetalning väntar/).waitFor({timeout:30000});

    const pending=Invoicing.listCustomerInvoices(f.db,f.a.id)
      .find(row=>row.totalOre===-50000&&row.customerId===issued.invoice.customerId);
    assert.ok(pending,'delkreditfakturan ska finnas');
    assert.equal(pending.remainingOre,-50000,'kundens kredit ska ligga som negativt saldo tills pengar betalas ut');
    const pendingBundle=Invoicing.invoiceBundle(f.db,f.a.id,pending.id);
    assert.equal(pendingBundle.credit.refundStatus,'pending');
    assert.equal(pendingBundle.credit.refundOutstandingOre,50000);

    const beforeRefund=Reports.receivablesControl(f.db,f.a.id);
    assert.equal(beforeRefund.integrityOk,true,'kundreskontra och 1510 ska stämma även medan återbetalning väntar');
    assert.equal(beforeRefund.differenceOre,0);

    await page.getByRole('button',{name:'Registrera återbetalning',exact:true}).click();
    await page.getByText(/Återbetalningen är registrerad/).waitFor({timeout:30000});

    const refunded=Invoicing.invoiceBundle(f.db,f.a.id,pending.id);
    assert.equal(refunded.credit.refundStatus,'refunded');
    assert.equal(refunded.invoice.remainingOre,0);
    assert.equal(refunded.credit.refund.refundAccount,'1930');
    assert.equal(refunded.credit.refund.bankReference,'browser-refund-001');

    const refundEntry=Accounting.entryBySource(f.db,f.a.id,'customer-credit-refund',pending.id);
    assert.ok(refundEntry);
    assert.equal(refundEntry.lines.find(row=>row.account==='1510').debitOre,50000);
    assert.equal(refundEntry.lines.find(row=>row.account==='1930').creditOre,50000);
    assert.equal(refundEntry.lines.reduce((sum,row)=>sum+row.debitOre-row.creditOre,0),0);

    const afterRefund=Reports.receivablesControl(f.db,f.a.id);
    assert.equal(afterRefund.integrityOk,true);
    assert.equal(afterRefund.differenceOre,0);

    await page.screenshot({path:path.join(out,'private-customer-credit-refund.png'),fullPage:false});
    console.log('Customer credit/refund browser-UAT: OK');
  }finally{
    if(browser)await browser.close();
    await f.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
