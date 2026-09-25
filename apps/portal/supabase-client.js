(function(){
  'use strict';
  const cfg=window.LT_SUPABASE;
  function headers(token,extra){return Object.assign({'apikey':cfg.publishableKey,'Content-Type':'application/json'},token?{'Authorization':'Bearer '+token}:{},extra||{});}
  async function request(path,options={}){
    const response=await fetch(cfg.url+path,Object.assign({},options,{headers:headers(options.token,options.headers)}));
    const text=await response.text(); let data=null;
    if(text){try{data=JSON.parse(text);}catch{data=text;}}
    if(!response.ok) throw new Error((data&&(data.error||data.message))||('Supabase request failed: '+response.status));
    return data;
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
    functions:{invoke:(name,body,token)=>request('/functions/v1/'+encodeURIComponent(name),{method:'POST',token,body:JSON.stringify(body||{})})},
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
