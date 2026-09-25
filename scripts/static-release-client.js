'use strict';
(function(){
  const script=document.currentScript;
  const base=new URL('./',script.src);
  const current=document.querySelector('meta[name="lt-release"]')?.content;
  if(!current)return;
  let busy=false;
  function versionUrl(url,version){url.searchParams.set('v',version);return url;}
  // Also cover links inserted by modules after their initial render.
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href]');if(!link)return;
    const url=new URL(link.href,location.href);
    if(url.origin===base.origin&&url.pathname.startsWith(base.pathname)&&(/\.html$/.test(url.pathname)||url.pathname.endsWith('/'))){
      link.href=versionUrl(url,current).href;
    }
  },true);
  async function check(){
    if(busy||document.visibilityState==='hidden')return;
    busy=true;
    try{
      const url=new URL('build-info.json',base);url.searchParams.set('check',Date.now());
      const response=await fetch(url,{cache:'no-store'});if(!response.ok)return;
      const info=await response.json();
      if(!/^[a-f0-9]{40}$/.test(info.commit)||info.commit===current)return;
      if(document.getElementById('lt-release-update'))return;
      // Stop testing an obsolete build without discarding unsaved input automatically.
      const dialog=document.createElement('dialog');dialog.id='lt-release-update';
      const heading=document.createElement('h2');heading.textContent='En ny version finns';
      const message=document.createElement('p');message.textContent='UAT har uppdaterats. Ladda den senaste versionen innan du fortsätter testa. Osparade ändringar på sidan försvinner vid omladdning.';
      const button=document.createElement('button');button.textContent='Öppna senaste versionen';
      button.addEventListener('click',()=>location.replace(versionUrl(new URL(location.href),info.commit).href));
      dialog.addEventListener('cancel',event=>event.preventDefault());
      dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();}});
      dialog.append(heading,message,button);document.body.append(dialog);dialog.showModal();
    }catch{/* Retry on focus/visibility or the next interval after a network failure. */}
    finally{busy=false;}
  }
  addEventListener('pageshow',check);addEventListener('focus',check);
  document.addEventListener('visibilitychange',check);setInterval(check,30000);check();
})();
