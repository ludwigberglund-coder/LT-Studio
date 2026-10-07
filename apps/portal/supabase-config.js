// Public Supabase connection settings. Publishable keys are intentionally safe for browser use.
// Authorization is enforced by Supabase Auth + Row Level Security. Never put secret/service-role keys here.
(function(){
  'use strict';
  const ENV_KEY='lt-studio-supabase-environment-v1';
  const CONFIGS=Object.freeze({
    uat:Object.freeze({
      url:'https://bwbhnotpuuhgghjpmflk.supabase.co',
      publishableKey:'sb_publishable_funrQFTXmsEpbjG09xS68w_D8wEj6G4',
      environment:'uat'
    }),
    staging:Object.freeze({
      url:'https://rwnqkgbbbxjjfhwtepsi.supabase.co',
      publishableKey:'sb_publishable_9lqpsEtC15oreqlNjhVB2A_QV2SUGdN',
      environment:'staging'
    })
  });

  let requested='';
  try{requested=String(new URLSearchParams(location.search).get('lt-env')||'').trim().toLowerCase()}catch{}
  let environment=Object.prototype.hasOwnProperty.call(CONFIGS,requested)?requested:'uat';

  try{
    if(Object.prototype.hasOwnProperty.call(CONFIGS,requested))sessionStorage.setItem(ENV_KEY,requested);
    const stored=String(sessionStorage.getItem(ENV_KEY)||'').trim().toLowerCase();
    if(Object.prototype.hasOwnProperty.call(CONFIGS,stored))environment=stored;
  }catch{}

  window.LT_SUPABASE=CONFIGS[environment];
  document.documentElement.dataset.ltEnvironment=environment;

  if(environment==='staging'){
    const showStagingBadge=()=>{
      if(document.getElementById('lt-staging-environment-badge'))return;
      const badge=document.createElement('aside');
      badge.id='lt-staging-environment-badge';
      badge.setAttribute('role','status');
      badge.style.cssText='position:fixed;left:14px;bottom:14px;z-index:2147483647;display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid rgba(15,23,42,.18);border-radius:12px;background:#fff;color:#111827;box-shadow:0 8px 28px rgba(15,23,42,.18);font:600 12px/1.25 system-ui,sans-serif';
      const label=document.createElement('span');
      label.textContent='STAGING · ENDAST SYNTETISK DATA';
      const link=document.createElement('a');
      const target=new URL(location.href);
      target.searchParams.set('lt-env','uat');
      link.href=target.pathname+target.search+target.hash;
      link.textContent='Byt till UAT';
      link.style.cssText='color:inherit;text-decoration:underline;font-weight:700';
      badge.append(label,link);
      document.body.appendChild(badge);
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',showStagingBadge,{once:true});
    else showStagingBadge();
  }
})();
