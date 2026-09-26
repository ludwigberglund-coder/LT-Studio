(function(){
  'use strict';
  const cfg=window.LT_SUPABASE;
  const CLOCK_SKEW_RETRY_DELAYS=[700,1400,2800];
  function headers(token,extra){return Object.assign({'apikey':cfg.publishableKey,'Content-Type':'application/json'},token?{'Authorization':'Bearer '+token}:{},extra||{});}
  function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
  function errorMessage(data,status){return (data&&typeof data==='object'&&(data.message||data.error_description||data.error))||('Supabase request failed: '+status);}
  function isJwtFutureError(message){return /jwt.*issued.*future|issued\s+at\s+future/i.test(String(message||''));}
  function isSafeToRetry(options){const method=String(options?.method||'GET').toUpperCase();return method==='GET'||method==='HEAD';}
  async function request(path,options={}){
    const requestOptions=Object.assign({},options,{headers:headers(options.token,options.headers)});
    for(let attempt=0;;attempt+=1){
      const response=await fetch(cfg.url+path,requestOptions);
      const text=await response.text(); let data=null;
      if(text){try{data=JSON.parse(text);}catch{data=text;}}
      if(response.ok)return data;
      const message=errorMessage(data,response.status);
      const canRetry=isSafeToRetry(options)&&(response.status===401||response.status===403)&&isJwtFutureError(message)&&attempt<CLOCK_SKEW_RETRY_DELAYS.length;
      if(canRetry){await sleep(CLOCK_SKEW_RETRY_DELAYS[attempt]);continue;}
      if(isJwtFutureError(message))throw new Error('Den säkra sessionen håller fortfarande på att synkroniseras. Vänta några sekunder och försök logga in igen.');
      throw new Error(message);
    }
  }
  async function storageRequest(path,token,options={}){
    const headers=Object.assign({'apikey':cfg.publishableKey,'Authorization':'Bearer '+token},options.headers||{});
    const response=await fetch(cfg.url+'/storage/v1'+path,Object.assign({},options,{headers}));
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.message||data.error||('Storage request failed: '+response.status));}
    return response;
  }
  window.LTSupabase={
    config:cfg,
    signIn:({email,password})=>request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})}),
    signOut:(token)=>request('/auth/v1/logout',{method:'POST',token}),
    getUser:(token)=>request('/auth/v1/user',{token}),
    mfaEnroll:(token,friendlyName)=>request('/auth/v1/factors',{method:'POST',token,body:JSON.stringify({factor_type:'totp',friendly_name:String(friendlyName||'LT Studio')})}),
    mfaChallenge:(token,factorId)=>request('/auth/v1/factors/'+encodeURIComponent(factorId)+'/challenge',{method:'POST',token,body:JSON.stringify({})}),
    mfaVerify:(token,factorId,challengeId,code)=>request('/auth/v1/factors/'+encodeURIComponent(factorId)+'/verify',{method:'POST',token,body:JSON.stringify({challenge_id:challengeId,code:String(code||'')})}),
    rpc:(name,args,token)=>request('/rest/v1/rpc/'+encodeURIComponent(name),{method:'POST',token,headers:{Prefer:'return=representation'},body:JSON.stringify(args||{})}),
    from:(table,token)=>({
      select:(query='*',filters='')=>request('/rest/v1/'+encodeURIComponent(table)+'?select='+encodeURIComponent(query)+(filters?'&'+filters:''),{token}),
      insert:(rows)=>request('/rest/v1/'+encodeURIComponent(table),{method:'POST',token,headers:{Prefer:'return=representation'},body:JSON.stringify(rows)}),
      upsert:(rows)=>request('/rest/v1/'+encodeURIComponent(table),{method:'POST',token,headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(rows)}),
      update:(values,filters)=>request('/rest/v1/'+encodeURIComponent(table)+'?'+filters,{method:'PATCH',token,headers:{Prefer:'return=representation'},body:JSON.stringify(values)}),
      delete:(filters)=>request('/rest/v1/'+encodeURIComponent(table)+'?'+filters,{method:'DELETE',token,headers:{Prefer:'return=representation'}})
    }),
    storage:{
      upload:async(bucket,path,file,token)=>{
        const response=await storageRequest('/object/'+encodeURIComponent(bucket)+'/'+path.split('/').map(encodeURIComponent).join('/'),token,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:file});
        return response.json().catch(()=>({}));
      },
      download:async(bucket,path,token)=>{
        const response=await storageRequest('/object/authenticated/'+encodeURIComponent(bucket)+'/'+path.split('/').map(encodeURIComponent).join('/'),token,{method:'GET'});
        return response.blob();
      },
      remove:async(bucket,paths,token)=>{
        const response=await storageRequest('/object/'+encodeURIComponent(bucket),token,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:paths})});
        return response.json().catch(()=>({}));
      }
    }
  };
})();
