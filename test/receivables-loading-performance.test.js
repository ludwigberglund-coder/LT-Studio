'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.resolve(__dirname,'../apps/portal/app.js'),'utf8');
const start=source.indexOf('async function loadReceivables(){');
const end=source.indexOf('\nasync function openComments(',start);
assert.ok(start>=0&&end>start,'Expected the Supabase receivables loading function');

function runtime(records){
  const calls=[];
  let renders=0;
  const userContext={
    authenticated:true,
    accessToken:'fake-jwt-for-synthetic-test',
    company:{id:'tenant-a',name:'Synthetic company A'},
    user:{displayName:'Synthetic tester'}
  };
  const global={
    Promise,Map,Set,Number,String,encodeURIComponent,
    session:null,invoices:[],receivableCustomers:[],
    supabaseContext:async()=>userContext,
    pendingBatchInvoice:invoice=>String(invoice?.status||'')==='Väntar på bunt',
    portalView:()=>{renders++},
    loginView:()=>{throw Error('Unexpected login redirect')},
    supabaseRows:async(table,token,filters,columns='*')=>{
      assert.equal(token,userContext.accessToken);
      const params=new URLSearchParams(filters);
      assert.equal(params.get('company_id'),'eq.tenant-a',table+' must be scoped to the active company');
      calls.push({table,filters,columns});
      if(table==='customer_invoice_documents')throw Error('PDF documents must not be downloaded for the list');
      const rows=records[table]||[];
      return rows.filter(row=>row.company_id==='tenant-a')
        .filter(row=>!(table==='customers'&&row.archived_at))
        .filter(row=>table!=='financial_batches'||!params.get('id')||params.get('id').includes(row.id))
        .map(row=>columns==='*'?row:Object.fromEntries(columns.split(',').map(name=>[name,row[name]])));
    }
  };
  vm.runInNewContext(source.slice(start,end)+'\n;globalThis.__read=loadReceivables;',global,{filename:'app.js'});
  return{global,calls,load:global.__read,renders:()=>renders};
}

test('Kundreskontra reads only summary data, preserves financial totals and keeps PDFs lazy',async()=>{
  const records={
    customers:[
      {id:'c1',company_id:'tenant-a',customer_number:'K-1001',name:'Kund Ett',org_number:'111111-1111',customer_type:'business',reminder_fee_agreed:true},
      {id:'c2',company_id:'tenant-a',customer_number:'K-1002',name:'Kund Två',org_number:'222222-2222',customer_type:'business',reminder_fee_agreed:false},
      {id:'foreign',company_id:'tenant-b',customer_number:'SECRET',name:'Other tenant'}
    ],
    invoices:[
      {id:'i1',company_id:'tenant-a',customer_id:'c1',invoice_number:'310001',total_ore:15000,remaining_ore:10000,status:'Delbetald',due_date:'2026-10-01'},
      {id:'i2',company_id:'tenant-a',customer_id:'c1',invoice_number:'310002',total_ore:8000,remaining_ore:0,status:'Betald',due_date:'2026-09-01'},
      {id:'i3',company_id:'tenant-a',customer_id:'c1',invoice_number:'310003',total_ore:7500,remaining_ore:7500,status:'Väntar på bunt',due_date:'2026-10-20'},
      {id:'i4',company_id:'tenant-a',customer_id:'c2',invoice_number:'310004',total_ore:2500,remaining_ore:2500,status:'Bokförd',due_date:'2026-10-25'},
      {id:'secret',company_id:'tenant-b',customer_id:'foreign',invoice_number:'999999',total_ore:990000,remaining_ore:990000,status:'Bokförd'}
    ],
    invoice_transactions:[{id:'tx1',company_id:'tenant-a',invoice_id:'i1',transaction_type:'payment',amount_ore:-5000,approved:true}],
    customer_manual_payments:[{id:'p1',company_id:'tenant-a',invoice_id:'i1',batch_id:'b1',status:'pending',amount_ore:1500,payment_date:'2026-09-20',created_at:'2026-09-20T00:00:00Z'}],
    customer_invoice_credit_adjustments:[],
    customer_credit_refunds:[],
    invoice_comments:[{id:'comment1',company_id:'tenant-a',invoice_id:'i1',comment_text:'Synthetic note'}],
    invoice_reminders:[{id:'reminder1',company_id:'tenant-a',invoice_id:'i1',reminder_number:1,reminder_date:'2026-09-30',kind:'payment-reminder'}],
    financial_batches:[{id:'b1',company_id:'tenant-a',batch_number:19}]
  };
  const app=runtime(records);
  await app.load();
  const {calls,global}=app;
  assert.equal(app.renders(),1);
  assert.equal(calls.length,9,'Eight overview reads plus one batch-number lookup');
  assert.ok(!calls.some(c=>c.table==='customer_invoice_documents'),'PDF payloads should load only on click');
  assert.notEqual(calls.find(c=>c.table==='invoices').columns,'*');
  assert.notEqual(calls.find(c=>c.table==='customers').columns,'*');
  assert.equal(calls.find(c=>c.table==='financial_batches').columns,'id,batch_number');
  const a=global.receivableCustomers.find(c=>c.customerId==='c1');
  const b=global.receivableCustomers.find(c=>c.customerId==='c2');
  assert.equal(a.invoiceCount,3);
  assert.equal(a.openInvoiceCount,1,'Pending-batch invoice must not count as an open posted balance');
  assert.equal(a.remainingOre,10000);
  assert.equal(b.invoiceCount,1);
  assert.equal(b.remainingOre,2500);
  assert.equal(global.invoices.length,4,'No data from tenant B');
  const invoice=global.invoices.find(i=>i.id==='i1');
  assert.equal(invoice.transactions[0].amountOre,-5000);
  assert.equal(invoice.manualPayments[0].status,'pending');
  assert.equal(invoice.manualPayments[0].batchNumber,19);
  assert.equal(invoice.commentCount,1);
  assert.equal(invoice.reminders[0].reminderNumber,1);
  assert.equal(invoice.pdfDocument,undefined,'Large document JSON must not be retained in overview');
});

test('PDF action still has a company-scoped single-invoice fallback',()=>{
  const from=source.indexOf('async function openInvoicePdf(invoiceId)');
  const to=source.indexOf('\n}',from);
  assert.ok(from>=0&&to>from,'Invoice PDF action remains available');
  const pdfAction=source.slice(from,to);
  assert.match(pdfAction,/from\('customer_invoice_documents'/);
  assert.match(pdfAction,/select\('document_json'/);
  assert.match(pdfAction,/company_id=eq\./);
  assert.match(pdfAction,/invoice_id=eq\./);
});
