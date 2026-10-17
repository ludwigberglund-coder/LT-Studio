// HTTP boundary for fixed synthetic examples only. No document or posting API.
import { runSyntheticPilot } from './ai-gateway-orchestrator.mjs';
import { cloudflareProvider } from './cloudflare-bookkeeping.mjs';
import { runSyntheticFinanceProcess } from './ai-finance-process-orchestrator.mjs';
import { createFinanceCloudflareProvider } from './ai-finance-cloudflare.mjs';

export const PILOT_ORIGIN = 'https://ludwigberglund-coder.github.io';
const PROJECT_URLS = new Set([
  // This pilot is approved for isolated staging only. UAT must fail closed.
  'https://rwnqkgbbbxjjfhwtepsi.supabase.co'
]);
// Reserved aggregate bucket, NOT a hash/verification of a client's IP address.
// Every caller shares it; changing proxy headers can never evade this ceiling.
export const SHARED_BUCKET = '0'.repeat(64);
const HEADERS = Object.freeze({
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Vary':'Origin'
});
function fail(code) { return Object.assign(new Error(code), {code}); }
function secret(env, mapName, legacyName) {
  let mapped;
  try { mapped=JSON.parse(env(mapName)||'{}').default; } catch { /* fail closed below */ }
  return typeof mapped==='string'&&mapped ? mapped : env(legacyName)||'';
}
function safeCode(error) {
  const allowed=new Set([
    'INVALID_INPUT','INVALID_COMPANY','UNSUPPORTED_SCENARIO','INVALID_REQUEST_ID',
    'AUTH_REQUIRED','ACCESS_DENIED','TENANT_MISMATCH','AI_PILOT_DISABLED',
    'BUDGET_NOT_CONFIGURED','BUDGET_NOT_RESERVED','AI_DISABLED',
    'UNTRUSTED_SOURCE','MODEL_INVALID_RESPONSE','PROVIDER_UNAVAILABLE',
    'PROVIDER_REJECTED','INVALID_PROCESS_REQUEST','UNSUPPORTED_PURPOSE',
    'INVALID_MODEL_ADVICE','UNSAFE_AI_PROPOSAL','UNSAFE_AI_ADVICE',
    'AI_BACKEND_NOT_CONFIGURED','AI_RATE_LIMITED'
  ]);
  return allowed.has(error?.code) ? error.code : 'AI_PILOT_ERROR';
}
export async function readSmallJson(req, timeoutMs=2500) {
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get('content-type')||'')) throw fail('INVALID_INPUT');
  const length=req.headers.get('content-length');
  if(length!==null&&(!/^\d{1,4}$/.test(length)||Number(length)>1024)) throw fail('INVALID_INPUT');
  const reader=req.body?.getReader();
  if(!reader) throw fail('INVALID_INPUT');
  let timer,done=false,size=0;
  const parts=[];
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('INVALID_INPUT')),timeoutMs);});
  try {
    while(true) {
      const next=await Promise.race([reader.read(),deadline]);
      if(next.done){done=true;break;}
      if(!(next.value instanceof Uint8Array)||next.value.length===0) throw fail('INVALID_INPUT');
      size+=next.value.length;
      if(size>1024) throw fail('INVALID_INPUT');
      parts.push(next.value);
    }
    const data=new Uint8Array(size);let offset=0;
    for(const part of parts){data.set(part,offset);offset+=part.length;}
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
    if(!value||typeof value!=='object'||Array.isArray(value)) throw fail('INVALID_INPUT');
    return value;
  } catch { throw fail('INVALID_INPUT'); }
  finally {
    clearTimeout(timer);
    if(!done) { try { void reader.cancel().catch(()=>{}); } catch { /* do not wait for cancellation */ } }
    try { reader.releaseLock(); } catch { /* no private error propagation */ }
  }
}

export function createSyntheticHttpHandler({createClient,env,releaseApproved=false,fetchImpl=globalThis.fetch}) {
  return async function handler(req) {
    const origin=req.headers.get('origin');
    const cors=origin===PILOT_ORIGIN ? {
      'Access-Control-Allow-Origin':PILOT_ORIGIN,
      'Access-Control-Allow-Headers':'authorization, apikey, content-type',
      'Access-Control-Allow-Methods':'POST, OPTIONS'
    } : {};
    const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...HEADERS,...cors}});
    if(releaseApproved!==true) return reply(503,{code:'AI_PILOT_NOT_RELEASED'});
    try {
      const url=env('SUPABASE_URL')||'';
      if(!PROJECT_URLS.has(url)) throw fail('AI_BACKEND_NOT_CONFIGURED');
      const publishable=secret(env,'SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY');
      const serviceKey=secret(env,'SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY');
      if(!publishable||!serviceKey) throw fail('AI_BACKEND_NOT_CONFIGURED');
      const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
      // All methods and clients use one durable admission bucket BEFORE body,
      // Auth or model work. This is deliberately stricter than per-IP admission.
      const admission=await admin.rpc('admit_ai_pilot_request_server');
      if(admission.error) throw fail('BUDGET_NOT_CONFIGURED');
      if(admission.data==='disabled') throw fail('AI_PILOT_DISABLED');
      if(admission.data==='rate-limited') throw fail('AI_RATE_LIMITED');
      if(admission.data!=='allowed') throw fail('BUDGET_NOT_RESERVED');
      if(!cors['Access-Control-Allow-Origin']) return reply(403,{code:'ACCESS_DENIED'});
      if(new URL(req.url).search) throw fail('INVALID_INPUT');
      if(req.method==='OPTIONS') return new Response(null,{status:204,headers:{...HEADERS,...cors}});
      if(req.method!=='POST') return reply(405,{code:'METHOD_NOT_ALLOWED'});
      const bearer=req.headers.get('authorization')||'';
      if(!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(bearer)) throw fail('AUTH_REQUIRED');
      const token=bearer.slice(7);
      const body=await readSmallJson(req);
      const userClient=createClient(url,publishable,{
        auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:bearer}}
      });
      const reserveBudget=async params=>{
        const {data,error}=await admin.rpc('reserve_ai_pilot_request_server',{
          p_company_id:params.companyId,p_actor_uid:params.actorId,
          p_session_id:params.sessionId,p_request_id:params.requestId,
          p_client_ip_hash:SHARED_BUCKET
        });
        if(error||!data)return null;
        return Array.isArray(data)?data[0]:data;
      };
      // Only the orchestrators can reach these lazy providers, AFTER verified
      // personal Auth/AAL2/RLS, durable quotas and replay checks. No client data
      // can choose the endpoint, model or supply additional prompt fields.
      const providerFor=finance=>async (...args)=>{
        const accountId=env('CLOUDFLARE_ACCOUNT_ID')||'';
        const apiToken=env('CLOUDFLARE_AI_TOKEN')||'';
        if(!/^[0-9a-f]{32}$/i.test(accountId)||!apiToken) throw fail('AI_BACKEND_NOT_CONFIGURED');
        const factory=finance?createFinanceCloudflareProvider:cloudflareProvider;
        return factory({enabled:true,accountId,apiToken,timeoutMs:12000,fetchImpl})(...args);
      };
      if(Object.hasOwn(body,'purpose')) {
        const proposal=await runSyntheticFinanceProcess({
          body,accessToken:token,userClient,enabled:true,
          privacyApproved:true,reserveBudget,provider:providerFor(true)
        });
        return reply(200,{
          schemaVersion:proposal.schemaVersion,companyId:proposal.companyId,
          purpose:proposal.purpose,sourceId:proposal.sourceId,
          status:'manual-review',posted:false,synthetic:true,
          requiresHumanApproval:true,advice:proposal.advice
        });
      }
      const suggestion=await runSyntheticPilot({
        body,accessToken:token,userClient,pilotEnabled:true,
        privacyApproved:true,reserveBudget,provider:providerFor(false)
      });
      return reply(200,{
        status:'manual-review',sourceId:suggestion.sourceId,
        companyId:suggestion.companyId,reason:suggestion.reason,
        suggestion:suggestion.suggestion,engine:suggestion.engine,posted:false,synthetic:true
      });
    } catch(error) {
      const code=safeCode(error);
      const status=code==='AUTH_REQUIRED'?401:
        ['ACCESS_DENIED','TENANT_MISMATCH'].includes(code)?403:
        ['INVALID_INPUT','INVALID_COMPANY','UNSUPPORTED_SCENARIO','UNSUPPORTED_PURPOSE','INVALID_PROCESS_REQUEST','INVALID_REQUEST_ID'].includes(code)?422:
        ['BUDGET_NOT_RESERVED','AI_RATE_LIMITED'].includes(code)?429:503;
      return reply(status,{code,error:'AI-testet kunde inte genomforas.'});
    }
  };
}
