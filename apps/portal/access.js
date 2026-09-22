const app=document.getElementById('access-app');
const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
const csrfToken=sessionStorage.getItem('rollands-csrf')||'';
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
async function api(path,options={}){
  const headers={Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&options.method!=='GET'&&csrfToken?{'X-CSRF-Token':csrfToken}:{})};
  const response=await fetch('/api/v1'+path,{credentials:'same-origin',cache:'no-store',...options,headers,body:options.body?JSON.stringify(options.body):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error||'Begäran misslyckades.');error.code=data.code;throw error}
  return data;
}
function render(session,data,message=''){
  const roles=new Map(data.roles.map(role=>[role.id,role]));
  const rows=data.members.map(member=>`<tr><td><b>${esc(member.displayName)}</b><br><small>${esc(member.username)}</small></td><td>${member.platformAdmin?'LT Studio global admin':'Kundkonto'}</td><td><select data-role-user="${esc(member.userId)}" ${member.userId===session.user.id?'disabled title="Din egen roll ändras av en annan admin"':''}>${data.roles.map(role=>`<option value="${esc(role.id)}" ${member.role===role.id?'selected':''}>${esc(role.label)}</option>`).join('')}</select></td><td>${member.disabled?'Inaktiverad':'Aktiv'}</td></tr>`).join('');
  app.innerHTML=`<div class="portal"><aside class="sidebar"></aside><section class="main"><header class="topbar"><div><h1>Användare & behörigheter</h1><p>${esc(session.company.name)}</p></div></header><main class="content"><div class="page-heading"><div><span class="eyebrow">Åtkomstkontroll</span><h2>Roller i företaget</h2><p>Rollerna kontrolleras på servern. Ett rollbyte återkallar den användarens aktiva sessioner direkt.</p></div></div>${message?`<div class="notice" style="margin-bottom:18px">${esc(message)}</div>`:''}<section class="panel"><div class="table-scroll"><table class="res-table" style="width:100%"><thead><tr><th>Användare</th><th>Kontotyp</th><th>Roll</th><th>Status</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Inga företagsanvändare.</td></tr>'}</tbody></table></div></section><section class="panel" style="padding:22px;margin-top:18px"><h3>Rollernas innebörd</h3>${[...roles.values()].map(role=>`<p><b>${esc(role.label)}:</b> ${esc(role.description)}</p>`).join('')}</section></main></section></div>`;
  globalThis.RollandsNavigation?.mount?.();
}
async function load(message=''){
  if(isDemo){
    app.innerHTML=`<div class="portal"><aside class="sidebar"></aside><section class="main"><header class="topbar"><div><h1>Användare & behörigheter</h1><p>Demo · inga riktiga användare</p></div></header><main class="content"><div class="demo-banner"><b>Demo.</b> Roller kan endast ändras i den privata portalen av en riktig admin.</div><section class="panel" style="padding:22px"><h2>Rollmodell</h2><p>Admin · Ekonom · Attestant · Läsbehörighet</p><p>Demot gör inga konto- eller behörighetsändringar.</p></section></main></section></div>`;
    globalThis.RollandsNavigation?.mount?.();return;
  }
  const session=await api('/session');
  if(!session.authenticated){location.href='./index.html';return}
  if(!(session.permissions||[]).includes('users.manage'))throw new Error('Du saknar adminbehörighet för användarhantering.');
  const data=await api('/access/members');
  render(session,data,message);
}
document.addEventListener('change',async event=>{
  const select=event.target.closest('[data-role-user]');if(!select)return;
  select.disabled=true;
  try{
    await api('/access/members/'+encodeURIComponent(select.dataset.roleUser)+'/role',{method:'PUT',body:{role:select.value}});
    await load('Rollen sparades. Användarens gamla sessioner har avslutats.');
  }catch(error){select.disabled=false;alert(error.message);await load().catch(()=>{})}
});
load().catch(error=>{app.innerHTML=`<main class="boot"><strong>Behörigheter kunde inte laddas</strong><span>${esc(error.message)}</span><p><a href="./dashboard.html">Till översikten</a></p></main>`});
