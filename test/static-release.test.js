'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {stampRelease}=require('../scripts/static-release.js');
test('all pages, styles, imports and local data use one release; external URLs remain unchanged',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-release-'));
  try{
    fs.mkdirSync(path.join(dir,'portal'));
    const files={'portal/index.html':'<head><link href="./style.css"><script src="./app.js"></script></head>','portal/app.js':"import './helper.js'; fetch('./data.json'); fetch('https://example.com/api.json');",'portal/style.css':'','portal/helper.js':'','portal/data.json':'{}'};
    for(const [name,content]of Object.entries(files))fs.writeFileSync(path.join(dir,name),content);
    const sha='a'.repeat(40);stampRelease(dir,sha);
    const html=fs.readFileSync(path.join(dir,'portal/index.html'),'utf8');
    assert.ok(html.includes('./app.js?v='+sha));assert.ok(html.includes('./style.css?v='+sha));
    assert.ok(html.includes('../release.js?v='+sha));assert.ok(html.includes('content="'+sha+'"'));
    const js=fs.readFileSync(path.join(dir,'portal/app.js'),'utf8');
    assert.ok(js.includes('./helper.js?v='+sha));assert.ok(js.includes('./data.json?v='+sha));
    assert.ok(js.includes("fetch('https://example.com/api.json')"));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('UAT approvals from an earlier release never approve the new release',()=>{
  const storage=new Map([['rollands-uat-checklist-v1',JSON.stringify({customers:{status:'ok'}})]]);
  function open(release){
    const app={innerHTML:''},handlers={};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../apps/portal/uat.js'),'utf8'),{
      document:{getElementById:()=>app,querySelector:selector=>selector.startsWith('meta')?{content:release}:{value:''},addEventListener:(name,fn)=>{handlers[name]=fn;}},
      location:{hostname:'localhost',search:'?demo=1'},URLSearchParams,CSS:{escape:x=>x},
      RollandsDemoScenario:{VERSION:'test',AS_OF_DATE:'2026-09-25'},
      localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    });return{app,handlers};
  }
  const first=open('a'.repeat(40));assert.match(first.app.innerHTML,/>0\/14</);
  first.handlers.change({target:{dataset:{status:'customers'},value:'ok'}});
  assert.match(open('a'.repeat(40)).app.innerHTML,/>1\/14</);
  assert.match(open('b'.repeat(40)).app.innerHTML,/>0\/14</);
  assert.ok(storage.has('rollands-uat-checklist-v2:'+'a'.repeat(40)));
});
