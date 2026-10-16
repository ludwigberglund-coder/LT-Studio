'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const Persistence=require('../apps/portal/supplier-persistence.js');
const source=fs.readFileSync(path.join(__dirname,'../apps/portal/suppliers.js'),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({historyGate=null,initialBusy=null}={}){
 const gate=deferred(),calls=[],controls=[
  {disabled:false,isConnected:true,name:'name',value:'Edited supplier'},
  {disabled:false,isConnected:true,name:'bankgiro',value:'123-4567'},
  {disabled:true,isConnected:true,name:'restricted',value:'unchanged'},
  {disabled:false,isConnected:true,name:'submit'},
  {disabled:false,isConnected:true,name:'supplier-search',value:''}
 ];
 const attrs=new Map(initialBusy===null?[]:[['aria-busy',initialBusy]]),notice={textContent:''};
 const app={innerHTML:'',querySelectorAll:()=>controls,querySelector:selector=>selector==='.notice'?notice:null,
  getAttribute:name=>attrs.has(name)?attrs.get(name):null,setAttribute:(name,value)=>attrs.set(name,value),removeAttribute:name=>attrs.delete(name)};
 const context={authenticated:true,company:{id:'synthetic-company'},authUser:{id:'synthetic-user'},accessToken:'synthetic',membership:{role:'accountant'}};
 const supplier={id:'supplier-a',companyId:context.company.id,supplierNumber:'L-1',name:'Old supplier',orgNumber:'',countryCode:'',email:'',defaultCostAccount:'',bankgiro:'',plusgiro:'',rowVersion:1};
 const form={dataset:{form:'profile'},isConnected:true,querySelector:()=>controls[3]};
 const sandbox={console,URLSearchParams,structuredClone,crypto:webcrypto,setTimeout:()=>1,clearTimeout:()=>{},
  location:{hostname:'ludwigberglund-coder.github.io',search:''},sessionStorage:{getItem:()=>''},
  FormData:class {constructor(){assert.equal(controls[0].disabled,false,'capture user values before disabling fields');return new Map([['name',controls[0].value],['orgNumber',''],['countryCode',''],['email',''],['defaultCostAccount','']]);}},
  LTStudioSupplierPersistence:{...Persistence,save:options=>{calls.push(options);return gate.promise;}},
  window:{LTSupabaseUat:{context:async()=>context},LTSupabase:{from:table=>{assert.equal(table,'supplier_change_events');return{select:async()=>historyGate?historyGate.promise:[]};}}},
  document:{getElementById:id=>id==='suppliers-app'?app:null,querySelectorAll:()=>[],addEventListener:()=>{}},
  fixtureContext:context,fixtureSupplier:supplier
 };
 const code=source.replace(/\nload\(\)\.catch\(showLoadError\);\s*$/,'\n');
 assert.notEqual(code,source,'only skip the automatic page bootstrap in this isolated UI test');
 vm.runInNewContext(code+'\npageContext=fixtureContext;selected=fixtureSupplier;suppliers=[selected,{...selected,id:"supplier-b"}];globalThis.testApi={saveForm,chooseSupplier,isBusy:()=>busy,selectedId:()=>selected?.id};',sandbox,{filename:'suppliers.js'});
 const saved={...supplier,name:'Edited supplier',rowVersion:2};
 return{api:sandbox.testApi,gate,calls,controls,app,form,saved,notice};
}
test('supplier save locks every editable field and captures input before locking',async()=>{
 const h=harness(),pending=h.api.saveForm(h.form);await tick();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].operation.values.name,'Edited supplier');
 assert.equal(h.app.getAttribute('aria-busy'),'true');
 assert.ok(h.controls.every(control=>control.disabled),'other form/search fields must not accept edits that an older save will erase');
 h.gate.resolve(h.saved);await pending;
 assert.equal(h.api.isBusy(),false);assert.equal(h.app.getAttribute('aria-busy'),null);
 assert.deepEqual(h.controls.map(control=>control.disabled),[false,false,true,false,false]);
});
test('failed supplier save retains inputs and restores prior disabled and accessibility state',async()=>{
 const h=harness({initialBusy:'false'}),pending=h.api.saveForm(h.form);await tick();
 assert.ok(h.controls.every(control=>control.disabled));
 h.gate.reject(new Error('Synthetic network failure'));await pending;
 assert.equal(h.controls[0].value,'Edited supplier');assert.equal(h.controls[1].value,'123-4567');
 assert.deepEqual(h.controls.map(control=>control.disabled),[false,false,true,false,false]);
 assert.equal(h.app.getAttribute('aria-busy'),'false');assert.equal(h.api.isBusy(),false);
 assert.ok(h.notice.textContent,'failure stays visible rather than erasing the form');
});
test('second submit or supplier selection cannot start another operation during save',async()=>{
 const h=harness(),pending=h.api.saveForm(h.form);await tick();
 await h.api.saveForm(h.form);await h.api.chooseSupplier('supplier-b');
 assert.equal(h.calls.length,1);assert.equal(h.api.selectedId(),'supplier-a');
 assert.ok(h.controls.every(control=>control.disabled));
 h.gate.resolve(h.saved);await pending;
});
test('controls stay locked until the follow-up history request completes',async()=>{
 const historyGate=deferred(),h=harness({historyGate}),pending=h.api.saveForm(h.form);await tick();
 h.gate.resolve(h.saved);await tick();
 assert.equal(h.api.isBusy(),true);assert.ok(h.controls.every(control=>control.disabled));
 historyGate.resolve([]);await pending;
 assert.equal(h.api.isBusy(),false);assert.deepEqual(h.controls.map(control=>control.disabled),[false,false,true,false,false]);
});
test('detached controls are not re-enabled after a view has been replaced',async()=>{
 const h=harness(),pending=h.api.saveForm(h.form);await tick();
 h.controls[0].isConnected=false;
 h.gate.reject(new Error('Synthetic interrupted save'));await pending;
 assert.equal(h.controls[0].disabled,true);assert.equal(h.controls[1].disabled,false);assert.equal(h.controls[2].disabled,true);
});
