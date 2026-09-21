'use strict';

const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Payables=require('../apps/api/payables.js');
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
    const rel=url.pathname==='/'?'reports.html':url.pathname.replace(/^\/+/,''),file=path.resolve(root,rel);
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
async function assertDownload(page,base,{type,params,filename,contains}){
  const link=page.getByRole('link',{name:'Exportera CSV för Excel'});
  await link.waitFor();
  const href=await link.getAttribute('href');
  const exportUrl=new URL(href,base);
  assert.equal(exportUrl.pathname,'/api/v1/exports/'+type);
  for(const [key,value] of Object.entries(params))assert.equal(exportUrl.searchParams.get(key),value);
  const [download]=await Promise.all([page.waitForEvent('download'),link.click()]);
  assert.equal(download.suggestedFilename(),filename);
  const csv=fs.readFileSync(await download.path(),'utf8');
  for(const value of contains)assert.ok(csv.includes(value),'CSV saknar förväntat värde: '+value);
}

(async()=>{
  const db=Db.openDatabase(':memory:');
  const runtime=createServer({db,host:'127.0.0.1',secureCookies:false});
  let portal,browser;
  try{
    Payables.initializePayables(db);
    const company=Db.createCompany(db,{legalName:'Report Export Browser AB',displayName:'Report Export Browser',orgNumber:'559911-2001'});
    const user=Db.createUser(db,{username:'reports.browser',displayName:'Reports Browser',passwordHash:'test-only'});
    Db.addMembership(db,{companyId:company.id,userId:user.id});

    const customer=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-77',name:'Rapportkund AB',customerType:'business'});
    Db.createInvoice(db,{
      companyId:company.id,customerId:customer.id,invoiceNumber:'317701',invoiceDate:'2026-09-15',postingDate:'2026-09-15',
      dueDate:'2026-09-25',totalOre:125000,remainingOre:125000,vatOre:25000,status:'Bokförd'
    });
    const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-77',name:'Rapportleverantör AB',orgNumber:'559911-2002',bankgiro:'777-0001'});
    Payables.createSupplierInvoice(db,{
      companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'LEV-7701',invoiceDate:'2026-09-12',dueDate:'2026-09-22',
      totalOre:50000,vatOre:10000,registeredBy:user.id
    });

    const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
    Db.createSession(db,{
      tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId:user.id,companyId:company.id,
      expiresAt:new Date(Date.now()+3600000).toISOString()
    });

    const backendPort=await listen(runtime.server);
    portal=proxy(backendPort);
    const port=await listen(portal),base='http://127.0.0.1:'+port;
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({acceptDownloads:true});
    await context.addCookies([{name:'rollands_session',value:token,url:base}]);
    const page=await context.newPage();
    await page.goto(base+'/reports.html',{waitUntil:'networkidle'});

    await page.getByRole('button',{name:'Försäljning',exact:true}).click();
    await page.locator('[data-field="from"]').fill('2026-09-10');
    await page.locator('[data-field="to"]').fill('2026-09-30');
    const salesResponse=page.waitForResponse(r=>r.url().includes('/api/v1/reports/sales?from=2026-09-10&to=2026-09-30')&&r.status()===200);
    await page.getByRole('button',{name:'Uppdatera',exact:true}).click();
    await salesResponse;
    await page.getByText('Rapportkund AB',{exact:true}).waitFor();
    await assertDownload(page,base,{
      type:'sales',
      params:{from:'2026-09-10',to:'2026-09-30'},
      filename:'forsaljningsrapport.csv',
      contains:['Rapportkund AB','K-77','125000']
    });

    await page.getByRole('button',{name:'Inköp',exact:true}).click();
    await page.getByText('Rapportleverantör AB',{exact:true}).waitFor();
    await assertDownload(page,base,{
      type:'supplier-purchases',
      params:{from:'2026-09-10',to:'2026-09-30'},
      filename:'inkop-per-leverantor.csv',
      contains:['Rapportleverantör AB','L-77','50000']
    });

    await page.getByRole('button',{name:'Kundfordringar',exact:true}).click();
    await page.locator('[data-field="to"]').fill('2026-09-20');
    const receivablesResponse=page.waitForResponse(r=>r.url().includes('/api/v1/reports/receivables-aging?asOf=2026-09-20')&&r.status()===200);
    await page.getByRole('button',{name:'Uppdatera',exact:true}).click();
    await receivablesResponse;
    await page.getByText('Rapportkund AB',{exact:true}).waitFor();
    await assertDownload(page,base,{
      type:'receivables-aging',
      params:{asOf:'2026-09-20'},
      filename:'kundfordringar-alder-2026-09-20.csv',
      contains:['Rapportkund AB','K-77','125000']
    });

    await page.getByRole('button',{name:'Leverantörsskulder',exact:true}).click();
    await page.getByText('Rapportleverantör AB',{exact:true}).waitFor();
    await assertDownload(page,base,{
      type:'payables-aging',
      params:{asOf:'2026-09-20'},
      filename:'leverantorsskulder-alder-2026-09-20.csv',
      contains:['Rapportleverantör AB','L-77','50000']
    });

    console.log('Rapportexporter browser-UAT: OK');
  }finally{
    if(browser)await browser.close();
    if(portal)await close(portal);
    await close(runtime.server);
    try{db.close()}catch{}
  }
})().catch(error=>{console.error(error);process.exitCode=1});
