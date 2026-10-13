// Cloudflare AI pilot gateway: intentionally NOT activated or deployed.
// GitHub remains the source of truth for any future security/release change.
import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { runSyntheticPilot } from "../../../packages/automation/ai-gateway-orchestrator.mjs";
import { cloudflareProvider } from "../../../packages/automation/cloudflare-bookkeeping.mjs";

// Hard-code false: config and secrets cannot unlock this before a reviewed release.
const RELEASE_APPROVED = false;
const DURABLE_IP_LIMITER_VERIFIED = false;
const TRUSTED_IP_HEADER = "x-real-ip";
const REPLY_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
function respond(status: number, body: object, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {status, headers:{...REPLY_HEADERS,...extra}});
}
function gatewayError(code: string) {
  return Object.assign(new Error(code), {code});
}
function safeError(error: unknown) {
  const allowed = new Set([
    "INVALID_INPUT","INVALID_COMPANY","UNSUPPORTED_SCENARIO","INVALID_REQUEST_ID",
    "AUTH_REQUIRED","ACCESS_DENIED","TENANT_MISMATCH","AI_PILOT_DISABLED",
    "BUDGET_NOT_CONFIGURED","BUDGET_NOT_RESERVED","AI_DISABLED",
    "UNTRUSTED_SOURCE","MODEL_INVALID_RESPONSE","PROVIDER_UNAVAILABLE",
    "PROVIDER_REJECTED"
  ]);
  const code = error instanceof Error && "code" in error
    ? String(error.code) : "AI_PILOT_ERROR";
  return allowed.has(code) ? code : "AI_PILOT_ERROR";
}
function projectKeys() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const publishable = (() => {
    try { return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}").default; }
    catch { return ""; }
  })() || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = (() => {
    try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default; }
    catch { return ""; }
  })() || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return { url, publishable, serviceKey };
}
function trustedClientIp(req: Request) {
  // Hosted UAT must prove that Supabase's gateway overwrites this header before
  // DURABLE_IP_LIMITER_VERIFIED may change. Never fall back to x-forwarded-for,
  // cf-connecting-ip or a caller-selected header.
  if (Deno.env.get("AI_PILOT_TRUSTED_IP_HEADER") !== TRUSTED_IP_HEADER) {
    throw gatewayError("UNTRUSTED_SOURCE");
  }
  const value=(req.headers.get(TRUSTED_IP_HEADER)||"").trim();
  const ipv4=value.split('.');
  const validV4=ipv4.length===4&&ipv4.every((part)=>
    /^\d{1,3}$/.test(part)&&Number(part)>=0&&Number(part)<=255&&
    (part==='0'||!part.startsWith('0')));
  if (validV4) return value;
  if (value.length<2||value.length>45||!value.includes(':')||
      !/^[0-9a-f:.]+$/i.test(value)) throw gatewayError("UNTRUSTED_SOURCE");
  try {
    const host=new URL(`http://[${value}]/`).hostname;
    if (!host.startsWith('[')||!host.endsWith(']')) throw new Error('Not IPv6');
    return host.slice(1,-1).toLowerCase();
  } catch {
    throw gatewayError("UNTRUSTED_SOURCE");
  }
}
async function clientIpHash(req: Request) {
  const salt=Deno.env.get("AI_PILOT_IP_HASH_SALT")||"";
  if (salt.length<32||salt.length>256) throw gatewayError("UNTRUSTED_SOURCE");
  const bytes=new TextEncoder().encode(`${salt}\0${trustedClientIp(req)}`);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function readSmallJson(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    throw gatewayError("INVALID_INPUT");
  }
  const reader=req.body?.getReader();
  if (!reader) throw gatewayError("INVALID_INPUT");
  let size=0;
  const chunks: Uint8Array[]=[];
  try {
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.length;
      if(size>1024)throw gatewayError("INVALID_INPUT");
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const data=new Uint8Array(size); let offset=0;
  for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
  try {return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(data));}
  catch {throw gatewayError("INVALID_INPUT");}
}
function corsFor(req: Request): Record<string,string> {
  const expected=Deno.env.get("AI_PILOT_ALLOWED_ORIGIN")||"";
  const origin=req.headers.get("origin")||"";
  return expected&&/^https:\/\//.test(expected)&&origin===expected
    ? {"Access-Control-Allow-Origin":expected,
       "Access-Control-Allow-Headers":"authorization, apikey, content-type",
       "Access-Control-Allow-Methods":"POST, OPTIONS",
       "Vary":"Origin"} : {};
}
Deno.serve(async(req:Request)=>{
  const cors=corsFor(req);
  // Even a future accidental deployment of this revision will be inert.
  if(!RELEASE_APPROVED || !DURABLE_IP_LIMITER_VERIFIED){
    return respond(503,{code:"AI_PILOT_NOT_RELEASED",error:"AI-testfunktionen är ännu inte aktiverad."},cors);
  }
  if(req.method==="OPTIONS"){
    if(!cors["Access-Control-Allow-Origin"])return respond(403,{code:"ACCESS_DENIED"});
    return new Response(null,{status:204,headers:{...REPLY_HEADERS,...cors}});
  }
  if(req.method!=="POST")return respond(405,{code:"METHOD_NOT_ALLOWED"},cors);
  if(!cors["Access-Control-Allow-Origin"])return respond(403,{code:"ACCESS_DENIED"});
  if(Deno.env.get("AI_SYNTHETIC_PILOT_ENABLED")!=="true"){
    return respond(503,{code:"AI_PILOT_DISABLED"},cors);
  }
  const bearer=req.headers.get("Authorization")||"";
  if(!/^Bearer [^\s]+$/.test(bearer))return respond(401,{code:"AUTH_REQUIRED"},cors);
  const token=bearer.slice(7);
  const keys=projectKeys();
  const accountId=Deno.env.get("CLOUDFLARE_ACCOUNT_ID")||"";
  const apiToken=Deno.env.get("CLOUDFLARE_AI_TOKEN")||"";
  if(!keys.url||!keys.publishable||!keys.serviceKey||!accountId||!apiToken){
    return respond(503,{code:"AI_BACKEND_NOT_CONFIGURED"},cors);
  }
  try{
    const body=await readSmallJson(req);
    const ipHash=await clientIpHash(req);
    const userClient=createClient(keys.url,keys.publishable,{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{headers:{Authorization:bearer}}
    });
    const admin=createClient(keys.url,keys.serviceKey,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const reserveBudget=async(params: {
      companyId:string;actorId:string;sessionId:string;requestId:string;
    })=>{
      const {data,error}=await admin.rpc("reserve_ai_pilot_request_server",{
        p_company_id:params.companyId,
        p_actor_uid:params.actorId,
        p_session_id:params.sessionId,
        p_request_id:params.requestId,
        p_client_ip_hash:ipHash
      });
      if(error||!data)return null;
      return Array.isArray(data)?data[0]:data;
    };
    const provider=cloudflareProvider({
      enabled:true,accountId,apiToken,timeoutMs:12000
    });
    const suggestion=await runSyntheticPilot({
      body,accessToken:token,userClient,
      pilotEnabled:true,
      privacyApproved:Deno.env.get("AI_PILOT_PRIVACY_APPROVED")==="true",
      reserveBudget,provider
    });
    return respond(200,{
      status:"manual-review",sourceId:suggestion.sourceId,
      companyId:suggestion.companyId,reason:suggestion.reason,
      suggestion:suggestion.suggestion,engine:suggestion.engine,
      posted:false
    },cors);
  }catch(error){
    const code=safeError(error);
    const status=code==="AUTH_REQUIRED"?401:code==="ACCESS_DENIED"?403:
      code==="INVALID_INPUT"||code==="INVALID_COMPANY"||
      code==="UNSUPPORTED_SCENARIO"||code==="INVALID_REQUEST_ID"?422:
      code==="BUDGET_NOT_RESERVED"||code==="BUDGET_NOT_CONFIGURED"?429:503;
    return respond(status,{code,error:"Testförslaget kunde inte behandlas."},cors);
  }
});
