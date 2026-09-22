'use strict';
(function(root){
  const groups=[
    {id:'workspace',label:'Arbetsyta',items:[['overview','Översikt','portal/dashboard.html']]},
    {id:'economy',label:'Ekonomi',items:[
      ['invoices','Kundfakturor','portal/invoices.html'],['receivables','Kundreskontra','portal/receivables.html'],
      ['receivables-details','Reskontradetaljer & påminnelser','portal/index.html'],
      ['payables','Leverantörsfakturor & reskontra','portal/payables.html'],['payments','Betalningar','portal/payments.html'],['bank','Bank & avstämning','portal/bank.html'],
      ['automation','Automationskö','portal/automation.html'],['accounting','Bokföring','portal/accounting.html'],
      ['reports','Rapporter','portal/reports.html'],['accounts','Kontoplan & intäktskonton','portal/accounts.html'],
      ['payroll','Lön & lönejournal','portal/payroll.html'],['money','Öreskalkylator','admin/#/money'],
      ['journal','Verifikationer & periodtest','admin/#/journal'],
      ['res-tools','Reskontraverktyg (äldre demo)','legacy/#/res-tools'],['batches','Buntar (äldre demo)','legacy/#/batches'],
      ['inbox','Fakturainkorg (äldre demo)','legacy/#/inbox']
    ]},
    {id:'operations',label:'Register & verksamhet',items:[['customers','Kunder','portal/customers.html'],['suppliers','Leverantörer','portal/suppliers.html'],['inventory','Lager & svinn','portal/inventory.html']]},
    {id:'administration',label:'Systemadministration',items:[
      ['website','Webbplats & innehåll','portal/website.html'],['documents','Dokument','portal/documents.html'],
      ['decisions','Verksamhetsbeslut','admin/#/decisions'],
      ['modules','Systemmoduler','admin/#/modules'],['project','Projektöversikt','admin/#/overview'],
      ['content','Innehållsförhandsvisning','admin/#/content'],
      ['audit','Revisionslogg (äldre demo)','legacy/#/audit'],['settings','Inställningar (äldre demo)','legacy/#/settings']
    ]},
    {id:'help',label:'Test & hjälp',items:[['uat','Testa systemet','portal/uat.html'],['legacy','Tidigare system','legacy/#/overview'],['assistant','Hjälp & chatbot (äldre demo)','legacy/#/assistant']]}
  ];
  const demoOnlyIds=new Set(['money','journal','res-tools','batches','inbox','audit','settings','legacy','assistant','decisions','modules','project','content','uat','receivables-details']);
  const requiredPermission=Object.freeze({
    invoices:'customer-invoice.view',receivables:'customer-invoice.view',payables:'supplier-invoice.view',payments:'payment.view',bank:'bank.view',automation:'accounting.view',accounting:'accounting.view',reports:'reports.view',accounts:'accounting.view',payroll:'payroll.view',customers:'customer-invoice.view',suppliers:'supplier.view',inventory:'inventory.view',website:'website.manage',documents:'documents.view'
  });
  function visibleGroups({authenticated=false,demo=false,permissions=[]}={}){
    if(demo)return groups;
    if(!authenticated)return [];
    const allowed=new Set(Array.isArray(permissions)?permissions:[]);
    return groups.map(group=>({...group,items:group.items.filter(([id])=>!demoOnlyIds.has(id)&&(!requiredPermission[id]||allowed.has(requiredPermission[id]))).map(item=>item[0]==='receivables'?[item[0],item[1],'portal/index.html']:item)})).filter(group=>group.items.length);
  }
  if(typeof module==='object'&&module.exports){module.exports={groups,visibleGroups};return;}
  if(root.RollandsNavigation)return;
  const base=new URL('../',document.currentScript.src);
  const demo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
  const key='rollands-navigation-v2:'+base.pathname;
  const runtimeKey='rollands-runtime-id:'+base.pathname;
  let runtimeCheckInFlight=false;
  async function ensureFreshRuntime(){
    if(demo||runtimeCheckInFlight)return false;
    runtimeCheckInFlight=true;
    try{
      const response=await fetch('/_runtime-version',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)return false;
      const data=await response.json();
      const runtimeId=String(data.runtimeId||'');
      if(!runtimeId)return false;
      const previous=sessionStorage.getItem(runtimeKey);
      sessionStorage.setItem(runtimeKey,runtimeId);
      if(previous&&previous!==runtimeId){location.reload();return true;}
    }catch{}
    finally{runtimeCheckInFlight=false;}
    return false;
  }
  function read(){try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return {}}}
  function persist(value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
  function href(path){const u=new URL(path,base);if(demo&&path!=='./')u.searchParams.set('demo','1');return u.href;}
  const normalizePath=path=>path.replace(/\/index\.html$/,'/');
  function active(path){const u=new URL(path,base);return normalizePath(u.pathname)===normalizePath(location.pathname)&&(!u.hash||u.hash===(location.hash||'#/overview'));}
  async function navigationContext(){
    if(demo)return{groups,session:null};
    try{
      const response=await fetch('/api/v1/session',{credentials:'same-origin',cache:'no-store'});
      const session=response.ok?await response.json():null;
      return{groups:visibleGroups({authenticated:session?.authenticated===true,permissions:session?.permissions||[]}),session};
    }catch{return{groups:[],session:null}}
  }
  function avatarInitials(name){return String(name||'Användare').trim().split(/\s+/).filter(Boolean).map(part=>part[0]).join('').slice(0,2).toUpperCase()||'AN';}
  async function mountUserMenu(){
    const topbar=document.querySelector('.topbar');if(!topbar)return;
    const currentMenus=[...topbar.querySelectorAll('.shared-user-menu')];
    if(currentMenus.length){
      currentMenus.slice(1).forEach(menu=>menu.remove());
      topbar.querySelectorAll('.user-chip').forEach(chip=>chip.remove());
      return;
    }
    if(topbar.dataset.sharedUserMenuMounting==='1')return;
    topbar.dataset.sharedUserMenuMounting='1';
    try{
      const context=await navigationContext();
      if(!topbar.isConnected||document.querySelector('.topbar')!==topbar)return;
      const afterWaitMenus=[...topbar.querySelectorAll('.shared-user-menu')];
      if(afterWaitMenus.length){
        afterWaitMenus.slice(1).forEach(menu=>menu.remove());
        topbar.querySelectorAll('.user-chip').forEach(chip=>chip.remove());
        return;
      }
      topbar.querySelectorAll('.user-chip').forEach(chip=>chip.remove());
      const wrap=document.createElement('div');wrap.className='shared-user-menu';
      const button=document.createElement('button');button.type='button';button.className='shared-user-trigger';button.setAttribute('aria-haspopup','true');button.setAttribute('aria-expanded','false');
      const displayName=demo?'Demoanvändare':String(context.session?.user?.displayName||context.session?.user?.username||'Användare');
      button.setAttribute('aria-label',`Öppna användarmenyn för ${displayName}`);
      const avatar=document.createElement('span');avatar.className='shared-user-avatar';avatar.textContent=avatarInitials(displayName);
      const label=document.createElement('span');label.className='shared-user-label';
      const name=document.createElement('strong');name.textContent=displayName;
      const company=document.createElement('small');company.textContent=demo?'Demoläge':String(context.session?.company?.name||'Företaget');
      label.append(name,company);
      const caret=document.createElement('span');caret.className='shared-user-caret';caret.textContent='▾';caret.setAttribute('aria-hidden','true');
      button.append(avatar,label,caret);
      const menu=document.createElement('div');menu.className='shared-user-dropdown';menu.hidden=true;
      const profile=document.createElement('a');profile.href=href('portal/profile.html');profile.textContent='Min profil & inloggning';menu.append(profile);
      if(demo){
        const leave=document.createElement('a');leave.href=href('./');leave.textContent='Lämna demon';menu.append(leave);
      }else if(context.session?.authenticated===true){
        const logout=document.createElement('button');logout.type='button';logout.textContent='Logga ut';
        logout.addEventListener('click',async()=>{
          logout.disabled=true;
          const csrf=sessionStorage.getItem('rollands-csrf')||'';
          try{
            const response=await fetch('/api/v1/auth/logout',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})}});
            if(!response.ok)throw new Error('Utloggningen misslyckades.');
            sessionStorage.removeItem('rollands-csrf');
            location.href=href('portal/index.html');
          }catch{
            logout.disabled=false;
            logout.textContent='Försök logga ut igen';
          }
        });
        menu.append(logout);
      }
      button.addEventListener('click',()=>{const open=menu.hidden;menu.hidden=!open;button.setAttribute('aria-expanded',String(open));});
      document.addEventListener('click',event=>{if(!wrap.contains(event.target)){menu.hidden=true;button.setAttribute('aria-expanded','false');}});
      wrap.append(button,menu);topbar.append(wrap);
    }finally{
      delete topbar.dataset.sharedUserMenuMounting;
    }
  }
  async function mount(){
    const sidebar=document.querySelector('.sidebar');if(!sidebar)return;
    const route=location.pathname+location.hash;
    if(sidebar.dataset.sharedRoute===route&&sidebar.querySelector('.shared-navigation'))return;
    sidebar.classList.add('shared-sidebar');
    const workspace=sidebar.parentElement;workspace.classList.add('shared-workspace-shell');
    const workspaceMain=[...workspace.children].find(child=>child!==sidebar);if(workspaceMain)workspaceMain.classList.add('shared-workspace-main');
    sidebar.setAttribute('aria-label','Huvudmeny');sidebar.dataset.sharedRoute=route;
    const saved=read();
    const context=await navigationContext();const allowedGroups=context.groups;
    const brand=document.createElement('a');brand.className='shared-brand';brand.href=href('portal/dashboard.html');
    const companyName=demo?'Rollands':String(context.session?.company?.name||'Företaget');
    const brandName=document.createElement('strong');brandName.textContent=companyName;
    const brandPlatform=document.createElement('small');brandPlatform.textContent='LT STUDIO';brand.append(brandName,brandPlatform);
    const info=document.createElement('p');info.className='shared-company';info.textContent=demo?'Demoföretag · fiktiv data':companyName+' · skyddad företagsportal';
    const nav=document.createElement('nav');nav.className='shared-navigation';nav.setAttribute('aria-label','Systemets alla verktyg');
    for(const group of allowedGroups){
      const details=document.createElement('details');details.dataset.navGroup=group.id;
      details.open=group.items.some(item=>active(item[2]))||saved[group.id]!==false;
      const summary=document.createElement('summary');summary.textContent=group.label;details.append(summary);
      const links=document.createElement('div');links.className='shared-links';
      for(const [id,label,path] of group.items){
        const a=document.createElement('a');a.dataset.navId=id;a.textContent=label;a.href=href(path);
        if(active(path)){a.setAttribute('aria-current','page');a.classList.add('active');}links.append(a);
      }
      details.append(links);nav.append(details);
      details.addEventListener('toggle',()=>{const s=read();s[group.id]=details.open;persist(s);});
    }
    const foot=document.createElement('div');foot.className='shared-foot';
    const home=document.createElement('a');home.href=href(demo?'./':'portal/dashboard.html');home.textContent=demo?'Visa företagets hemsida':'Till arbetsöversikten';foot.append(home);
    const note=document.createElement('p');note.textContent=demo?'Äldre referensverktyg har separat demodata.':'Menyn följer din roll. Servern kontrollerar varje skyddad åtgärd oavsett vad som visas här.';foot.append(note);
    sidebar.replaceChildren(brand,info,nav,foot);
    try{sidebar.scrollTop=Number(sessionStorage.getItem(key+':scroll')||0)}catch{}
    if(!sidebar.dataset.scrollBound){sidebar.addEventListener('scroll',()=>{try{sessionStorage.setItem(key+':scroll',String(sidebar.scrollTop))}catch{}});sidebar.dataset.scrollBound='1';}
  }
  let pending=false;
  function schedule(){if(pending)return;pending=true;queueMicrotask(async()=>{pending=false;await Promise.all([mount(),mountUserMenu()]);});}
  // Renders can replace the entire sidebar. Stay subscribed instead of disconnecting after boot.
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  addEventListener('hashchange',schedule);
  addEventListener('pageshow',()=>{schedule();ensureFreshRuntime();});
  addEventListener('focus',ensureFreshRuntime);
  addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')ensureFreshRuntime();});
  setInterval(ensureFreshRuntime,30000);
  root.RollandsNavigation={groups,mount,mountUserMenu,href};ensureFreshRuntime();mount();mountUserMenu();
})(globalThis);
