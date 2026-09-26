(function(){
  'use strict';
  const KEY='lt-studio-supabase-uat-session-v1';
  const COMPANY_KEY='lt-studio-supabase-uat-company-v1';
  const ALLOWED_DURATIONS=new Set([120,240,360,480]);
  const REFRESH_AHEAD_MS=60*1000;
  const api=()=>window.LTSupabase;
  let expiryTimer=0;

  function parseStored(storage){
    try{return JSON.parse(storage.getItem(KEY)||'null')}catch{return null}
  }
  function read(){
    return parseStored(sessionStorage)||parseStored(localStorage);
  }
  function clearExpiryTimer(){
    if(expiryTimer){clearTimeout(expiryTimer);expiryTimer=0}
  }
  function clearStoredSession(){
    clearExpiryTimer();
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  }
  function jwtClaims(value){
    try{
      const part=String(value||'').split('.')[1]||'';
      const normalized=part.replace(/-/g,'+').replace(/_/g,'/');
      return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,'=')));
    }catch{return{}}
  }
  function normalizeDuration(value){
    if(value===null)return null;
    const minutes=Number(value);
    return ALLOWED_DURATIONS.has(minutes)?minutes:480;
  }
  function storedDuration(value){
    if(!value||!Object.prototype.hasOwnProperty.call(value,'_lt_session_duration_minutes'))return undefined;
    return value._lt_session_duration_minutes===null?null:normalizeDuration(value._lt_session_duration_minutes);
  }
  function sessionStartedAt(value){
    const stored=Number(value?._lt_session_started_at||0);
    if(Number.isFinite(stored)&&stored>0)return stored;
    const issued=Number(jwtClaims(value?.access_token).iat||0)*1000;
    return issued>0?issued:Date.now();
  }
  function persist(value,durationMinutes,startedAt=sessionStartedAt(value)){
    clearStoredSession();
    if(!value)return null;
    const normalized=durationMinutes===null?null:normalizeDuration(durationMinutes);
    const record={...value,_lt_session_started_at:startedAt,_lt_session_duration_minutes:normalized};
    const storage=normalized===null?sessionStorage:localStorage;
    storage.setItem(KEY,JSON.stringify(record));
    scheduleExpiry(record);
    return record;
  }
  function storeSession(value){
    if(!value){clearStoredSession();return null}
    return persist(value,null,sessionStartedAt(value));
  }
  function token(){return read()?.access_token||''}
  function requiresAal2(){return window.LT_SUPABASE?.environment==='uat'}
  function deadline(value){
    const duration=storedDuration(value);
    return duration===undefined||duration===null?null:sessionStartedAt(value)+duration*60*1000;
  }
  function expiredByPolicy(value){
    const limit=deadline(value);
    return limit!==null&&Date.now()>=limit;
  }
  function expireLocal(value){
    clearStoredSession();
    const accessToken=value?.access_token||'';
    if(accessToken)api().signOut(accessToken,'local').catch(()=>{});
  }
  function scheduleExpiry(value){
    clearExpiryTimer();
    const limit=deadline(value);
    if(limit===null)return;
    const delay=limit-Date.now();
    if(delay<=0){expireLocal(value);return}
    expiryTimer=setTimeout(()=>{
      const current=read();
      if(!current)return;
      if(expiredByPolicy(current)){
        expireLocal(current);
        if(typeof location!=='undefined')location.href='./index.html';
      }
    },Math.min(delay,2147483647));
  }
  async function refreshIfNeeded(value){
    const claims=jwtClaims(value?.access_token);
    const expiresAt=Number(claims.exp||0)*1000;
    if(expiresAt>Date.now()+REFRESH_AHEAD_MS)return value;
    if(!value?.refresh_token){clearStoredSession();return null}
    try{
      const refreshed=await api().refreshSession(value.refresh_token);
      if(!refreshed?.access_token)throw new Error('Ingen ny access token returnerades.');
      if(requiresAal2()&&jwtClaims(refreshed.access_token).aal!=='aal2')throw new Error('MFA-nivån kunde inte behållas.');
      const knownDuration=storedDuration(value);
      return persist(refreshed,knownDuration===undefined?null:knownDuration,sessionStartedAt(value));
    }catch{
      clearStoredSession();
      return null;
    }
  }
  async function activeSession(){
    let current=read();
    if(!current)return null;
    if(expiredByPolicy(current)){expireLocal(current);return null}
    current=await refreshIfNeeded(current);
    if(!current||expiredByPolicy(current)){if(current)expireLocal(current);return null}
    return current;
  }
  async function signIn(email,password,totp=''){
    const initial=await api().signIn({email,password});
    const initialToken=initial?.access_token;
    if(!initialToken)throw new Error('Inloggningen gav ingen giltig Supabase-session.');
    let session=initial;
    if(requiresAal2()){
      const user=await api().getUser(initialToken);
      const factor=(user?.factors||[]).find(item=>item.factor_type==='totp'&&item.status==='verified');
      if(!factor){
        await api().signOut(initialToken,'local').catch(()=>{});
        throw new Error('Kontot saknar verifierad MFA. Öppna UAT-aktiveringen och slutför TOTP-registreringen.');
      }
      if(!/^[0-9]{6}$/.test(String(totp||''))){
        await api().signOut(initialToken,'local').catch(()=>{});
        throw new Error('Ange den sexsiffriga MFA-koden från din authenticator-app.');
      }
      const challenge=await api().mfaChallenge(initialToken,factor.id);
      const verified=await api().mfaVerify(initialToken,factor.id,challenge.id,String(totp));
      if(!verified?.access_token||jwtClaims(verified.access_token).aal!=='aal2'){
        await api().signOut(initialToken,'local').catch(()=>{});
        throw new Error('MFA-verifieringen misslyckades.');
      }
      session=verified;
    }
    storeSession(session);
    return context();
  }
  async function signOut(){
    const current=read();
    const accessToken=current?.access_token||'';
    if(accessToken)await api().signOut(accessToken,'global').catch(()=>{});
    clearStoredSession();
    localStorage.removeItem(COMPANY_KEY);
  }
  async function context(){
    let current=await activeSession();
    if(!current)return {authenticated:false};
    let accessToken=current.access_token;
    if(requiresAal2()&&jwtClaims(accessToken).aal!=='aal2'){
      clearStoredSession();
      return {authenticated:false,mfaRequired:true};
    }
    let authUser;
    try{authUser=await api().getUser(accessToken)}catch{clearStoredSession();return {authenticated:false}}
    const uid=authUser?.id;if(!uid){clearStoredSession();return {authenticated:false}}
    const [profiles,memberships,companies]=await Promise.all([
      api().from('app_users',accessToken).select('*','auth_user_id=eq.'+encodeURIComponent(uid)),
      api().from('company_memberships',accessToken).select('*','auth_user_id=eq.'+encodeURIComponent(uid)),
      api().from('companies',accessToken).select('*')
    ]);
    const profile=profiles?.[0]||{};
    const duration=normalizeDuration(profile.session_duration_minutes);
    const startedAt=sessionStartedAt(current);
    if(duration!==null&&Date.now()>=startedAt+duration*60*1000){
      expireLocal(current);
      return {authenticated:false,sessionExpired:true};
    }
    current=persist(current,duration,startedAt);
    accessToken=current.access_token;
    const allowed=new Set((memberships||[]).map(m=>String(m.company_id)));
    const visible=(companies||[]).filter(c=>allowed.has(String(c.id)));
    let companyId=localStorage.getItem(COMPANY_KEY)||'';
    if(!allowed.has(companyId))companyId=visible[0]?.id||'';
    if(companyId)localStorage.setItem(COMPANY_KEY,companyId);
    const company=visible.find(c=>String(c.id)===String(companyId))||visible[0]||null;
    const membership=(memberships||[]).find(m=>String(m.company_id)===String(company?.id))||null;
    return {
      authenticated:true,
      accessToken,
      authUser,
      user:{
        id:profile.id||uid,
        authUserId:uid,
        username:profile.username||authUser.email||'',
        displayName:profile.display_name||profile.username||authUser.email||'Användare',
        sessionDurationMinutes:duration
      },
      company:company?{id:company.id,name:company.display_name||company.legal_name||'Företaget',legalName:company.legal_name,orgNumber:company.org_number}:null,
      membership,
      companies:visible.map(c=>({id:c.id,name:c.display_name||c.legal_name||'Företaget'}))
    };
  }
  function setCompany(id){localStorage.setItem(COMPANY_KEY,String(id||''))}
  window.LTSupabaseUat={read,token,storeSession,signIn,signOut,context,setCompany};
})();