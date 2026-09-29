'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {buildStatic}=require('../scripts/build-static.js');

const root=buildStatic();
const pagesHost='ludwigberglund-coder.github.io';
const pagesPrefix='/LT-Studio/';
const supabaseHost='bwbhnotpuuhgghjpmflk.supabase.co';
const sessionKey='lt-studio-supabase-uat-session-v1';
const uid='00000000-0000-4000-8000-000000000001';
const companyId='00000000-0000-4000-8000-000000000002';

function base64url(value){
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
const accessToken=[
  base64url({alg:'none',typ:'JWT'}),
  base64url({sub:uid,aal:'aal2',exp:Math.floor(Date.now()/1000)+3600}),
  'test-signature'
].join('.');
const session={access_token:accessToken,refresh_token:'synthetic-refresh-token'};

function contentType(file){
  return ({
    '.html':'text/html; charset=utf-8',
    '.js':'text/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8',
    '.json':'application/json',
    '.svg':'image/svg+xml',
    '.png':'image/png',
    '.jpg':'image/jpeg',
    '.jpeg':'image/jpeg',
    '.webp':'image/webp',
    '.woff2':'font/woff2'
  })[path.extname(file).toLowerCase()]||'application/octet-stream';
}

function json(route,status,body){
  return route.fulfill({
    status,
    contentType:'application/json',
    headers:{
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Headers':'*',
      'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'
    },
    body:JSON.stringify(body)
  });
}

(async()=>{
  let browser;
  let logoutCalls=0;
  try{
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext();

    await context.addInitScript(({sessionKey,session})=>{
      if(!sessionStorage.getItem('__lt_logout_history_seeded')){
        sessionStorage.setItem('__lt_logout_history_seeded','1');
        sessionStorage.setItem(sessionKey,JSON.stringify(session));
      }
      class NoopWebSocket{
        static OPEN=1;
        constructor(){this.readyState=3;}
        send(){}
        close(){this.readyState=3;}
      }
      window.WebSocket=NoopWebSocket;
    },{sessionKey,session});

    await context.route('**/*',async route=>{
      const request=route.request();
      const url=new URL(request.url());

      if(url.hostname===pagesHost){
        if(!url.pathname.startsWith(pagesPrefix)){
          await route.fulfill({status:404,body:'Not found'});
          return;
        }
        let relative=decodeURIComponent(url.pathname.slice(pagesPrefix.length));
        if(!relative||relative.endsWith('/'))relative+='index.html';
        const file=path.resolve(root,relative);
        if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
          await route.fulfill({status:404,body:'Not found'});
          return;
        }
        await route.fulfill({
          status:200,
          contentType:contentType(file),
          headers:{'Cache-Control':'no-store'},
          body:fs.readFileSync(file)
        });
        return;
      }

      if(url.hostname===supabaseHost){
        if(request.method()==='OPTIONS'){
          await route.fulfill({
            status:204,
            headers:{
              'Access-Control-Allow-Origin':'*',
              'Access-Control-Allow-Headers':'*',
              'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'
            }
          });
          return;
        }

        if(url.pathname==='/auth/v1/user'){
          await json(route,200,{id:uid,email:'synthetic.user@example.invalid'});
          return;
        }
        if(url.pathname==='/auth/v1/logout'){
          logoutCalls+=1;
          await json(route,200,{});
          return;
        }
        if(url.pathname==='/rest/v1/app_users'){
          await json(route,200,[{
            id:'profile-1',
            auth_user_id:uid,
            username:'synthetic.user@example.invalid',
            display_name:'Syntetisk UAT-användare',
            session_duration_minutes:null
          }]);
          return;
        }
        if(url.pathname==='/rest/v1/company_memberships'){
          await json(route,200,[{auth_user_id:uid,company_id:companyId,role:'admin'}]);
          return;
        }
        if(url.pathname==='/rest/v1/companies'){
          await json(route,200,[{
            id:companyId,
            display_name:'Syntetiskt Testbolag',
            legal_name:'Syntetiskt Testbolag AB',
            org_number:'000000-0000'
          }]);
          return;
        }
        if(url.pathname==='/rest/v1/rpc/portal_dashboard_metrics'){
          await json(route,200,{});
          return;
        }
        if(url.pathname.startsWith('/rest/v1/')){
          await json(route,200,[]);
          return;
        }

        await json(route,404,{error:'Unhandled synthetic Supabase route'});
        return;
      }

      await route.abort();
    });

    const page=await context.newPage();
    const base='https://'+pagesHost+pagesPrefix;
    await page.goto(base+'portal/dashboard.html',{waitUntil:'domcontentloaded',timeout:20000});
    await page.locator('.shared-user-trigger').waitFor({state:'visible',timeout:10000});
    assert.match(await page.locator('body').innerText(),/Syntetisk UAT-användare/);

    await page.locator('a[data-nav-id="receivables"]').click();
    await page.waitForURL(/\/LT-Studio\/portal\/index\.html$/, {timeout:10000});
    await page.locator('.shared-user-trigger').waitFor({state:'visible',timeout:10000});

    await page.locator('.shared-user-trigger').click();
    await page.getByRole('button',{name:'Logga ut',exact:true}).click();
    await page.locator('#login-form').waitFor({state:'visible',timeout:10000});

    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),sessionKey),null,'logout must clear the browser auth session');
    assert.equal(logoutCalls,1,'logout must call Supabase global sign-out once');

    await page.goBack({waitUntil:'commit',timeout:10000}).catch(()=>null);
    await page.waitForFunction(
      ()=>location.pathname.endsWith('/portal/index.html')&&Boolean(document.querySelector('#login-form')),
      null,
      {timeout:10000}
    );

    assert.equal(await page.locator('#login-form').isVisible(),true,'browser Back after logout must stay on login');
    assert.equal(await page.locator('.shared-user-trigger').count(),0,'cached authenticated controls must not return after logout');
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),sessionKey),null,'Back navigation must not recreate the cleared session');
    assert.match(page.url(),/\/LT-Studio\/portal\/index\.html$/);

    console.log('Browser security OK: logout clears session and Back cannot restore an authenticated portal view.');
  }finally{
    if(browser)await browser.close();
  }
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
