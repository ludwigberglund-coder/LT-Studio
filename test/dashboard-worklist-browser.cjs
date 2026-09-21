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
      if(p==='/api/v1/session')return json(route,200,{authenticated:true,user:{displayName:'Dashboard Test'},company:{id:'co-test',name:'Dashboard Test AB'}});
      if(p==='/api/v1/receivables')return json(route,503,{error:'Kundreskontran kunde inte läsas.'});
      if(p==='/api/v1/payables/invoices')return json(route,200,{invoices:[]});
      if(p==='/api/v1/bank/payments')return json(route,200,{payments:[]});
      if(p==='/api/v1/automation/proposals')return json(route,200,{proposals:[]});
      if(p==='/api/v1/suppliers/pending-changes')return json(route,200,{changes:[]});
      if(p==='/api/v1/inventory/adjustments')return json(route,200,{adjustments:[]});
      if(p==='/api/v1/inventory/items')return json(route,200,{items:[{id:'item-1'}]});
      if(p==='/api/v1/accounting/unlock-requests')return json(route,200,{requests:[]});
      if(p==='/api/v1/documents')return json(route,200,{documents:[]});
      if(p==='/api/v1/accounting/entries')return json(route,200,{entries:[]});
      if(p==='/api/v1/payroll/runs')return json(route,200,{runs:[]});
      if(p==='/api/v1/website/cms')return json(route,200,{state:{published:{version:3}}});
      return json(route,404,{error:'Unexpected test route '+p});
    });

    await page.goto(base+'/dashboard.html',{waitUntil:'networkidle'});

    const warning=page.locator('.notice.warning');
    await warning.waitFor();
    assert.match(await warning.innerText(),/Arbetslistan är ofullständig/);
    assert.match(await warning.innerText(),/kundreskontra/);

    const openMetric=page.locator('.dash-metric').filter({hasText:'Öppet kundsaldo'});
    const overdueMetric=page.locator('.dash-metric').filter({hasText:'Förfallet kundsaldo'});
    assert.match(await openMetric.innerText(),/Ej tillgängligt/);
    assert.match(await overdueMetric.innerText(),/Ej tillgängligt/);
    assert.equal((await openMetric.innerText()).includes('0,00'),false);
    assert.equal((await overdueMetric.innerText()).includes('0,00'),false);

    const bankMetric=page.locator('.dash-metric').filter({hasText:'Bank att matcha'});
    assert.match(await bankMetric.innerText(),/\b0\b/);
    assert.equal((await bankMetric.innerText()).includes('Ej tillgängligt'),false);

    const receivablesCard=page.locator('.module-card').filter({hasText:'Kundreskontra'});
    assert.match(await receivablesCard.innerText(),/Data kunde inte läsas/);
    assert.match(await receivablesCard.innerText(),/Ej tillgängligt/);

    const inventoryCard=page.locator('.module-card').filter({hasText:'Lager'});
    assert.match(await inventoryCard.innerText(),/\b1\b/);
    const websiteCard=page.locator('.module-card').filter({hasText:'Webbplats & innehåll'});
    assert.match(await websiteCard.innerText(),/v3/);

    console.log('Dashboard unavailable-state browser flow: OK');
  }finally{
    if(browser)await browser.close();
    await close(server);
  }
})().catch(error=>{console.error(error);process.exitCode=1});
