'use strict';

const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

const repoRoot=path.resolve(__dirname,'..');
const portalRoot=path.join(repoRoot,'apps','portal');
const configRoot=path.join(repoRoot,'config');

function mime(file){
  const ext=path.extname(file).toLowerCase();
  return ({
    '.html':'text/html; charset=utf-8',
    '.js':'text/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8',
    '.json':'application/json; charset=utf-8'
  })[ext]||'application/octet-stream';
}

function send(res,status,body,type='text/plain; charset=utf-8'){
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});
  res.end(body);
}

const supabaseClientMock=`
window.__manualUnplacedCalls=[];
window.__mockBankPayments=[];
window.LTSupabase={
  from:(table)=>({
    select:async()=>{
      if(table==='bank_payments')return window.__mockBankPayments;
      return [];
    }
  }),
  functions:{
    invoke:async(name,body)=>{
      window.__manualUnplacedCalls.push({name,body});
      if(name!=='manual-customer-payment')throw new Error('Unexpected function '+name);
      window.__mockBankPayments.push({
        id:'browser-unplaced-1',
        company_id:'company-browser-test',
        external_id:'manual-unplaced:'+body.requestId,
        booking_date:body.paymentDate,
        value_date:body.paymentDate,
        amount_ore:body.amountOre,
        currency:'SEK',
        reference:body.reference,
        message:body.comment,
        payer_name:body.payerName,
        payer_account:null,
        status:'unmatched'
      });
      return {bank_payment_id:'browser-unplaced-1',status:'unmatched',duplicate:false};
    }
  }
};
`;

const supabaseSessionMock=`
window.LTSupabaseUat={
  context:async()=>({
    authenticated:true,
    accessToken:'browser-test-token',
    user:{id:'browser-user',displayName:'Browser QA'},
    company:{id:'company-browser-test',name:'Browser QA AB'}
  })
};
`;

const navMock=`
window.RollandsNavigation={mount(){}};
`;

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(url.pathname==='/supabase-config.js')return send(res,200,"window.LT_SUPABASE={environment:'uat'};",'text/javascript; charset=utf-8');
  if(url.pathname==='/supabase-client.js')return send(res,200,supabaseClientMock,'text/javascript; charset=utf-8');
  if(url.pathname==='/supabase-session.js')return send(res,200,supabaseSessionMock,'text/javascript; charset=utf-8');
  if(url.pathname==='/portal-nav.js')return send(res,200,navMock,'text/javascript; charset=utf-8');
  if(url.pathname==='/payments.js'){
    const source=fs.readFileSync(path.join(portalRoot,'payments.js'),'utf8');
    const productionDetection="const isSupabase=location.hostname==='ludwigberglund-coder.github.io'&&!isDemo;";
    assert.ok(source.includes(productionDetection),'payments.js Supabase environment detection changed unexpectedly');
    const testSource=source.replace(productionDetection,'const isSupabase=!isDemo;');
    return send(res,200,testSource,'text/javascript; charset=utf-8');
  }

  let file;
  if(url.pathname.startsWith('/config/')){
    file=path.join(configRoot,url.pathname.slice('/config/'.length));
  }else{
    const rel=url.pathname==='/'?'payments.html':url.pathname.replace(/^\/+/, '');
    file=path.join(portalRoot,rel);
  }
  if(!file.startsWith(portalRoot+path.sep)&&!file.startsWith(configRoot+path.sep)){
    return send(res,403,'Forbidden');
  }
  fs.readFile(file,(error,data)=>{
    if(error)return send(res,404,'Not found');
    send(res,200,data,mime(file));
  });
});

(async()=>{
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const port=server.address().port;
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));

    await page.goto(`http://127.0.0.1:${port}/payments.html`,{waitUntil:'networkidle'});
    await page.locator('.payments-live-banner').waitFor();

    await page.locator('[data-action="manual-payment-open"]').click();
    await page.getByRole('button',{name:'Registrera som oplacerad'}).click();

    const form=page.locator('#manual-unplaced-payment-form');
    await form.locator('[name="paymentDate"]').fill('2026-10-01');
    await form.locator('[name="amount"]').fill('123,45');
    await form.locator('[name="reference"]').fill('QA-UNPLACED-20261001');
    await form.locator('[name="payerName"]').fill('Browser QA Betalare');
    await form.locator('[name="comment"]').fill('Browser regression för oplacerad inbetalning');

    await form.getByRole('button',{name:'Registrera som oplacerad'}).click();
    await page.getByText(/har registrerats som oplacerad/).waitFor();

    const calls=await page.evaluate(()=>window.__manualUnplacedCalls);
    assert.equal(calls.length,1,'exakt ett Edge Function-anrop ska göras');
    assert.equal(calls[0].name,'manual-customer-payment');
    assert.equal(calls[0].body.placement,'unplaced');
    assert.equal(calls[0].body.paymentDate,'2026-10-01');
    assert.equal(calls[0].body.amountOre,12345);
    assert.equal(calls[0].body.bankAccount,'1930');
    assert.equal(calls[0].body.reference,'QA-UNPLACED-20261001');
    assert.equal(calls[0].body.payerName,'Browser QA Betalare');
    assert.equal(calls[0].body.comment,'Browser regression för oplacerad inbetalning');

    assert.equal(await page.getByText('Ange ett giltigt betaldatum.').count(),0,'ett giltigt ISO-datum får inte avvisas');
    assert.equal(errors.length,0,'browserflödet ska inte ge okontrollerade JavaScript-fel');

    console.log('Manuell oplacerad inbetalning browser regression: OK');
  }finally{
    if(browser)await browser.close();
    if(server.listening)await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
