'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {PDFDocument}=require('pdf-lib');
const {groups}=require('../apps/portal/portal-nav.js');
const {example}=require('./fixtures/invoice-example.js');
const {buildStatic}=require('../scripts/build-static.js');
const root=buildStatic(),out=path.resolve(__dirname,'..','test-artifacts');fs.mkdirSync(out,{recursive:true});
const expected=groups.flatMap(g=>g.items).map(i=>i[0]);
const errors=[],checks=[];
function mime(file){return ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.pdf':'application/pdf'})[path.extname(file)]||'application/octet-stream';}
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');if(u.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
 if(!u.pathname.startsWith('/Rollands/')){res.writeHead(404);res.end('Not found');return;}
 let relative=decodeURIComponent(u.pathname.slice('/Rollands/'.length));if(relative.endsWith('/')||!relative)relative+='index.html';
 const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':mime(file),'Cache-Control':'no-store'});res.end(data);});
});
(async()=>{
 let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/Rollands/`;
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
  page.on('pageerror',e=>errors.push({url:page.url(),error:e.message}));page.on('dialog',dialog=>dialog.accept());
  async function menu(){
   await page.locator('.shared-navigation').waitFor({timeout:15000});
   const actual=await page.locator('.shared-navigation [data-nav-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.navId));assert.deepEqual(actual,expected,page.url());
   assert.equal(await page.locator('.shared-navigation').count(),1);
   assert.equal(await page.locator('.shared-sidebar').evaluate(el=>getComputedStyle(el).display!=='none'),true);
   await page.locator('.shared-navigation details').evaluateAll(nodes=>nodes.forEach(n=>{n.open=true;}));
   assert.equal(await page.locator('.shared-navigation [data-nav-id]').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).display!=='none'&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0)),true,page.url());
  }
  const portal=fs.readdirSync(path.join(root,'portal')).filter(f=>f.endsWith('.html')).map(f=>'portal/'+f);
  const admin=['overview','content','money','access','journal','modules','decisions'].map(v=>'admin/?demo=1#/'+v);
  const legacy=['overview','res-tools','batches','audit','inbox','assistant','settings'].map(v=>'legacy/?demo=1#/'+v);
  for(const route of [...portal,...admin,...legacy]){
   const target=new URL(route,base);target.searchParams.set('demo','1');const response=await page.goto(target.href,{waitUntil:'networkidle'});assert.equal(response.status(),200,route);await menu();checks.push({kind:'menu',route});
  }
  // All links resolve inside the nested deployment base, not the domain root.
  const links=await page.locator('[data-nav-id]').evaluateAll(nodes=>nodes.map(n=>n.href));
  for(const href of links){assert.ok(href.startsWith(base),href);const r=await context.request.get(href.split('#')[0]);assert.equal(r.status(),200,href);}
  await page.goto(base+'portal/dashboard.html?demo=1',{waitUntil:'networkidle'});
  for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:1000});await menu();checks.push({kind:'viewport',width});if(width===390)await page.screenshot({path:path.join(out,'menu-mobile.png'),fullPage:true});}
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-nav-group="administration"] summary').click();assert.equal(await page.locator('[data-nav-group="administration"]').getAttribute('open'),null);
  await page.locator('[data-nav-id="invoices"]').click();await page.locator('h1').filter({hasText:'Kundfakturor'}).waitFor();
  assert.equal(await page.locator('[data-nav-group="administration"]').getAttribute('open'),null,'user collapse survives route change');
  await menu();
  await page.getByRole('button',{name:'+ Ny kundfaktura',exact:true}).click();await page.locator('#invoice-form').waitFor();await menu();
  await page.getByRole('button',{name:'Till fakturalistan',exact:true}).click();await menu();
  // Add a user-defined revenue account through its real page before invoicing.
  await page.locator('[data-nav-id="accounts"]').click();await page.locator('#account-form').waitFor();
  await page.locator('#account-form [name=number]').fill('3099');await page.locator('#account-form [name=name]').fill('Egen intäkt för browser-test');await page.getByRole('button',{name:'Spara intäktskonto',exact:true}).click();await menu();
  await page.locator('[data-nav-id="invoices"]').click();await page.getByRole('button',{name:'+ Ny kundfaktura',exact:true}).click();
  await page.locator('[name=customerNumber]').selectOption('K-1001');
  const data=example();
  for(const group of ['seller','buyer'])for(const [key,value] of Object.entries(data[group])){const field=page.locator(`[name="${group}.${key}"]`);if(await field.count())await field.fill(String(value));}
  for(const key of ['invoiceDate','postingDate','dueDate','deliveryDate','paymentTermsDays','ourReference','yourReference','orderNumber','ocr','interestText','paymentTermsText','deliveryTerms','deliveryMethod','deliveryAddress','notes','internalNotes'])await page.locator(`[name="${key}"]`).fill(String(data[key]??''));
  await page.getByRole('button',{name:'+ Lägg till fakturarad',exact:true}).click();
  for(let index=0;index<data.lines.length;index++){
   const row=page.locator(`[data-row="${index}"]`);
   for(const [key,value] of Object.entries(data.lines[index])){const field=row.locator(`[data-row-field="${key}"]`);if(key==='vatRate'||key==='revenueAccount')await field.selectOption(key==='revenueAccount'&&index===1?'3099':String(value));else await field.fill(String(value));}
  }
  await page.screenshot({path:path.join(out,'invoice-editor.png'),fullPage:true});
  const before=await page.evaluate(()=>RollandsDemoScenario.state().customerInvoices.length);
  await page.getByRole('button',{name:'Granska faktura / PDF',exact:true}).click();await page.getByRole('heading',{name:'Faktura UTKAST',exact:true}).waitFor();await menu();
  assert.equal(await page.evaluate(()=>RollandsDemoScenario.state().customerInvoices.length),before,'preview must not post');
  await page.getByRole('button',{name:'Tillbaka till utkast',exact:true}).click();
  // Validation must retain entered data and leave state untouched.
  await page.locator('[name="buyer.address"]').fill('');await page.getByRole('button',{name:'Granska faktura / PDF',exact:true}).click();await page.locator('#invoice-alert:not([hidden])').waitFor();
  assert.equal(await page.locator('[data-row="1"] [data-row-field=revenueAccount]').inputValue(),'3099');assert.equal(await page.evaluate(()=>RollandsDemoScenario.state().customerInvoices.length),before);
  await page.locator('[name="buyer.address"]').fill(data.buyer.address);
  await page.getByRole('button',{name:'Skapa och bokför faktura',exact:true}).click();await page.getByRole('button',{name:'Hämta faktura (PDF)',exact:true}).waitFor();await menu();
  const posted=await page.evaluate(()=>{const s=RollandsDemoScenario.state();return {record:s.customerInvoices.at(-1),entry:s.accountingEntries.at(-1),count:s.customerInvoices.length};});
  assert.equal(posted.count,before+1);assert.equal(posted.record.document.lines[1].revenueAccount,'3099');assert.equal(posted.record.document.seller.iban,'DEMO-IBAN');
  assert.equal(posted.entry.lines.find(r=>r.account==='3099').creditOre,33750);assert.equal(posted.entry.lines.reduce((n,r)=>n+r.debitOre-r.creditOre,0),0);
  const customerDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Hämta faktura (PDF)',exact:true}).click();const customerFile=await customerDownload;await customerFile.saveAs(path.join(out,'invoice-browser.pdf'));
  const bytes=fs.readFileSync(path.join(out,'invoice-browser.pdf'));assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.equal((await PDFDocument.load(bytes)).getTitle(),'FAKTURA '+posted.record.invoiceNumber);
  const internalDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Hämta hela underlaget (PDF)',exact:true}).click();await (await internalDownload).saveAs(path.join(out,'invoice-browser-internal.pdf'));
  await page.screenshot({path:path.join(out,'invoice-preview.png'),fullPage:true});
  await page.reload({waitUntil:'networkidle'});await menu();assert.equal(await page.evaluate(()=>RollandsDemoScenario.state().customerInvoices.at(-1).document.lines[1].revenueAccount),'3099');
  await page.locator('[data-nav-id="accounting"]').click();await menu();assert.ok((await page.locator('body').innerText()).includes(posted.record.invoiceNumber));
  // Repeated replacement is precisely the failure mode reported by the user.
  await page.evaluate(()=>{document.querySelector('.sidebar').outerHTML='<aside class="sidebar"></aside>';});await menu();
  checks.push({kind:'invoice',invoiceNumber:posted.record.invoiceNumber,selectedAccounts:['3051','3099'],netOre:posted.record.document.netOre,totalOre:posted.record.document.totalOre});
  assert.deepEqual(errors,[],'no uncaught browser errors');
  fs.copyFileSync(path.join(root,'shared/vendor/pdf-lib.min.js'),path.join(out,'pdf-lib.min.js'));
  fs.writeFileSync(path.join(out,'navigation-invoice-results.json'),JSON.stringify({ok:true,checks,errors},null,2));
  console.log(`Navigation and invoice browser checks passed: ${checks.length} checks, ${expected.length} stable menu links.`);
 }catch(error){fs.writeFileSync(path.join(out,'navigation-invoice-results.json'),JSON.stringify({ok:false,checks,errors,failure:error.stack},null,2));throw error;}
 finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
