import { createClient } from "npm:@supabase/supabase-js@2.117.1";

const CLIENT_ID="68040146910-6tsr6qoehav0p2jf8f1snp5s0snv60vu.apps.googleusercontent.com";
const REDIRECT_URI="https://bwbhnotpuuhgghjpmflk.supabase.co/functions/v1/gmail-oauth-callback";
const SCOPES=["https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/gmail.send"];
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors});
const text=(v:unknown)=>String(v??"").trim();
const hex=(bytes:Uint8Array)=>[...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
async function sha256(value:string){return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))))}
function keys(){
  const url=Deno.env.get("SUPABASE_URL")||"";
  const publishable=(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}").default}catch{return ""}})()||Deno.env.get("SUPABASE_ANON_KEY")||"";
  const secret=(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default}catch{return ""}})()||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  return {url,publishable,secret};
}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply(405,{code:"METHOD_NOT_ALLOWED"});
  try{
    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer "))return reply(401,{code:"AUTH_REQUIRED"});
    const token=auth.slice(7);
    const {url,publishable,secret}=keys();
    if(!url||!publishable||!secret)return reply(503,{code:"BACKEND_NOT_CONFIGURED"});
    const userClient=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
    const {data:userData,error:userError}=await userClient.auth.getUser(token);
    if(userError||!userData.user)return reply(401,{code:"AUTH_REQUIRED"});
    const body=await req.json().catch(()=>({}));
    const companyId=text(body.companyId);
    if(!/^[0-9a-f-]{36}$/i.test(companyId))return reply(422,{code:"INVALID_COMPANY_ID"});
    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:membership,error:membershipError}=await admin.from("company_memberships").select("role").eq("company_id",companyId).eq("user_id",userData.user.id).maybeSingle();
    if(membershipError)throw membershipError;
    if(!membership||membership.role!=="admin")return reply(403,{code:"COMPANY_ADMIN_REQUIRED"});
    const stateBytes=new Uint8Array(32);crypto.getRandomValues(stateBytes);
    const state=hex(stateBytes),stateHash=await sha256(state);
    const expiresAt=new Date(Date.now()+10*60*1000).toISOString();
    const {error:insertError}=await admin.from("gmail_oauth_states").insert({state_hash:stateHash,company_id:companyId,requested_by:userData.user.id,expires_at:expiresAt});
    if(insertError)throw insertError;
    const q=new URLSearchParams({client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,response_type:"code",access_type:"offline",prompt:"consent",include_granted_scopes:"true",scope:SCOPES.join(" "),state});
    return reply(200,{authorizationUrl:"https://accounts.google.com/o/oauth2/v2/auth?"+q.toString(),expiresAt});
  }catch(error){
    console.error("gmail-oauth-start failed",{name:error instanceof Error?error.name:"Error"});
    return reply(500,{code:"GMAIL_OAUTH_START_FAILED"});
  }
});