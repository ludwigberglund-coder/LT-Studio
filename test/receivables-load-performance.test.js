'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../apps/portal/app.js'),'utf8');
const loadStart=source.indexOf('async function loadReceivables(){');
const loadEnd=source.indexOf('\nasync function openComments(',loadStart);
const pdfStart=source.indexOf('async function openInvoicePdf(');
const pdfEnd=source.indexOf('\nfunction customerOverview(',pdfStart);
assert.ok(loadStart>=0&&loadEnd>loadStart,'Cannot isolate the receivables loader');
assert.ok(pdfStart>=0&&pdfEnd>pdfStart,'Cannot isolate the invoice PDF reader');

const company='synthetic-tenant-a';
const otherCompany='synthetic-tenant-b';
function invoice(id,customerId,remainingOre,status='Bokförd',companyId=company){
  return {id,company_id:companyId,customer_id:customerId,invoice_number:id,ocr:id,invoice_date:'2026-09-01',posting_date:'2026-09-01',due_date:'2026-10-01',
    total_ore:Math.abs(remainingOre),remaining_ore:remainingOre,vat_ore:0,status,payment_method:'Bankgiro',payment_account:'1930',invoice_account:'1510',batch_number:14,journal_number:'A14'};
}
function fixture(){
  return {
    customers:[
      {id:'customer-1',company_id:company,name:'Kund Ett',customer_number:'K1',org_number:'111111-1111',customer_type:'business',reminder_fee_agreed:true},
      {id:'customer-2',company_id:company,name:'Kund Två',customer_number:'K2'},
      {id:'customer-3',company_id:company,name:'Utan faktura',customer_number:'K3'},
      {id:'foreign',company_id:otherCompany,name:'Får ej visas',customer_number:'K99'}
    ],
    invoices:[
      invoice('inv-open','customer-1',12000),
      invoice('inv-paid','customer-1',0,'Betald'),
      invoice('inv-pending','customer-1',7000,'Väntar på bunt'),
      invoice('inv-customer-2','customer-2',4000),
      invoice('inv-foreign','foreign',990000,'Bokförd',otherCompany)
    ],
    invoice_transactions:[{id:'transaction-1',company_id:company,invoice_id:'inv-open',amount_ore:-2000,transaction_type:'payment',payment_date:'2026-09-15'}],
    customer_manual_payments:[{id:'payment-1',company_id:company,invoice_id:'inv-open',batch_id:'batch-1',payment_date:'2026-09-20',amount_ore:3000,status:'pending'}],
    financial_batches:[{id:'batch-1',company_id:company,batch_number:42}],
    customer_invoice_credit_adjustments:[],customer_credit_refunds:[],
    invoice_comments:[{id:'comment-1',company_id:company,invoice_id:'inv-open',comment_text:'Fiktiv kommentar',author_name:'UAT'}],
    invoice_reminders:[{id:'reminder-1',company_id:company,invoice_id:'inv-open',reminder_date:'2026-09-25',kind:'payment-reminder'}],
    customer_invoice_documents:[{id:'doc-1',company_id:company,invoice_id:'inv-open',document_json:{large:'x'.repeat(20000)}}]
  };
}
function harness(data=fixture()){
  const calls=[];
  let renders=0;
  const context={
    mode:'supabase',session:null,invoices:[],receivableCustomers:[],
    pendingBatchInvoice:i=>i.status==='Väntar på bunt',
    supabaseContext:async()=>({authenticated:true,company:{id:company},user:{displayName:'Synthetic user'},accessToken:'synthetic-test-token'}),
    supabaseRows:async(table,token,filters,columns='*')=>{
      assert.equal(token,'synthetic-test-token');
      const params=new URLSearchParams(filters);
      assert.equal(params.get('company_id'),'eq.'+company,'Every query must keep the tenant filter');
      calls.push({table,filters,columns});
      const selected=(data[table]||[]).filter(row=>row.company_id===company)
        .filter(row=>!params.has('archived_at')||!row.archived_at)
        .filter(row=>!params.has('id')||String(params.get('id')).includes(row.id));
      return selected.map(row=>columns==='*'?{...row}:Object.fromEntries(columns.split(',').map(key=>[key,row[key]])));
    },
    portalView:()=>{renders++},
    loginView:()=>{throw new Error('Unexpected login fallback')}
  };
  vm.runInNewContext(source.slice(loadStart,loadEnd)+'\n;globalThis.__loadReceivables=loadReceivables;',context,{filename:'app.js'});
  return {context,calls,renders:()=>renders};
}

test('receivables fetch only list fields, never download every invoice PDF at startup',async()=>{
  const h=harness();
  await h.context.__loadReceivables();
  assert.equal(h.renders(),1);
  assert.equal(h.calls.length,9,'Eight collection reads plus one matching batch lookup');
  assert.equal(h.calls.some(q=>q.table==='customer_invoice_documents'),false,'PDF JSON must be fetched on click, not when listing invoices');
  const customers=h.calls.find(q=>q.table==='customers');
  const invoices=h.calls.find(q=>q.table==='invoices');
  assert.equal(customers.columns.includes('*'),false);
  assert.equal(invoices.columns.includes('*'),false);
  assert.match(invoices.columns,/remaining_ore/);
  assert.match(customers.filters,/archived_at=is.null/);
  assert.equal(h.context.invoices.length,4,'Second tenant must not leak into list');
  assert.equal(h.context.invoices.find(i=>i.id==='inv-open').pdfDocument,undefined);
  assert.equal(h.context.invoices.find(i=>i.id==='inv-open').commentCount,1);
  assert.equal(h.context.invoices.find(i=>i.id==='inv-open').manualPayments[0].batchNumber,42);
  const byId=id=>h.context.receivableCustomers.find(c=>c.customerId===id);
  assert.equal(byId('customer-1').invoiceCount,3);
  assert.equal(byId('customer-1').openInvoiceCount,1);
  assert.equal(byId('customer-1').remainingOre,12000,'Pending batch and paid invoices do not distort receivable totals');
  assert.equal(byId('customer-2').remainingOre,4000);
  assert.equal(byId('customer-3').invoiceCount,0,'Customers without invoices remain visible');
  assert.equal(byId('customer-3').remainingOre,0);
  assert.equal(byId('foreign'),undefined);
});

test('one selected invoice PDF is fetched with company and invoice filters only when opened',async()=>{
  const h=harness();
  await h.context.__loadReceivables();
  const tab={opener:'unsafe',location:{href:''},close:()=>{throw Error('PDF tab unexpectedly closed')}};
  const pdfRequests=[];
  let renderedDocument=null;
  Object.assign(h.context,{
    Pdf:{createInvoicePdf:async doc=>{renderedDocument=doc;return new Uint8Array([37,80,68,70])}},
    invoiceById:id=>h.context.invoices.find(i=>i.id===id),
    Blob,
    URL:{createObjectURL:()=> 'blob:synthetic-invoice',revokeObjectURL:()=>{}},
    setTimeout:()=>1,
    window:{
      open:()=>tab,
      LTSupabase:{from:(table,token)=>{
        assert.equal(table,'customer_invoice_documents');
        assert.equal(token,'synthetic-test-token');
        return {select:async(columns,filters)=>{
          pdfRequests.push({columns,filters});
          assert.equal(columns,'document_json');
          assert.match(filters,/company_id=eq.synthetic-tenant-a/);
          assert.match(filters,/invoice_id=eq.inv-open/);
          return [{document_json:{customer:'Kund Ett',invoice:'inv-open'}}];
        }};
      }}
    }
  });
  vm.runInNewContext(source.slice(pdfStart,pdfEnd)+'\n;globalThis.__openInvoicePdf=openInvoicePdf;',h.context,{filename:'app.js'});
  await h.context.__openInvoicePdf('inv-open');
  assert.equal(pdfRequests.length,1);
  assert.equal(renderedDocument.invoice,'inv-open');
  assert.equal(tab.opener,null);
  assert.equal(tab.location.href,'blob:synthetic-invoice');
});
