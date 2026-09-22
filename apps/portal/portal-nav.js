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

  // UI polish: all pictograms below are paths from Iconoir (MIT), never mixed with another icon set.
  const ICONOIR=Object.freeze({
    home:'<path d="M9 21H7C4.79086 21 3 19.2091 3 17V10.7076C3 9.30887 3.73061 8.01175 4.92679 7.28679L9.92679 4.25649C11.2011 3.48421 12.7989 3.48421 14.0732 4.25649L19.0732 7.28679C20.2694 8.01175 21 9.30887 21 10.7076V17C21 19.2091 19.2091 21 17 21H15M9 21V17C9 15.3431 10.3431 14 12 14C13.6569 14 15 15.3431 15 17V21M9 21H15" />',
    page:'<path d="M4 21.4V2.6C4 2.26863 4.26863 2 4.6 2H16.2515C16.4106 2 16.5632 2.06321 16.6757 2.17574L19.8243 5.32426C19.9368 5.43679 20 5.5894 20 5.74853V21.4C20 21.7314 19.7314 22 19.4 22H4.6C4.26863 22 4 21.7314 4 21.4Z"/><path d="M8 10H16M8 18H16M8 14H12M16 2V5.4C16 5.73137 16.2686 6 16.6 6H20"/>',
    wallet:'<path d="M19 20H5C3.89543 20 3 19.1046 3 18V9C3 7.89543 3.89543 7 5 7H19C20.1046 7 21 7.89543 21 9V18C21 19.1046 20.1046 20 19 20Z"/><path d="M18 7V5.60322C18 4.28916 16.7544 3.33217 15.4847 3.67075L4.48467 6.60409C3.60917 6.83756 3 7.63046 3 8.53656V9"/><path d="M16.5 14.25V13.75"/>',
    card:'<path d="M22 9V17C22 18.1046 21.1046 19 20 19H4C2.89543 19 2 18.1046 2 17V7C2 5.89543 2.89543 5 4 5H20C21.1046 5 22 5.89543 22 7V9ZM22 9H6"/>',
    bank:'<path d="M3 9.5L12 4L21 9.5M5 20H19M10 9H14M6 17V12M10 17V12M14 17V12M18 17V12"/>',
    book:'<path d="M4 19V5C4 3.89543 4.89543 3 6 3H19.4C19.7314 3 20 3.26863 20 3.6V16.7143M6 17H20M6 21H20M6 21C4.89543 21 4 20.1046 4 19C4 17.8954 4.89543 17 6 17M9 7H15"/>',
    stats:'<path d="M10 9H6M15.5 11C14.1193 11 13 9.88071 13 8.5C13 7.11929 14.1193 6 15.5 6C16.8807 6 18 7.11929 18 8.5C18 9.88071 16.8807 11 15.5 11ZM6 6H9M18 18L13.5 15L11 17L6 13M3 20.4V3.6C3 3.26863 3.26863 3 3.6 3H20.4C20.7314 3 21 3.26863 21 3.6V20.4C21 20.7314 20.7314 21 20.4 21H3.6C3.26863 21 3 20.7314 3 20.4Z"/>',
    group:'<path d="M1 20V19C1 15.134 4.13401 12 8 12C11.866 12 15 15.134 15 19V20M13 14C13 11.2386 15.2386 9 18 9C20.7614 9 23 11.2386 23 14V14.5M8 12C10.2091 12 12 10.2091 12 8C12 5.79086 10.2091 4 8 4C5.79086 4 4 5.79086 4 8C4 10.2091 5.79086 12 8 12ZM18 9C19.6569 9 21 7.65685 21 6C21 4.34315 19.6569 3 18 3C16.3431 3 15 4.34315 15 6C15 7.65685 16.3431 9 18 9Z"/>',
    package:'<path d="M20 6V18C20 19.1046 19.1046 20 18 20H6C4.89543 20 4 19.1046 4 18V6C4 4.89543 4.89543 4 6 4H18C19.1045 4 20 4.89543 20 6ZM12 9V4"/>',
    settings:'<path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"/><path d="M19.6224 10.3954L18.5247 7.7448L20 6L18 4L16.2647 5.48295L13.5578 4.36974L12.9353 2H10.981L10.3491 4.40113L7.70441 5.51596L6 4L4 6L5.45337 7.78885L4.3725 10.4463L2 11V13L4.40111 13.6555L5.51575 16.2997L4 18L6 20L7.79116 18.5403L10.397 19.6123L11 22H13L13.6045 19.6132L16.2551 18.5155L18 20L20 18L18.5159 16.2494L19.6139 13.598L22 12.9772V11L19.6224 10.3954Z"/>',
    help:'<path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22ZM9 9C9 5.49997 14.5 5.5 14.5 9C14.5 11.5 12 10.9999 12 13.9999M12 18.01L12.01 17.9989"/>',
    shield:'<path d="M8.5 11.5L11.5 14.5L16.5 9.5M5 18L3.13036 4.91253C3.05646 4.39524 3.39389 3.91247 3.90398 3.79912L11.5661 2.09641C11.8519 2.03291 12.1481 2.03291 12.4339 2.09641L20.096 3.79912C20.6061 3.91247 20.9435 4.39524 20.8696 4.91252L19 18C18.9293 18.495 18.5 21.5 12 21.5C5.5 21.5 5.07071 18.495 5 18Z"/>',
    database:'<path d="M5 12V18C5 18 5 21 12 21C19 21 19 18 19 18V12M5 6V12C5 12 5 15 12 15C19 15 19 12 19 12V6M12 3C19 3 19 6 19 6C19 6 19 9 12 9C5 9 5 6 5 6C5 6 5 3 12 3Z"/>',
    profile:'<path d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2ZM4.271 18.3457C4.271 18.3457 6.5 15.5 12 15.5C17.5 15.5 19.7291 18.3457 19.7291 18.3457M12 12C13.6569 12 15 10.6569 15 9C15 7.34315 13.6569 6 12 6C10.3431 6 9 7.34315 9 9C9 10.6569 10.3431 12 12 12Z"/>',
    logout:'<path d="M12 12H19M19 12L16 15M19 12L16 9M19 6V5C19 3.89543 18.1046 3 17 3H7C5.89543 3 5 3.89543 5 5V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V18"/>',
    check:'<path d="M5 13L9 17L19 7"/>',
    plus:'<path d="M6 12H18M12 6V18"/>',
    search:'<path d="M17 17L21 21M3 11C3 15.4183 6.58172 19 11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11Z"/>',
    refresh:'<path d="M21.8883 13.5C21.1645 18.3113 17.013 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C16.1006 2 19.6248 4.46819 21.1679 8M17 8H21.4C21.7314 8 22 7.73137 22 7.4V3"/>',
    download:'<path d="M6 20H18M12 4V16M12 16L15.5 12.5M12 16L8.5 12.5"/>',
    edit:'<path d="M14.3632 5.65156L15.8431 4.17157C16.6242 3.39052 17.8905 3.39052 18.6716 4.17157L20.0858 5.58579C20.8668 6.36683 20.8668 7.63316 20.0858 8.41421L18.6058 9.8942M14.3632 5.65156L4.74749 15.2672C4.41542 15.5993 4.21079 16.0376 4.16947 16.5054L3.92738 19.2459C3.87261 19.8659 4.39148 20.3848 5.0115 20.33L7.75191 20.0879C8.21972 20.0466 8.65806 19.8419 8.99013 19.5099L18.6058 9.8942M14.3632 5.65156L18.6058 9.8942"/>',
    xmark:'<path d="M6.75827 17.2426L12.0009 12M17.2435 6.75736L12.0009 12M12.0009 12L6.75827 6.75736M12.0009 12L17.2435 17.2426"/>',
    trash:'<path d="M20 9L18.005 20.3463C17.8369 21.3026 17.0062 22 16.0353 22H7.96474C6.99379 22 6.1631 21.3026 5.99496 20.3463L4 9M21 6H15.375M3 6H8.625M8.625 6V4C8.625 2.89543 9.52043 2 10.625 2H13.375C14.4796 2 15.375 2.89543 15.375 4V6M8.625 6H15.375"/>',
    key:'<path d="M10 12C10 14.2091 8.20914 16 6 16C3.79086 16 2 14.2091 2 12C2 9.79086 3.79086 8 6 8C8.20914 8 10 9.79086 10 12ZM10 12H22V15M18 12V15"/>',
    openWindow:'<path d="M21 3H15M21 3L12 12M21 3V9M21 13V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H11"/>',
    arrowLeft:'<path d="M21 12H3M3 12L11.5 3.5M3 12L11.5 20.5"/>'
  });
  const NAV_ICONS=Object.freeze({
    overview:'home',invoices:'page',receivables:'wallet','receivables-details':'stats',payables:'page',payments:'card',bank:'bank',
    automation:'settings',accounting:'book',reports:'stats',accounts:'book',payroll:'wallet',money:'card',journal:'book','res-tools':'database',
    batches:'package',inbox:'page',customers:'group',suppliers:'group',inventory:'package',website:'page',documents:'page',decisions:'shield',
    modules:'package',project:'stats',content:'page',audit:'shield',settings:'settings',uat:'shield',legacy:'database',assistant:'help'
  });
  function iconoir(name,label=''){
    const span=document.createElement('span');span.className='ui-icon';span.setAttribute('aria-hidden','true');
    span.innerHTML='<svg viewBox="0 0 24 24" fill="none" focusable="false" aria-label="'+String(label).replace(/"/g,'')+'">'+(ICONOIR[name]||ICONOIR.page)+'</svg>';
    return span;
  }
  function addIcon(element,name){
    if(!element||element.querySelector(':scope > .ui-icon'))return;
    element.prepend(iconoir(name));
    element.classList.add('ui-with-icon');
  }
  function semanticButtonIcon(element){
    const text=String(element.textContent||'').trim().toLowerCase();
    if(/logga ut/.test(text))return'logout';
    if(/stäng|avbryt/.test(text))return'xmark';
    if(/ta bort|radera/.test(text))return'trash';
    if(/lösenord|mfa|nyckel/.test(text))return'key';
    if(/tillbaka|alla företag/.test(text))return'arrowLeft';
    if(/spara|godkänn|verifiera|registrera|bokför|skapa och|attestera/.test(text))return'check';
    if(/skapa|lägg till|ny /.test(text))return'plus';
    if(/sök|filtrera|hitta/.test(text))return'search';
    if(/uppdatera|försök igen|återställ|beräkna/.test(text))return'refresh';
    if(/ladda ner|ladda ned|exportera/.test(text))return'download';
    if(/öppna|visa /.test(text))return'openWindow';
    if(/redigera|ändra/.test(text))return'edit';
    if(/profil|konto|inloggning/.test(text))return'profile';
    return'';
  }
  function decorateUi(){
    document.querySelectorAll('[data-nav-id]').forEach(link=>addIcon(link,NAV_ICONS[link.dataset.navId]||'page'));
    document.querySelectorAll('.shared-user-dropdown a,.shared-user-dropdown button').forEach(el=>addIcon(el,semanticButtonIcon(el)||'profile'));
    document.querySelectorAll('.shared-foot>a').forEach(el=>addIcon(el,'home'));
    document.querySelectorAll('.button,button[data-action],button[data-journal-action],.nav-item,.module-card a,.callout a').forEach(button=>{const name=semanticButtonIcon(button);if(name)addIcon(button,name);});
  }
  function animateTap(element){
    if(!element||element.disabled||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    element.animate(
      [{transform:'translateY(0) scale(1)'},{transform:'translateY(1px) scale(.97)'},{transform:'translateY(0) scale(1)'}],
      {duration:220,easing:'cubic-bezier(.2,.8,.2,1)'}
    );
  }
  document.addEventListener('pointerdown',event=>{
    const target=event.target.closest('.button,.shared-links a,.module-card,.task-card,.sales-panel,.sales-metric,.invoice-section>summary,.shared-user-trigger,.shared-user-dropdown a,.shared-user-dropdown button,.nav-item,.clickable-card');
    if(target)animateTap(target);
  },{passive:true});
  document.addEventListener('click',event=>{
    const target=event.target.closest('.button,button[data-action]');
    if(!target||target.disabled)return;
    target.classList.remove('ui-action-confirmed');
    void target.offsetWidth;
    target.classList.add('ui-action-confirmed');
    setTimeout(()=>target.classList.remove('ui-action-confirmed'),420);
  });

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
      wrap.append(button,menu);topbar.append(wrap);decorateUi();
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
    sidebar.replaceChildren(brand,info,nav,foot);decorateUi();
    try{sidebar.scrollTop=Number(sessionStorage.getItem(key+':scroll')||0)}catch{}
    if(!sidebar.dataset.scrollBound){sidebar.addEventListener('scroll',()=>{try{sessionStorage.setItem(key+':scroll',String(sidebar.scrollTop))}catch{}});sidebar.dataset.scrollBound='1';}
  }
  let pending=false;
  function schedule(){if(pending)return;pending=true;queueMicrotask(async()=>{pending=false;await Promise.all([mount(),mountUserMenu()]);decorateUi();});}
  // Renders can replace the entire sidebar. Stay subscribed instead of disconnecting after boot.
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  addEventListener('hashchange',schedule);
  addEventListener('pageshow',()=>{schedule();ensureFreshRuntime();});
  addEventListener('focus',ensureFreshRuntime);
  addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')ensureFreshRuntime();});
  setInterval(ensureFreshRuntime,30000);
  root.RollandsNavigation={groups,mount,mountUserMenu,href};ensureFreshRuntime();mount();mountUserMenu();decorateUi();
})(globalThis);
