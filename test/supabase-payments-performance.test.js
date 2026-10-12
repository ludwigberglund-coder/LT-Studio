'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../apps/portal/payments.js'),'utf8');
const boot=source.lastIndexOf('load().catch(');
assert.ok(boot>0,'Expected the standalone payments page bootstrap');

function makePage(rowsByTable){
  const calls=[];
  const companyId='company-a';
  const accessToken='synthetic-test-token';
  const context={
    URLSearchParams,
    Intl,
    Date,
    window:{
      LTSupabaseUat:{context:async()=>({
        authenticated:true,accessToken,company:{id:companyId,name:'Synthetic A'},user:{displayName:'Tester'}
      })},
      LTSupabase:{
        from(table,token){
          assert.equal(token,accessToken);
          return {async select(projection,filter){
            calls.push({table,projection,filter});
            const params=new URLSearchParams(filter);
            assert.equal(params.get('company_id'),'eq.'+companyId,table+' must stay company-scoped');
            const from=params.get('booking_date')?params.get('booking_date').slice(4):params.get('payment_date')?.slice(4);
            const to=params.get('booking_date')?params.getAll('booking_date')[1]?.slice(4):params.getAll('payment_date')[1]?.slice(4);
            return (rowsByTable[table]||[]).filter(row=>{
              if(row.company_id!==companyId)return false;
              if(from){
                const date=table==='bank_payments'?row.booking_date:row.payment_date;
                if(date<from||date>to)return false;
              }
              return true;
            }).map(row=>Object.fromEntries(projection.split(',').map(key=>[key,row[key]])));
          }};
        }
      }
    },
    location:{search:'',hostname:'ludwigberglund-coder.github.io',href:''},
    document:{getElementById:()=>({innerHTML:''}),addEventListener:()=>{}}
  };
  vm.runInNewContext(source.slice(0,boot)+
    '\n;globalThis.__test={setPeriod:(date,value)=>{anchor=date;mode=value;},read:supabasePayments,openInvoices:()=>openInvoices};',context,
    {filename:'payments.js'});
  return{api:context.__test,calls};
}

test('Supabase payments query the selected period and project only used fields',async()=>{
  const data={
    bank_payments:[
      {id:'bank-1',company_id:'company-a',booking_date:'2026-09-10',amount_ore:10000,status:'unmatched',reference:'A1',payer_name:'Customer A'},
      {id:'bank-old',company_id:'company-a',booking_date:'2026-08-10',amount_ore:5000,status:'unmatched'},
      {id:'bank-other',company_id:'company-b',booking_date:'2026-09-10',amount_ore:99000,status:'unmatched'}
    ],
    supplier_payments:[
      {id:'supplier-payment',company_id:'company-a',supplier_invoice_id:'supplier-invoice',payment_date:'2026-09-15',amount_ore:3000,status:'paid',account:'1930',recipient_name:'Supplier A'},
      {id:'supplier-other',company_id:'company-b',payment_date:'2026-09-15',amount_ore:8000,status:'paid'}
    ],
    customer_manual_payments:[
      // The old pending payment is not in the September list but must reduce the available invoice balance.
      {id:'pending-old',company_id:'company-a',invoice_id:'invoice-1',payment_date:'2026-08-20',amount_ore:1500,status:'pending',bank_account:'1930'},
      {id:'manual-new',company_id:'company-a',invoice_id:'invoice-1',batch_id:'batch-1',payment_date:'2026-09-12',amount_ore:2000,status:'approved',reference:'M1',bank_account:'1930'}
    ],
    customer_payment_executions:[],
    invoices:[{id:'invoice-1',company_id:'company-a',invoice_number:'1001',customer_id:'customer-1',total_ore:10000,remaining_ore:10000,invoice_date:'2026-08-01',due_date:'2026-10-01',status:'sent',journal_number:1}],
    customers:[{id:'customer-1',company_id:'company-a',name:'Customer A',customer_number:'C1'}],
    supplier_invoices:[{id:'supplier-invoice',company_id:'company-a',supplier_id:'supplier-1',supplier_invoice_number:'S1'}],
    suppliers:[{id:'supplier-1',company_id:'company-a',name:'Supplier A',bankgiro:'123-4567'}],
    financial_batches:[{id:'batch-1',company_id:'company-a',batch_number:42,status:'approved'}]
  };
  const {api,calls}=makePage(data);
  api.setPeriod('2026-09-10','month');
  const result=await api.read();
  assert.equal(calls.length,9,'Keep the query contract explicit for comparison with future batching');
  for(const call of calls){
    assert.notEqual(call.projection,'*',call.table+' must not download every field');
    assert.match(call.filter,/company_id=eq.company-a/);
  }
  const bank=calls.find(call=>call.table==='bank_payments');
  const supplier=calls.find(call=>call.table==='supplier_payments');
  assert.ok(bank.filter.includes('booking_date=gte.2026-09-01'));
  assert.ok(bank.filter.includes('booking_date=lte.2026-09-30'));
  assert.ok(supplier.filter.includes('payment_date=gte.2026-09-01'));
  assert.ok(supplier.filter.includes('payment_date=lte.2026-09-30'));
  const manual=calls.find(call=>call.table==='customer_manual_payments');
  assert.equal(manual.filter,'company_id=eq.company-a','Pending payments from older periods must remain visible to balance logic');
  assert.equal(result.rows.length,3);
  assert.deepEqual(Array.from(result.rows.map(row=>row.id)).sort(),['in:bank-1','manual:manual-new','out:supplier-payment']);
  assert.equal(result.summary.incomingOre,12000);
  assert.equal(result.summary.outgoingOre,3000);
  assert.equal(result.summary.netOre,9000);
  assert.equal(result.rows.find(row=>row.id==='out:supplier-payment').counterparty,'Supplier A');
  assert.equal(result.rows.find(row=>row.id==='manual:manual-new').batchNumber,42);
  assert.equal(api.openInvoices().length,1);
  assert.equal(api.openInvoices()[0].availableOre,8500);
});
