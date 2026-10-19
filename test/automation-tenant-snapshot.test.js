'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','automation.js'),'utf8');
const tables=[
  'automation_proposals','customer_payment_executions',
  'customer_payment_reclassifications','bank_payments','invoices','customers'
];
const error=/Automationskön kunde inte läsas säkert/;

function fixture({rows={},deferTable}={}){
  const app={innerHTML:''},queries=[];
  let complete=null;
  const ctx={
    authenticated:true,
    company:{id:'tenant-a',name:'Fiktivt företag A'},
    accessToken:'synthetic-token-a',
    user:{displayName:'Testanvändare'}
  };
  const window={
    LTSupabaseUat:{context:async()=>ctx},
    LTSupabase:{from:(table,token)=>({
      select:async(fields,filter)=>{
        queries.push({table,token,fields,filter});
        if(table===deferTable){
          return new Promise(resolve=>{complete=resolve;});
        }
        return Object.prototype.hasOwnProperty.call(rows,table)?rows[table]:[];
      }
    })}
  };
  const sandbox={
    window,document:{
      getElementById:id=>id==='automation-app'?app:null,
      addEventListener:()=>{}
    },
    location:{hostname:'ludwigberglund-coder.github.io',search:'',href:''},
    sessionStorage:{getItem:()=>null},
    URLSearchParams,Intl,Date,structuredClone
  };
  vm.runInNewContext(source,sandbox,{filename:'apps/portal/automation.js'});
  return {app,ctx,queries,finish:result=>{
    assert.equal(typeof complete,'function');
    complete(result);
  }};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('valid tenant-scoped queue renders only supported company rows',async()=>{
  const a=fixture({rows:{
    automation_proposals:[{
      id:'proposal-a',company_id:'tenant-a',
      proposal_type:'bank-payment-match',status:'manual-review',
      source_id:'bank-a',reason:'Testunderlag'
    }],
    bank_payments:[{id:'bank-a',company_id:'tenant-a',amount_ore:125000,
      payer_name:'Fiktiv köpare A',booking_date:'2026-10-01'}]
  }});
  await settle();
  assert.match(a.app.innerHTML,/Automationskö/);
  assert.match(a.app.innerHTML,/Fiktiv köpare A/);
  assert.match(a.app.innerHTML,/proposal-a/);
  assert.ok(a.queries.length===tables.length);
  assert.deepEqual(a.queries.map(q=>q.table).sort(),[...tables].sort());
  assert.ok(a.queries.every(q=>q.filter.startsWith('company_id=eq.tenant-a')));
  assert.ok(a.queries.every(q=>q.token==='synthetic-token-a'));
});

test('a single foreign row in ANY joined table stops the entire queue without leaking row data',async()=>{
  for(const table of tables){
    const a=fixture({rows:{[table]:[{
      company_id:'tenant-b',id:'secret-foreign-id',
      payer_name:'Secret Foreign Buyer',status:'manual-review'
    }]}});
    await settle();
    assert.match(a.app.innerHTML,error,table);
    assert.doesNotMatch(a.app.innerHTML,/secret-foreign-id|Secret Foreign Buyer|tenant-b/,table);
    assert.doesNotMatch(a.app.innerHTML,/proposal-head|proposal-list/,table);
  }
});

test('missing tenant column and malformed data both fail closed',async()=>{
  for(const dataset of [[{id:'missing-company'}],null,{},'not-an-array']){
    const a=fixture({rows:{customers:dataset}});
    await settle();
    assert.match(a.app.innerHTML,error);
    assert.doesNotMatch(a.app.innerHTML,/missing-company/);
  }
});

test('a company or token switch during in-flight joins rejects the older snapshot',async()=>{
  const a=fixture({deferTable:'customers',rows:{
    automation_proposals:[{id:'proposal-a',company_id:'tenant-a',status:'manual-review'}]
  }});
  await settle();
  a.ctx.company={id:'tenant-b',name:'Fiktivt företag B'};
  a.ctx.accessToken='synthetic-token-b';
  a.finish([]);
  await settle();
  assert.match(a.app.innerHTML,error);
  assert.doesNotMatch(a.app.innerHTML,/proposal-a|tenant-a|synthetic-token-a/);
});

test('a missing access token cannot read or show tenant records',async()=>{
  const a=fixture();
  a.ctx.accessToken='';
  await settle();
  assert.match(a.app.innerHTML,error);
  assert.equal(a.queries.length,0);
});

test('guard uses existing reads only and never changes financial posting operations',()=>{
  assert.match(source,/function verifiedCompanyRows\(rows,companyId\)/);
  assert.match(source,/results\.map\(rows=>verifiedCompanyRows\(rows,companyId\)\)/);
  assert.match(source,/execute_customer_payment/);
  assert.match(source,/decide_automation_proposal/);
});
