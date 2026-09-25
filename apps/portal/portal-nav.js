'use strict';
(function(root){
  const LT_STUDIO_FAVICON='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAADxElEQVR42p1WPU8jSRCt193jmTHDWQQkOL8VXIqERACChD+AWJ2lY1PQbcAv2SPZk8iIF6M9ICQAERERHSeRO0HaE8OJFXg8XXVBj2fGX9hsBZbH7qnqqnrvVYGZaawJEWgiGzip3vyOvHp44B4jA4jI8Hcw+h7DTA36dUUDUMQoe5EBp/Ja4P4AzKy1BsDMAIZXQHof8VoSqu/uxpi7u7u1tbXz83MA1tohMTCuATIQIE1TpZTW+uDgYHV19fLyMo7jibra4x+DoFDu7p7ntVqtrffvd3Z2vn9/0lobY4p7yQRIK772nDYiAuD4+Hhvb6/VatVqNSKy1iqlxiOn94BzDaCchFFKXV1dbW5uBkFQq9XSNNVaE5GwvIJgpZSI9DNEJMMFCgIZIvr27zciCsMw6XSA7IyMqAszM7O1lgDqenSAzt8kkIhorUEwRGS0yXBZYtgQEnRB7FKcxJjZ5Nk5K7qvVF8ebK025vr6+ubmxvd9ZhYSEupLwj2+vLysr6/Pz8+bIjUi154BeAgR0jT1PO/s7KzRaDw9PY1pOSAinz79sbCwYMoYEyH08ghA7v3r178ajV8BzMzMMDOhC/wBCBijHx//m5qaIiJThjFALkS5B877ly9H29u/aa2M8ZIkAdDDqIIr4uqUpqkI5wFKNy4SQs7Bo6OjDx+2K5WKNpotG6Nd5QbEKgOuNlpr7UTTlOVQSNB91Fq5En3+/OfHj78TKEmS8dMJBILW2lrbbid9GQClVNM0Zeb7+/tm82h5eTmKpgkkDjkEBQDKFSEvkEvI6WOSJO/e/ZwFcH902ZdlHUWRUqper19cXNCPWsYD10+RYpoopf6+va3X6+12u2CoCACllLXW9/2FhV/yFgCQLmdyWmScEJGTkxMiqtV+iqKpKIrcZxAE1Wo1DEPf9/3AD4IgDMIg8J0a7u7uikgn7VhrecDKPxYlktKIEhLjmazbRmfoEjHGj+N4a2trf3/fKS7GKW1JkzMEdfGcq6kQiTCz53lxHG9sbBweHlYqFQDDvUtXsaUbwBULirrfCQAUypPA88zDw8PKykqz2QzDME3TnAQ9siilQQ3KUMTMIiIsQ2EuIsaYOH5cWlpqNptRFFlry4LaQzf0r1KGiKrVqkNOGIYiAqVIMpFTABE9Pz8vLi6enp7Ozs7mE6lnwoxev8DMSafzz+2t7/thGHYlSfJ7AGi323Nzc9PT09ayUnjT6jhi/xnBmnLdy/PrFSt6MFTWSUqjvO+vsvfRYTDRdv1jm/ak23Xf7oU3rGJE9D8ZRgrgk8hmDQAAAABJRU5ErkJggg==';
  const groups=[
    {id:'workspace',label:'Arbetsyta',items:[['overview','Översikt','portal/dashboard.html']]},
    {id:'economy',label:'Ekonomi',items:[
      ['invoices','Kundfakturor','portal/invoices.html'],['receivables','Kundreskontra','portal/receivables.html'],
      ['receivables-details','Reskontradetaljer & påminnelser','portal/index.html'],
      ['payables','Leverantörsfakturor & reskontra','portal/payables.html'],['payments','Betalningar','portal/payments.html'],['bank','Bank & avstämning','portal/bank.html'],
      ['automation','Automationskö','portal/automation.html'],['accounting','Bokföring','portal/accounting.html'],
      ['reports','Rapporter','portal/reports.html'],['accounts','Kontoplan & intäktskonton','portal/accounts.html'],
      ['payroll','Lön & lönejournal','portal/payroll.html'],['money','Öreskalkylator','admin/#/money'],

    ]},
    {id:'operations',label:'Register & verksamhet',items:[['customers','Kunder','portal/customers.html'],['suppliers','Leverantörer','portal/suppliers.html'],['inventory','Lager & svinn','portal/inventory.html']]},
    {id:'administration',label:'Systemadministration',items:[
      ['company-settings','Företagsinställningar','portal/company-settings.html'],['website','Webbplats & innehåll','portal/website.html'],['documents','Dokument','portal/documents.html'],
      ['decisions','Verksamhetsbeslut','admin/#/decisions'],
      ['modules','Systemmoduler','admin/#/modules'],['project','Projektöversikt','admin/#/overview'],
      ['content','Innehållsförhandsvisning','admin/#/content'],

    ]},
    {id:'help',label:'Test & hjälp',items:[['uat','Testa systemet','portal/uat.html']]}
  ];
  const demoOnlyIds=new Set(['money','journal','res-tools','batches','inbox','audit','settings','legacy','assistant','decisions','modules','project','content','uat','receivables-details']);
  const requiredPermission=Object.freeze({
    invoices:'customer-invoice.view',receivables:'customer-invoice.view',payables:'supplier-invoice.view',payments:'payment.view',bank:'bank.view',automation:'accounting.view',accounting:'accounting.view',reports:'reports.view',accounts:'accounting.view',payroll:'payroll.view',customers:'customer-invoice.view',suppliers:'supplier.view',inventory:'inventory.view','company-settings':'platform.settings.manage',website:'website.manage',documents:'documents.view'
  });
  function visibleGroups({authenticated=false,demo=false,permissions=[]}={}){
    if(demo)return groups;
    if(!authenticated)return [];
    const allowed=new Set(Array.isArray(permissions)?permissions:[]);
    return groups.map(group=>({...group,items:group.items.filter(([id])=>!demoOnlyIds.has(id)&&(!requiredPermission[id]||allowed.has(requiredPermission[id]))).map(item=>item[0]==='receivables'?[item[0],item[1],'portal/index.html']:item)})).filter(group=>group.items.length);
  }
  if(typeof module==='object'&&module.exports){module.exports={groups,visibleGroups};return;}
  function ensureFavicon(){
    if(document.querySelector('link[rel~="icon"]'))return;
    const link=document.createElement('link');
    link.rel='icon';link.type='image/png';link.href=LT_STUDIO_FAVICON;
    document.head.appendChild(link);
  }
  ensureFavicon();
  if(root.RollandsNavigation)return;
  const base=new URL('../',document.currentScript.src);
  const demo=new URLSearchParams(location.search).get('demo')==='1';
  const supabaseUat=location.hostname==='ludwigberglund-coder.github.io'&&!demo;
  const key='rollands-navigation-v2:'+base.pathname;
  const runtimeKey='rollands-runtime-id:'+base.pathname;
  let runtimeCheckInFlight=false;
  async function ensureFreshRuntime(){
    if(demo||supabaseUat||runtimeCheckInFlight)return false;
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
    if(supabaseUat&&root.LTSupabaseUat){
      try{
        const context=await root.LTSupabaseUat.context();
        if(!context?.authenticated)return{groups:[],session:null};
        const role=context.membership?.role||'readonly';
        const permissions=role==='admin'
          ? Object.values(requiredPermission)
          : role==='accountant'
            ? ['customer-invoice.view','supplier-invoice.view','payment.view','bank.view','accounting.view','reports.view','supplier.view','inventory.view','documents.view']
            : ['customer-invoice.view','supplier-invoice.view','reports.view','supplier.view','documents.view'];
        return{groups:visibleGroups({authenticated:true,permissions}),session:{authenticated:true,user:context.user,company:context.company}};
      }catch{return{groups:[],session:null}}
    }
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
    menu:'<path d="M3 6H21M3 12H21M3 18H21"/>',
    xmark:'<path d="M6.75827 17.2426L12.0009 12M17.2435 6.75736L12.0009 12M12.0009 12L6.75827 6.75736M12.0009 12L17.2435 17.2426"/>',
    trash:'<path d="M20 9L18.005 20.3463C17.8369 21.3026 17.0062 22 16.0353 22H7.96474C6.99379 22 6.1631 21.3026 5.99496 20.3463L4 9M21 6H15.375M3 6H8.625M8.625 6V4C8.625 2.89543 9.52043 2 10.625 2H13.375C14.4796 2 15.375 2.89543 15.375 4V6M8.625 6H15.375"/>',
    key:'<path d="M10 12C10 14.2091 8.20914 16 6 16C3.79086 16 2 14.2091 2 12C2 9.79086 3.79086 8 6 8C8.20914 8 10 9.79086 10 12ZM10 12H22V15M18 12V15"/>',
    openWindow:'<path d="M21 3H15M21 3L12 12M21 3V9M21 13V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H11"/>',
    arrowLeft:'<path d="M21 12H3M3 12L11.5 3.5M3 12L11.5 20.5"/>',
    navArrowDown:'<path d="M6 9L12 15L18 9"/>',
    unlock:'<path d="M11.5 12H6.6C6.26863 12 6 12.2686 6 12.6V19.4C6 19.7314 6.26863 20 6.6 20H17.4C17.7314 20 18 19.7314 18 19.4V18.5M16 12V8C16 6.66667 15.2 4 12 4C11.2532 4 10.6371 4.14525 10.1313 4.38491M16 12H17.4C17.7314 12 18 12.2686 18 12.6V13M8 8V8.5V12M3 3L21 21"/>',
    appleHalf:'<path d="M12.1471 21.2646L12 21.2351L11.8529 21.2646C9.47627 21.7399 7.23257 21.4756 5.59352 20.1643C3.96312 18.86 2.75 16.374 2.75 12C2.75 7.52684 3.75792 5.70955 5.08541 5.04581C5.77977 4.69863 6.67771 4.59759 7.82028 4.72943C8.96149 4.86111 10.2783 5.21669 11.7628 5.71153L12.0235 5.79841L12.2785 5.69638C14.7602 4.70367 16.9909 4.3234 18.5578 5.05463C20.0271 5.7403 21.25 7.59326 21.25 12C21.25 16.374 20.0369 18.86 18.4065 20.1643C16.7674 21.4756 14.5237 21.7399 12.1471 21.2646ZM12 5.5C12 3 11 2 9 2M12 6V21M15 12V14"/>',
    deliveryTruck:'<path d="M8 19C9.10457 19 10 18.1046 10 17C10 15.8954 9.10457 15 8 15C6.89543 15 6 15.8954 6 17C6 18.1046 6.89543 19 8 19ZM18 19C19.1046 19 20 18.1046 20 17C20 15.8954 19.1046 15 18 15C16.8954 15 16 15.8954 16 17C16 18.1046 16.8954 19 18 19ZM10.05 17H15V6.6C15 6.26863 14.7314 6 14.4 6H1M5.65 17H3.6C3.26863 17 3 16.7314 3 16.4V11.5M2 9H6M15 9H20.6101C20.8472 9 21.0621 9.13964 21.1584 9.35632L22.9483 13.3836C22.9824 13.4604 23 13.5434 23 13.6273V16.4C23 16.7314 22.7314 17 22.4 17H20.5M15 17H16"/>',
    cutlery:'<path d="M6 20H12M9 20V15M17 20V12C17 12 19.5 11 19.5 9V4.5M17 8.5V4.5M4.5 11C5.5 13.1281 9 15 9 15C9 15 12.5001 13.1281 13.5 11C14.5795 8.70257 13.5 4.5 13.5 4.5H4.5C4.5 4.5 3.42047 8.70257 4.5 11Z"/>',
    chat:'<path d="M8 10H12H16M8 14H10H12M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.513 10.1786 22 12 22Z"/>',
    send:'<path d="M22 12L3 20L6.5625 12L3 4L22 12ZM6.5 12H22"/>'
  });
  const NAV_ICONS=Object.freeze({
    overview:'home',invoices:'page',receivables:'wallet','receivables-details':'stats',payables:'page',payments:'card',bank:'bank',
    automation:'settings',accounting:'book',reports:'stats',accounts:'book',payroll:'wallet',money:'card',journal:'book','res-tools':'database',
    batches:'package',inbox:'page',customers:'group',suppliers:'group',inventory:'package','company-settings':'settings',website:'page',documents:'page',decisions:'shield',
    modules:'package',project:'stats',content:'page',audit:'shield',settings:'settings',uat:'shield',legacy:'database',assistant:'help'
  });
  function iconoir(name,label=''){
    const span=document.createElement('span');span.className='ui-icon';span.setAttribute('aria-hidden','true');
    span.innerHTML='<svg viewBox="0 0 24 24" fill="none" focusable="false" aria-label="'+String(label).replace(/"/g,'')+'">'+(ICONOIR[name]||ICONOIR.page)+'</svg>';
    return span;
  }
  function addIcon(element,name){
    if(!element||element.querySelector(':scope > .ui-icon'))return;
    for(const node of [...element.childNodes]){
      if(node.nodeType!==Node.TEXT_NODE)continue;
      const cleaned=String(node.textContent||'').replace(/^\s*(?:←|→|↗|↻|×|☷|✓|\+|💬)\s*/u,'');
      if(cleaned!==node.textContent)node.textContent=cleaned;
    }
    element.prepend(iconoir(name));
    element.classList.add('ui-with-icon');
  }
  function textNavigationIcon(element){
    const text=String(element.textContent||'').trim().toLowerCase();
    if(/översikt/.test(text))return'home';
    if(/kund|användare|leverantör/.test(text))return'group';
    if(/faktura|dokument|innehåll/.test(text))return'page';
    if(/bank/.test(text))return'bank';
    if(/bokför|verifikation|konto/.test(text))return'book';
    if(/rapport|statistik|projekt/.test(text))return'stats';
    if(/lager|modul/.test(text))return'package';
    if(/säker|audit|test/.test(text))return'shield';
    if(/inställ|automation/.test(text))return'settings';
    if(/hjälp|assistent/.test(text))return'help';
    return'page';
  }
  function semanticButtonIcon(element){
    const text=[element.getAttribute?.('aria-label'),element.getAttribute?.('title'),element.textContent].filter(Boolean).join(' ').trim().toLowerCase();
    if(/logga ut/.test(text))return'logout';
    if(/stäng|avbryt/.test(text)||/^(?:×|✕|✖)$/.test(text))return'xmark';
    if(/lås upp/.test(text))return'unlock';
    if(/kommentar/.test(text))return'chat';
    if(/kolumn/.test(text))return'stats';
    if(/påminnelse|skicka/.test(text))return'send';
    if(/ta bort|radera/.test(text))return'trash';
    if(/lösenord|mfa|nyckel/.test(text))return'key';
    if(/tillbaka|alla företag/.test(text))return'arrowLeft';
    if(/spara|godkänn|verifiera|registrera|bokför|skapa och|attestera/.test(text))return'check';
    if(/skapa|lägg till|ny /.test(text))return'plus';
    if(/sök|filtrera|hitta/.test(text))return'search';
    if(/uppdatera|försök igen|återställ|beräkna/.test(text))return'refresh';
    if(/ladda ner|ladda ned|exportera/.test(text))return'download';
    if(/öppna|visa |besök/.test(text))return'openWindow';
    if(/redigera|ändra/.test(text))return'edit';
    if(/profil|konto|inloggning/.test(text))return'profile';
    return'';
  }
  function decorateUi(){
    document.querySelectorAll('[data-nav-id]').forEach(link=>addIcon(link,NAV_ICONS[link.dataset.navId]||'page'));
    document.querySelectorAll('.nav-item').forEach(link=>{
      const legacy=link.querySelector(':scope > span:first-child');
      if(legacy&&/^[^\p{L}\p{N}]+$/u.test(String(legacy.textContent||'').trim()))legacy.remove();
      addIcon(link,textNavigationIcon(link));
    });
    document.querySelectorAll('.shared-user-dropdown a,.shared-user-dropdown button').forEach(el=>addIcon(el,semanticButtonIcon(el)||'profile'));
    document.querySelectorAll('.shared-foot>a').forEach(el=>addIcon(el,'home'));
    document.querySelectorAll('.comment-badge').forEach(el=>addIcon(el,'chat'));
    document.querySelectorAll('[data-iconoir]').forEach(el=>{const name=el.dataset.iconoir;if(!name||!ICONOIR[name])return;el.replaceChildren(iconoir(name));});
    document.querySelectorAll('button,.button,.nav-item,.module-card a,.callout a,.column-picker summary,.context-menu button').forEach(button=>{if(button.matches('.metric,.stat-button,.shared-user-trigger'))return;const name=semanticButtonIcon(button);if(name)addIcon(button,name);});
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

  const sidebarMedia=matchMedia('(max-width: 760px)');
  function sidebarParts(){
    const sidebar=document.querySelector('.sidebar.shared-sidebar');
    const workspace=sidebar?.parentElement||null;
    const toggle=document.querySelector('.shared-menu-toggle');
    return{sidebar,workspace,toggle};
  }
  function sidebarOpen(){
    const {workspace}=sidebarParts();if(!workspace)return false;
    return sidebarMedia.matches?workspace.classList.contains('shared-mobile-menu-open'):!workspace.classList.contains('shared-sidebar-collapsed');
  }
  function updateSidebarToggle(open){
    const {toggle}=sidebarParts();if(!toggle)return;
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',open?'Stäng huvudmeny':'Öppna huvudmeny');
    toggle.title=open?'Stäng huvudmeny':'Öppna huvudmeny';
  }
  function setSidebarOpen(open,{persistDesktop=true,focus=true}={}){
    const {sidebar,workspace,toggle}=sidebarParts();if(!sidebar||!workspace)return;
    const mobile=sidebarMedia.matches;
    if(mobile){
      workspace.classList.toggle('shared-mobile-menu-open',Boolean(open));
      workspace.classList.remove('shared-sidebar-collapsed');
      document.body.classList.toggle('shared-mobile-nav-lock',Boolean(open));
    }else{
      workspace.classList.remove('shared-mobile-menu-open');
      document.body.classList.remove('shared-mobile-nav-lock');
      workspace.classList.toggle('shared-sidebar-collapsed',!open);
      if(persistDesktop){const state=read();state.sidebarCollapsed=!open;persist(state);}
    }
    updateSidebarToggle(Boolean(open));
    if(!focus)return;
    if(open&&mobile){
      requestAnimationFrame(()=>{
        const preferred=sidebar.querySelector('[aria-current="page"]')||sidebar.querySelector('a[href],summary,button');
        preferred?.focus?.({preventScroll:true});
      });
    }else if(!open&&toggle){
      toggle.focus?.({preventScroll:true});
    }
  }
  function applySidebarPreference(){
    const {sidebar,workspace}=sidebarParts();if(!sidebar||!workspace)return;
    sidebar.id='shared-primary-sidebar';
    if(sidebarMedia.matches)setSidebarOpen(false,{persistDesktop:false,focus:false});
    else setSidebarOpen(read().sidebarCollapsed!==true,{persistDesktop:false,focus:false});
  }
  function ensureMenuOverlay(){
    let overlay=document.querySelector('.shared-menu-overlay');
    if(overlay)return overlay;
    overlay=document.createElement('button');
    overlay.type='button';
    overlay.className='shared-menu-overlay';
    overlay.tabIndex=-1;
    overlay.setAttribute('aria-label','Stäng huvudmeny');
    overlay.setAttribute('aria-hidden','true');
    overlay.addEventListener('click',()=>setSidebarOpen(false));
    document.body.append(overlay);
    return overlay;
  }
  function mountSidebarToggle(){
    document.documentElement.classList.add('shared-navigation-enabled');
    document.body.classList.add('shared-navigation-enabled');
    const topbar=document.querySelector('.topbar');
    const sidebar=document.querySelector('.sidebar.shared-sidebar');
    if(!topbar||!sidebar)return;
    sidebar.id='shared-primary-sidebar';
    const existing=[...document.querySelectorAll('.shared-menu-toggle')];
    existing.slice(1).forEach(button=>button.remove());
    let button=topbar.querySelector('.shared-menu-toggle')||existing[0];
    if(!button){
      button=document.createElement('button');
      button.type='button';
      button.className='shared-menu-toggle';
      button.setAttribute('aria-controls','shared-primary-sidebar');
      button.append(iconoir('menu'));
      button.addEventListener('click',()=>setSidebarOpen(!sidebarOpen()));
      topbar.prepend(button);
    }else if(button.parentElement!==topbar){
      topbar.prepend(button);
    }
    ensureMenuOverlay();
    applySidebarPreference();
  }
  function mobileFocusables(){
    const {sidebar,toggle}=sidebarParts();
    if(!sidebar||!toggle)return[];
    return[toggle,...sidebar.querySelectorAll('a[href],button:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')]
      .filter((element,index,list)=>list.indexOf(element)===index&&element.getClientRects().length>0);
  }
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&sidebarOpen()){
      event.preventDefault();setSidebarOpen(false);return;
    }
    if(event.key!=='Tab'||!sidebarMedia.matches||!sidebarOpen())return;
    const focusables=mobileFocusables();if(!focusables.length)return;
    const first=focusables[0],last=focusables[focusables.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  document.addEventListener('click',event=>{
    if(sidebarMedia.matches&&event.target.closest('.sidebar.shared-sidebar .shared-links a'))setSidebarOpen(false,{focus:false});
  });
  sidebarMedia.addEventListener?.('change',()=>applySidebarPreference());

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
      const caret=document.createElement('span');caret.className='shared-user-caret';caret.append(iconoir('navArrowDown'));caret.setAttribute('aria-hidden','true');
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
    const note=document.createElement('p');note.textContent=demo?'UAT använder aktuella moduler från samma publicering.':'Menyn följer din roll. Servern kontrollerar varje skyddad åtgärd oavsett vad som visas här.';foot.append(note);
    sidebar.replaceChildren(brand,info,nav,foot);decorateUi();applySidebarPreference();
    try{sidebar.scrollTop=Number(sessionStorage.getItem(key+':scroll')||0)}catch{}
    if(!sidebar.dataset.scrollBound){sidebar.addEventListener('scroll',()=>{try{sessionStorage.setItem(key+':scroll',String(sidebar.scrollTop))}catch{}});sidebar.dataset.scrollBound='1';}
  }
  let pending=false;
  function schedule(){if(pending)return;pending=true;queueMicrotask(async()=>{pending=false;await Promise.all([mount(),mountUserMenu()]);mountSidebarToggle();decorateUi();});}
  // Renders can replace the entire sidebar. Stay subscribed instead of disconnecting after boot.
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  addEventListener('hashchange',schedule);
  addEventListener('pageshow',()=>{schedule();ensureFreshRuntime();});
  addEventListener('focus',ensureFreshRuntime);
  addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')ensureFreshRuntime();});
  setInterval(ensureFreshRuntime,30000);
  root.RollandsNavigation={groups,mount,mountUserMenu,mountSidebarToggle,setSidebarOpen,href};ensureFreshRuntime();mount();mountUserMenu();mountSidebarToggle();decorateUi();
})(globalThis);
