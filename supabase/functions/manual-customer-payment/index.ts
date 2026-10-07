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
  "AUTH_REQUIRED",
  "SESSION_EXPIRED",
  "ACCESS_DENIED",
  "MFA_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "PAYMENT_ALREADY_PENDING",
  "INVOICE_NOT_FOUND",
  "INVALID_REQUEST_ID",
  "INVALID_PAYMENT_DATE",
  "INVALID_PAYMENT_AMOUNT",
  "INVALID_BANK_ACCOUNT",
  "PAYMENT_REFERENCE_TOO_LONG",
  "PAYMENT_COMMENT_TOO_LONG",
  "PAYER_NAME_TOO_LONG",
  "BANK_IDEMPOTENCY_CONFLICT",
  "PAYMENT_REQUIRES_DEBIT_INVOICE",
  "INVOICE_NOT_POSTED",
  "INVOICE_ALREADY_SETTLED",
  "INVALID_RECEIVABLE_ACCOUNT",
  "BANK_ACCOUNT_EQUALS_RECEIVABLE_ACCOUNT",
  "CUSTOMER_NOT_FOUND",
  "PERIOD_LOCKED",
  "BATCH_NUMBER_EXHAUSTED"
] as const;

function safeDatabaseError(message:string){
  const raw=String(message||"");
  const balance=raw.match(/PAYMENT_EXCEEDS_AVAILABLE_BALANCE:(\\d+)/);
  if(balance)return {code:"PAYMENT_EXCEEDS_AVAILABLE_BALANCE",message:`PAYMENT_EXCEEDS_AVAILABLE_BALANCE:${balance[1]}`};
  for(const code of safeDbCodes){
    if(raw.includes(code))return {code,message:code};
  }
  return {code:"MANUAL_PAYMENT_STAGE_FAILED",message:"Inbetalningen kunde inte registreras."};
}

function statusFor(code:string){
  if(code==="AUTH_REQUIRED"||code==="SESSION_EXPIRED")return 401;
  if(code==="ACCESS_DENIED"||code==="MFA_REQUIRED")return 403;
  if(code==="IDEMPOTENCY_CONFLICT"||code==="PAYMENT_ALREADY_PENDING")return 409;
  if(code==="INVOICE_NOT_FOUND")return 404;
  if(code==="MANUAL_PAYMENT_STAGE_FAILED")return 500;
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
    const placement=text(body.placement)||"invoice";
    const invoiceId=text(body.invoiceId);
    const paymentDate=text(body.paymentDate);
    const amountOre=Number(body.amountOre);
    const bankAccount=text(body.bankAccount);
    const reference=text(body.reference)||null;
    const payerName=text(body.payerName)||null;
    const comment=text(body.comment)||null;

    if(!companyId)return reply(422,{error:"Företag krävs.",code:"INVALID_PAYMENT_REQUEST"});
    if(placement!=="invoice"&&placement!=="unplaced")return reply(422,{error:"Ogiltig placeringsmetod.",code:"INVALID_PAYMENT_REQUEST"});
    if(placement==="invoice"&&!invoiceId)return reply(422,{error:"Faktura krävs.",code:"INVALID_PAYMENT_REQUEST"});
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(requestId))return reply(422,{error:"Ogiltigt request-id.",code:"INVALID_REQUEST_ID"});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate))return reply(422,{error:"Ogiltigt betaldatum.",code:"INVALID_PAYMENT_DATE"});
    if(!Number.isSafeInteger(amountOre)||amountOre<=0)return reply(422,{error:"Ogiltigt betalningsbelopp.",code:"INVALID_PAYMENT_AMOUNT"});
    if(!/^19[0-9]{2}$/.test(bankAccount))return reply(422,{error:"Ogiltigt likvidkonto.",code:"INVALID_BANK_ACCOUNT"});
    if((reference?.length||0)>160)return reply(422,{error:"Betalningsreferensen är för lång.",code:"PAYMENT_REFERENCE_TOO_LONG"});
    if((payerName?.length||0)>160)return reply(422,{error:"Betalarnamnet är för långt.",code:"PAYER_NAME_TOO_LONG"});
    if((comment?.length||0)>1000)return reply(422,{error:"Kommentaren är för lång.",code:"PAYMENT_COMMENT_TOO_LONG"});

    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    if(placement==="unplaced"){
      if(bankAccount!=="1930")return reply(422,{error:"Oplacerade inbetalningar måste registreras mot konto 1930.",code:"INVALID_BANK_ACCOUNT"});
      const {data,error}=await admin.rpc("stage_manual_unplaced_bank_payment_server",{
        p_actor_uid:userData.user.id,
        p_session_id:sessionId,
        p_company_id:companyId,
        p_request_id:requestId,
        p_payment_date:paymentDate,
        p_amount_ore:amountOre,
        p_reference:reference,
        p_payer_name:payerName,
        p_comment:comment
      });
      if(error){
        const safe=safeDatabaseError(error.message);
        console.error("manual unplaced payment RPC failed",{code:error.code||"",safeCode:safe.code});
        return reply(statusFor(safe.code),{error:safe.message,code:safe.code});
      }
      const saved=Array.isArray(data)?data[0]:data;
      if(!saved)return reply(500,{error:"Den oplacerade inbetalningen kunde inte registreras.",code:"MANUAL_PAYMENT_STAGE_FAILED"});
      return reply(200,saved);
    }
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
      const safe=safeDatabaseError(error.message);
      console.error("manual-customer-payment RPC failed",{code:error.code||"",safeCode:safe.code});
      return reply(statusFor(safe.code),{error:safe.message,code:safe.code});
    }

    const staged=Array.isArray(data)?data[0]:data;
    if(!staged)return reply(500,{error:"Inbetalningen skapade ingen bunt.",code:"MANUAL_PAYMENT_STAGE_FAILED"});
    return reply(200,staged);
  }catch(error){
    console.error("manual-customer-payment unexpected failure",{name:error instanceof Error?error.name:"Error"});
    return reply(500,{error:"Inbetalningen kunde inte registreras.",code:"MANUAL_PAYMENT_EDGE_ERROR"});
  }
});
