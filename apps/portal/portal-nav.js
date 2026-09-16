(function(){
  const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
  const suffix=isDemo?'?demo=1':'';
  function addLink(economy,href,label,beforeSelector='a[href*="automation.html"]'){
    if(!economy||economy.querySelector(`a[href*="${href}"]`))return;
    const before=economy.querySelector(beforeSelector);const link=document.createElement('a');link.className='side-link';link.href=`./${href}${suffix}`;link.textContent=label;if(before)economy.insertBefore(link,before);else economy.append(link);
  }
  function enhance(){
    const sidebar=document.querySelector('.sidebar');if(!sidebar)return false;
    if(!sidebar.querySelector('a[href*="dashboard.html"]')){
      const group=document.createElement('div');group.className='side-group unified-overview';group.innerHTML=`<span>Arbetsyta</span><a class="side-link" href="./dashboard.html${suffix}">Översikt</a>`;
      const company=sidebar.querySelector('.company-pill');if(company)company.after(group);else sidebar.prepend(group);
    }
    const economy=[...sidebar.querySelectorAll('.side-group')].find(g=>/Ekonomi/i.test(g.querySelector('span')?.textContent||''));
    addLink(economy,'suppliers.html','Leverantörer');
    addLink(economy,'accounting.html','Bokföring & rapporter');
    return true;
  }
  if(!enhance()){const observer=new MutationObserver(()=>{if(enhance())observer.disconnect()});observer.observe(document.documentElement,{childList:true,subtree:true})}
})();
