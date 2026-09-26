'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const sessionSource=fs.readFileSync(path.join(root,'apps','portal','supabase-session.js'),'utf8');
const profileSource=fs.readFileSync(path.join(root,'apps','portal','profile.js'),'utf8');
const profileHtml=fs.readFileSync(path.join(root,'apps','portal','profile.html'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase','migrations','20260926_personal_session_duration.sql'),'utf8');

function storage(){
  const values=new Map();
  return{
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key),
    dump:()=>Object.fromEntries(values)
  };
}
function jwt(payload){
  const part=Buffer.from(JSON.stringify(payload)).toString('base64url');
  return 'x.'+part+'.y';
}
function sessionHarness({duration=120,expired=false}={}){
  const localStorage=storage(),sessionStorage=storage();
  const now=Math.floor(Date.now()/1000);
  const initialToken=jwt({sub:'auth-1',aal:'aal2',iat:now-10,exp:expired?now-5:now+3600});
  const refreshedToken=jwt({sub:'auth-1',aal:'aal2',iat:now,exp:now+3600});
  let refreshCalls=0;
  const api={
    refreshSession:async()=>{refreshCalls+=1;return{access_token:refreshedToken,refresh_token:'refresh-2'}},
    signOut:async()=>({}),
    getUser:async token=>({id:'auth-1',email:'user@example.test',token}),
    from:table=>({
      select:async()=>{
        if(table==='app_users')return[{id:'user-1',auth_user_id:'auth-1',username:'user@example.test',display_name:'Test User',session_duration_minutes:duration}];
        if(table==='company_memberships')return[{company_id:'company-1',auth_user_id:'auth-1',role:'admin'}];
        if(table==='companies')return[{id:'company-1',display_name:'Testbolaget',legal_name:'Testbolaget AB',org_number:'556000-0000'}];
        return[];
      }
    })
  };
  const window={LT_SUPABASE:{environment:'uat'},LTSupabase:api};
  const sandbox={
    window,localStorage,sessionStorage,
    location:{href:''},
    setTimeout:()=>1,clearTimeout:()=>{},
    atob:value=>Buffer.from(value,'base64').toString('binary'),
    Date,JSON,Object,String,Number,Set,Math,Promise,encodeURIComponent
  };
  vm.runInNewContext(sessionSource,sandbox,{filename:'supabase-session.js'});
  window.LTSupabaseUat.storeSession({access_token:initialToken,refresh_token:'refresh-1'});
  return{window,localStorage,sessionStorage,get refreshCalls(){return refreshCalls},initialToken,refreshedToken};
}

test('profile page loads Supabase runtime and uses GitHub Pages as live UAT',()=>{
  assert.match(profileHtml,/supabase-config\.js/);
  assert.match(profileHtml,/supabase-client\.js/);
  assert.match(profileHtml,/supabase-session\.js/);
  assert.match(profileSource,/const isSupabase=location\.hostname==='ludwigberglund-coder\.github\.io'&&!isDemo/);
  assert.match(profileSource,/session_duration_minutes/);
  assert.match(profileSource,/LTSupabaseUat\.signOut\(\)/);
});

test('fixed personal session duration is persisted across browser restarts',async()=>{
  const h=sessionHarness({duration:120});
  const ctx=await h.window.LTSupabaseUat.context();
  assert.equal(ctx.authenticated,true);
  assert.equal(ctx.user.sessionDurationMinutes,120);
  assert.ok(h.localStorage.getItem('lt-studio-supabase-uat-session-v1'));
  assert.equal(h.sessionStorage.getItem('lt-studio-supabase-uat-session-v1'),null);
});

test('browser-session choice stays in sessionStorage only',async()=>{
  const h=sessionHarness({duration:null});
  const ctx=await h.window.LTSupabaseUat.context();
  assert.equal(ctx.authenticated,true);
  assert.equal(ctx.user.sessionDurationMinutes,null);
  assert.ok(h.sessionStorage.getItem('lt-studio-supabase-uat-session-v1'));
  assert.equal(h.localStorage.getItem('lt-studio-supabase-uat-session-v1'),null);
});

test('expired access token is refreshed without resetting personal session start',async()=>{
  const h=sessionHarness({duration:120,expired:true});
  const ctx=await h.window.LTSupabaseUat.context();
  assert.equal(ctx.authenticated,true);
  assert.equal(h.refreshCalls,1);
  assert.equal(ctx.accessToken,h.refreshedToken);
  const stored=JSON.parse(h.localStorage.getItem('lt-studio-supabase-uat-session-v1'));
  assert.ok(Number(stored._lt_session_started_at)>0);
  assert.equal(stored._lt_session_duration_minutes,120);
});

test('app_users update is column-limited, owner-scoped and AAL2-restricted',()=>{
  assert.match(migration,/grant update \(session_duration_minutes\) on table public\.app_users to authenticated/i);
  assert.match(migration,/as restrictive\s+for all\s+to authenticated/i);
  assert.match(migration,/auth_user_id=\(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(migration,/grant update on table public\.app_users/i);
});


test('personal session limit is also enforced at the Supabase RLS boundary',()=>{
  const guard=fs.readFileSync(path.join(root,'supabase','migrations','20260926_personal_session_server_guard.sql'),'utf8');
  assert.match(guard,/create or replace function private\.lt_personal_session_allowed\(\)/i);
  assert.match(guard,/security definer/i);
  assert.match(guard,/set search_path to ''/i);
  assert.match(guard,/auth\.sessions/i);
  assert.match(guard,/auth\.jwt\(\)->>'session_id'/i);
  assert.match(guard,/coalesce\(\(select auth\.jwt\(\)->>'aal'\),'aal1'\) <> 'aal2'/i);
  assert.match(guard,/as restrictive for all to authenticated/i);
  assert.match(guard,/private\.lt_personal_session_allowed\(\)/i);
  assert.match(guard,/revoke all on function private\.lt_personal_session_allowed\(\) from public/i);
});
