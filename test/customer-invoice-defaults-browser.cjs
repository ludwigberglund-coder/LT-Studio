'use strict';

const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Invoicing=require('../apps/api/customer-invoicing.js');
const {createServer}=require('../apps/api/server.js');

function contentType(file){
  const ext=path.extname(file);
  return ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'application/octet-stream';
}
function proxy(backendPort){
  const root=path.resolve(__dirname,'..','apps','portal');
  return http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/v1/')){
      const p=http.request({host:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers:req.headers},up=>{
        res.writeHead(up.statusCode||500,up.headers);
        up.pipe(res);
      });
      req.pipe(p);
      return;
    }
    const rel=url.pathname==='/'?'customers.html':url.pathname.replace(/^\/portal\//,'').replace(/^\/+/,''),file=path.resolve(root,rel);
    if(!file.startsWith(root)){res.writeHead(403);res.end('Forbidden');return}
    fs.readFile(file,(error,bytes)=>{
      if(error){res.writeHead(404);res.end('Not found');return}
      res.writeHead(200,{'Content-Type':contentType(file)});
      res.end(bytes);
    });
  });
}
async function listen(server){
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  return server.address().port;
}
async function close(server){
  if(server?.listening)await new Promise(resolve=>server.close(resolve));
}

(async()=>{
  const db=Db.openDatabase(':memory:');
  const runtime=createServer({db,host:'127.0.0.1',secureCookies:false});
  let portal,browser;
  try{
    const company=Db.createCompany(db,{legalName:'Kundstandard AB',displayName:'Kundstandard',orgNumber:'559944-1001'});
    const user=Db.createUser(db,{username:'defaults.browser',displayName:'Defaults Browser',passwordHash:'test-only'});
    Db.addMembership(db,{companyId:company.id,userId:user.id});
    const customer=Db.createCustomer(db,{
      companyId:company.id,customerNumber:'K-1001',name:'Återanvänd Kund AB',orgNumber:'559944-2001',
      email:'faktura@ateranvand.test',address:{full:'Kundgatan 14, 111 22 Stockholm'},customerType:'business'
    });

    const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
    Db.createSession(db,{
      tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId:user.id,companyId:company.id,
      expiresAt:'2099-01-01T00:00:00.000Z',absoluteExpiresAt:'2099-01-01T00:00:00.000Z'
    });

    const backendPort=await listen(runtime.server);
    portal=proxy(backendPort);
    const port=await listen(portal),base='http://127.0.0.1:'+port;
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext();
    await context.addCookies([{name:'rollands_session',value:token,url:base}]);
    const page=await context.newPage();
    await page.addInitScript(value=>sessionStorage.setItem('rollands-csrf',value),csrf);

    await page.goto(base+'/customers.html',{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Redigera',exact:true}).click();
    await page.locator('input[name="paymentTermsDays"]').fill('14');
    await page.locator('input[name="ourReference"]').fill('Anna Sälj');
    await page.locator('input[name="yourReference"]').fill('PO-4477');
    await page.getByRole('button',{name:'Spara kund',exact:true}).click();
    await page.getByText(/Kund K-1001 är uppdaterad/).waitFor();

    const stored=Invoicing.customerInvoicePreferences(db,company.id,customer.id);
    assert.equal(stored.paymentTermsDays,14);
    assert.equal(stored.ourReference,'Anna Sälj');
    assert.equal(stored.yourReference,'PO-4477');

    await page.goto(base+'/invoices.html',{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'+ Ny kundfaktura',exact:true}).click();
    await page.locator('select[name="customerNumber"]').selectOption('K-1001');
    await page.locator('input[name="ourReference"]').waitFor();

    assert.equal(await page.getByLabel('Företagsnamn - kund').inputValue(),'Återanvänd Kund AB');
    assert.equal(await page.getByLabel('Organisationsnummer - kund').inputValue(),'559944-2001');
    assert.equal(await page.getByLabel('Fakturaadress, postnummer och ort - kund').inputValue(),'Kundgatan 14, 111 22 Stockholm');
    assert.equal(await page.getByLabel('Mottagarens e-post - kund').inputValue(),'faktura@ateranvand.test');
    assert.equal(await page.locator('input[name="paymentTermsDays"]').inputValue(),'14');
    assert.equal(await page.locator('input[name="ourReference"]').inputValue(),'Anna Sälj');
    assert.equal(await page.locator('input[name="yourReference"]').inputValue(),'PO-4477');

    const labels=await page.locator('#invoice-form label').allTextContents();
    assert.ok(labels.some(value=>value.includes('Företagsnamn - kund')));
    assert.ok(labels.some(value=>value.includes('Organisationsnummer - kund')));
    assert.ok(labels.some(value=>value.includes('Fakturaadress')));
    assert.ok(labels.some(value=>value.includes('Mottagarens e-post')));
    assert.equal(await page.locator('[name="articleNumber"],[data-row-field="articleNumber"]').count(),0);
    assert.equal((await page.locator('#invoice-form').innerText()).includes('Artikelnummer'),false);

    const invoiceDate=await page.locator('input[name="invoiceDate"]').inputValue();
    const dueDate=await page.locator('input[name="dueDate"]').inputValue();
    const expected=new Date(invoiceDate+'T12:00:00Z');
    expected.setUTCDate(expected.getUTCDate()+14);
    assert.equal(dueDate,expected.toISOString().slice(0,10));

    await page.getByRole('button',{name:'Spara utkast',exact:true}).click();
    const draft=Invoicing.getCustomerInvoiceDraft(db,company.id,user.id);
    assert.equal(draft.draft.customerNumber,'K-1001');
    assert.equal(draft.draft.buyer.name,'Återanvänd Kund AB');
    assert.equal(draft.draft.buyer.orgNumber,'559944-2001');
    assert.equal(draft.draft.buyer.email,'faktura@ateranvand.test');
    assert.equal(draft.draft.paymentTermsDays,14);
    assert.equal(draft.draft.ourReference,'Anna Sälj');
    assert.equal(draft.draft.yourReference,'PO-4477');

    console.log('Customer invoice defaults browser UAT: OK');
  }finally{
    if(browser)await browser.close();
    if(portal)await close(portal);
    await close(runtime.server);
    try{db.close()}catch{}
  }
})().catch(error=>{console.error(error);process.exitCode=1});
