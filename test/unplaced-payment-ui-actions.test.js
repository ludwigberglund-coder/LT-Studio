'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../apps/portal/unplaced-payments.js'),'utf8');

async function harness(){
  const fields={invoice:'invoice-first',account:'',description:''};
  const calls=[];
  const invokeErrors=[];
  const listeners={};
  let uuidCounter=0;
  let renderCount=0;
  let html='';
  const app={
    querySelectorAll:()=>[{disabled:false},{disabled:false}],
    get innerHTML(){return html},
    set innerHTML(markup){
      html=markup;
      renderCount+=1;
      // Assign the real select/input defaults that a fresh render would create.
      fields.invoice='invoice-first';
      fields.account='';
      fields.description='';
    }
  };
  const ctx={
    authenticated:true,accessToken:'test-token',
    user:{displayName:'Browser QA'},
    company:{id:'company-qa',name:'QA Företag'}
  };
  const records={
    bank_payments:[{
      id:'bank-1',booking_date:'2026-10-12',amount_ore:10000,
      reference:'QA',payer_name:'Testbetalare'
    }],
    invoices:[
      {id:'invoice-first',invoice_number:'F-100',remaining_ore:20000,invoice_account:'1510',customer_id:'customer-1'},
      {id:'invoice-second',invoice_number:'F-200',remaining_ore:20000,invoice_account:'1510',customer_id:'customer-1'}
    ],
    customers:[{id:'customer-1',name:'Testkunden'}]
  };
  const document={
    getElementById:(id)=>id==='unplaced-payments-app'?app:null,
    addEventListener:(name,listener)=>{listeners[name]=listener},
    querySelector:(selector)=>{
      const field=selector.match(/data-field="([^"]+)"/)?.[1];
      return field?{get value(){return fields[field]},set value(value){fields[field]=value}}:null;
    }
  };
  const window={
    LTSupabaseUat:{context:async()=>ctx},
    LTSupabase:{
      from:(table)=>({select:async()=>records[table]||[]}),
      rpc:async(name,args,token)=>{calls.push({name,args,token});return [{id:'proposal-qa'}]},
      functions:{
        invoke:async(name,args,token)=>{
          calls.push({name,args,token});
          const nextError=invokeErrors.shift();
          if(nextError)throw new Error(nextError);
          return {journal_number:42};
        }
      }
    }
  };

  vm.runInNewContext(source,{
    document,window,URLSearchParams,Intl,crypto:{randomUUID:()=>`test-uuid-${++uuidCounter}`},
    sessionStorage:{getItem:()=>null},
    location:{search:'',hostname:'ludwigberglund-coder.github.io',href:''}
  },{filename:'unplaced-payments.js'});

  // load() fetches the mocked company-scoped Supabase rows before rendering.
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(html,/Testbetalare/,'the queue must finish loading before the actions run');

  return {
    fields,calls,failNextInvoke:(message)=>invokeErrors.push(message),getRenderCount:()=>renderCount,getHtml:()=>html,
    async click(action){
      const button={dataset:{action}};
      const target={closest:(selector)=>selector==='[data-action]'?button:null};
      await listeners.click({target});
    }
  };
}

test('manual invoice matching sends the actually selected invoice, not the first option',async()=>{
  const ui=await harness();
  ui.fields.invoice='invoice-second';
  const before=ui.getRenderCount();
  await ui.click('invoice');
  const proposal=ui.calls.find(call=>call.name==='create_bank_match_proposal');
  assert.ok(proposal,'the matching proposal must be sent');
  assert.equal(proposal.args.p_target_invoice_id,'invoice-second');
  assert.equal(proposal.args.p_bank_payment_id,'bank-1');
  assert.ok(ui.getRenderCount()>before,'the UI should update after the operation');
});

test('other-income preserves the manually entered accounting account and description',async()=>{
  const ui=await harness();
  ui.fields.account='3990';
  ui.fields.description='Övrig verifierad inbetalning';
  await ui.click('other-income');
  const call=ui.calls.find(item=>item.name==='resolve-unplaced-payment');
  assert.ok(call,'the settlement function must be called');
  assert.equal(call.args.resolutionType,'other-income');
  assert.equal(call.args.counterAccount,'3990');
  assert.equal(call.args.description,'Övrig verifierad inbetalning');
  assert.equal(call.args.bankPaymentId,'bank-1');
});

test('outgoing classification keeps the entered accounting details',async()=>{
  const ui=await harness();
  ui.fields.account='6990';
  ui.fields.description='Verifierad återbetalning';
  await ui.click('outgoing');
  const call=ui.calls.find(item=>item.name==='resolve-unplaced-payment');
  assert.ok(call,'the settlement function must be called');
  assert.equal(call.args.resolutionType,'outgoing');
  assert.equal(call.args.counterAccount,'6990');
  assert.equal(call.args.description,'Verifierad återbetalning');
});

test('network failure reuses the same idempotency key and keeps inputs for a safe retry',async()=>{
  const ui=await harness();
  ui.fields.account='3990';
  ui.fields.description='Förskott från bank';
  ui.failNextInvoke('Nätverksavbrott efter mottagen betalning');
  await ui.click('other-income');

  assert.equal(ui.calls.length,1);
  assert.equal(ui.fields.account,'3990','account should be restored after a failed request');
  assert.equal(ui.fields.description,'Förskott från bank','description should be restored after a failed request');
  assert.match(ui.getHtml(),/Kunde inte genomföra åtgärden/);
  const initialRequestId=ui.calls[0].args.requestId;

  await ui.click('other-income');
  assert.equal(ui.calls.length,2);
  assert.equal(ui.calls[1].args.requestId,initialRequestId,'a retry must reuse the original request ID');
  assert.match(ui.getHtml(),/Verifikation 42 skapades/);
  assert.doesNotMatch(ui.getHtml(),/Kunde inte genomföra åtgärden/);
});

test('changed accounting details create a new idempotency key instead of replaying stale details',async()=>{
  const ui=await harness();
  ui.fields.account='3990';
  ui.fields.description='Övrig inbetalning';
  ui.failNextInvoke('Tillfälligt nätverksfel');
  await ui.click('other-income');
  const initialId=ui.calls[0].args.requestId;

  ui.fields.account='3980';
  ui.failNextInvoke('Tillfälligt nätverksfel');
  await ui.click('other-income');
  assert.notEqual(ui.calls[1].args.requestId,initialId);
  assert.equal(ui.calls[1].args.counterAccount,'3980');

  ui.fields.account='3980';
  ui.fields.description='Återbetalning till kund';
  ui.failNextInvoke('Tillfälligt nätverksfel');
  await ui.click('outgoing');
  assert.notEqual(ui.calls[2].args.requestId,ui.calls[1].args.requestId);
  assert.equal(ui.calls[2].args.resolutionType,'outgoing');
});
