'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const {buildStatic}=require('../scripts/build-static.js');

const root=buildStatic();
const out=path.resolve(__dirname,'..','test-artifacts');
fs.mkdirSync(out,{recursive:true});

const surfaces=[
  {id:'dashboard',route:'portal/dashboard.html?demo=1'},
  {id:'customers',route:'portal/customers.html?demo=1'},
  {id:'invoices',route:'portal/invoices.html?demo=1'},
  {id:'receivables',route:'portal/index.html?demo=1'},
  {id:'suppliers',route:'portal/suppliers.html?demo=1'},
  {id:'payables',route:'portal/payables.html?demo=1'},
  {id:'supplier-ledger',route:'portal/supplier-ledger.html?demo=1'},
  {id:'payments',route:'portal/payments.html?demo=1'},
  {id:'unplaced',route:'portal/unplaced-payments.html?demo=1'},
  {id:'batches',route:'portal/batches.html?demo=1'},
  {id:'accounting',route:'portal/accounting.html?demo=1'},
  {id:'accounts',route:'portal/accounts.html?demo=1'},
  {id:'reports',route:'portal/reports.html?demo=1'},
  {id:'bokslut',route:'portal/bokslut.html?demo=1'},
  {id:'documents',route:'portal/documents.html?demo=1'},
  {id:'inventory',route:'portal/inventory.html?demo=1'},
  {id:'payroll',route:'portal/payroll.html?demo=1'},
  {id:'automation',route:'portal/automation.html?demo=1'},
  {id:'cms',route:'portal/website.html?demo=1'},
  {id:'profile',route:'portal/profile.html?demo=1'},
  {id:'company-settings',route:'portal/company-settings.html?demo=1'},
  {id:'uat',route:'portal/uat.html?demo=1'},
  {id:'project-admin',route:'admin/?demo=1#/overview'},
  {id:'legacy',route:'legacy/?demo=1#/overview'},
  {id:'website',route:'index.html'}
];
const viewports=[
  {id:'desktop',width:1440,height:1000},
  {id:'laptop',width:1024,height:900},
  {id:'tablet',width:768,height:900},
  {id:'mobile',width:390,height:844}
];
const themes=[
  {id:'light',colorScheme:'light'},
  {id:'dark',colorScheme:'dark'}
];

function mime(file){
  return ({
    '.html':'text/html; charset=utf-8',
    '.js':'text/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8',
    '.json':'application/json',
    '.svg':'image/svg+xml'
  })[path.extname(file)]||'application/octet-stream';
}

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(!url.pathname.startsWith('/Rollands/')){res.writeHead(404);res.end('Not found');return;}
  let relative=decodeURIComponent(url.pathname.slice('/Rollands/'.length));
  if(!relative||relative.endsWith('/'))relative+='index.html';
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':mime(file),'Cache-Control':'no-store'});
    res.end(data);
  });
});

function visible(element){
  const style=getComputedStyle(element);
  const rect=element.getBoundingClientRect();
  return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&rect.width>0&&rect.height>0;
}

(async()=>{
  let browser;
  const checks=[];
  const errors=[];
  const layoutIssues=[];
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}/Rollands/`;
    browser=await chromium.launch({headless:true});

    for(const theme of themes){
      for(const viewport of viewports){
        const context=await browser.newContext({
          viewport:{width:viewport.width,height:viewport.height},
          colorScheme:theme.colorScheme
        });
        for(const surface of surfaces){
        const page=await context.newPage();
        const pageErrors=[];
        page.on('pageerror',error=>pageErrors.push(error.message));
        const response=await page.goto(new URL(surface.route,base).href,{waitUntil:'domcontentloaded',timeout:10000});
        if(response)assert.equal(response.status(),200,`${surface.id} ${viewport.id} returned ${response.status()}`);
        await page.waitForLoadState('load',{timeout:5000}).catch(()=>{});
        await page.waitForTimeout(250);

        const layout=await page.evaluate(()=>{
          const html=document.documentElement;
          const body=document.body;
          const side=document.querySelector('.shared-sidebar, .sidebar');
          const active=document.querySelector('.shared-navigation a[aria-current="page"], .side-nav .active, .nav-item.active');
          const styleSide=side?getComputedStyle(side):null;
          const styleActive=active?getComputedStyle(active):null;
          const operatorTheme=html.dataset.operatorTheme||null;
          const bodyStyle=getComputedStyle(body);
          const sharedUser=document.querySelector('.shared-user-trigger');
          const sharedAvatar=document.querySelector('.shared-user-avatar');
          const sidebarCompany=document.querySelector('.sidebar.shared-sidebar .shared-company');
          const sidebarCompanyStyle=sidebarCompany?getComputedStyle(sidebarCompany):null;
          const sidebarCompanyRect=sidebarCompany?.getBoundingClientRect();
          const cmsForm=document.querySelector('.cms-form');
          const cmsSidePanel=document.querySelector('.cms-side > .panel');
          const supplierDivider=document.querySelector('.supplier-alert > div');
          const dashboardHeroParagraphs=[...document.querySelectorAll('.dash-hero p')];
          const dashboardHeroGap=dashboardHeroParagraphs.length>1
            ? dashboardHeroParagraphs[1].getBoundingClientRect().top-dashboardHeroParagraphs[0].getBoundingClientRect().bottom
            : null;
          const sharedUserStyle=sharedUser?getComputedStyle(sharedUser):null;
          const sharedAvatarStyle=sharedAvatar?getComputedStyle(sharedAvatar):null;
          const cmsFormStyle=cmsForm?getComputedStyle(cmsForm):null;
          const cmsSideStyle=cmsSidePanel?getComputedStyle(cmsSidePanel):null;
          const supplierDividerStyle=supplierDivider?getComputedStyle(supplierDivider):null;
          const supplierInput=document.querySelector('.supplier-detail input');
          const supplierPrimary=document.querySelector('.supplier-detail .button:not(.ghost)');
          const supplierInputStyle=supplierInput?getComputedStyle(supplierInput):null;
          const supplierPrimaryStyle=supplierPrimary?getComputedStyle(supplierPrimary):null;
          const sharedBrand=document.querySelector('.shared-brand strong');
          const themeLabel=document.querySelector('.lt-theme-toggle-topbar .lt-theme-toggle-label');
          const themeLabelStyle=themeLabel?getComputedStyle(themeLabel):null;
          const systemHeading=document.querySelector('.system-status-heading h2');
          const systemRowStrong=document.querySelector('.system-status .system-row strong');
          const systemHeadingStyle=systemHeading?getComputedStyle(systemHeading):null;
          const systemRowStrongStyle=systemRowStrong?getComputedStyle(systemRowStrong):null;
          const projectTopbar=document.querySelector('.admin-shell .topbar');
          const firstInvoiceRow=document.querySelector('.invoice-list-panel .sales-table tbody tr:not(.invoice-empty-row)');
          const firstInvoiceCell=firstInvoiceRow?.querySelector('td[data-label]');
          const invoiceThead=document.querySelector('.invoice-list-panel .sales-table thead');
          const projectTopbarRect=projectTopbar?.getBoundingClientRect();
          const invoiceTheadRect=invoiceThead?.getBoundingClientRect();
          const legacyToast=document.querySelector('#toast.show');
          const rendered=[...document.querySelectorAll('body *')].filter(element=>{
            const style=getComputedStyle(element);
            const rect=element.getBoundingClientRect();
            return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&rect.width>0&&rect.height>0;
          });
          const visibleControls=rendered.filter(element=>element.matches('a,button,input,select,textarea,summary')).length;
          // Theme readability is measured on actual computed colors, not CSS filenames.
          const colorLuminance=value=>{
            const raw=String(value||'').trim().toLowerCase();
            let channels;
            if(raw.startsWith('rgb(')||raw.startsWith('rgba(')){
              const inner=raw.slice(raw.indexOf('(')+1,raw.indexOf(')'));
              channels=inner.replace(/,/g,' ').split(/\s+/).filter(Boolean).slice(0,3)
                .map(x=>x.endsWith('%')?Number.parseFloat(x)/100:Number(x)/255);
            }else if(raw.startsWith('color(srgb ')){
              channels=raw.slice('color(srgb '.length,raw.indexOf(')'))
                .trim().split(/\s+/).slice(0,3).map(Number);
            }else{
              return null;
            }
            if(channels.length!==3||channels.some(v=>!Number.isFinite(v)))return null;
            const linear=channels.map(v=>{
              const c=Math.max(0,Math.min(1,v));
              return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);
            });
            return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
          };
          const theme=html.dataset.ltTheme;
          const readableTargets=[...document.querySelectorAll(
            'h1,h2,h3,h4,h5,h6,p,small,label,legend,th,td,summary,.shared-navigation a,.side-nav button,.shared-user-label,.ui-icon,.op-icon'
          )].filter(el=>{
            const style=getComputedStyle(el),rect=el.getBoundingClientRect();
            if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0||rect.width<=0||rect.height<=0)return false;
            if(!el.matches('.ui-icon,.op-icon')&&!el.innerText?.trim())return false;
            // Do not assume an icon on a deliberately dark button should be
            // dark in a light page. Inverted button icons need local surface
            // contrast, not the global text-luminance heuristic.
            if(el.matches('.ui-icon,.op-icon')&&el.closest('button,[role="button"],.button'))return false;
            return !el.closest('.button,.header-action,.status-pill,.status-badge,.badge,.avatar,.nav-badge,.notice,.error,.warning,.success-box,.visual-note,.service-number,.login-brand,.topbar-create') &&
              !(theme==='light'&&el.closest('.contact,.operator-shell .sidebar'));
          });
          const contrastIssues=readableTargets.map(el=>{
            const color=getComputedStyle(el).color;
            const lum=colorLuminance(color);
            if(lum===null||(theme==='dark'?lum>=.44:lum<=.32))return null;
            return {tag:el.tagName.toLowerCase(),className:String(el.className||'').slice(0,65),
              text:el.innerText?.trim().slice(0,50)||'icon',color,lum:Number(lum.toFixed(3))};
          }).filter(Boolean).slice(0,12);
          /* Screenshot-led WCAG checks for actual inverted controls. The
             earlier theme audit intentionally skipped links and buttons and
             therefore missed invisible CTAs, SVG strokes and number chips. */
          const contrastRatio=(foreground,background)=>{
            const a=colorLuminance(foreground),b=colorLuminance(background);
            return a===null||b===null?null:
              (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
          };
          const selectors=[
            ['dashboard-cta-title','.welcome-next strong','.welcome-next',4.5],
            ['dashboard-cta-label','.welcome-next>span','.welcome-next',4.5],
            ['dashboard-task-count','.task-card>strong','.task-card>strong',4.5],
            ['menu-icon-stroke','.shared-menu-toggle .ui-icon svg path','.shared-menu-toggle',3],
            ['user-avatar-initials','.shared-user-avatar','.shared-user-avatar',4.5],
            ['user-name','.shared-user-label strong','.shared-user-trigger',4.5],
            ['active-navigation','.shared-navigation .shared-links a[aria-current="page"]','.shared-navigation .shared-links a[aria-current="page"]',4.5]
          ];
          const controlContrast=selectors.map(([name,selector,backgroundSelector,minRatio])=>{
            const target=document.querySelector(selector),background=document.querySelector(backgroundSelector);
            if(!target||!background)return null;
            const style=getComputedStyle(target),rect=target.getBoundingClientRect();
            if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0||rect.width===0||rect.height===0)return null;
            const fg=name==='menu-icon-stroke'?style.stroke:style.color;
            const bg=getComputedStyle(background).backgroundColor;
            const ratio=contrastRatio(fg,bg);
            return {name,color:fg,background:bg,ratio:ratio===null?null:Number(ratio.toFixed(2)),minRatio};
          }).filter(Boolean);
          const lowContrastControls=controlContrast.filter(x=>x.ratio===null||x.ratio+0.01<x.minRatio);
          const overflowing=rendered.map(element=>{
            const rect=element.getBoundingClientRect();
            return {
              tag:element.tagName.toLowerCase(),
              className:String(element.className||'').slice(0,100),
              text:String(element.textContent||'').trim().replace(/\\s+/g,' ').slice(0,90),
              left:Math.round(rect.left),
              right:Math.round(rect.right),
              width:Math.round(rect.width)
            };
          }).filter(item=>item.left<-2||item.right>window.innerWidth+2||item.width>window.innerWidth+2).slice(0,12);
          return {
            theme:document.documentElement.dataset.ltTheme||null,
            scrollWidth:Math.max(html.scrollWidth,body.scrollWidth),
            innerWidth:window.innerWidth,
            bodyText:body.innerText.trim().length,
            visibleControls,
            contrastIssues,
            controlContrast,
            lowContrastControls,
            checkedColors:readableTargets.length,
            fontFamily:bodyStyle.fontFamily,
            bodyBackground:bodyStyle.backgroundColor,
            sidebarBackground:styleSide?.backgroundColor||null,
            activeBackground:styleActive?.backgroundColor||null,
            activeColor:styleActive?.color||null,
            operatorTheme,
            sharedUserDisplay:sharedUserStyle?.display||null,
            sharedUserBorderTopWidth:sharedUserStyle?.borderTopWidth||null,
            sharedAvatarWidth:sharedAvatarStyle?.width||null,
            sidebarCompanyHeight:sidebarCompanyStyle?.display==='none'||sidebarCompanyStyle?.visibility==='hidden'?null:(sidebarCompanyRect?.height??null),
            sidebarCompanyClipped:Boolean(sidebarCompany&&sidebarCompanyStyle?.overflow==='hidden'&&sidebarCompany.scrollHeight>sidebarCompany.clientHeight+2),
            cmsFormPaddingTop:cmsFormStyle?.paddingTop||null,
            cmsFormPaddingLeft:cmsFormStyle?.paddingLeft||null,
            cmsSidePaddingTop:cmsSideStyle?.paddingTop||null,
            supplierDividerBorderTopColor:supplierDividerStyle?.borderTopColor||null,
            supplierInputColor:supplierInputStyle?.color||null,
            supplierInputTextFill:supplierInputStyle?.webkitTextFillColor||null,
            supplierPrimaryColor:supplierPrimaryStyle?.color||null,
            supplierPrimaryBackground:supplierPrimaryStyle?.backgroundColor||null,
            sharedBrandText:sharedBrand?.textContent?.trim()||null,
            themeLabelDisplay:themeLabelStyle?.display||null,
            systemHeadingColor:systemHeadingStyle?.color||null,
            systemRowStrongColor:systemRowStrongStyle?.color||null,
            projectTopbarHeight:projectTopbarRect?Math.round(projectTopbarRect.height):null,
            invoiceMobileCard:Boolean(firstInvoiceCell?.dataset?.label)&&Boolean(invoiceTheadRect&&invoiceTheadRect.width<=2),
            legacyToastVisible:Boolean(legacyToast),
            dashboardHeroGap,
            overflowing,
            iconizedMetrics:document.querySelectorAll('.metric.ui-with-icon,.stat-button.ui-with-icon').length
          };
        });

        assert.equal(layout.theme,theme.id,`${surface.id} ${viewport.id} did not apply ${theme.id} mode`);
        assert.ok(layout.bodyText>80,`${surface.id} ${viewport.id} ${theme.id} rendered too little content`);
        assert.ok(layout.visibleControls>0,`${surface.id} ${viewport.id} ${theme.id} has no visible controls`);
        assert.equal(layout.contrastIssues.length,0,`${surface.id} ${viewport.id} ${theme.id} has unreadable text/icons: ${JSON.stringify(layout.contrastIssues)}`);
        assert.equal(layout.lowContrastControls.length,0,`${surface.id} ${viewport.id} ${theme.id} has low contrast CTA, number, icon or navigation: ${JSON.stringify(layout.lowContrastControls)}`);
        if(layout.scrollWidth>layout.innerWidth+2)layoutIssues.push(`${surface.id} ${viewport.id} ${theme.id} has page-level horizontal overflow: ${layout.scrollWidth}px > ${layout.innerWidth}px; offenders=${JSON.stringify(layout.overflowing)}`);
        assert.match(layout.fontFamily,/(-apple-system|BlinkMacSystemFont|SF Pro|system-ui)/i,`${surface.id} ${viewport.id} is not using the shared Apple/system font stack`);
        assert.equal(pageErrors.length,0,`${surface.id} ${viewport.id} has uncaught browser errors: ${pageErrors.join('; ')}`);
        assert.equal(layout.iconizedMetrics,0,`${surface.id} ${viewport.id} metric cards must not be converted into inline icon buttons`);

        /* The operator has an independent theme without the old material layer. */
        if(surface.id==='project-admin'&&viewport.id==='desktop'){
          assert.equal(layout.operatorTheme,theme.id,'operator uses the wrong theme');
        }
        if(layout.sidebarBackground){
          assert.notEqual(layout.sidebarBackground,'rgb(20, 60, 48)',`${surface.id} ${viewport.id} leaked the old green sidebar`);
        }
        if(layout.sharedBrandText){
          assert.equal(layout.sharedBrandText,'LT Studio',`${surface.id} ${viewport.id} shows outdated workspace branding: ${layout.sharedBrandText}`);
        }
        if(layout.sidebarCompanyHeight!==null){
          assert.ok(layout.sidebarCompanyHeight>=35,
            `${surface.id} ${viewport.id} ${theme.id} company badge clips its text (height ${layout.sidebarCompanyHeight})`);
          assert.equal(layout.sidebarCompanyClipped,false,
            `${surface.id} ${viewport.id} ${theme.id} company badge has hidden overflow`);
        }
        if(layout.themeLabelDisplay){
          assert.equal(layout.themeLabelDisplay,'none',`${surface.id} ${viewport.id} topbar appearance label must not overlap adjacent controls`);
        }
        if(surface.id==='project-admin'&&layout.systemHeadingColor){
          assert.equal(layout.systemHeadingColor,'rgb(255, 255, 255)',`${viewport.id} project admin system heading lost contrast`);
          assert.equal(layout.systemRowStrongColor,'rgb(255, 255, 255)',`${viewport.id} project admin status values lost contrast`);
          if(viewport.id==='mobile')assert.ok(layout.projectTopbarHeight<=150,`project admin mobile topbar is too tall: ${layout.projectTopbarHeight}px`);
        }
        if(surface.id==='bokslut'){
          const close=await page.evaluate(()=>{
            const root=document.querySelector('#lt-bokslut-app');
            const grid=document.querySelector('.bokslut-grid');
            const cards=[...document.querySelectorAll('.bokslut-grid .bokslut-card')];
            const links=cards.map(card=>card.querySelector('a'));
            return {
              visible:!!root&&!root.hidden,
              columns:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').length:0,
              cards:cards.length,
              notVerified:cards.every(card=>card.innerText.includes('Inte verifierad')),
              demoLinks:links.every(link=>link.href.includes('demo=1')),
              minLinkHeight:Math.min(...links.map(link=>link.getBoundingClientRect().height)),
              overflow:document.documentElement.scrollWidth>innerWidth+2
            };
          });
          assert.equal(close.visible,true,'bokslut must be visible in explicit demo mode');
          assert.equal(close.cards,6,'bokslut must show all six review areas');
          assert.equal(close.notVerified,true,'bokslut must never claim automatic reconciliation');
          assert.equal(close.demoLinks,true,'book-close destinations must stay in demo mode');
          assert.equal(close.overflow,false,'bokslut has horizontal overflow');
          assert.ok(close.minLinkHeight>=44,'bokslut links must be finger-friendly');
          if(viewport.id==='mobile')assert.equal(close.columns,1,'bokslut must stack cards on phones');
        }
        if(surface.id==='invoices'&&viewport.id==='mobile'){
          assert.equal(layout.invoiceMobileCard,true,'mobile customer invoices must render as labeled stacked rows');
        }
        if(surface.id==='legacy'){
          assert.equal(layout.legacyToastVisible,false,`${viewport.id} legacy demo notice must not cover working content on initial load`);
        }
        if(layout.sharedUserDisplay){
          assert.ok(['flex','inline-flex'].includes(layout.sharedUserDisplay),`${surface.id} ${viewport.id} shared account trigger lost its flex layout: ${layout.sharedUserDisplay}`);
          assert.equal(layout.sharedUserBorderTopWidth,'0px',`${surface.id} ${viewport.id} shared account trigger leaked a native button border`);
          assert.equal(layout.sharedAvatarWidth,'34px',`${surface.id} ${viewport.id} shared account avatar has the wrong size`);
        }
        if(surface.id==='dashboard'&&layout.dashboardHeroGap!==null){
          assert.ok(layout.dashboardHeroGap>=8,`${viewport.id} dashboard guide action overlaps the intro copy (gap ${layout.dashboardHeroGap}px)`);
        }
        if(surface.id==='cms'){
          assert.ok(Number.parseFloat(layout.cmsFormPaddingTop)>=16,`${viewport.id} CMS form card lost its internal padding`);
          assert.ok(Number.parseFloat(layout.cmsFormPaddingLeft)>=16,`${viewport.id} CMS form card lost its horizontal padding`);
          assert.ok(Number.parseFloat(layout.cmsSidePaddingTop)>=16,`${viewport.id} CMS side cards lost their internal padding`);
        }
        if(surface.id==='legacy'&&layout.supplierDividerBorderTopColor){
          const expectedDivider=theme.id==='dark'?'rgb(68, 76, 86)':'rgb(229, 229, 229)';
          assert.equal(layout.supplierDividerBorderTopColor,expectedDivider,`${viewport.id} ${theme.id} legacy supplier alert leaked an incorrect divider color`);
        }
        if(surface.id==='suppliers'&&theme.id==='dark'){
          assert.equal(layout.supplierInputColor,'rgb(255, 255, 255)',`${viewport.id} supplier input text lost dark-mode contrast`);
          assert.equal(layout.supplierInputTextFill,'rgb(255, 255, 255)',`${viewport.id} supplier input text fill lost dark-mode contrast`);
          assert.equal(layout.supplierPrimaryColor,'rgb(255, 255, 255)',`${viewport.id} supplier primary button must be light text on a dark surface`);
        }

        /* A visible appearance switch must actually change theme and change back. */
        if(viewport.id==='desktop'&&['dashboard','project-admin','website'].includes(surface.id)){
          const selector=surface.id==='project-admin'
            ? '[data-action="toggle-theme"]'
            : '.lt-theme-toggle-topbar,.lt-theme-toggle-floating';
          const switcher=page.locator(selector).first();
          await switcher.waitFor({state:'visible'});
          const opposite=theme.id==='dark'?'light':'dark';
          await switcher.click();
          await page.waitForFunction(expected=>document.documentElement.dataset.ltTheme===expected,opposite);
          if(surface.id==='project-admin'){
            assert.equal(await page.locator('html').getAttribute('data-operator-theme'),opposite,
              'operator theme must stay synchronized with the shared theme');
          }
          await switcher.click();
          await page.waitForFunction(expected=>document.documentElement.dataset.ltTheme===expected,theme.id);
          if(surface.id==='project-admin'){
            assert.equal(await page.locator('html').getAttribute('data-operator-theme'),theme.id);
          }
        }

        /* Open a REAL popup and measure its label against its own surface.
           Screenshots of closed pages never exercised this state. */
        if(surface.id==='dashboard'){
          const trigger=page.locator('.shared-user-trigger').first();
          await trigger.waitFor({state:'visible'});
          await trigger.click();
          const popup=page.locator('.shared-user-dropdown').first();
          await popup.waitFor({state:'visible'});
          await page.waitForTimeout(150);
          const popupContrast=await page.evaluate(()=>{
            const menu=document.querySelector('.shared-user-dropdown');
            const item=menu?.querySelector('a,button');
            if(!menu||!item)return null;
            const read=v=>{
              const raw=String(v||'').trim().toLowerCase();
              let channels;
              if(raw.startsWith('rgb(')||raw.startsWith('rgba(')){
                const inner=raw.slice(raw.indexOf('(')+1,raw.indexOf(')'));
                channels=inner.replace(/,/g,' ').split(/\s+/).filter(Boolean).slice(0,3)
                  .map(x=>Number(x)/255);
              }else if(raw.startsWith('color(srgb ')){
                channels=raw.slice('color(srgb '.length,raw.indexOf(')')).trim()
                  .split(/\s+/).slice(0,3).map(Number);
              }else{return null;}
              if(channels.length!==3||channels.some(x=>!Number.isFinite(x)))return null;
              const c=channels.map(v=>{
                const n=Math.max(0,Math.min(1,v));
                return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;
              });
              return .2126*c[0]+.7152*c[1]+.0722*c[2];
            };
            const fg=getComputedStyle(item).color,bg=getComputedStyle(menu).backgroundColor;
            const a=read(fg),b=read(bg);
            return a===null||b===null?null:{ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),fg,bg};
          });
          assert.ok(popupContrast&&popupContrast.ratio>=4.5,
            `${viewport.id} ${theme.id} user dropdown is not readable: ${JSON.stringify(popupContrast)}`);
          await page.screenshot({path:path.join(out,`user-dropdown-${viewport.id}-${theme.id}.png`),fullPage:false});
          await trigger.click();
          await popup.waitFor({state:'hidden'});
        }

        const file=`visual-${surface.id}-${viewport.id}-${theme.id}.png`;
        await page.screenshot({path:path.join(out,file),fullPage:false});
        checks.push({surface:surface.id,viewport:viewport.id,theme:theme.id,...layout,screenshot:file});
        await page.close();
        }
        await context.close();
      }
    }

    if(layoutIssues.length)throw new Error(`Visual layout issues:\n${layoutIssues.join('\n')}`);
    fs.writeFileSync(path.join(out,'visual-design-results.json'),JSON.stringify({ok:true,checks,errors},null,2));
    console.log(`Visual design smoke passed: ${checks.length} rendered viewport/theme checks (including website dark mode).`);
  }catch(error){
    errors.push(error.stack||String(error));
    fs.writeFileSync(path.join(out,'visual-design-results.json'),JSON.stringify({ok:false,checks,errors},null,2));
    throw error;
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
