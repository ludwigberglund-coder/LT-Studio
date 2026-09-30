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

function statusFor(message:string){
  if(/AUTH_REQUIRED|SESSION_EXPIRED|invalid.*jwt|token/i.test(message))return 401;
  if(/ACCESS_DENIED|MFA_REQUIRED/i.test(message))return 403;
  if(/IDEMPOTENCY_CONFLICT|PAYMENT_ALREADY_PENDING/i.test(message))return 409;
  if(/INVOICE_NOT_FOUND/i.test(message))return 404;
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
    if(claims.aal!=="aal2")return reply(403,{error:"Manuell inbetalning kräver MFA-verifierad session.",code:"MFA_REQUIRED"});
    const sessionId=text(claims.session_id);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)){
      return reply(401,{error:"Sessionen saknar giltigt sessions-id.",code:"SESSION_EXPIRED"});
    }

    const body=await req.json().catch(()=>({}));
    const companyId=text(body.companyId);
    const requestId=text(body.requestId);
    const invoiceId=text(body.invoiceId);
    const paymentDate=text(body.paymentDate);
    const amountOre=Number(body.amountOre);
    const bankAccount=text(body.bankAccount);
    const reference=text(body.reference)||null;
    const comment=text(body.comment)||null;

    if(!companyId||!invoiceId)return reply(422,{error:"Företag och faktura krävs.",code:"INVALID_PAYMENT_REQUEST"});
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(requestId))return reply(422,{error:"Ogiltigt request-id.",code:"INVALID_REQUEST_ID"});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate))return reply(422,{error:"Ogiltigt betaldatum.",code:"INVALID_PAYMENT_DATE"});
    if(!Number.isSafeInteger(amountOre)||amountOre<=0)return reply(422,{error:"Ogiltigt betalningsbelopp.",code:"INVALID_PAYMENT_AMOUNT"});
    if(!/^19[0-9]{2}$/.test(bankAccount))return reply(422,{error:"Ogiltigt likvidkonto.",code:"INVALID_BANK_ACCOUNT"});
    if((reference?.length||0)>160)return reply(422,{error:"Betalningsreferensen är för lång.",code:"PAYMENT_REFERENCE_TOO_LONG"});
    if((comment?.length||0)>1000)return reply(422,{error:"Kommentaren är för lång.",code:"PAYMENT_COMMENT_TOO_LONG"});

    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await admin.rpc("stage_manual_customer_payment_server",{
      p_actor_uid:userData.user.id,
      p_session_id:sessionId,
      p_company_id:companyId,
      p_request_id:requestId,
      p_invoice_id:invoiceId,
      p_payment_date:paymentDate,
      p_amount_ore:amountOre,
      p_bank_account:bankAccount,
      p_reference:reference,
      p_comment:comment
    });
    if(error){
      const message=String(error.message||"Inbetalningen kunde inte registreras.");
      return reply(statusFor(message),{error:message,code:error.code||"MANUAL_PAYMENT_STAGE_FAILED"});
    }

    const staged=Array.isArray(data)?data[0]:data;
    if(!staged)return reply(500,{error:"Inbetalningen skapade ingen bunt.",code:"MANUAL_PAYMENT_STAGE_FAILED"});
    return reply(200,staged);
  }catch(error){
    const message=String((error as Error)?.message||error||"Inbetalningen kunde inte registreras.");
    return reply(500,{error:message,code:"MANUAL_PAYMENT_EDGE_ERROR"});
  }
});
