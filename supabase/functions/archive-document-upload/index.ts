import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { MAX_PDF_BYTES, assertSafePdfDeep, sha256Hex } from "../_shared/passive-pdf.ts";

// Private document intake. PDF bytes arrive at this trusted boundary FIRST.
// A client can never create a completed archive original without server checks.
// The shared PDF gate is also used by verify-customer-invoice-document.
const ORIGIN="https://ludwigberglund-coder.github.io";
const MAX_BODY_BYTES=MAX_PDF_BYTES+32*1024;
const CATEGORIES=new Set([
  "customer-invoice","supplier-invoice","receipt","bank","accounting","inventory","other"
]);
const SOURCE_TABLES:Record<string,string>={
  "customer-invoice":"invoices",
  "supplier-invoice":"supplier_invoices",
  "bank":"bank_payments",
  "accounting":"journal_entries",
  "inventory":"inventory_items"
};
type PostgrestAdmin=ReturnType<typeof createClient>;
type UploadInfo={
  companyId:string;requestId:string;title:string;category:string;note:string;
  sourceType:string|null;sourceId:string|null;fileName:string;file:File;
};
function problem(status:number,code:string){
  return Object.assign(new Error(code),{status,code});
}
function headers(origin:string){
  return {
    "Access-Control-Allow-Origin":origin===ORIGIN?origin:ORIGIN,
    "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-lt-company-id",
    "Access-Control-Allow-Methods":"POST,OPTIONS",
    "Cache-Control":"no-store",
    "Content-Type":"application/json",
    "Vary":"Origin"
  };
}
function reply(req:Request,status:number,body:unknown){
  return new Response(JSON.stringify(body),{status,headers:headers(req.headers.get("origin")||"")});
}
function secretKey(){
  try{
    const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
    if(typeof keys.default==="string")return keys.default;
  }catch{}
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
}
function publishableKey(){
  try{
    const keys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
    if(typeof keys.default==="string")return keys.default;
  }catch{}
  return Deno.env.get("SUPABASE_ANON_KEY")||"";
}
function claim(token:string){
  try{
    const part=token.split(".")[1]||"";
    const text=atob(part.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(part.length/4)*4,"="));
    return JSON.parse(text);
  }catch{return {}}
}
function safeText(form:FormData,key:string,required:boolean,max:number){
  const values=form.getAll(key);
  if(values.length!==1||typeof values[0]!=="string")throw problem(422,"INVALID_UPLOAD_FIELDS");
  const raw=values[0] as string;
  // A document comment may contain normal line breaks; other controls are
  // not valid human-entered archive metadata.
  const unsafe=key==="note"
    ?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)
    :/[\u0000-\u001f\u007f]/.test(raw);
  if(unsafe)throw problem(422,"INVALID_UPLOAD_FIELDS");
  const text=raw.trim().normalize("NFC");
  if(text.length>max||(required&&!text))throw problem(422,"INVALID_UPLOAD_FIELDS");
  // Browser multipart normalizes textarea newlines to CRLF. Store one
  // canonical representation so retries and audit text remain stable.
  return key==="note"?text.replace(/\r\n?/g,"\n"):text;
}
function parseInfo(form:FormData,companyId:string):UploadInfo{
  const keys=new Set(["companyId","requestId","title","category","note",
    "entityType","entityId","file"]);
  for(const [key] of form.entries())if(!keys.has(key))throw problem(422,"UNKNOWN_UPLOAD_FIELD");
  if(safeText(form,"companyId",true,120)!==companyId)throw problem(403,"COMPANY_MISMATCH");
  const requestId=safeText(form,"requestId",true,100);
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(requestId))throw problem(422,"INVALID_REQUEST_ID");
  const title=safeText(form,"title",true,180);
  const category=safeText(form,"category",true,40);
  const note=safeText(form,"note",false,1000);
  const sourceType=safeText(form,"entityType",false,40)||null;
  const sourceId=safeText(form,"entityId",false,120)||null;
  if(!CATEGORIES.has(category)||Boolean(sourceType)!==Boolean(sourceId)||
     (sourceType&&!Object.hasOwn(SOURCE_TABLES,sourceType))||
     (sourceId&&!/^[A-Za-z0-9_-]{1,120}$/.test(sourceId))){
    throw problem(422,"INVALID_DOCUMENT_LINK");
  }
  const files=form.getAll("file");
  if(files.length!==1||!(files[0] instanceof File))throw problem(422,"PDF_ONLY");
  const file=files[0] as File;
  if(file.size<32||file.size>MAX_PDF_BYTES)throw problem(413,"PDF_SIZE_INVALID");
  if(file.type&&file.type!=="application/pdf")throw problem(415,"PDF_MIME_INVALID");
  return {companyId,requestId,title,category,note,sourceType,sourceId,
    fileName:file.name,file};
}
async function readMultipart(req:Request):Promise<FormData>{
  const contentType=req.headers.get("content-type")||"";
  if(!/^multipart\/form-data;\s*boundary=/i.test(contentType))
    throw problem(415,"MULTIPART_REQUIRED");
  const declared=Number(req.headers.get("content-length")||0);
  if(!Number.isSafeInteger(declared)||declared<0||declared>MAX_BODY_BYTES)
    throw problem(413,"UPLOAD_TOO_LARGE");
  if(!req.body)throw problem(422,"EMPTY_UPLOAD");
  const reader=req.body.getReader();
  const parts:Uint8Array[]=[];let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>MAX_BODY_BYTES){
        await reader.cancel().catch(()=>{});
        throw problem(413,"UPLOAD_TOO_LARGE");
      }
      parts.push(value);
    }
  }catch(error){
    if((error as {code?:string})?.code)throw error;
    throw problem(422,"INVALID_MULTIPART");
  }finally{reader.releaseLock();}
  const payload=new Uint8Array(total);let offset=0;
  for(const part of parts){payload.set(part,offset);offset+=part.length;}
  try{
    // Parse a copy with a bounded total size, rather than unbounded req.formData().
    return await new Request("https://lt.invalid/upload",{
      method:"POST",headers:{"content-type":contentType},body:payload
    }).formData();
  }catch{throw problem(422,"INVALID_MULTIPART");}
}
function sameOriginal(existing:Record<string,unknown>|null,expected:Record<string,unknown>){
  return Boolean(existing&&[
    "id","company_id","object_path","file_name","mime_type",
    "size_bytes","sha256","source_type","source_id","uploaded_by",
    "title","category","note"
  ].every(key=>String(existing[key]??"")===String(expected[key]??"")));
}
async function requireStoredOriginal(
  admin:PostgrestAdmin,existing:Record<string,unknown>,expected:Record<string,unknown>
){
  // A retry is not proof that Storage still holds the original. Older
  // records have no verified provenance and must not be grandfathered in.
  if(!sameOriginal(existing,expected)||!existing.server_verified_at)
    throw problem(409,"DOCUMENT_REQUEST_CONFLICT");
  const {data:stored,error:readError}=await admin.storage.from("lt-documents")
    .download(String(expected.object_path));
  if(readError||!stored||stored.size!==expected.size_bytes)
    throw problem(503,"ARCHIVED_ORIGINAL_UNAVAILABLE");
  const storedHash=await sha256Hex(new Uint8Array(await stored.arrayBuffer()));
  if(storedHash!==expected.sha256)throw problem(503,"ARCHIVED_ORIGINAL_MISMATCH");
}
async function findDocument(admin:PostgrestAdmin,id:string,companyId:string){
  const {data,error}=await admin.from("documents").select(
    "id,company_id,object_path,file_name,mime_type,size_bytes,sha256,source_type,source_id,uploaded_by,title,category,note,server_verified_at"
  ).eq("company_id",companyId).eq("id",id).maybeSingle();
  if(error)throw problem(503,"ARCHIVE_STATE_UNKNOWN");
  return data as Record<string,unknown>|null;
}
async function main(req:Request){
  if(req.method==="OPTIONS"){
    if(req.headers.get("origin")!==ORIGIN)return reply(req,403,{code:"ORIGIN_NOT_ALLOWED"});
    return new Response("ok",{headers:headers(ORIGIN)});
  }
  if(req.method!=="POST")return reply(req,405,{code:"METHOD_NOT_ALLOWED"});
  if(req.headers.get("origin")!==ORIGIN)return reply(req,403,{code:"ORIGIN_NOT_ALLOWED"});

  try{
    const companyId=(req.headers.get("x-lt-company-id")||"").trim();
    if(!/^[A-Za-z0-9_-]{1,120}$/.test(companyId))throw problem(422,"INVALID_COMPANY");
    const authorization=req.headers.get("authorization")||"";
    const token=authorization.match(/^Bearer\s+(\S+)$/i)?.[1]||"";
    const url=Deno.env.get("SUPABASE_URL")||"";
    const secret=secretKey(),publishable=publishableKey();
    if(!url||!secret||!publishable)throw problem(503,"ARCHIVE_BACKEND_UNAVAILABLE");
    if(!token||!req.headers.get("apikey"))throw problem(401,"AUTH_REQUIRED");
    const userClient=createClient(url,publishable,{
      global:{headers:{Authorization:"Bearer "+token}},
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
    });
    const {data:userData,error:userError}=await userClient.auth.getUser(token);
    if(userError||!userData?.user)throw problem(401,"AUTH_REQUIRED");
    if(claim(token).aal!=="aal2")throw problem(403,"MFA_REQUIRED");
    const admin=createClient(url,secret,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
    });
    const {data:membership,error:memberError}=await admin.from("company_memberships")
      .select("role").eq("company_id",companyId).eq("auth_user_id",userData.user.id)
      .maybeSingle();
    if(memberError)throw problem(503,"MEMBERSHIP_UNAVAILABLE");
    if(!membership||!["admin","accountant"].includes(String(membership.role)))
      throw problem(403,"ACCESS_DENIED");

    // Durable rate limit is reserved BEFORE reading or parsing untrusted PDF
    // bytes. It is atomic across concurrent Edge instances and all company users.
    const {data:admitted,error:quotaError}=await admin.rpc(
      "reserve_archive_pdf_upload",{
        p_company_id:companyId,p_actor_id:userData.user.id
      });
    if(quotaError)throw problem(503,"UPLOAD_QUOTA_UNAVAILABLE");
    if(admitted!==true)throw problem(429,"UPLOAD_RATE_LIMITED");

    const form=await readMultipart(req);
    const info=parseInfo(form,companyId);
    const bytes=new Uint8Array(await info.file.arrayBuffer());
    await assertSafePdfDeep(bytes,info.fileName);
    const fileSha=await sha256Hex(bytes);
    if(info.sourceType){
      const table=SOURCE_TABLES[info.sourceType];
      const {data:entity,error:entityError}=await admin.from(table).select("id")
        .eq("company_id",companyId).eq("id",info.sourceId).maybeSingle();
      if(entityError||!entity)throw problem(422,"DOCUMENT_LINK_NOT_FOUND");
    }
    // Browser sends only a request ID; never allow caller-chosen object paths.
    const identity=await sha256Hex(new TextEncoder().encode(
      companyId+"\u001f"+userData.user.id+"\u001f"+info.requestId
    ));
    const id="doc_"+identity.slice(0,32);
    const safeName=info.fileName.replace(/[^A-Za-z0-9_.-]/g,"_")
      .replace(/^\.+/,"_").slice(0,180);
    const objectPath=companyId+"/documents/"+id+"/"+safeName;
    const row={
      id,company_id:companyId,object_path:objectPath,
      file_name:info.fileName,mime_type:"application/pdf",
      size_bytes:bytes.length,sha256:fileSha,
      source_type:info.sourceType,source_id:info.sourceId,
      uploaded_by:userData.user.id,title:info.title,
      category:info.category,note:info.note,
      server_verified_at:new Date().toISOString()
    };
    const existing=await findDocument(admin,id,companyId);
    if(existing){
      await requireStoredOriginal(admin,existing,row);
      return reply(req,200,{saved:true,id,duplicate:true});
    }
    // Avoid a second identical original under another request ID.
    const {data:identical,error:duplicateError}=await admin.from("documents")
      .select("id").eq("company_id",companyId).eq("sha256",fileSha).limit(1);
    if(duplicateError)throw problem(503,"ARCHIVE_STATE_UNKNOWN");
    if((identical||[]).length)throw problem(409,"DOCUMENT_ALREADY_EXISTS");

    let uploaded=false;
    try{
      const {error:storageError}=await admin.storage.from("lt-documents")
        .upload(objectPath,bytes,{
          contentType:"application/pdf",cacheControl:"0",upsert:false
        });
      if(storageError)throw problem(409,"STORAGE_UPLOAD_UNCONFIRMED");
      uploaded=true;
      // Verify the object bytes actually persisted BEFORE referencing them.
      const {data:stored,error:readError}=await admin.storage.from("lt-documents")
        .download(objectPath);
      if(readError||!stored||stored.size!==bytes.length)
        throw problem(503,"STORAGE_READBACK_FAILED");
      const storedSha=await sha256Hex(new Uint8Array(await stored.arrayBuffer()));
      if(storedSha!==fileSha)throw problem(503,"STORAGE_INTEGRITY_FAILED");

      // Fail closed if membership was revoked during a long upload.
      const {data:laterUser,error:laterAuth}=await userClient.auth.getUser(token);
      const {data:laterMember,error:laterMemberError}=await admin.from("company_memberships")
        .select("role").eq("company_id",companyId).eq("auth_user_id",userData.user.id)
        .maybeSingle();
      if(laterAuth||laterMemberError||laterUser?.user?.id!==userData.user.id||
         !["admin","accountant"].includes(String(laterMember?.role||"")))
        throw problem(403,"SESSION_CHANGED");

      const {data:inserted,error:insertError}=await admin.from("documents")
        .insert(row).select("id").single();
      if(insertError?.code==="23505")throw problem(409,"DOCUMENT_ALREADY_EXISTS");
      if(insertError||inserted?.id!==id)throw problem(503,"ARCHIVE_INSERT_UNCONFIRMED");
      return reply(req,201,{saved:true,id,duplicate:false});
    }catch(error){
      // A DB response can fail *after* a successful commit. Never delete an
      // original without establishing that NO archive metadata refers to it.
      let confirmed:null|Record<string,unknown>=null;
      try{confirmed=await findDocument(admin,id,companyId)}
      catch{throw problem(503,"ARCHIVE_STATE_UNKNOWN")}
      if(confirmed){
        await requireStoredOriginal(admin,confirmed,row);
        return reply(req,200,{saved:true,id,duplicate:true});
      }
      if(uploaded){
        const {error:cleanupError}=await admin.storage.from("lt-documents")
          .remove([objectPath]);
        if(cleanupError)throw problem(503,"ARCHIVE_CLEANUP_UNCONFIRMED");
      }
      throw error;
    }
  }catch(error){
    const known=(error as {status?:number;statusCode?:number;code?:string})||{};
    const rawStatus=Number(known.status||known.statusCode||500);
    const status=Number.isInteger(rawStatus)&&rawStatus>=400&&rawStatus<=599
      ?rawStatus:500;
    const code=known.code&&/^[A-Z0-9_]{2,64}$/.test(known.code)
      ?known.code:"ARCHIVE_UPLOAD_FAILED";
    console.error("archive-document-upload",code);
    return reply(req,status,{code,error:status===429
      ?"För många uppladdningar. Försök igen senare."
      :status===409
      ?"Dokumentet finns redan, eller uppladdningen måste kontrolleras i arkivet."
      :status===403||status===401
      ?"Du saknar behörighet. Logga in igen."
      :status>=500
      ?"Uppladdningen kunde inte bekräftas säkert. Kontrollera dokumentarkivet innan du försöker igen."
      :"PDF-underlaget kunde inte verifieras. Kontrollera filen och uppgifterna."});
  }
}

Deno.serve(main);
