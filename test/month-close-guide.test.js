'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','month-close-guide.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','apps','portal','month-close-guide.css'),'utf8');

function guide(){
  const context={};
  vm.runInNewContext(source,context,{filename:'month-close-guide.js'});
  assert.equal(typeof context.LTMonthCloseGuide.render,'function');
  return context.LTMonthCloseGuide;
}

test('månadschecklistan har verkliga länkar utan automatiskt godkända steg',()=>{
  const html=guide().render({period:'2026-10',periodExists:true,periodStatus:'open',visibleEntries:4,demo:true});
  assert.match(html,/Förbered 2026-10/);
  assert.match(html,/4 verifikationer för perioden visas/);
  assert.match(html,/inte ett bevis på att alla poster är med/);
  assert.match(html,/Kontrollera manuellt/);
  assert.equal((html.match(/Kontrollera manuellt/g)||[]).length,7);
  assert.match(html,/href="\.\/bank\.html\?demo=1"/);
  assert.match(html,/href="\.\/unplaced-payments\.html\?demo=1"/);
  assert.match(html,/href="\.\/documents\.html\?demo=1"/);
  assert.match(html,/href="\.\/invoices\.html\?demo=1"/);
  assert.match(html,/href="\.\/payables\.html\?demo=1"/);
  assert.match(html,/href="\.\/reports\.html\?demo=1"/);
  assert.doesNotMatch(html,/(?:Alla kontroller klara|Redo att låsa|Allt avstämt)/);
});

test('låst period påstås inte automatiskt vara avstämd',()=>{
  const html=guide().render({period:'2026-10',periodExists:true,periodStatus:'locked',visibleEntries:2,demo:false});
  assert.match(html,/Perioden är låst\. Ett lås bevisar inte/);
  assert.match(html,/status-pill locked/);
  assert.match(html,/href="\.\/bank\.html"/);
  assert.doesNotMatch(html,/href="\.\/bank\.html\?demo=1"/);
});

test('okänd period och ogiltigt visningsantal kan inte förfalska status eller html',()=>{
  const html=guide().render({period:'<img src=x>',periodExists:false,periodStatus:'locked',visibleEntries:-8});
  assert.match(html,/Okänd period/);
  assert.match(html,/Status behöver kontrolleras/);
  assert.match(html,/0 verifikationer/);
  assert.doesNotMatch(html,/<img/);
});

test('guiden fungerar i mobil mörkt läge och med tangentbord',()=>{
  assert.match(css,/html\[data-lt-theme="dark"\]/);
  assert.match(css,/@media\(max-width:780px\)/);
  assert.match(css,/:focus-visible/);
});

test('bokföringsvyn visar läsguiden för den aktuella perioden och bekräftar före låsning',()=>{
  const accounting=fs.readFileSync(path.join(__dirname,'..','apps','portal','accounting.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'..','apps','portal','accounting.html'),'utf8');
  assert.match(accounting,/function monthlyGuide\(current\)/);
  assert.match(accounting,/periodExists:periods\.some\(p=>p\.period===current\.period\)/);
  assert.match(accounting,/visibleEntries:entries\.filter/);
  assert.match(accounting,/\$\{monthlyGuide\(current\)\}/);
  assert.match(accounting,/LTStudioDialog\.confirm/);
  assert.match(accounting,/if\(!confirmed\)return/);
  assert.match(accounting,/Jag har kontrollerat – lås perioden/);
  assert.match(html,/month-close-guide\.css/);
  assert.match(html,/month-close-guide\.js/);
  assert.ok(html.indexOf('month-close-guide.js')<html.indexOf('accounting.js'),'guiden laddas före bokföringsvyn');
});
