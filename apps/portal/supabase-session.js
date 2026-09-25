(function(){
  'use strict';
  const KEY='lt-studio-supabase-uat-session-v1';
  const COMPANY_KEY='lt-studio-supabase-uat-company-v1';
  const api=()=>window.LTSupabase;
  function read(){try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}}
  function write(value){if(value)localStorage.setItem(KEY,JSON.stringify(value));else localStorage.removeItem(KEY)}
  function token(){return read()?.access_token||''}
  function storeSession(value){write(value||null);return value||null}
  async function signIn(email,password){
    const data=await api().signIn({email,password});
    write(data);
    return context();
  }
  async function signOut(){
    const t=token();
    if(t)await api().signOut(t).catch(()=>{});
    write(null);localStorage.removeItem(COMPANY_KEY);
  }
  async function context(){
    const t=token(); if(!t)return {authenticated:false};
    let authUser;
    try{authUser=await api().getUser(t)}catch{write(null);return {authenticated:false}}
    const uid=authUser?.id;if(!uid){write(null);return {authenticated:false}}
    const [profiles,memberships,companies]=await Promise.all([
      api().from('app_users',t).select('*','auth_user_id=eq.'+encodeURIComponent(uid)),
      api().from('company_memberships',t).select('*','auth_user_id=eq.'+encodeURIComponent(uid)),
      api().from('companies',t).select('*')
    ]);
    const profile=profiles?.[0]||{};
    const allowed=new Set((memberships||[]).map(m=>String(m.company_id)));
    const visible=(companies||[]).filter(c=>allowed.has(String(c.id)));
    let companyId=localStorage.getItem(COMPANY_KEY)||'';
    if(!allowed.has(companyId))companyId=visible[0]?.id||'';
    if(companyId)localStorage.setItem(COMPANY_KEY,companyId);
    const company=visible.find(c=>String(c.id)===String(companyId))||visible[0]||null;
    const membership=(memberships||[]).find(m=>String(m.company_id)===String(company?.id))||null;
    return {
      authenticated:true,
      accessToken:t,
      authUser,
      user:{id:profile.id||uid,authUserId:uid,username:profile.username||authUser.email||'',displayName:profile.display_name||profile.username||authUser.email||'Användare'},
      company:company?{id:company.id,name:company.display_name||company.legal_name||'Företaget',legalName:company.legal_name,orgNumber:company.org_number}:null,
      membership,
      companies:visible.map(c=>({id:c.id,name:c.display_name||c.legal_name||'Företaget'}))
    };
  }
  function setCompany(id){localStorage.setItem(COMPANY_KEY,String(id||''))}
  window.LTSupabaseUat={read,token,storeSession,signIn,signOut,context,setCompany};
})();