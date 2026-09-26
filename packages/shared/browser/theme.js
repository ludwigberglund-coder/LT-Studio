'use strict';
(function(root){
  const STORAGE_KEY='lt-studio-theme-v1';
  const DARK='dark';
  const LIGHT='light';
  const SUN_ICON='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 12L23 12" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 2V1" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 23V22" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 20L19 19" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 4L19 5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20L5 19" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 4L5 5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 12L2 12" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const MOON_ICON='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 11.5066C3 16.7497 7.25034 21 12.4934 21C16.2209 21 19.4466 18.8518 21 15.7259C12.4934 15.7259 8.27411 11.5066 8.27411 3C5.14821 4.55344 3 7.77915 3 11.5066Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const media=matchMedia('(prefers-color-scheme: dark)');
  let explicit=false;

  function readStored(){
    try{
      const value=localStorage.getItem(STORAGE_KEY);
      if(value===DARK||value===LIGHT){explicit=true;return value}
    }catch{}
    return null;
  }

  function preferred(){
    return readStored()||(media.matches?DARK:LIGHT);
  }

  function updateThemeColor(theme){
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute('content',theme===DARK?'#22272e':'#f7f5f0');
  }

  function setButtonState(button,theme){
    if(!button||button.dataset.ltThemeState===theme)return;
    const dark=theme===DARK;
    button.dataset.ltThemeState=theme;
    button.innerHTML='<span class="lt-theme-toggle-icon">'+(dark?SUN_ICON:MOON_ICON)+'</span><span class="lt-theme-toggle-label">'+(dark?'Ljust läge':'Mörkt läge')+'</span>';
    button.setAttribute('aria-label',dark?'Stäng av mörkt läge':'Slå på mörkt läge');
    button.setAttribute('title',dark?'Stäng av mörkt läge':'Slå på mörkt läge');
    button.setAttribute('aria-pressed',String(dark));
  }

  function syncButtons(theme){
    document.querySelectorAll('[data-lt-theme-toggle]').forEach(button=>setButtonState(button,theme));
  }

  function apply(theme,{persist=false}={}){
    const normalized=theme===DARK?DARK:LIGHT;
    document.documentElement.dataset.ltTheme=normalized;
    document.documentElement.style.colorScheme=normalized;
    updateThemeColor(normalized);
    syncButtons(normalized);
    if(persist){
      explicit=true;
      try{localStorage.setItem(STORAGE_KEY,normalized)}catch{}
    }
    root.dispatchEvent(new CustomEvent('lt-themechange',{detail:{theme:normalized}}));
  }

  function toggle(){
    apply(document.documentElement.dataset.ltTheme===DARK?LIGHT:DARK,{persist:true});
  }

  function makeButton(kind){
    const button=document.createElement('button');
    button.type='button';
    button.className='lt-theme-toggle lt-theme-toggle-'+kind;
    button.dataset.ltThemeToggle='1';
    button.addEventListener('click',toggle);
    setButtonState(button,document.documentElement.dataset.ltTheme||preferred());
    return button;
  }

  function menuTarget(){
    return document.querySelector(
      '.shared-foot, .side-footer, .sidebar-footer, .top-actions, .operator-user, .mobile-nav, nav[aria-label="Huvudmeny"]'
    );
  }

  function mountButtons(){
    const target=menuTarget();
    let menu=document.querySelector('.lt-theme-toggle-menu');
    if(target){
      if(!menu)menu=makeButton('menu');
      if(menu.parentElement!==target)target.append(menu);
      document.body?.classList.add('lt-theme-has-menu-toggle');
    }else{
      menu?.remove();
      document.body?.classList.remove('lt-theme-has-menu-toggle');
    }
    let floating=document.querySelector('.lt-theme-toggle-floating');
    if(!floating){
      floating=makeButton('floating');
      document.body?.append(floating);
    }
    syncButtons(document.documentElement.dataset.ltTheme||preferred());
  }

  apply(preferred());

  const observer=new MutationObserver(()=>mountButtons());
  if(document.documentElement)observer.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',mountButtons,{once:true});
  }else{
    mountButtons();
  }

  media.addEventListener?.('change',event=>{
    if(!explicit)apply(event.matches?DARK:LIGHT);
  });

  root.addEventListener('storage',event=>{
    if(event.key!==STORAGE_KEY)return;
    explicit=event.newValue===DARK||event.newValue===LIGHT;
    apply(explicit?event.newValue:(media.matches?DARK:LIGHT));
  });

  root.LTTheme={apply,toggle,current:()=>document.documentElement.dataset.ltTheme||LIGHT};
})(window);
