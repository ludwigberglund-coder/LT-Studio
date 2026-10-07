(function(){
  'use strict';

  const newForm=document.getElementById('new-account-form');
  const existingForm=document.getElementById('existing-account-form');
  const resumeForm=document.getElementById('resume-form');
  const newResult=document.getElementById('new-account-result');
  const existingResult=document.getElementById('existing-account-result');
  const resumeResult=document.getElementById('resume-result');
  let activeSession=null;
  let activeFactor=null;
  let activeCompanyId='';

  function esc(value=''){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function errorBox(message){return '<div class="error">'+esc(message)+'</div>';}
  function sessionValue(value){activeSession=value;window.LTSupabaseUat.storeSession(value);return value;}
  function extractInvite(){
    const params=new URLSearchParams(location.hash.replace(/^#/,''));
    const code=String(params.get('code')||'').trim();
    if(code){
      document.querySelectorAll('input[name="inviteCode"]').forEach(input=>{input.value=code});
      history.replaceState(null,'',location.pathname+location.search);
    }
  }
  function qrMarkup(qr){
    const value=String(qr||'');
    return value.startsWith('data:image/svg+xml')?'<img alt="QR-kod för LT Studio MFA" src="'+esc(value)+'">':'';
  }
  async function beginMfa(session,target,companyId=''){
    const token=session?.access_token;
    if(!token)throw new Error('Inloggningen gav ingen giltig session.');
    activeCompanyId=companyId||activeCompanyId;
    const user=await window.LTSupabase.getUser(token);
    const verified=(user?.factors||[]).find(f=>f.factor_type==='totp'&&f.status==='verified');
    if(verified){
      activeFactor=verified;
      target.innerHTML='<div class="mfa-box"><strong>MFA finns redan på kontot.</strong><p>Verifiera den aktuella sexsiffriga koden för att öppna företagsportalen med AAL2.</p><form id="verify-mfa-form" class="activation-form"><label>MFA-kod<input name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required autocomplete="one-time-code"></label><div class="actions"><button class="button" type="submit">Verifiera MFA</button></div></form><div id="verify-result"></div></div>';
      return;
    }
    const factor=await window.LTSupabase.mfaEnroll(token,'LT Studio');
    if(!factor?.id||!factor?.totp?.secret)throw new Error('MFA-registreringen kunde inte startas.');
    activeFactor=factor;
    target.innerHTML='<div class="mfa-box"><strong>1. Lägg till LT Studio i din authenticator-app</strong>'+
      qrMarkup(factor.totp.qr_code)+
      '<p>Om QR-koden inte kan skannas, lägg in följande hemlighet manuellt:</p>'+
      '<div class="secret">'+esc(factor.totp.secret)+'</div>'+
      '<p><strong>2. Skriv sedan den aktuella sexsiffriga koden.</strong></p>'+
      '<form id="verify-mfa-form" class="activation-form"><label>MFA-kod<input name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required autocomplete="one-time-code"></label><div class="actions"><button class="button" type="submit">Verifiera MFA och öppna portalen</button></div></form><div id="verify-result"></div></div>';
  }

  async function verifyMfa(code){
    if(!activeSession?.access_token||!activeFactor?.id)throw new Error('MFA-registreringen saknar en aktiv session.');
    const challenge=await window.LTSupabase.mfaChallenge(activeSession.access_token,activeFactor.id);
    if(!challenge?.id)throw new Error('MFA-utmaningen kunde inte skapas.');
    const verified=await window.LTSupabase.mfaVerify(activeSession.access_token,activeFactor.id,challenge.id,code);
    if(!verified?.access_token)throw new Error('MFA-koden kunde inte verifieras.');
    sessionValue(verified);
    if(activeCompanyId)window.LTSupabaseUat.setCompany(activeCompanyId);
    const result=document.getElementById('verify-result');
    result.innerHTML='<div class="result"><strong>Klart – kontot är säkert aktiverat.</strong><p>MFA är verifierad och företagsåtkomsten är redo.</p><div class="actions"><a class="button" href="./index.html">Öppna företagsportalen</a></div></div>';
  }

  async function verifyExistingSession(email,password,totp){
    const signed=await window.LTSupabase.signIn({email,password});
    const user=signed?.user||await window.LTSupabase.getUser(signed.access_token);
    const factor=(user?.factors||[]).find(item=>item.factor_type==='totp'&&item.status==='verified');
    if(!factor){
      await window.LTSupabase.signOut(signed.access_token,'global').catch(()=>{});
      throw new Error('Det befintliga kontot saknar verifierad MFA. Slutför MFA först.');
    }
    const challenge=await window.LTSupabase.mfaChallenge(signed.access_token,factor.id);
    const verified=await window.LTSupabase.mfaVerify(signed.access_token,factor.id,challenge.id,String(totp||''));
    if(!verified?.access_token)throw new Error('MFA-verifieringen misslyckades.');
    return verified;
  }

  newForm.addEventListener('submit',async event=>{
    event.preventDefault();
    newResult.innerHTML='';
    const data=Object.fromEntries(new FormData(newForm).entries());
    const email=String(data.email||'').trim().toLowerCase(),password=String(data.password||''),inviteCode=String(data.inviteCode||'').trim();
    const button=newForm.querySelector('button[type="submit"]');button.disabled=true;
    try{
      const activated=await window.LTSupabase.functions.invoke('company-activate',{action:'create-account',email,password,inviteCode});
      const signed=await window.LTSupabase.signIn({email,password});
      sessionValue(signed);
      newResult.innerHTML='<div class="result"><strong>Kontot är skapat.</strong><p>Nu återstår MFA innan företagsdata kan öppnas.</p></div>';
      await beginMfa(signed,newResult,activated.companyId);
      newForm.reset();
    }catch(error){newResult.innerHTML=errorBox(error.message);}
    finally{button.disabled=false}
  });

  existingForm.addEventListener('submit',async event=>{
    event.preventDefault();
    existingResult.innerHTML='';
    const data=Object.fromEntries(new FormData(existingForm).entries());
    const email=String(data.email||'').trim().toLowerCase(),password=String(data.password||''),totp=String(data.totp||'').trim(),inviteCode=String(data.inviteCode||'').trim();
    const button=existingForm.querySelector('button[type="submit"]');button.disabled=true;
    try{
      const verified=await verifyExistingSession(email,password,totp);
      const activated=await window.LTSupabase.functions.invoke('company-activate',{action:'claim-existing',email,inviteCode},verified.access_token);
      sessionValue(verified);
      window.LTSupabaseUat.setCompany(activated.companyId);
      existingResult.innerHTML='<div class="result"><strong>Företaget är kopplat.</strong><p>Ditt befintliga konto behåller sitt lösenord och sin MFA.</p><div class="actions"><a class="button" href="./index.html">Öppna '+esc(activated.companyName||'företagsportalen')+'</a></div></div>';
      existingForm.reset();
    }catch(error){
      window.LTSupabaseUat.storeSession(null);
      existingResult.innerHTML=errorBox(error.message);
    }finally{button.disabled=false}
  });

  resumeForm.addEventListener('submit',async event=>{
    event.preventDefault();
    resumeResult.innerHTML='';
    const data=Object.fromEntries(new FormData(resumeForm).entries());
    const email=String(data.email||'').trim(),password=String(data.password||'');
    const button=resumeForm.querySelector('button[type="submit"]');button.disabled=true;
    try{
      const signed=await window.LTSupabase.signIn({email,password});
      sessionValue(signed);
      await beginMfa(signed,resumeResult);
    }catch(error){resumeResult.innerHTML=errorBox(error.message);}
    finally{button.disabled=false}
  });

  document.addEventListener('submit',async event=>{
    if(event.target.id!=='verify-mfa-form')return;
    event.preventDefault();
    const form=event.target,code=String(new FormData(form).get('code')||'').trim();
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    try{await verifyMfa(code)}catch(error){document.getElementById('verify-result').innerHTML=errorBox(error.message);button.disabled=false}
  });

  extractInvite();
})();