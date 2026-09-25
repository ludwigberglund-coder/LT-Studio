import { createClient } from "npm:@supabase/supabase-js@2.117.1";

const allowedOrigins=new Set([
  "https://ludwigberglund-coder.github.io"
]);

function cors(req:Request){
  const origin=req.headers.get("origin")||"";
  return {
    "Access-Control-Allow-Origin":allowedOrigins.has(origin)?origin:"https://ludwigberglund-coder.github.io",
    "Access-Control-Allow-Headers":"content-type, apikey",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Vary":"Origin",
    "Content-Type":"application/json",
    "Cache-Control":"no-store"
  };
}
const reply=(req:Request,status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors(req)});
const clean=(v:unknown)=>String(v??"").trim();
function passwordOk(value:string){
  return value.length>=12
    && /[a-zåäö]/u.test(value)
    && /[A-ZÅÄÖ]/u.test(value)
    && /[0-9]/.test(value)
    && /[^A-Za-zÅÄÖåäö0-9]/u.test(value);
}
async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function secretKey(){
  const modern=Deno.env.get("SUPABASE_SECRET_KEYS");
  if(modern){
    try{
      const parsed=JSON.parse(modern);
      if(parsed?.default)return parsed.default;
    }catch{}
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
}
async function releaseInvite(admin:any,id:string){
  await admin.from("uat_bootstrap_invites").update({
    use_count:0,claimed_email:null,claimed_auth_user_id:null,claimed_at:null
  }).eq("id",id).eq("use_count",1);
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST")return reply(req,405,{error:"Endast POST stöds.",code:"METHOD_NOT_ALLOWED"});
  const origin=req.headers.get("origin")||"";
  if(origin&&!allowedOrigins.has(origin))return reply(req,403,{error:"UAT-aktivering får endast köras från LT Studios GitHub Pages.",code:"ORIGIN_NOT_ALLOWED"});

  let claimedInviteId:string|null=null;
  let createdUserId:string|null=null;
  try{
    const url=Deno.env.get("SUPABASE_URL")||"";
    const secret=secretKey();
    if(!url||!secret)throw Object.assign(new Error("Bootstrap-backend saknar Supabase-konfiguration."),{status:503,code:"BOOTSTRAP_BACKEND_NOT_CONFIGURED"});
    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const body=await req.json().catch(()=>({}));
    const email=clean(body.email).toLowerCase();
    const password=String(body.password||"");
    const displayName=clean(body.displayName);
    const inviteCode=clean(body.inviteCode);

    if(!email||!email.includes("@")||email.length>254)throw Object.assign(new Error("Ange en giltig e-postadress."),{status:422,code:"INVALID_EMAIL"});
    if(displayName.length<2||displayName.length>120)throw Object.assign(new Error("Namnet måste vara 2–120 tecken."),{status:422,code:"INVALID_DISPLAY_NAME"});
    if(!passwordOk(password))throw Object.assign(new Error("Lösenordet måste vara minst 12 tecken och innehålla stor bokstav, liten bokstav, siffra och specialtecken."),{status:422,code:"WEAK_PASSWORD"});
    if(inviteCode.length<40||inviteCode.length>160)throw Object.assign(new Error("Engångskoden är ogiltig."),{status:403,code:"INVALID_INVITE"});

    const codeHash=await sha256Hex(inviteCode);
    const {data:invite,error:inviteError}=await admin.from("uat_bootstrap_invites")
      .select("*").eq("code_sha256",codeHash).maybeSingle();
    if(inviteError)throw inviteError;
    if(!invite||invite.use_count>=invite.max_uses||Date.parse(invite.expires_at)<=Date.now()){
      throw Object.assign(new Error("Engångskoden är ogiltig, använd eller har gått ut."),{status:403,code:"INVALID_INVITE"});
    }

    const {data:claimed,error:claimError}=await admin.from("uat_bootstrap_invites").update({
      use_count:invite.use_count+1,
      claimed_email:email,
      claimed_at:new Date().toISOString()
    }).eq("id",invite.id).eq("use_count",invite.use_count).select("*").maybeSingle();
    if(claimError)throw claimError;
    if(!claimed)throw Object.assign(new Error("Engångskoden hann användas av någon annan."),{status:409,code:"INVITE_ALREADY_USED"});
    claimedInviteId=invite.id;

    const {data:created,error:createError}=await admin.auth.admin.createUser({
      email,password,email_confirm:true,user_metadata:{display_name:displayName}
    });
    if(createError||!created?.user){
      await releaseInvite(admin,invite.id);
      claimedInviteId=null;
      if(String(createError?.message||"").toLowerCase().includes("already"))throw Object.assign(new Error("E-postadressen har redan ett Supabase-konto. Använd en annan UAT-adress eller kontakta LT Studio."),{status:409,code:"USER_ALREADY_EXISTS"});
      throw createError||new Error("Auth-kontot kunde inte skapas.");
    }
    createdUserId=created.user.id;
    const appUserId="user_"+crypto.randomUUID().replaceAll("-","");

    const {error:profileError}=await admin.from("app_users").insert({
      id:appUserId,
      auth_user_id:created.user.id,
      username:email,
      display_name:displayName,
      disabled:false,
      session_duration_minutes:480
    });
    if(profileError)throw profileError;

    const {error:membershipError}=await admin.from("company_memberships").insert({
      company_id:invite.company_id,
      auth_user_id:created.user.id,
      user_id:appUserId,
      role:invite.membership_role
    });
    if(membershipError)throw membershipError;

    if(invite.grant_operator){
      const {error:operatorError}=await admin.from("platform_operators").insert({
        auth_user_id:created.user.id,
        display_name:displayName,
        disabled:false
      });
      if(operatorError)throw operatorError;
    }

    const {error:finishError}=await admin.from("uat_bootstrap_invites").update({
      claimed_auth_user_id:created.user.id
    }).eq("id",invite.id).eq("use_count",invite.use_count+1);
    if(finishError)throw finishError;

    await admin.from("operator_audit_events").insert({
      operator_auth_user_id:invite.grant_operator?created.user.id:null,
      action:"UAT_BOOTSTRAP_ACCOUNT_CREATED",
      company_id:invite.company_id,
      target_auth_user_id:created.user.id,
      details:{label:invite.label,membershipRole:invite.membership_role,grantOperator:Boolean(invite.grant_operator)}
    });

    return reply(req,201,{
      created:true,
      email,
      displayName,
      companyId:invite.company_id,
      membershipRole:invite.membership_role,
      operator:Boolean(invite.grant_operator),
      requireMfa:Boolean(invite.grant_operator)
    });
  }catch(error){
    try{
      const url=Deno.env.get("SUPABASE_URL")||"",secret=secretKey();
      if(url&&secret){
        const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
        if(createdUserId){
          await admin.auth.admin.deleteUser(createdUserId).catch(()=>{});
          createdUserId=null;
        }
        if(claimedInviteId)await releaseInvite(admin,claimedInviteId);
      }
    }catch{}
    console.error("uat-bootstrap",String((error as any)?.code||""),String((error as any)?.message||error));
    const status=Number((error as any)?.status||500);
    const code=(error as any)?.code||"BOOTSTRAP_ERROR";
    return reply(req,status>=500?500:status,status>=500
      ?{error:"UAT-kontot kunde inte skapas på grund av ett internt fel.",code}
      :{error:String((error as any)?.message||"UAT-kontot kunde inte skapas."),code});
  }
});
