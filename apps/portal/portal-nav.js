(function(){
  const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
  const suffix=isDemo?'?demo=1':'';
  function enhance(){
    const sidebar=document.querySelector('.sidebar');if(!sidebar)return false;
    if(!sidebar.querySelector('a[href*="dashboard.html"]')){
      const group=document.createElement('div');group.className='side-group unified-overview';group.innerHTML=`<span>Arbetsyta</span><a class="side-link" href="./dashboard.html${suffix}">Översikt</a>`;
      const company=sidebar.querySelector('.company-pill');if(company)company.after(group);else sidebar.prepend(group);
    }
    let sales=[...sidebar.querySelectorAll('.side-group')].find(g=>/Försäljning/i.test(g.querySelector('span')?.textContent||''));
    if(!sales){sales=document.createElement('div');sales.className='side-group unified-sales';sales.innerHTML='<span>Försäljning</span>';const economy=[...sidebar.querySelectorAll('.side-group')].find(g=>/Ekonomi/i.test(g.querySelector('span')?.textContent||''));if(economy)sidebar.insertBefore(sales,economy);else sidebar.append(sales)}
    const ensureSales=(href,label)=>{if(sidebar.querySelector(`a[href*="${href}"]`))return;const link=document.createElement('a');link.className='side-link';link.href=`./${href}${suffix}`;link.textContent=label;sales.append(link)};
    if(isDemo){ensureSales('invoices.html','Kundfakturor');ensureSales('customers.html','Kunder');ensureSales('receivables.html','Kundreskontra')}else{ensureSales('index.html','Kundreskontra')}
    const economy=[...sidebar.querySelectorAll('.side-group')].find(g=>/Ekonomi/i.test(g.querySelector('span')?.textContent||''));
    const addBeforeAutomation=(href,label)=>{if(!economy||sidebar.querySelector(`a[href*="${href}"]`))return;const automation=economy.querySelector('a[href*="automation.html"]');const link=document.createElement('a');link.className='side-link';link.href=`./${href}${suffix}`;link.textContent=label;if(automation)economy.insertBefore(link,automation);else economy.append(link)};
    addBeforeAutomation('bank.html','Bank & avstämning');
    addBeforeAutomation('payables.html','Leverantörsfakturor');
    addBeforeAutomation('suppliers.html','Leverantörer');
    addBeforeAutomation('inventory.html','Lager');
    addBeforeAutomation('accounting.html','Bokföring');
    addBeforeAutomation('reports.html','Rapporter');
    addBeforeAutomation('payroll.html','Lön');
    addBeforeAutomation('documents.html','Dokument');
    if(!sidebar.querySelector('a[href*="website.html"]')){const group=document.createElement('div');group.className='side-group unified-admin';group.innerHTML=`<span>Administration</span><a class="side-link" href="./website.html${suffix}">Webbplats & innehåll</a>`;const footer=sidebar.querySelector('.sidebar-footer');if(footer)sidebar.insertBefore(group,footer);else sidebar.append(group)}
    if(isDemo&&!sidebar.querySelector('a[href*="uat.html"]')){const group=document.createElement('div');group.className='side-group unified-uat';group.innerHTML=`<span>Test & granskning</span><a class="side-link" href="./uat.html?demo=1">Testa systemet</a>`;const footer=sidebar.querySelector('.sidebar-footer');if(footer)sidebar.insertBefore(group,footer);else sidebar.append(group)}
    return true;
  }
  if(!enhance()){const observer=new MutationObserver(()=>{if(enhance())observer.disconnect()});observer.observe(document.documentElement,{childList:true,subtree:true})}
})();
