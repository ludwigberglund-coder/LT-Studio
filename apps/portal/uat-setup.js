(function(){
  'use strict';
  const bootstrapForm=document.getElementById('bootstrap-form');
  const bootstrapResult=document.getElementById('bootstrap-result');
  const resumeForm=document.getElementById('resume-form');
  const resumeResult=document.getElementById('resume-result');
  let activeSession=null;
  let activeFactor=null;

  function esc(v=''){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function errorBox(message){return '<div class="error">'+esc(message)+'</div>';}
  function sessionValue(value){activeSession=value;window.LTSupabaseUat.storeSession(value);return value;}
  function qrMarkup(qr){
    const value=String(qr||'');
    if(value.startsWith('data:image/svg+xml'))return '<img alt="QR-kod för LT Studio MFA" src="'+esc(value)+'">';
    return '';
  }
  async function beginMfa(session,target){
    const token=session?.access_token;if(!token)throw new Error('Inloggningen gav ingen giltig session.');
    const user=await window.LTSupabase.getUser(token);
    const verified=(user?.factors||[]).find(f=>f.factor_type==='totp'&&f.status==='verified');
    if(verified){
      activeFactor=verified;
      target.innerHTML='<div class="mfa-box"><strong>MFA är redan registrerad.</strong><p>Verifiera den aktuella sexsiffriga koden för att uppgradera den här nya sessionen till AAL2.</p><form id="verify-mfa-form"><label>TOTP-kod<input name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required autocomplete="one-time-code"></label><div class="actions"><button class="button" type="submit">Verifiera MFA och fortsätt</button></div></form><div id="verify-result"></div></div>';
      return;
    }
    const factor=await window.LTSupabase.mfaEnroll(token,'LT Studio UAT');
    if(!factor?.id||!factor?.totp?.secret)throw new Error('Supabase kunde inte starta MFA-registreringen.');
    activeFactor=factor;
    target.innerHTML='<div class="mfa-box"><strong>1. Lägg till LT Studio i din authenticator-app</strong>'+
      qrMarkup(factor.totp.qr_code)+
      '<p>Om QR-koden inte kan skannas, lägg in följande hemlighet manuellt:</p>'+
      '<div class="secret">'+esc(factor.totp.secret)+'</div>'+
      '<p><strong>2. Skriv sedan den aktuella sexsiffriga koden nedan.</strong></p>'+
      '<form id="verify-mfa-form"><label>TOTP-kod<input name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required autocomplete="one-time-code"></label><div class="actions"><button class="button" type="submit">Verifiera MFA och slutför</button></div></form><div id="verify-result"></div></div>';
  }

  async function verifyMfa(code){
    if(!activeSession?.access_token||!activeFactor?.id)throw new Error('MFA-registreringen saknar aktiv session.');
    const challenge=await window.LTSupabase.mfaChallenge(activeSession.access_token,activeFactor.id);
    if(!challenge?.id)throw new Error('MFA-utmaningen kunde inte skapas.');
    const verified=await window.LTSupabase.mfaVerify(activeSession.access_token,activeFactor.id,challenge.id,code);
    if(!verified?.access_token)throw new Error('MFA-koden kunde inte verifieras.');
    sessionValue(verified);
    const result=document.getElementById('verify-result');
    result.innerHTML='<div class="result"><strong>Klart – MFA är verifierad.</strong><p>Din session har nu säkerhetsnivå AAL2. UAT-kontot är redo.</p><div class="actions"><a class="button" href="./index.html">Öppna kundportalen</a><a class="button ghost" href="../operator/">Öppna driftadmin</a></div></div>';
  }

  bootstrapForm.addEventListener('submit',async event=>{
    event.preventDefault();bootstrapResult.innerHTML='';
    const fd=new FormData(bootstrapForm),payload={
      displayName:String(fd.get('displayName')||'').trim(),
      email:String(fd.get('email')||'').trim(),
      password:String(fd.get('password')||''),
      inviteCode:String(fd.get('inviteCode')||'').trim()
    };
    const button=bootstrapForm.querySelector('button[type="submit"]');button.disabled=true;
    try{
      const response=await fetch(window.LT_SUPABASE.url+'/functions/v1/uat-bootstrap',{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':window.LT_SUPABASE.publishableKey},
        body:JSON.stringify(payload)
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'UAT-kontot kunde inte skapas.');
      bootstrapResult.innerHTML='<div class="result"><strong>Kontot är skapat.</strong><p>Nu loggar sidan in dig och startar MFA-registreringen.</p></div>';
      const signed=await window.LTSupabase.signIn({email:payload.email,password:payload.password});
      sessionValue(signed);
      await beginMfa(signed,bootstrapResult);
      bootstrapForm.reset();
    }catch(error){bootstrapResult.innerHTML=errorBox(error.message);}
    finally{button.disabled=false}
  });

  resumeForm.addEventListener('submit',async event=>{
    event.preventDefault();resumeResult.innerHTML='';
    const fd=new FormData(resumeForm),email=String(fd.get('email')||'').trim(),password=String(fd.get('password')||'');
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
})();
