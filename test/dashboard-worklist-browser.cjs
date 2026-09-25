'use strict';

const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

function contentType(file){
  const ext=path.extname(file);
  if(ext==='.html')return'text/html; charset=utf-8';
  if(ext==='.js')return'text/javascript; charset=utf-8';
  if(ext==='.css')return'text/css; charset=utf-8';
  return'application/octet-stream';
}
function staticServer(){
  const root=path.resolve(__dirname,'..','apps','portal');
  return http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const rel=url.pathname==='/'?'dashboard.html':url.pathname.replace(/^\/+/,''),file=path.resolve(root,rel);
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
function json(route,status,body){
  return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
}

(async()=>{
  const server=staticServer();
  let browser;
  try{
    const port=await listen(server),base='http://127.0.0.1:'+port;
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage();

    await page.route('**/api/v1/**',route=>{
      const url=new URL(route.request().url());
      const p=url.pathname;
      if(p==='/api/v1/session')return json(route,200,{authenticated:true,user:{displayName:'Dashboard Test'},company:{id:'co-test',name:'Dashboard Test AB'},permissions:['customer-invoice.view','supplier-invoice.view','payment.view','bank.view','accounting.view','reports.view','supplier.view','inventory.view','documents.view']});
      if(p==='/api/v1/receivables')return json(route,503,{error:'Kundreskontran kunde inte läsas.'});
      if(p==='/api/v1/payables/invoices')return json(route,200,{invoices:[{status:'coded'},{status:'approved'}]});
      if(p==='/api/v1/bank/payments')return json(route,200,{payments:[{status:'unmatched'}]});
      if(p==='/api/v1/automation/proposals')return json(route,200,{proposals:[{status:'manual-review'}]});
      if(p==='/api/v1/inventory/adjustments')return json(route,200,{adjustments:[{status:'pending'}]});
      if(p==='/api/v1/accounting/unlock-requests')return json(route,200,{requests:[{status:'pending'}]});
      return json(route,404,{error:'Unexpected test route '+p});
    });

    await page.goto(base+'/dashboard.html',{waitUntil:'networkidle'});

    await page.locator('.sidebar.shared-sidebar').waitFor();
    await page.locator('.shared-navigation').waitFor();
    assert.equal(await page.locator('[data-nav-id="overview"]').count(),1);

    const warning=page.locator('.overview-soft-warning');
    await warning.waitFor();
    assert.match(await warning.innerText(),/Några köer kunde inte läsas/);

    const cards=page.locator('.task-card');
    assert.equal(await cards.count(),6);
    assert.match(await page.locator('.welcome-card h2').innerText(),/Dashboard/);
    assert.equal(await page.getByText('Starta testguiden').count(),0);
    assert.equal(await page.getByText('Öppet kundsaldo').count(),0);
    assert.equal(await page.getByText('Alla områden').count(),0);

    assert.equal(await page.getByText('Matcha bankhändelser',{exact:true}).count(),1);
    assert.equal(await page.getByText('Granska leverantörsfakturor',{exact:true}).count(),1);
    assert.equal(await page.getByText('Granska automationsförslag',{exact:true}).count(),1);
    assert.equal(await page.getByText('Besluta om periodupplåsning',{exact:true}).count(),1);

    console.log('Dashboard sparse worklist and shared navigation flow: OK');
  }finally{
    if(browser)await browser.close();
    await close(server);
  }
})().catch(error=>{console.error(error);process.exitCode=1});
