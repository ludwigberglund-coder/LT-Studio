(function(){
  'use strict';
  const cfg=window.LT_SUPABASE;
  function headers(token,extra){return Object.assign({'apikey':cfg.publishableKey,'Content-Type':'application/json'},token?{'Authorization':'Bearer '+token}:{},extra||{});}
  async function request(path,options={}){
    const response=await fetch(cfg.url+path,Object.assign({},options,{headers:headers(options.token,options.headers)}));
    const text=await response.text(); let data=null;
    if(text){try{data=JSON.parse(text);}catch{data=text;}}
    if(!response.ok) throw new Error((data&&data.message)||('Supabase request failed: '+response.status));
    return data;
  }
  window.LTSupabase={
    config:cfg,
    signIn:({email,password})=>request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})}),
    signOut:(token)=>request('/auth/v1/logout',{method:'POST',token}),
    getUser:(token)=>request('/auth/v1/user',{token}),
    from:(table,token)=>({
      select:(query='*',filters='')=>request('/rest/v1/'+encodeURIComponent(table)+'?select='+encodeURIComponent(query)+(filters?'&'+filters:''),{token}),
      insert:(rows)=>request('/rest/v1/'+encodeURIComponent(table),{method:'POST',token,headers:{Prefer:'return=representation'},body:JSON.stringify(rows)}),
      update:(values,filters)=>request('/rest/v1/'+encodeURIComponent(table)+'?'+filters,{method:'PATCH',token,headers:{Prefer:'return=representation'},body:JSON.stringify(values)})
    })
  };
})();
