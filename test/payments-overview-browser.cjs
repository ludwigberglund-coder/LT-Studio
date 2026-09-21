'use strict';

const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Bank=require('../apps/api/bank-payments.js');
const Payables=require('../apps/api/payables.js');
const {createServer}=require('../apps/api/server.js');

function contentType(file){const ext=path.extname(file);return ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'application/octet-stream'}
function proxy(backendPort){
  const root=path.resolve(__dirname,'..','apps','portal');
  return http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/v1/')){const p=http.request({host:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers:req.headers},up=>{res.writeHead(up.statusCode||500,up.headers);up.pipe(res)});req.pipe(p);return}
    const rel=url.pathname==='/'?'payments.html':url.pathname.replace(/^\/+/,''),file=path.resolve(root,rel);
    fs.readFile(file,(e,b)=>{if(e){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':contentType(file)});res.end(b)});
  });
}
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return server.address().port}
async function close(server){if(server?.listening)await new Promise(r=>server.close(r))}

(async()=>{
  const db=Db.openDatabase(':memory:'),runtime=createServer({db,host:'127.0.0.1',secureCookies:false});
  let portal,browser;
  try{
    const company=Db.createCompany(db,{legalName:'Payments Browser AB',displayName:'Payments Browser',orgNumber:'559911-1001'});
    const user=Db.createUser(db,{username:'payments.browser',displayName:'Payments Browser',passwordHash:'test-only'});
    Db.addMembership(db,{companyId:company.id,userId:user.id});
    Bank.create(db,{companyId:company.id,externalId:'PB-IN',bookingDate:'2026-09-10',amountOre:30000,reference:'BANK-REF',payerName:'Kund Alpha',createdBy:user.id});
    const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-1',name:'Leverantör Beta',bankgiro:'123-4567'});
    const invoice=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'SUP-42',invoiceDate:'2026-09-01',dueDate:'2026-09-30',totalOre:12500,vatOre:2500,registeredBy:user.id});
    db.prepare(`INSERT INTO supplier_payments(id,company_id,supplier_invoice_id,payment_date,amount_ore,account,status,prepared_by,recipient_name,recipient_bankgiro,created_at,updated_at)
      VALUES('PB-OUT',?,?,?,?,?,'paid',?,?,?,'2026-09-11T10:00:00.000Z','2026-09-11T10:00:00.000Z')`).run(company.id,invoice.id,'2026-09-11',12500,'1930',user.id,'Leverantör Beta','123-4567');
    const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
    Db.createSession(db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId:user.id,companyId:company.id,expiresAt:new Date(Date.now()+3600000).toISOString()});
    const backendPort=await listen(runtime.server);portal=proxy(backendPort);const port=await listen(portal),base=`http://127.0.0.1:${port}`;
    browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.addCookies([{name:'rollands_session',value:token,url:base}]);
    const page=await context.newPage();await page.goto(base+'/payments.html',{waitUntil:'networkidle'});
    await page.locator('[data-field="anchor"]').fill('2026-09-10');
    await page.locator('[data-field="direction"]').selectOption('out');
    await page.locator('[data-field="status"]').fill('paid');
    await page.locator('[data-field="query"]').fill('Leverantör Beta');
    await page.locator('[data-field="account"]').fill('1930');
    await page.locator('[data-field="sort"]').selectOption('amount');
    await page.locator('[data-field="order"]').selectOption('desc');
    const responsePromise=page.waitForResponse(response=>response.url().includes('/api/v1/reports/payments-overview')&&response.url().includes('query=Leverant%C3%B6r%20Beta')&&response.url().includes('account=1930')&&response.status()===200);
    await page.getByRole('button',{name:'Uppdatera'}).click();
    await responsePromise;
    await page.locator('tbody tr').filter({hasText:'Leverantör Beta'}).waitFor();
    assert.equal(await page.getByText('Kund Alpha',{exact:true}).count(),0);
    assert.match(await page.locator('.report-summary').innerText(),/125,00|125\.00/);
    assert.equal(await page.locator('tbody tr').count(),1);
    const exportHref=await page.getByRole('link',{name:'Exportera CSV'}).getAttribute('href');
    const exportUrl=new URL(exportHref,base);
    assert.equal(exportUrl.pathname,'/api/v1/exports/payments-overview');
    assert.equal(exportUrl.searchParams.get('mode'),'month');
    assert.equal(exportUrl.searchParams.get('date'),'2026-09-10');
    assert.equal(exportUrl.searchParams.get('direction'),'out');
    assert.equal(exportUrl.searchParams.get('status'),'paid');
    assert.equal(exportUrl.searchParams.get('query'),'Leverantör Beta');
    assert.equal(exportUrl.searchParams.get('account'),'1930');
    assert.equal(exportUrl.searchParams.get('sort'),'amount');
    assert.equal(exportUrl.searchParams.get('order'),'desc');
    const [download]=await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link',{name:'Exportera CSV'}).click()
    ]);
    assert.equal(download.suggestedFilename(),'betalningsoversikt.csv');
    const csv=fs.readFileSync(await download.path(),'utf8');
    assert.match(csv,/Leverantör Beta/);
    assert.equal(csv.includes('Kund Alpha'),false);
    assert.match(csv,/-12500/);
    console.log('Betalningsöversikt browserfilter och export: OK');
  }finally{if(browser)await browser.close();if(portal)await close(portal);await close(runtime.server);try{db.close()}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1});
