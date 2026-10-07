import { createClient } from "npm:@supabase/supabase-js@2.117.1";

const defaultOrigins=new Set(["https://ludwigberglund-coder.github.io"]);

function allowedOrigins(){
  const out=new Set(defaultOrigins);
  for(const item of String(Deno.env.get("LT_CUSTOMER_ACTIVATION_ORIGINS")||"").split(",")){
    const value=item.trim();
    if(value)out.add(value);
  }
  return out;
}

function cors(req:Request){
  const origin=req.headers.get("origin")||"";
  const allowed=allowedOrigins();
  return {
    "Access-Control-Allow-Origin":allowed.has(origin)?origin:"https://ludwigberglund-coder.github.io",
    "Access-Control-Allow-Headers":"authorization, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Vary":"Origin",
    "Content-Type":"application/json",
    "Cache-Control":"no-store"
  };
}

const reply=(req:Request,status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors(req)});
const clean=(value:unknown)=>String(value??"").trim();

function passwordOk(value:string){
  return value.length>=12
    && /[a-zåäö]/u.test(value)
    && /[A-ZÅÄÖ]/u.test(value)
    && /[0-9]/.test(value)
    && /[^A-Za-zÅÄÖåäö0-9]/u.test(value);
}

function jwtPayload(token:string){
  try{
    const part=token.split(".")[1]||"";
    const normalized=part.replace(/-/g,"+").replace(/_/g,"/");
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,"=")));
  }catch{return {}}
}

async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
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

function publishableKey(){
  const modern=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if(modern){
    try{
      const parsed=JSON.parse(modern);
      if(parsed?.default)return parsed.default;
    }catch{}
  }
  return Deno.env.get("SUPABASE_ANON_KEY")||"";
}

async function allAuthUsers(admin:any){
  const out:any[]=[];
  for(let page=1;page<=20;page++){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});
    if(error)throw error;
    const rows=data?.users||[];
    out.push(...rows);
    if(rows.length<1000)break;
  }
  return out;
}

async function inviteFor(admin:any,codeHash:string,email:string){
  const {data,error}=await admin.from("company_activation_invites")
    .select("*").eq("code_sha256",codeHash).maybeSingle();
  if(error)throw error;
  const normalized=email.toLowerCase();
  if(!data
    || data.revoked_at
    || data.claimed_at
    || Date.parse(data.expires_at)<=Date.now()
    || String(data.recipient_email||"").toLowerCase()!==normalized){
    throw Object.assign(new Error("Aktiveringslänken är ogiltig, använd, utgången eller avsedd för en annan e-postadress."),{status:403,code:"INVALID_ACTIVATION"});
  }
  return data;
}

async function claim(admin:any,codeHash:string,email:string,authUserId:string){
  const profile=(await admin.from("app_users").select("id").eq("auth_user_id",authUserId).maybeSingle()).data;
  const appUserId=profile?.id||("user_"+crypto.randomUUID().replaceAll("-",""));
  const result=await admin.rpc("claim_company_activation_invite",{
    p_code_sha256:codeHash,
    p_email:email,
    p_auth_user_id:authUserId,
    p_app_user_id:appUserId
  });
  if(result.error)throw result.error;
  const row=result.data?.[0];
  if(!row?.company_id)throw new Error("Företagsåtkomsten kunde inte aktiveras.");
  return row;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST")return reply(req,405,{error:"Endast POST stöds.",code:"METHOD_NOT_ALLOWED"});

  const origin=req.headers.get("origin")||"";
  if(!allowedOrigins().has(origin))return reply(req,403,{error:"Kontoaktivering får endast göras från LT Studios portal.",code:"ORIGIN_NOT_ALLOWED"});

  let createdUserId:string|null=null;
  try{
    const url=Deno.env.get("SUPABASE_URL")||"";
    const secret=secretKey(),publishable=publishableKey();
    if(!url||!secret||!publishable)throw Object.assign(new Error("Aktiveringsbackend saknar Supabase-konfiguration."),{status:503,code:"ACTIVATION_BACKEND_NOT_CONFIGURED"});

    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const body=await req.json().catch(()=>({}));
    const action=clean(body.action||"create-account");
    const email=clean(body.email).toLowerCase();
    const inviteCode=clean(body.inviteCode);

    if(!email||!email.includes("@")||email.length>254)throw Object.assign(new Error("Ange den e-postadress som LT Studio har bjudit in."),{status:422,code:"INVALID_EMAIL"});
    if(inviteCode.length!==64||!/^[0-9a-f]+$/i.test(inviteCode))throw Object.assign(new Error("Aktiveringskoden är ogiltig."),{status:403,code:"INVALID_ACTIVATION"});
    const codeHash=await sha256Hex(inviteCode);
    const invite=await inviteFor(admin,codeHash,email);

    if(action==="create-account"){
      const password=String(body.password||"");
      if(!passwordOk(password))throw Object.assign(new Error("Lösenordet måste vara minst 12 tecken och innehålla stor bokstav, liten bokstav, siffra och specialtecken."),{status:422,code:"WEAK_PASSWORD"});

      const existing=(await allAuthUsers(admin)).find(user=>String(user.email||"").toLowerCase()===email);
      if(existing)throw Object.assign(new Error("E-postadressen har redan ett LT Studio-konto. Välj alternativet för befintligt konto och logga in med MFA."),{status:409,code:"ACCOUNT_EXISTS_USE_EXISTING"});

      const created=await admin.auth.admin.createUser({
        email,
        password,
        email_confirm:true,
        user_metadata:{display_name:invite.recipient_display_name}
      });
      if(created.error||!created.data?.user)throw created.error||new Error("Kontot kunde inte skapas.");
      createdUserId=created.data.user.id;

      const activated=await claim(admin,codeHash,email,createdUserId);
      createdUserId=null;
      return reply(req,201,{
        activated:true,
        newAccount:true,
        companyId:activated.company_id,
        companyName:activated.company_name,
        role:activated.membership_role,
        displayName:invite.recipient_display_name,
        requireMfa:true
      });
    }

    if(action==="claim-existing"){
      const auth=req.headers.get("Authorization")||"";
      if(!auth.startsWith("Bearer "))throw Object.assign(new Error("Logga in med det befintliga kontot först."),{status:401,code:"AUTH_REQUIRED"});
      const token=auth.slice(7);
      if(jwtPayload(token).aal!=="aal2")throw Object.assign(new Error("Befintligt konto måste verifieras med MFA innan företaget kan kopplas."),{status:403,code:"MFA_REQUIRED"});

      const userClient=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
      const current=await userClient.auth.getUser(token);
      if(current.error||!current.data?.user)throw Object.assign(new Error("Sessionen är ogiltig eller har gått ut."),{status:401,code:"AUTH_REQUIRED"});
      if(String(current.data.user.email||"").toLowerCase()!==email)throw Object.assign(new Error("Det inloggade kontot matchar inte e-postadressen som blev inbjuden."),{status:403,code:"INVITED_EMAIL_MISMATCH"});

      const activated=await claim(admin,codeHash,email,current.data.user.id);
      return reply(req,200,{
        activated:true,
        newAccount:false,
        companyId:activated.company_id,
        companyName:activated.company_name,
        role:activated.membership_role,
        requireMfa:true
      });
    }

    throw Object.assign(new Error("Okänd aktiveringsåtgärd."),{status:422,code:"INVALID_ACTION"});
  }catch(error){
    try{
      if(createdUserId){
        const url=Deno.env.get("SUPABASE_URL")||"",secret=secretKey();
        if(url&&secret){
          const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
          await admin.auth.admin.deleteUser(createdUserId);
        }
      }
    }catch{}
    console.error("company-activate",String((error as any)?.code||""),String((error as any)?.message||error));
    const status=Number((error as any)?.status||500),code=(error as any)?.code||"COMPANY_ACTIVATION_ERROR";
    return reply(req,status>=500?500:status,status>=500
      ?{error:"Kontot kunde inte aktiveras på grund av ett internt fel.",code}
      :{error:String((error as any)?.message||"Kontot kunde inte aktiveras."),code});
  }
});
