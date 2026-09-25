import { createClient } from "npm:@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json",
  "Cache-Control":"no-store"
};

const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors});
const text=(v:unknown)=>String(v??"").trim();
const allowedRoles=new Set(["admin","accountant","approver","readonly"]);
const incidentStates=new Set(["new","reviewed","investigating","resolved"]);

function jwtPayload(token:string){
  try{
    const part=token.split(".")[1]||"";
    const normalized=part.replace(/-/g,"+").replace(/_/g,"/");
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,"=")));
  }catch{return {}}
}
function passwordOk(value:string){
  return value.length>=8&&/[a-zåäö]/u.test(value)&&/[A-ZÅÄÖ]/u.test(value)&&(/[0-9]/.test(value)||/[^A-Za-zÅÄÖåäö0-9]/u.test(value));
}
function severity(eventType:string){
  const value=eventType.toUpperCase();
  if(/CRITICAL|BREACH|DIRECT_.*BLOCKED|INTEGRITY_ERROR/.test(value))return "critical";
  if(/SECURITY|FAIL|DENIED|REJECT|INVALID|LOCK/.test(value))return "warning";
  return "info";
}
function monthKey(value:string){return String(value||"").slice(0,7)}
function recentMonths(count=6){
  const now=new Date(),out:string[]=[];
  for(let i=count-1;i>=0;i--){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1));out.push(d.toISOString().slice(0,7))}
  return out;
}
async function allAuthUsers(admin:any){
  const out:any[]=[];
  for(let page=1;page<=20;page++){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});
    if(error)throw error;
    const rows=data?.users||[];out.push(...rows);
    if(rows.length<1000)break;
  }
  return out;
}
async function audit(admin:any,operatorId:string,action:string,{companyId=null,targetUserId=null,details={}}:any={}){
  const {error}=await admin.from("operator_audit_events").insert({
    operator_auth_user_id:operatorId,action,company_id:companyId,target_auth_user_id:targetUserId,details
  });
  if(error)throw error;
}
async function authContext(req:Request){
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))throw Object.assign(new Error("Inloggning krävs."),{status:401,code:"OPERATOR_AUTH_REQUIRED"});
  const token=auth.slice(7);
  const url=Deno.env.get("SUPABASE_URL")||"";
  const publishable=(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}").default}catch{return ""}})()||Deno.env.get("SUPABASE_ANON_KEY")||"";
  const secret=(()=>{try{return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default}catch{return ""}})()||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!url||!publishable||!secret)throw Object.assign(new Error("Operator-backend saknar Supabase-konfiguration."),{status:503,code:"OPERATOR_BACKEND_NOT_CONFIGURED"});
  const userClient=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
  const {data:userData,error:userError}=await userClient.auth.getUser(token);
  if(userError||!userData?.user)throw Object.assign(new Error("Sessionen är ogiltig eller har gått ut."),{status:401,code:"OPERATOR_AUTH_REQUIRED"});
  const claims=jwtPayload(token);
  if(claims.aal!=="aal2")throw Object.assign(new Error("LT Studio-admin kräver MFA-verifierad session."),{status:403,code:"OPERATOR_MFA_REQUIRED"});
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:operator,error:operatorError}=await admin.from("platform_operators").select("*").eq("auth_user_id",userData.user.id).maybeSingle();
  if(operatorError)throw operatorError;
  if(!operator||operator.disabled)throw Object.assign(new Error("Kontot är inte ett aktivt LT Studio-operatörskonto."),{status:403,code:"OPERATOR_ACCESS_DENIED"});
  return {admin,user:userData.user,operator,claims};
}
async function overview(admin:any){
  const since30=new Date(Date.now()-30*86400000).toISOString(),months=recentMonths();
  const [companiesQ,membersQ,usersQ,customersQ,invoicesQ,auditQ,authUsers]=await Promise.all([
    admin.from("companies").select("*"),
    admin.from("company_memberships").select("*"),
    admin.from("app_users").select("*"),
    admin.from("customers").select("id,company_id,created_at"),
    admin.from("invoices").select("id,company_id,created_at"),
    admin.from("audit_events").select("id,company_id,event_type,created_at").order("created_at",{ascending:false}).limit(5000),
    allAuthUsers(admin)
  ]);
  for(const q of [companiesQ,membersQ,usersQ,customersQ,invoicesQ,auditQ])if(q.error)throw q.error;
  const companies=companiesQ.data||[],members=membersQ.data||[],users=usersQ.data||[],customers=customersQ.data||[],invoices=invoicesQ.data||[],events=auditQ.data||[];
  const userByAuth=new Map(users.map((u:any)=>[String(u.auth_user_id),u]));
  const authById=new Map(authUsers.map((u:any)=>[String(u.id),u]));
  const mfa=(id:string)=>Array.isArray(authById.get(id)?.factors)&&authById.get(id).factors.some((f:any)=>f.status==="verified");
  const rows=companies.map((company:any)=>{
    const cm=members.filter((m:any)=>m.company_id===company.id),active=cm.filter((m:any)=>!userByAuth.get(String(m.auth_user_id))?.disabled);
    const ce=events.filter((e:any)=>e.company_id===company.id),last=ce[0]?.created_at||null;
    const sec=ce.filter((e:any)=>Date.parse(e.created_at)>=Date.now()-24*3600000);
    return {
      id:company.id,legalName:company.legal_name,displayName:company.display_name||company.legal_name,orgNumber:company.org_number||"",createdAt:company.created_at,
      memberCount:cm.length,activeMemberCount:active.length,mfaProtectedMemberCount:active.filter((m:any)=>mfa(String(m.auth_user_id))).length,
      activity30dCount:ce.filter((e:any)=>e.created_at>=since30).length,securityEventCount24h:sec.filter((e:any)=>severity(e.event_type)!=="info").length,
      criticalSecurityCount24h:sec.filter((e:any)=>severity(e.event_type)==="critical").length,activeSessionCount:null,
      customerRecordCount:customers.filter((r:any)=>r.company_id===company.id).length,invoiceRecordCount:invoices.filter((r:any)=>r.company_id===company.id).length,
      lastActivityAt:last,accessConfigured:active.length>0
    };
  });
  const roleDistribution={admin:0,accountant:0,approver:0,readonly:0} as Record<string,number>;
  for(const m of members)if(m.role in roleDistribution)roleDistribution[m.role]++;
  const monthly=months.map(month=>({
    month,label:new Intl.DateTimeFormat("sv-SE",{month:"short",timeZone:"UTC"}).format(new Date(month+"-01T00:00:00Z")).replace(".",""),
    activity:events.filter((e:any)=>monthKey(e.created_at)===month).length,invoices:invoices.filter((e:any)=>monthKey(e.created_at)===month).length,
    customers:customers.filter((e:any)=>monthKey(e.created_at)===month).length,memberships:members.filter((e:any)=>monthKey(e.created_at)===month).length
  }));
  const activeUsers=users.filter((u:any)=>!u.disabled&&members.some((m:any)=>m.auth_user_id===u.auth_user_id));
  const security24=events.filter((e:any)=>Date.parse(e.created_at)>=Date.now()-24*3600000).map((e:any)=>severity(e.event_type));
  return {
    generatedAt:new Date().toISOString(),runtimeModel:"supabase-shared-saas",companyCount:rows.length,activeSessionCount:null,sessionMetricAvailable:false,
    totals:{
      members:members.length,customers:customers.length,invoices:invoices.length,activeSessions:null,configuredCompanies:rows.filter((r:any)=>r.accessConfigured).length,
      activeCompanies30d:rows.filter((r:any)=>r.lastActivityAt&&r.lastActivityAt>=since30).length,newCompanies30d:rows.filter((r:any)=>r.createdAt>=since30).length,
      disabledUsers:users.filter((u:any)=>u.disabled).length,activeUsers:activeUsers.length,mfaProtectedUsers:activeUsers.filter((u:any)=>mfa(String(u.auth_user_id))).length,
      activity30d:events.filter((e:any)=>e.created_at>=since30).length,companySecurityEvents24h:rows.reduce((s:number,r:any)=>s+r.securityEventCount24h,0),
      companyCriticalSecurity24h:rows.reduce((s:number,r:any)=>s+r.criticalSecurityCount24h,0)
    },roleDistribution,monthly,security:{
      windowHours:24,total:security24.filter(x=>x!=="info").length,info:security24.filter(x=>x==="info").length,
      warning:security24.filter(x=>x==="warning").length,critical:security24.filter(x=>x==="critical").length,latestEventAt:events[0]?.created_at||null
    },companies:rows
  };
}
async function companyDetail(admin:any,companyId:string){
  const [companyQ,membersQ,usersQ,customerQ,invoiceQ,auditQ,operatorsQ,authUsers]=await Promise.all([
    admin.from("companies").select("*").eq("id",companyId).maybeSingle(),
    admin.from("company_memberships").select("*").eq("company_id",companyId),
    admin.from("app_users").select("*"),
    admin.from("customers").select("id").eq("company_id",companyId),
    admin.from("invoices").select("id").eq("company_id",companyId),
    admin.from("audit_events").select("created_at").eq("company_id",companyId).order("created_at",{ascending:false}).limit(1),
    admin.from("platform_operators").select("*"),
    allAuthUsers(admin)
  ]);
  for(const q of [companyQ,membersQ,usersQ,customerQ,invoiceQ,auditQ,operatorsQ])if(q.error)throw q.error;
  if(!companyQ.data)throw Object.assign(new Error("Kundföretaget hittades inte."),{status:404,code:"COMPANY_NOT_FOUND"});
  const usersByAuth=new Map((usersQ.data||[]).map((u:any)=>[String(u.auth_user_id),u])),authById=new Map(authUsers.map((u:any)=>[String(u.id),u]));
  const members=(membersQ.data||[]).map((m:any)=>{const profile=usersByAuth.get(String(m.auth_user_id))||{},au=authById.get(String(m.auth_user_id));return{
    userId:m.auth_user_id,username:profile.username||au?.email||"",displayName:profile.display_name||au?.user_metadata?.display_name||au?.email||"Användare",
    role:m.role,disabled:Boolean(profile.disabled),platformAdmin:false,createdAt:m.created_at
  }});
  const platformAdmins=(operatorsQ.data||[]).map((op:any)=>{const au=authById.get(String(op.auth_user_id));return{userId:op.auth_user_id,username:au?.email||"",displayName:op.display_name,disabled:Boolean(op.disabled),mfaConfigured:Boolean(au?.factors?.some((f:any)=>f.status==="verified")),createdAt:op.created_at}});
  return {company:{id:companyQ.data.id,legalName:companyQ.data.legal_name,displayName:companyQ.data.display_name,orgNumber:companyQ.data.org_number,createdAt:companyQ.data.created_at},
    stats:{memberCount:members.length,activeSessionCount:null,customerRecordCount:(customerQ.data||[]).length,invoiceRecordCount:(invoiceQ.data||[]).length,lastActivityAt:auditQ.data?.[0]?.created_at||null,activePlatformAdminCount:platformAdmins.filter((x:any)=>!x.disabled&&x.mfaConfigured).length},
    members,platformAdmins,roles:[{id:"admin",label:"Admin"},{id:"accountant",label:"Ekonom"},{id:"approver",label:"Attestant"},{id:"readonly",label:"Läsbehörighet"}]};
}
async function findAuthUser(admin:any,email:string){
  const normalized=email.toLowerCase();
  const users=await allAuthUsers(admin);return users.find((u:any)=>String(u.email||"").toLowerCase()===normalized)||null;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply(405,{error:"Endast POST stöds.",code:"METHOD_NOT_ALLOWED"});
  try{
    const {admin,user,operator}=await authContext(req);
    const body=await req.json().catch(()=>({}));
    const action=text(body.action);

    if(action==="session")return reply(200,{authenticated:true,operator:{id:user.id,username:user.email||"",displayName:operator.display_name},aal:"aal2"});
    if(action==="overview")return reply(200,await overview(admin));
    if(action==="company-detail")return reply(200,await companyDetail(admin,text(body.companyId)));
    if(action==="operator-audit"){
      const {data,error}=await admin.from("operator_audit_events").select("*").order("created_at",{ascending:false}).limit(Math.min(200,Math.max(1,Number(body.limit)||100)));if(error)throw error;
      const companies=(await admin.from("companies").select("id,display_name,legal_name")).data||[],profiles=(await admin.from("app_users").select("auth_user_id,display_name")).data||[],ops=(await admin.from("platform_operators").select("*")).data||[];
      const cm=new Map(companies.map((c:any)=>[String(c.id),c])),pm=new Map(profiles.map((p:any)=>[String(p.auth_user_id),p])),om=new Map(ops.map((o:any)=>[String(o.auth_user_id),o]));
      return reply(200,{events:(data||[]).map((e:any)=>({action:e.action,createdAt:e.created_at,operatorName:om.get(String(e.operator_auth_user_id))?.display_name||"Tidigare operatör",companyId:e.company_id,companyName:e.company_id?(cm.get(String(e.company_id))?.display_name||cm.get(String(e.company_id))?.legal_name||null):null,targetUserName:e.target_auth_user_id?pm.get(String(e.target_auth_user_id))?.display_name||null:null,...(e.details||{})}))});
    }
    if(action==="readiness"){
      const operators=(await admin.from("platform_operators").select("*").eq("disabled",false)).data||[];
      return reply(200,{ok:operators.length>0,checks:{databaseRead:true,databaseWrite:true,platformAdmin:operators.length>0},generatedAt:new Date().toISOString()});
    }
    if(action==="security-events"){
      const limit=Math.min(200,Math.max(1,Number(body.limit)||100));
      const {data:events,error}=await admin.from("audit_events").select("*").order("created_at",{ascending:false}).limit(limit);if(error)throw error;
      const {data:incidents}=await admin.from("operator_security_incidents").select("*");
      const {data:companies}=await admin.from("companies").select("id,display_name,legal_name");
      const im=new Map((incidents||[]).map((i:any)=>[String(i.audit_event_id),i])),cm=new Map((companies||[]).map((c:any)=>[String(c.id),c]));
      return reply(200,{events:(events||[]).map((e:any)=>{const inc=im.get(String(e.id));return{id:String(e.id),kind:e.event_type,severity:severity(e.event_type),createdAt:e.created_at,companyId:e.company_id||null,companyName:e.company_id?(cm.get(String(e.company_id))?.display_name||cm.get(String(e.company_id))?.legal_name||null):null,incidentStatus:inc?.status||"new",incidentUpdatedAt:inc?.updated_at||null,incidentUpdatedBy:null}})});
    }
    if(action==="security-monitor"){
      const since=new Date(Date.now()-24*3600000).toISOString();
      const {data,error}=await admin.from("audit_events").select("*").gte("created_at",since).order("created_at",{ascending:false});if(error)throw error;
      const securityRows=(data||[]).filter((e:any)=>severity(e.event_type)!=="info"),counts={critical:0,warning:0,info:0,total:securityRows.length};
      for(const e of securityRows)(counts as any)[severity(e.event_type)]++;
      return reply(200,{active:true,status:counts.critical?"critical":counts.warning?"warning":"ok",scanIntervalSeconds:15,counts,findings:securityRows.slice(0,20).map((e:any)=>({code:e.event_type,severity:severity(e.event_type),category:"Audit",title:e.event_type.replaceAll("_"," "),message:"Händelsen kommer från Supabase audit-loggen."}))});
    }
    if(action==="security-alerts")return reply(200,{configured:false,channel:"webhook",lastTestAt:null,lastTestSucceeded:false,lastDeliveryAt:null,lastDeliveryStatus:null});
    if(action==="security-alert-test")return reply(503,{error:"Extern säkerhetswebhook är ännu inte konfigurerad i Supabase-UAT.",code:"SECURITY_ALERTS_UNAVAILABLE"});
    if(action==="set-incident-status"){
      const eventId=Number(body.eventId),status=text(body.status);if(!Number.isSafeInteger(eventId)||!incidentStates.has(status))return reply(422,{error:"Ogiltig incidentstatus.",code:"INVALID_SECURITY_INCIDENT_STATUS"});
      const existing=(await admin.from("operator_security_incidents").select("*").eq("audit_event_id",eventId).maybeSingle()).data;
      const before=existing?.status||"new";
      if(before===status)return reply(200,{changed:false,incident:{status,updatedAt:existing?.updated_at||null,updatedBy:operator.display_name}});
      const {error}=await admin.from("operator_security_incidents").upsert({audit_event_id:eventId,status,updated_by:user.id,updated_at:new Date().toISOString()});if(error)throw error;
      await audit(admin,user.id,"SECURITY_INCIDENT_STATUS_CHANGED",{details:{securityEventId:String(eventId),beforeStatus:before,afterStatus:status}});
      return reply(200,{changed:true,incident:{status,updatedAt:new Date().toISOString(),updatedBy:operator.display_name}});
    }
    if(action==="create-user"){
      const companyId=text(body.companyId),email=text(body.email||body.username).toLowerCase(),requestedDisplayName=text(body.displayName),role=text(body.role||"readonly"),password=text(body.password);
      if(!email.includes("@"))return reply(422,{error:"Supabase-konton måste använda en giltig e-postadress.",code:"INVALID_EMAIL"});
      if(!allowedRoles.has(role))return reply(422,{error:"Ogiltig behörighet.",code:"INVALID_ROLE"});
      const company=(await admin.from("companies").select("id").eq("id",companyId).maybeSingle()).data;if(!company)return reply(404,{error:"Kundföretaget hittades inte.",code:"COMPANY_NOT_FOUND"});
      let authUser=await findAuthUser(admin,email),created=false;
      if(!authUser){
        if(requestedDisplayName.length<2||requestedDisplayName.length>120)return reply(422,{error:"Namn krävs för ett nytt konto och måste vara 2–120 tecken.",code:"INVALID_DISPLAY_NAME"});
        if(!passwordOk(password))return reply(422,{error:"Ett nytt konto kräver ett lösenord som uppfyller lösenordskraven.",code:"WEAK_PASSWORD"});
        const result=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:requestedDisplayName}});
        if(result.error)throw result.error;authUser=result.data.user;created=true;
      }
      if(!authUser)return reply(500,{error:"Användarkontot kunde inte skapas.",code:"USER_CREATE_FAILED"});
      const existing=(await admin.from("company_memberships").select("*").eq("company_id",companyId).eq("auth_user_id",authUser.id).maybeSingle()).data;
      if(existing)return reply(409,{error:"Användaren har redan åtkomst till kundföretaget.",code:"MEMBERSHIP_EXISTS"});
      const profile=(await admin.from("app_users").select("*").eq("auth_user_id",authUser.id).maybeSingle()).data;
      if(profile?.disabled)return reply(409,{error:"Det befintliga användarkontot är inaktiverat.",code:"USER_DISABLED"});
      const displayName=profile?.display_name||requestedDisplayName||text(authUser.user_metadata?.display_name)||email;
      if(displayName.length>120)return reply(422,{error:"Användarens namn är för långt.",code:"INVALID_DISPLAY_NAME"});
      let userId=profile?.id;
      if(!userId){userId="user_"+crypto.randomUUID().replaceAll("-","");const {error}=await admin.from("app_users").insert({id:userId,auth_user_id:authUser.id,username:email,display_name:displayName,disabled:false});if(error)throw error}
      const {error:membershipError}=await admin.from("company_memberships").insert({company_id:companyId,auth_user_id:authUser.id,user_id:userId,role});if(membershipError)throw membershipError;
      await audit(admin,user.id,created?"CUSTOMER_USER_CREATED":"CUSTOMER_EXISTING_USER_ADDED",{companyId,targetUserId:authUser.id,details:{role}});
      return reply(201,{created,linkedExisting:!created,userId:authUser.id,username:email,displayName,role,mfaSecret:null,mfaEnrollmentRequired:created});
    }
    if(action==="set-role"){
      const companyId=text(body.companyId),target=text(body.userId),role=text(body.role);if(!allowedRoles.has(role))return reply(422,{error:"Ogiltig behörighet.",code:"INVALID_ROLE"});
      const before=(await admin.from("company_memberships").select("*").eq("company_id",companyId).eq("auth_user_id",target).maybeSingle()).data;if(!before)return reply(404,{error:"Användaren finns inte i kundföretaget.",code:"MEMBERSHIP_NOT_FOUND"});
      const {error}=await admin.from("company_memberships").update({role}).eq("company_id",companyId).eq("auth_user_id",target);if(error)throw error;
      await audit(admin,user.id,"CUSTOMER_USER_ROLE_CHANGED",{companyId,targetUserId:target,details:{beforeRole:before.role,afterRole:role}});
      return reply(200,{membership:{...before,role},sessionsRevoked:false,sessionScope:"supabase"});
    }
    if(action==="reset-password"){
      const companyId=text(body.companyId),target=text(body.userId),password=text(body.password);
      if(!passwordOk(password))return reply(422,{error:"Lösenordet uppfyller inte lösenordskraven.",code:"WEAK_PASSWORD"});
      const member=(await admin.from("company_memberships").select("*").eq("company_id",companyId).eq("auth_user_id",target).maybeSingle()).data;if(!member)return reply(404,{error:"Användaren finns inte i kundföretaget.",code:"MEMBERSHIP_NOT_FOUND"});
      const result=await admin.auth.admin.updateUserById(target,{password});if(result.error)throw result.error;
      await audit(admin,user.id,"CUSTOMER_USER_PASSWORD_RESET",{companyId,targetUserId:target});
      return reply(200,{saved:true,sessionsRevoked:false});
    }
    if(action==="remove-user"){
      const companyId=text(body.companyId),target=text(body.userId);
      const member=(await admin.from("company_memberships").select("*").eq("company_id",companyId).eq("auth_user_id",target).maybeSingle()).data;if(!member)return reply(404,{error:"Användaren finns inte i kundföretaget.",code:"MEMBERSHIP_NOT_FOUND"});
      const {error}=await admin.from("company_memberships").delete().eq("company_id",companyId).eq("auth_user_id",target);if(error)throw error;
      await audit(admin,user.id,"CUSTOMER_USER_REMOVED",{companyId,targetUserId:target,details:{role:member.role}});
      return reply(200,{removed:true,sessionsRevoked:false,sessionScope:"company"});
    }
    return reply(404,{error:"Operatoråtgärden hittades inte.",code:"OPERATOR_ACTION_NOT_FOUND"});
  }catch(error){
    console.error(error);
    const status=Number((error as any)?.status||500),code=(error as any)?.code||"OPERATOR_EDGE_ERROR";
    return reply(status,status>=500?{error:"Ett internt operatorfel uppstod.",code}:{error:String((error as any)?.message||"Begäran kunde inte behandlas."),code});
  }
});
