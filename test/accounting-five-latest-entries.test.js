const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const code=fs.readFileSync(path.join(__dirname,'../apps/portal/accounting.js'),'utf8');
const styles=fs.readFileSync(path.join(__dirname,'../apps/portal/accounting.css'),'utf8');
function inspect(sample){
  const context={entries:sample,showAllEntries:false,selectedEntry:null,Intl,Date};
  vm.createContext(context);
  vm.runInContext(`const entries=globalThis.entries; let showAllEntries=globalThis.showAllEntries,selectedEntry=globalThis.selectedEntry;`+code.slice(code.indexOf('function sortedEntries()'),code.indexOf('function entryDetail()'))+
   `;globalThis.inspect=()=>({ordered:sortedEntries().map(e=>e.id),html:entryTable()});globalThis.expand=()=>{showAllEntries=true};`,context);
  return context;
}
function entry(id,createdAt,postingDate){
  return {id,number:'A'+id,createdAt,postingDate,description:'Test',sourceType:'manual',lines:[]};
}
test('orders by actual creation time, newest first, not posting date',()=>{
  const context=inspect([entry('old','2026-10-01','2026-10-12'),entry('new','2026-10-12','2026-09-01')]);
  assert.deepEqual(Array.from(context.inspect().ordered),['new','old']);
});
test('shows only five entries until expanded and keeps remaining accessible',()=>{
  const context=inspect(Array.from({length:8},(_,i)=>entry(String(i),'2026-10-'+String(i+1).padStart(2,'0'),'2026-10-01')));
  assert.equal((context.inspect().html.match(/data-entry=/g)||[]).length,5);
  assert.match(context.inspect().html,/Visa fler verifikationer \(3\)/);
  context.expand();
  assert.equal((context.inspect().html.match(/data-entry=/g)||[]).length,8);
  assert.match(context.inspect().html,/Visa färre/);
});
test('legacy entries without createdAt fall back to posting date',()=>{
 const context=inspect([entry('new',null,'2026-10-10'),entry('old',null,'2026-10-01')]);
 assert.deepEqual(Array.from(context.inspect().ordered),['new','old']);
});
test('keyboard selection and internal scroll are present',()=>{
 assert.match(code,/row\.addEventListener\('keydown'/);
 assert.match(code,/event\.key==='Enter'/);
 assert.match(code,/event\.key===' '/);
 assert.match(styles,/\.accounting-table-scroll\{max-height:340px;overflow:auto/);
 assert.match(styles,/position:sticky;top:0/);
});
