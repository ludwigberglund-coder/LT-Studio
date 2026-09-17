'use strict';

const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Payables=require('../apps/api/payables.js');
const Accounting=require('../apps/api/accounting-store.js');
const {createServer}=require('../apps/api/server.js');

function makeSession(db,companyId,userId,roles){
  Db.addMembership(db,{companyId,userId,roles});
  const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
  Db.createSession(db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId,companyId,expiresAt:new Date(Date.now()+60*60*1000).toISOString()});
  return{token,csrf};
}
function contentType(file){const ext=path.extname(file);return ext==='.html'?'text/html; charset=utf-8':ext==='.js'||ext==='.cjs'?'text/javascript; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'application/octet-stream'}
function createPortalProxy(backendPort){
  const root=path.resolve(__dirname,'..','apps','portal');
  return http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/v1/')){
      const proxy=http.request({host:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers:req.headers},upstream=>{res.writeHead(upstream.statusCode||500,upstream.headers);upstream.pipe(res)});
      proxy.on('error',error=>{res.writeHead(502,{'Content-Type':'text/plain'});res.end(error.message)});req.pipe(proxy);return;
    }
    const relative=url.pathname==='/'?'payables.html':decodeURIComponent(url.pathname).replace(/^\/+/,''),file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end('Forbidden');return}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404);res.end('Not found');return}res.writeHead(200,{'Content-Type':contentType(file),'Cache-Control':'no-store'});res.end(bytes)});
  });
}
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port}
async function close(server){if(!server.listening)return;await new Promise(resolve=>server.close(resolve))}
function net2440(entries){return entries.flatMap(entry=>entry.lines||[]).filter(line=>line.account==='2440').reduce((sum,line)=>sum+line.debitOre-line.creditOre,0)}

(async()=>{
  const db=Db.openDatabase(':memory:');
  const runtime=createServer({db,host:'127.0.0.1',secureCookies:false});
  let portal,browser;
  try{
    const company=Db.createCompany(db,{legalName:'Browser Test AB',displayName:'Browser Test',orgNumber:'559900-9911'});
    const hash=Auth.hashPassword('Sakert browser testlosenord 2026!');
    const accountant=Db.createUser(db,{username:'browser-accountant',displayName:'Ekonom Browser',passwordHash:hash});
    const approver=Db.createUser(db,{username:'browser-approver',displayName:'Attestant Browser',passwordHash:hash});
    const accountantSession=makeSession(db,company.id,accountant.id,['accountant']);
    const approverSession=makeSession(db,company.id,approver.id,['approver']);
    const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-144',name:'Billdal Kyla & Service AB',orgNumber:'559100-1449',bankgiro:'333-4411',defaultCostAccount:'4010'});

    const backendPort=await listen(runtime.server);portal=createPortalProxy(backendPort);const portalPort=await listen(portal);const base=`http://127.0.0.1:${portalPort}`;
    browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error));
    const setSession=async session=>{await context.addCookies([{name:'rollands_session',value:session.token,url:base}]);await page.evaluate(csrf=>sessionStorage.setItem('rollands-csrf',csrf),session.csrf);await page.reload({waitUntil:'networkidle'})};

    await context.addCookies([{name:'rollands_session',value:accountantSession.token,url:base}]);
    await page.goto(`${base}/payables.html`,{waitUntil:'networkidle'});await page.evaluate(csrf=>sessionStorage.setItem('rollands-csrf',csrf),accountantSession.csrf);await page.reload({waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Ny leverantörsfaktura'}).click();
    const form=page.locator('#supplier-invoice-intake');await form.locator('select[name="supplierId"]').selectOption(supplier.id);await form.locator('input[name="supplierInvoiceNumber"]').fill('BKS-771');await form.locator('input[name="invoiceDate"]').fill('2026-09-08');await form.locator('input[name="dueDate"]').fill('2026-09-17');await form.locator('input[name="totalAmount"]').fill('1250,00');await form.locator('input[name="vatAmount"]').fill('250,00');await form.locator('input[name="pdf"]').setInputFiles({name:'BKS-771.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% BKS-771 browser test\n')});
    await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),form.getByRole('button',{name:'Registrera faktura'}).click()]);
    await page.getByText('BKS-771',{exact:true}).first().click();await page.getByRole('button',{name:'Hämta konteringsförslag'}).click();await page.getByRole('button',{name:'Spara kontering'}).click();

    await setSession(approverSession);await page.getByText('BKS-771',{exact:true}).first().click();await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),page.getByRole('button',{name:'Attestera faktura'}).click()]);
    await setSession(accountantSession);await page.getByText('BKS-771',{exact:true}).first().click();await page.getByRole('button',{name:'Bokför leverantörsskuld'}).click();await page.getByRole('button',{name:'Förbered betalning idag'}).click();

    await setSession(approverSession);await page.getByRole('button',{name:'Frisläpp'}).click();
    await setSession(accountantSession);page.once('dialog',dialog=>dialog.accept('BANK-BKS-771-BROWSER'));await page.getByRole('button',{name:'Bekräfta & bokför'}).click();await page.getByText(/Betalningen är bokförd som/).waitFor({timeout:10000});

    const invoice=db.prepare(`SELECT id,status,open_amount_ore AS openAmountOre,accounting_status AS accountingStatus FROM supplier_invoices WHERE company_id=? AND supplier_invoice_number='BKS-771'`).get(company.id);assert.ok(invoice);assert.equal(invoice.status,'paid');assert.equal(invoice.accountingStatus,'paid');assert.equal(invoice.openAmountOre,0);
    const payment=db.prepare(`SELECT id,status,amount_ore AS amountOre,confirmation_reference AS confirmationReference FROM supplier_payments WHERE company_id=? AND supplier_invoice_id=?`).get(company.id,invoice.id);assert.ok(payment);assert.equal(payment.status,'paid');assert.equal(payment.amountOre,125000);assert.equal(payment.confirmationReference,'BANK-BKS-771-BROWSER');
    const invoiceEntry=Accounting.entryBySource(db,company.id,'supplier-invoice',invoice.id),paymentEntry=Accounting.entryBySource(db,company.id,'supplier-payment',payment.id);assert.ok(invoiceEntry);assert.ok(paymentEntry);assert.deepEqual(invoiceEntry.lines.map(line=>[line.account,line.debitOre,line.creditOre]),[['4010',100000,0],['2641',25000,0],['2440',0,125000]]);assert.deepEqual(paymentEntry.lines.map(line=>[line.account,line.debitOre,line.creditOre]),[['2440',125000,0],['1930',0,125000]]);assert.equal(net2440([invoiceEntry,paymentEntry]),0);assert.equal(pageErrors.length,0,pageErrors.map(error=>error.message).join('\n'));
    console.log('Browserflöde BKS-771: OK');
  }finally{
    if(browser)await browser.close();if(portal)await close(portal);await close(runtime.server);try{db.close()}catch{}
  }
})().catch(error=>{console.error(error);process.exitCode=1});
