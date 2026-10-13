'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../apps/portal/unplaced-payments.js'),'utf8');

async function harness(options={}){
  const fields={invoice:'invoice-first',kind:'',account:'',description:'',confirmed:false};
  const preview={innerHTML:''};
  const resolveButton={disabled:true};
  const accountControl={readOnly:false};
  const calls=[];
  const invokeErrors=[];
  let proposalResult={proposal_id:'proposal-qa',status:'manual-review',duplicate:false};
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
      fields.kind='';
      fields.account='';
      fields.description='';
      fields.confirmed=false;
      preview.innerHTML='';
      resolveButton.disabled=true;
      accountControl.readOnly=false;
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
      reference:options.reference??'QA',payer_name:'Testbetalare',currency:'SEK',company_id:'company-qa'
    }],
    invoices:[
      {id:'invoice-first',invoice_number:'F-100',ocr:options.firstOcr??'',total_ore:20000,remaining_ore:20000,invoice_account:'1510',company_id:'company-qa',customer_id:'customer-1'},
      {id:'invoice-second',invoice_number:'F-200',ocr:options.secondOcr??'',total_ore:20000,remaining_ore:20000,invoice_account:'1510',company_id:'company-qa',customer_id:'customer-1'}
    ],
    customers:[{id:'customer-1',name:'Testkunden'}]
  };
  const document={
    getElementById:(id)=>id==='unplaced-payments-app'?app:null,
    addEventListener:(name,listener)=>{listeners[name]=listener},
    querySelector:(selector)=>{
      if(selector==='[data-role="posting-preview"]')return preview;
      if(selector==='[data-action="resolve"]')return resolveButton;
      const field=selector.match(/data-field="([^"]+)"/)?.[1];
      if(!field)return null;
      return {
        get value(){return fields[field]},set value(value){fields[field]=value},
        get checked(){return Boolean(fields[field])},set checked(value){fields[field]=Boolean(value)},
        get readOnly(){return accountControl.readOnly},set readOnly(value){accountControl.readOnly=Boolean(value)}
      };
    }
  };
  const window={
    LTSupabaseUat:{context:async()=>ctx},
    LTSupabase:{
      from:(table)=>({select:async()=>records[table]||[]}),
      rpc:async(name,args,token)=>{calls.push({name,args,token});return [proposalResult]},
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
    fields,calls,failNextInvoke:(message)=>invokeErrors.push(message),setProposalResult:(result)=>{proposalResult=result},getSelectedInvoice:()=>fields.invoice,getRenderCount:()=>renderCount,getHtml:()=>html,
    getPreview:()=>preview.innerHTML,getPostDisabled:()=>resolveButton.disabled,getAccountReadOnly:()=>accountControl.readOnly,
    choose(kind){fields.kind=kind;listeners.change({target:{dataset:{field:'kind'}}})},
    confirm(checked=true){fields.confirmed=checked;listeners.change({target:{dataset:{field:'confirmed'}}})},
    type(field,value){fields[field]=value;listeners.input({target:{dataset:{field}}})},
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
  assert.match(ui.getHtml(),/Matchningsförslaget är skapat/);
  assert.ok(ui.getRenderCount()>before,'the UI should update after the operation');
});

test('other-income preserves explicitly entered account and description',async()=>{
  const ui=await harness();
  ui.choose('other-income');
  ui.type('account','3990');
  ui.type('description','Övrig verifierad inbetalning');
  ui.confirm();
  await ui.click('resolve');
  const call=ui.calls.find(item=>item.name==='resolve-unplaced-payment');
  assert.ok(call,'the settlement function must be called');
  assert.equal(call.args.resolutionType,'other-income');
  assert.equal(call.args.counterAccount,'3990');
  assert.equal(call.args.description,'Övrig verifierad inbetalning');
  assert.equal(call.args.bankPaymentId,'bank-1');
});

test('outgoing preserves entered accounting details and only posts after confirmation',async()=>{
  const ui=await harness();
  ui.choose('outgoing');
  ui.type('account','6990');
  ui.type('description','Verifierad återbetalning');
  assert.equal(ui.calls.length,0);
  ui.confirm();
  await ui.click('resolve');
  const call=ui.calls.find(item=>item.name==='resolve-unplaced-payment');
  assert.ok(call,'the settlement function must be called');
  assert.equal(call.args.resolutionType,'outgoing');
  assert.equal(call.args.counterAccount,'6990');
  assert.equal(call.args.description,'Verifierad återbetalning');
});

test('network failure reuses the same idempotency key and keeps entered details for retry',async()=>{
  const ui=await harness();
  ui.choose('other-income');
  ui.type('account','3990');
  ui.type('description','Förskott från bank');
  ui.confirm();
  ui.failNextInvoke('Nätverksavbrott efter mottagen betalning');
  await ui.click('resolve');

  assert.equal(ui.calls.length,1);
  assert.equal(ui.fields.kind,'other-income');
  assert.equal(ui.fields.account,'3990');
  assert.equal(ui.fields.description,'Förskott från bank');
  assert.equal(ui.fields.confirmed,true);
  assert.match(ui.getHtml(),/Kunde inte genomföra åtgärden/);
  const initialRequestId=ui.calls[0].args.requestId;

  await ui.click('resolve');
  assert.equal(ui.calls.length,2);
  assert.equal(ui.calls[1].args.requestId,initialRequestId,'a retry must reuse the original request ID');
  assert.match(ui.getHtml(),/Verifikation 42 skapades/);
  assert.doesNotMatch(ui.getHtml(),/Kunde inte genomföra åtgärden/);
});

test('different accounting details and payment types produce different idempotency keys',async()=>{
  const ui=await harness();
  ui.choose('other-income');
  ui.type('account','3990');
  ui.type('description','Övrig inbetalning');
  ui.confirm();
  ui.failNextInvoke('Nätverksfel');
  await ui.click('resolve');
  const first=ui.calls[0].args.requestId;

  ui.type('account','3980');
  ui.failNextInvoke('Nätverksfel');
  await ui.click('resolve');
  const second=ui.calls[1].args.requestId;
  assert.notEqual(first,second);

  ui.choose('outgoing');
  ui.type('account','3980');
  ui.type('description','Återbetalning till kund');
  ui.confirm();
  ui.failNextInvoke('Nätverksfel');
  await ui.click('resolve');
  const third=ui.calls[2].args.requestId;
  assert.notEqual(third,second);

  ui.choose('other-income');
  ui.type('account','3990');
  ui.type('description','Övrig inbetalning');
  ui.confirm();
  ui.failNextInvoke('Nätverksfel');
  await ui.click('resolve');
  assert.equal(ui.calls[3].args.requestId,first,'returning to the original details reuses the original ID');
});

test('rejected proposal result is not presented as successful matching',async()=>{
  const ui=await harness();
  ui.fields.invoice='invoice-second';
  ui.setProposalResult({proposal_id:'rejected-proposal',status:'rejected',duplicate:true});
  await ui.click('invoice');

  assert.equal(ui.calls.filter(call=>call.name==='create_bank_match_proposal').length,1);
  assert.match(ui.getHtml(),/Kunde inte genomföra åtgärden/);
  assert.match(ui.getHtml(),/Inget nytt matchningsförslag skapades/);
  assert.doesNotMatch(ui.getHtml(),/Matchningsförslaget är skapat/);
  assert.equal(ui.fields.invoice,'invoice-second','failed proposal must preserve chosen invoice');
});

test('invoice dropdown begins with an explicit choice, never implicitly assigns the first invoice',async()=>{
  const ui=await harness();
  assert.equal(ui.getSelectedInvoice(),'invoice-first','harness only initializes its mock field');
  assert.match(ui.getHtml(),/<option value="">Välj kundfaktura<\/option>/);
  assert.match(ui.getHtml(),/Ingen tydlig träff på OCR eller fakturanummer/);
});

test('unique OCR match suggests the correct invoice without submitting automatically',async()=>{
  const ui=await harness({reference:'OCR 99112233',secondOcr:'99112233'});
  assert.match(ui.getHtml(),/Möjlig fakturaträff/);
  assert.match(ui.getHtml(),/OCR matchar betalningens referens/);
  assert.equal(ui.calls.length,0);
  await ui.click('use-suggestion');
  assert.equal(ui.getSelectedInvoice(),'invoice-second');
  assert.equal(ui.calls.length,0,'a suggestion click cannot book or create a proposal');
  await ui.click('invoice');
  assert.equal(ui.calls[0].args.p_target_invoice_id,'invoice-second');
});

test('multiple invoices sharing a reference must not recommend either invoice',async()=>{
  const ui=await harness({reference:'99112233',firstOcr:'99112233',secondOcr:'99112233'});
  assert.match(ui.getHtml(),/Flera möjliga fakturor/);
  assert.doesNotMatch(ui.getHtml(),/Välj föreslagen faktura/);
  assert.equal(ui.calls.length,0);
});

test('an invoice number alone is not sent to the server without an explicit user choice',async()=>{
  const ui=await harness({reference:'F-200'});
  assert.match(ui.getHtml(),/Möjlig fakturaträff/);
  assert.equal(ui.calls.length,0);
});

test('bank fee shortcut fills 6570 without posting automatically',async()=>{
  const ui=await harness();
  ui.choose('bank-fee');
  assert.equal(ui.fields.account,'6570');
  assert.equal(ui.fields.description,'Bankavgift enligt kontoutdrag');
  assert.equal(ui.getAccountReadOnly(),true);
  assert.match(ui.getPreview(),/Debet 6570/);
  assert.match(ui.getPreview(),/Kredit 1930/);
  assert.equal(ui.calls.length,0);
  assert.equal(ui.getPostDisabled(),false);
});

test('bank fee requires explicit bank statement confirmation before direct booking',async()=>{
  const ui=await harness();
  ui.choose('bank-fee');
  await ui.click('resolve');
  assert.equal(ui.calls.length,0);
  assert.match(ui.getHtml(),/Kontrollera bankhändelsen och markera bekräftelserutan/);
  assert.equal(ui.fields.kind,'bank-fee');
  assert.equal(ui.fields.account,'6570');
  assert.equal(ui.fields.confirmed,false);

  ui.confirm();
  await ui.click('resolve');
  const call=ui.calls.find(item=>item.name==='resolve-unplaced-payment');
  assert.ok(call);
  assert.equal(call.args.resolutionType,'outgoing');
  assert.equal(call.args.counterAccount,'6570');
  assert.equal(call.args.description,'Bankavgift enligt kontoutdrag');
  assert.match(ui.getHtml(),/Verifikation 42 skapades/);
});

test('bank fee type refuses modified preset account',async()=>{
  const ui=await harness();
  ui.choose('bank-fee');
  ui.fields.account='3990';
  ui.confirm();
  await ui.click('resolve');
  assert.equal(ui.calls.length,0);
  assert.match(ui.getHtml(),/För bankavgift ska konto 6570 användas/);
});

test('switching kind clears a prior bank-fee preset and confirmation',async()=>{
  const ui=await harness();
  ui.choose('bank-fee');
  ui.confirm();
  ui.choose('other-income');
  assert.equal(ui.fields.account,'');
  assert.equal(ui.fields.description,'');
  assert.equal(ui.fields.confirmed,false);
  assert.equal(ui.getAccountReadOnly(),false);
  assert.match(ui.getPreview(),/Fyll i ett korrekt fyrsiffrigt motkonto/);
});

test('uncertain payment cannot be posted in any direction',async()=>{
  const ui=await harness();
  ui.choose('unsure');
  assert.equal(ui.getPostDisabled(),true);
  assert.match(ui.getPreview(),/Vänta med bokföringen/);
  await ui.click('resolve');
  assert.equal(ui.calls.length,0);
  assert.match(ui.getHtml(),/Välj vad bankhändelsen gäller/);
});

test('manual income preview shows bank debit and the selected account credit',async()=>{
  const ui=await harness();
  ui.choose('other-income');
  ui.type('account','3990');
  ui.type('description','Övrig inbetalning');
  assert.match(ui.getPreview(),/Debet 1930/);
  assert.match(ui.getPreview(),/Kredit 3990/);
  assert.equal(ui.calls.length,0);
  ui.confirm();
  await ui.click('resolve');
  const call=ui.calls.find(item=>item.name==='resolve-unplaced-payment');
  assert.equal(call.args.resolutionType,'other-income');
  assert.equal(call.args.counterAccount,'3990');
});

test('untrusted description in preview is HTML-escaped',async()=>{
  const ui=await harness();
  ui.choose('outgoing');
  ui.type('account','6570');
  ui.type('description','<img src=x onerror=alert(1)>');
  assert.match(ui.getPreview(),/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(ui.getPreview(),/<img/);
});
