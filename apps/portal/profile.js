const app=document.getElementById('profile-app');
const pageParams=new URLSearchParams(location.search);
const isDemo=pageParams.get('demo')==='1';
const isSupabase=location.hostname==='ludwigberglund-coder.github.io'&&!isDemo;
const csrfToken=sessionStorage.getItem('rollands-csrf')||'';
const ALLOWED_SESSION_DURATIONS=[120,240,360,480];
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
async function api(path,options={}){
  const headers={Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&options.method!=='GET'&&csrfToken?{'X-CSRF-Token':csrfToken}:{})};
  const response=await fetch('/api/v1'+path,{credentials:'same-origin',cache:'no-store',...options,headers,body:options.body?JSON.stringify(options.body):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error||'Begäran misslyckades.');error.code=data.code;throw error}
  return data;
}
function labelForDuration(value){
  if(value===null)return'Logga in varje gång webbläsarsessionen startas';
  return value/60+' timmar';
}
function render(session,security){
  const roleLabels={admin:'Admin / huvudanvändare',accountant:'Ekonom',approver:'Attestant',readonly:'Läsbehörighet'};
  const supabaseNote=isSupabase?'<div class="notice" style="margin-top:16px"><b>Gemensam Supabase-UAT.</b> Valet sparas på ditt konto och används av alla LT Studio-sidor. Vid ändring loggas du ut och måste logga in med lösenord och MFA igen.</div>':'';
  app.innerHTML=`<div class="portal"><aside class="sidebar"></aside><section class="main"><header class="topbar"><div><h1>Min profil</h1><p>Personlig säkerhet och inloggning</p></div></header><main class="content"><div class="page-heading"><div><span class="eyebrow">Personligt konto</span><h2>${esc(session.user.displayName)}</h2><p>Inställningen gäller ditt eget konto och bestämmer hur länge LT Studio får behålla din inloggning.</p></div></div><section class="panel" style="padding:22px;max-width:760px"><h3>Inloggningens giltighetstid</h3><p style="color:var(--muted);line-height:1.6">Välj hur länge en inloggning som längst får fortsätta gälla. Alternativet ”varje gång” sparar inloggningen endast för den aktuella webbläsarsessionen.</p><form id="security-form"><label class="field">Logga in igen
<select name="duration">
<option value="session" ${security.sessionDurationMinutes===null?'selected':''}>Varje gång</option>
${security.allowedSessionDurationMinutes.map(minutes=>`<option value="${minutes}" ${security.sessionDurationMinutes===minutes?'selected':''}>${minutes/60} timmar</option>`).join('')}
</select></label><div class="notice" style="margin:16px 0">Nuvarande val: <b>${esc(labelForDuration(security.sessionDurationMinutes))}</b>.</div><button class="button" type="submit">Spara och logga in igen</button></form>${supabaseNote}</section><section class="panel" style="padding:22px;max-width:760px;margin-top:18px"><h3>Behörighet</h3><p>Roll i detta företag: <b>${esc(roleLabels[session.role]||session.role||'Okänd')}</b></p>${session.user.platformAdmin?'<div class="notice"><b>LT Studio global admin.</b> Kontot kan välja alla kundföretag och får adminbehörighet i valt företag.</div>':''}</section></main></section></div>`;
  globalThis.RollandsNavigation?.mount?.();
}
function demoView(){
  app.innerHTML=`<div class="portal"><aside class="sidebar"></aside><section class="main"><header class="topbar"><div><h1>Min profil</h1><p>Demo · inga riktiga kontoinställningar</p></div></header><main class="content"><div class="demo-banner"><b>Demo.</b> Personlig sessionstid ändras endast efter riktig Supabase-inloggning.</div><section class="panel" style="padding:22px"><h2>Personlig säkerhet</h2><p>Här kan en riktig användare välja varje gång, 2, 4, 6 eller 8 timmar. Demot sparar inga kontoändringar.</p></section></main></section></div>`;
  globalThis.RollandsNavigation?.mount?.();
}
async function loadSupabase(){
  const ctx=await window.LTSupabaseUat.context();
  if(!ctx.authenticated||!ctx.company){location.href='./index.html';return}
  render(
    {user:{...ctx.user,platformAdmin:false},role:ctx.membership?.role||'readonly',company:ctx.company},
    {sessionDurationMinutes:ctx.user.sessionDurationMinutes,allowedSessionDurationMinutes:ALLOWED_SESSION_DURATIONS}
  );
}
async function load(){
  if(isDemo){demoView();return}
  if(isSupabase){await loadSupabase();return}
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
  if(sessionDurationMinutes!==null&&!ALLOWED_SESSION_DURATIONS.includes(sessionDurationMinutes)){
    alert('Välj varje gång, 2, 4, 6 eller 8 timmar.');
    return;
  }
  const button=event.target.querySelector('button');button.disabled=true;
  try{
    if(isSupabase){
      const ctx=await window.LTSupabaseUat.context();
      if(!ctx.authenticated)throw new Error('Sessionen har gått ut. Logga in igen.');
      const rows=await window.LTSupabase.from('app_users',ctx.accessToken).update(
        {session_duration_minutes:sessionDurationMinutes},
        'auth_user_id=eq.'+encodeURIComponent(ctx.authUser.id)
      );
      if(!rows?.[0])throw new Error('Sessionstiden kunde inte sparas.');
      await window.LTSupabaseUat.signOut();
      location.href='./index.html';
      return;
    }
    await api('/profile/security',{method:'PUT',body:{sessionDurationMinutes}});
    sessionStorage.removeItem('rollands-csrf');
    location.href='./index.html';
  }catch(error){button.disabled=false;alert(error.message)}
});
load().catch(error=>{app.innerHTML=`<main class="boot"><strong>Profilen kunde inte laddas</strong><span>${esc(error.message)}</span></main>`});