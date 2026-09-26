'use strict';

const REPO='ludwigberglund-coder/LT-Studio';
const GITHUB_REFRESH_MS=5*60*1000;
const SUPABASE_REFRESH_MS=60*1000;
const state={
  github:{tone:'loading',commit:'Hämtar…',message:'Väntar på GitHub',ci:'Hämtar…',pages:'Hämtar…',checkedAt:''},
  supabase:{tone:'loading',auth:'Hämtar…',realtime:'Hämtar…',checkedAt:''}
};
let githubTimer=0;
let supabaseTimer=0;
let observer=null;

function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function tone(value){return ['ok','warn','bad','loading'].includes(value)?value:'loading';}
function relativeTime(value){
  if(!value)return 'väntar';
  const stamp=Date.parse(value);
  if(!Number.isFinite(stamp))return 'okänd tid';
  const diff=Math.max(0,Date.now()-stamp);
  const seconds=Math.floor(diff/1000);
  if(seconds<60)return 'nyss';
  const minutes=Math.floor(seconds/60);
  if(minutes<60)return minutes+' min sedan';
  const hours=Math.floor(minutes/60);
  if(hours<24)return hours+' h sedan';
  return Math.floor(hours/24)+' d sedan';
}
function dot(value='ok'){return '<span class="system-live-dot '+tone(value)+'" aria-hidden="true"></span>';}
function githubMark(){return '<span class="system-brand-mark github" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M9 19c-4.3 1.3-4.3-2.2-6-2.7m12 5v-3.4c0-1 .1-1.5-.5-2.1 3.1-.4 6.4-1.5 6.4-6.9A5.4 5.4 0 0 0 19.5 5c.1-.4.6-1.9-.1-3.8 0 0-1.1-.4-3.6 1.4a12.4 12.4 0 0 0-6.6 0C6.7.8 5.6 1.2 5.6 1.2A5.2 5.2 0 0 0 5.5 5a5.4 5.4 0 0 0-1.4 3.9c0 5.4 3.3 6.5 6.4 6.9-.4.4-.7.9-.8 1.6V21" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';}
function supabaseMark(){return '<span class="system-brand-mark supabase" aria-hidden="true"><svg viewBox="0 0 109 113" fill="none"><path d="M63.708 110.284c-2.8 3.532-8.509 1.551-8.509-2.896v-56.01H18.043c-5.029 0-7.832-5.727-4.788-9.73L45.293 1.378c2.799-3.532 8.508-1.551 8.508 2.896v56.01h37.156c5.029 0 7.832 5.727 4.788 9.73l-32.037 40.27Z" fill="currentColor"/></svg></span>';}

function runLabel(run,successLabel){
  if(!run)return 'Ingen körning';
  if(run.status==='queued')return 'Köad';
  if(run.status==='in_progress')return 'Kör nu';
  if(run.status!=='completed')return 'Pågår';
  if(run.conclusion==='success')return successLabel;
  if(run.conclusion==='cancelled')return 'Avbruten';
  if(run.conclusion==='skipped')return 'Hoppad';
  return 'Fel';
}
function statusTitle(value,okLabel){if(value==='ok')return okLabel;if(value==='warn')return 'Begränsad';if(value==='bad')return 'Fel';return 'Kontrollerar';}

function markup(){
  const g=state.github,s=state.supabase;
  const allOk=g.tone==='ok'&&s.tone==='ok';
  return '<section class="system-status" aria-label="Live systemstatus">'+
    '<div class="system-status-glow glow-one"></div><div class="system-status-glow glow-two"></div><div class="system-status-gridlines" aria-hidden="true"></div>'+
    '<div class="system-status-heading"><div><span class="system-eyebrow">'+dot(allOk?'ok':'warn')+' Live Systemstatus</span><h2>GitHub och Supabase i realtid</h2><p>Automatisk driftöversikt med senaste kodändring, CI, publicering och Supabase-anslutning. Inga hemliga nycklar exponeras i webbläsaren.</p></div>'+
    '<div class="system-live-pill">'+dot(allOk?'ok':'warn')+'<span>Automatisk uppdatering</span><small>GitHub 5 min · Supabase 1 min</small></div></div>'+
    '<div class="system-status-cards">'+
      '<article class="system-card"><div class="system-card-head"><div class="system-brand">'+githubMark()+'<div><strong>GitHub</strong><span>Source of truth</span></div></div><span class="system-state '+tone(g.tone)+'">'+statusTitle(g.tone,'Synkad')+'</span></div>'+
      '<div class="system-data-list"><div class="system-row"><span>Branch</span><strong>main</strong></div><div class="system-row"><span>Commit</span><strong class="system-mono">'+escapeHtml(g.commit)+'</strong></div><div class="system-row"><span>CI</span><strong>'+escapeHtml(g.ci)+'</strong></div><div class="system-row"><span>Pages</span><strong>'+escapeHtml(g.pages)+'</strong></div></div>'+
      '<div class="system-card-foot"><span>'+escapeHtml(g.message)+'</span><time>'+escapeHtml(relativeTime(g.checkedAt))+'</time></div><span class="system-scan-line" aria-hidden="true"></span></article>'+
      '<article class="system-card"><div class="system-card-head"><div class="system-brand">'+supabaseMark()+'<div><strong>Supabase</strong><span>UAT backend</span></div></div><span class="system-state '+tone(s.tone)+'">'+statusTitle(s.tone,'Online')+'</span></div>'+
      '<div class="system-data-list"><div class="system-row"><span>Auth API</span><strong>'+escapeHtml(s.auth)+'</strong></div><div class="system-row"><span>Realtime</span><strong>'+escapeHtml(s.realtime)+'</strong></div><div class="system-row"><span>Miljö</span><strong>UAT</strong></div><div class="system-row"><span>Projekt</span><strong class="system-mono">bwbh…pmflk</strong></div></div>'+
      '<div class="system-card-foot"><span>Publik health-check + WebSocket-probe</span><time>'+escapeHtml(relativeTime(s.checkedAt))+'</time></div><span class="system-scan-line" aria-hidden="true"></span></article>'+
      '<article class="system-card system-activity-card"><div class="system-card-head"><div class="system-brand"><span class="system-brand-mark pulse" aria-hidden="true">↗</span><div><strong>Liveaktivitet</strong><span>Senaste signaler</span></div></div><span class="system-orbit" aria-hidden="true"><i></i></span></div>'+
      '<ol class="system-activity"><li><time>'+escapeHtml(relativeTime(g.checkedAt))+'</time><div>'+dot(g.tone)+'<span><strong>GitHub</strong>'+escapeHtml(g.message)+'</span></div></li><li><time>'+escapeHtml(relativeTime(g.checkedAt))+'</time><div>'+dot(g.ci==='Godkänd'?'ok':g.ci==='Fel'?'bad':'warn')+'<span><strong>CI / Pages</strong>'+escapeHtml(g.ci+' · '+g.pages)+'</span></div></li><li><time>'+escapeHtml(relativeTime(s.checkedAt))+'</time><div>'+dot(s.tone)+'<span><strong>Supabase</strong>Auth '+escapeHtml(s.auth.toLowerCase())+' · Realtime '+escapeHtml(s.realtime.toLowerCase())+'</span></div></li></ol></article>'+
    '</div></section>';
}

function mount(force=false){const target=document.getElementById('live-system-status');if(!target)return;if(!force&&target.dataset.systemStatusMounted==='1')return;target.innerHTML=markup();target.dataset.systemStatusMounted='1';}

async function fetchWithTimeout(url,options={},timeoutMs=6500){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(url,{...options,signal:controller.signal});}
  finally{clearTimeout(timer);}
}

async function refreshGithub(){
  try{
    const headers={Accept:'application/vnd.github+json'};
    const [commitResponse,runsResponse]=await Promise.all([
      fetchWithTimeout('https://api.github.com/repos/'+REPO+'/commits/main',{headers}),
      fetchWithTimeout('https://api.github.com/repos/'+REPO+'/actions/runs?branch=main&per_page=10',{headers})
    ]);
    if(!commitResponse.ok||!runsResponse.ok){
      const limited=[commitResponse,runsResponse].some(response=>response.status===403&&response.headers.get('x-ratelimit-remaining')==='0');
      state.github.tone=limited?'warn':'bad';
      state.github.message=limited?'GitHub API:s publika gräns är tillfälligt nådd.':'GitHub kunde inte nås.';
      state.github.checkedAt=new Date().toISOString();
      mount(true);return;
    }
    const [commitData,runsData]=await Promise.all([commitResponse.json(),runsResponse.json()]);
    const runs=Array.isArray(runsData&&runsData.workflow_runs)?runsData.workflow_runs:[];
    const quality=runs.find(run=>/quality and security checks/i.test(run.name||''))||runs.find(run=>/codeql|quality|security/i.test(run.name||''));
    const pages=runs.find(run=>/publish github pages uat|pages/i.test(run.name||''));
    const runState=run=>!run?'warn':run.status==='completed'?(run.conclusion==='success'?'ok':'bad'):'warn';
    const tones=[runState(quality),runState(pages)];
    const githubTone=tones.includes('bad')?'bad':tones.includes('warn')?'warn':'ok';
    state.github={tone:githubTone,commit:String(commitData&&commitData.sha||'').slice(0,8)||'okänd',message:String(commitData&&commitData.commit&&commitData.commit.message||'Senaste commit').split('\n')[0].slice(0,96),ci:runLabel(quality,'Godkänd'),pages:runLabel(pages,'Publicerad'),checkedAt:new Date().toISOString()};
  }catch(error){
    state.github.tone='bad';state.github.message='GitHub-status kunde inte hämtas.';state.github.checkedAt=new Date().toISOString();
  }
  mount(true);
}

function realtimeHealth(cfg){
  return new Promise(resolve=>{
    let settled=false;
    const parsed=new URL(cfg.url);
    const protocol=parsed.protocol==='https:'?'wss:':'ws:';
    const socket=new WebSocket(protocol+'//'+parsed.host+'/realtime/v1/websocket?apikey='+encodeURIComponent(cfg.publishableKey)+'&vsn=1.0.0');
    const done=value=>{if(settled)return;settled=true;clearTimeout(timer);try{socket.close();}catch{}resolve(value);};
    const timer=setTimeout(()=>done(false),5000);
    socket.onopen=()=>done(true);
    socket.onerror=()=>done(false);
  });
}

async function refreshSupabase(){
  const cfg=window.LT_SUPABASE;
  if(!cfg||!cfg.url||!cfg.publishableKey){state.supabase={tone:'bad',auth:'Saknas',realtime:'Saknas',checkedAt:new Date().toISOString()};mount(true);return;}
  try{
    const [authResult,realtimeResult]=await Promise.allSettled([
      fetchWithTimeout(cfg.url+'/auth/v1/health',{headers:{apikey:cfg.publishableKey}},5000),
      realtimeHealth(cfg)
    ]);
    const authOk=authResult.status==='fulfilled'&&authResult.value.ok;
    const realtimeOk=realtimeResult.status==='fulfilled'&&realtimeResult.value===true;
    state.supabase={tone:authOk&&realtimeOk?'ok':authOk||realtimeOk?'warn':'bad',auth:authOk?'Online':'Otillgänglig',realtime:realtimeOk?'Online':'Otillgänglig',checkedAt:new Date().toISOString()};
  }catch(error){state.supabase={tone:'bad',auth:'Otillgänglig',realtime:'Otillgänglig',checkedAt:new Date().toISOString()};}
  mount(true);
}

function start(){
  mount();refreshGithub();refreshSupabase();
  githubTimer=setInterval(()=>{if(document.visibilityState==='visible')refreshGithub();},GITHUB_REFRESH_MS);
  supabaseTimer=setInterval(()=>{if(document.visibilityState==='visible')refreshSupabase();},SUPABASE_REFRESH_MS);
  observer=new MutationObserver(()=>mount(false));observer.observe(document.getElementById('admin-app'),{childList:true,subtree:true});
  window.addEventListener('hashchange',()=>setTimeout(()=>mount(false),0));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){mount(false);refreshSupabase();}});
}

start();
