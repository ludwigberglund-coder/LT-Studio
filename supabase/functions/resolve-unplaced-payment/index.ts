import { createClient } from "npm:@supabase/supabase-js@2.117.1";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json",
  "Cache-Control":"no-store"
};

const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors});
const text=(value:unknown)=>String(value??"").trim();

function jwtPayload(token:string){
  try{
    const part=token.split(".")[1]||"";
    const normalized=part.replace(/-/g,"+").replace(/_/g,"/");
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,"=")));
  }catch{return {}}
}

function projectKeys(){
  const url=Deno.env.get("SUPABASE_URL")||"";
  const publishable=(()=>{
    try{return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}").default}
    catch{return ""}
  })()||Deno.env.get("SUPABASE_ANON_KEY")||"";
  const secret=(()=>{
    try{return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default}
    catch{return ""}
  })()||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  return {url,publishable,secret};
}

const safeDbCodes=[
  "AUTH_REQUIRED","SESSION_EXPIRED","ACCESS_DENIED","INVALID_RESOLUTION_TYPE",
  "INVALID_COUNTER_ACCOUNT","SUBLEDGER_ACCOUNT_BLOCKED","INVALID_DESCRIPTION",
  "INVALID_REQUEST_ID","IDEMPOTENCY_CONFLICT","BANK_PAYMENT_ALREADY_RESOLVED",
  "BANK_PAYMENT_NOT_FOUND","INVALID_BANK_PAYMENT_STATUS","UNSUPPORTED_CURRENCY",
  "PERIOD_LOCKED","BANK_PAYMENT_CONFLICT"
] as const;

function safeDatabaseError(message:string){
  const raw=String(message||"");
  for(const code of safeDbCodes){
    if(raw.includes(code))return {code,message:code};
  }
  return {code:"UNPLACED_PAYMENT_RESOLUTION_FAILED",message:"Betalningen kunde inte bokföras."};
}

function statusFor(code:string){
  if(code==="AUTH_REQUIRED"||code==="SESSION_EXPIRED")return 401;
  if(code==="ACCESS_DENIED")return 403;
  if(["IDEMPOTENCY_CONFLICT","BANK_PAYMENT_ALREADY_RESOLVED","INVALID_BANK_PAYMENT_STATUS","BANK_PAYMENT_CONFLICT"].includes(code))return 409;
  if(code==="BANK_PAYMENT_NOT_FOUND")return 404;
  if(code==="UNPLACED_PAYMENT_RESOLUTION_FAILED")return 500;
  return 422;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply(405,{error:"Endast POST stöds.",code:"METHOD_NOT_ALLOWED"});

  try{
    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer "))return reply(401,{error:"Inloggning krävs.",code:"AUTH_REQUIRED"});
    const token=auth.slice(7);
    const {url,publishable,secret}=projectKeys();
    if(!url||!publishable||!secret)return reply(503,{error:"Betalningsfunktionen saknar serverkonfiguration.",code:"BACKEND_NOT_CONFIGURED"});

    const userClient=createClient(url,publishable,{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{headers:{Authorization:auth}}
    });
    const {data:userData,error:userError}=await userClient.auth.getUser(token);
    if(userError||!userData?.user)return reply(401,{error:"Sessionen är ogiltig eller har gått ut.",code:"AUTH_REQUIRED"});

    const claims=jwtPayload(token);
    if(claims.aal!=="aal2")return reply(403,{error:"Oplacerade betalningar kräver MFA-verifierad session.",code:"MFA_REQUIRED"});
    const sessionId=text(claims.session_id);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)){
      return reply(401,{error:"Sessionen saknar giltigt sessions-id.",code:"SESSION_EXPIRED"});
    }

    const body=await req.json().catch(()=>({}));
    const companyId=text(body.companyId);
    const bankPaymentId=text(body.bankPaymentId);
    const resolutionType=text(body.resolutionType);
    const counterAccount=text(body.counterAccount);
    const description=text(body.description);
    const requestId=text(body.requestId);

    if(!companyId||!bankPaymentId)return reply(422,{error:"Företag och bankhändelse krävs.",code:"INVALID_REQUEST"});
    if(!["other-income","outgoing"].includes(resolutionType))return reply(422,{error:"Ogiltig hanteringstyp.",code:"INVALID_RESOLUTION_TYPE"});
    if(!/^\d{4}$/.test(counterAccount))return reply(422,{error:"Motkontot måste vara fyrsiffrigt.",code:"INVALID_COUNTER_ACCOUNT"});
    if(["1510","1930","2440"].includes(counterAccount))return reply(422,{error:"Kontot måste hanteras i sitt särskilda reskontra- eller bankflöde.",code:"SUBLEDGER_ACCOUNT_BLOCKED"});
    if(description.length<3||description.length>240)return reply(422,{error:"Beskrivningen måste vara 3–240 tecken.",code:"INVALID_DESCRIPTION"});
    if(!/^[A-Za-z0-9._:-]{8,180}$/.test(requestId))return reply(422,{error:"Ogiltigt request-id.",code:"INVALID_REQUEST_ID"});

    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await admin.rpc("resolve_unplaced_bank_payment_server",{
      p_actor_uid:userData.user.id,
      p_session_id:sessionId,
      p_company_id:companyId,
      p_bank_payment_id:bankPaymentId,
      p_resolution_type:resolutionType,
      p_counter_account:counterAccount,
      p_description:description,
      p_request_id:requestId
    });

    if(error){
      const safe=safeDatabaseError(error.message);
      console.error("resolve-unplaced-payment RPC failed",{code:error.code||"",safeCode:safe.code});
      return reply(statusFor(safe.code),{error:safe.message,code:safe.code});
    }

    const resolved=Array.isArray(data)?data[0]:data;
    if(!resolved)return reply(500,{error:"Betalningen skapade ingen bokföringspost.",code:"UNPLACED_PAYMENT_RESOLUTION_FAILED"});
    return reply(200,resolved);
  }catch(error){
    console.error("resolve-unplaced-payment unexpected failure",{name:error instanceof Error?error.name:"Error"});
    return reply(500,{error:"Betalningen kunde inte bokföras.",code:"UNPLACED_PAYMENT_EDGE_ERROR"});
  }
});
