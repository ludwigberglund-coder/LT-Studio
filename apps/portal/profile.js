const app=document.getElementById('profile-app');
const isDemo=location.hostname==='ludwigberglund-coder.github.io'||new URLSearchParams(location.search).has('demo');
const csrfToken=sessionStorage.getItem('rollands-csrf')||'';
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
async function api(path,options={}){
  const headers={Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&options.method!=='GET'&&csrfToken?{'X-CSRF-Token':csrfToken}:{})};
  const response=await fetch('/api/v1'+path,{credentials:'same-origin',cache:'no-store',...options,headers,body:options.body?JSON.stringify(options.body):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error||'Begäran misslyckades.');error.code=data.code;throw error}
  return data;
}
function labelForDuration(value){
  if(value===null)return'Logga in varje gång webbläsaren öppnas';
  return value/60+' timmar';
}
function render(session,security){
  const roleLabels={admin:'Admin / huvudanvändare',accountant:'Ekonom',approver:'Attestant',readonly:'Läsbehörighet'};
  app.innerHTML=`<div class="portal"><aside class="sidebar"></aside><section class="main"><header class="topbar"><div><h1>Min profil</h1><p>Personlig säkerhet och inloggning</p></div></header><main class="content"><div class="page-heading"><div><span class="eyebrow">Personligt konto</span><h2>${esc(session.user.displayName)}</h2><p>Inställningen gäller ditt eget konto. När du ändrar den loggas alla dina aktiva sessioner ut.</p></div></div><section class="panel" style="padding:22px;max-width:760px"><h3>Inloggningens giltighetstid</h3><p style="color:var(--muted);line-height:1.6">Välj hur länge en inloggning som längst får fortsätta gälla. Aktivitet kan aldrig förlänga sessionen förbi denna gräns. Alternativet ”varje gång” använder en webbläsarsession och kräver ny inloggning när webbläsarsessionen avslutas.</p><form id="security-form"><label class="field">Logga in igen
<select name="duration">
<option value="session" ${security.sessionDurationMinutes===null?'selected':''}>Varje gång</option>
${security.allowedSessionDurationMinutes.map(minutes=>`<option value="${minutes}" ${security.sessionDurationMinutes===minutes?'selected':''}>${minutes/60} timmar</option>`).join('')}
</select></label><div class="notice" style="margin:16px 0">Nuvarande val: <b>${esc(labelForDuration(security.sessionDurationMinutes))}</b>.</div><button class="button" type="submit">Spara och logga in igen</button></form></section><section class="panel" style="padding:22px;max-width:760px;margin-top:18px"><h3>Behörighet</h3><p>Roll i detta företag: <b>${esc(roleLabels[session.role]||session.role||'Okänd')}</b></p>${session.user.platformAdmin?'<div class="notice"><b>LT Studio global admin.</b> Kontot kan välja alla kundföretag och får adminbehörighet i valt företag.</div>':''}</section></main></section></div>`;
  globalThis.RollandsNavigation?.mount?.();
}
async function load(){
  if(isDemo){
    app.innerHTML=`<div class="portal"><aside class="sidebar"></aside><section class="main"><header class="topbar"><div><h1>Min profil</h1><p>Demo · inga riktiga kontoinställningar</p></div></header><main class="content"><div class="demo-banner"><b>Demo.</b> Personlig sessionstid ändras endast i den privata portalen efter riktig inloggning.</div><section class="panel" style="padding:22px"><h2>Personlig säkerhet</h2><p>Här kan en riktig användare välja varje gång, 2, 4, 6 eller 8 timmar. Demot sparar inga kontoändringar.</p></section></main></section></div>`;
    globalThis.RollandsNavigation?.mount?.();return;
  }
  const session=await api('/session');
  if(!session.authenticated){location.href='./index.html';return}
  const security=await api('/profile/security');
  render(session,security);
}
document.addEventListener('submit',async event=>{
  if(event.target.id!=='security-form')return;
  event.preventDefault();
  const value=new FormData(event.target).get('duration');
  const sessionDurationMinutes=value==='session'?null:Number(value);
  const button=event.target.querySelector('button');button.disabled=true;
  try{
    await api('/profile/security',{method:'PUT',body:{sessionDurationMinutes}});
    sessionStorage.removeItem('rollands-csrf');
    location.href='./index.html';
  }catch(error){button.disabled=false;alert(error.message)}
});
load().catch(error=>{app.innerHTML=`<main class="boot"><strong>Profilen kunde inte laddas</strong><span>${esc(error.message)}</span></main>`});
