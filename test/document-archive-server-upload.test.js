'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const read=(p)=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8');
const portal=read('apps/portal/documents.js');
const client=read('apps/portal/supabase-client.js');
const edge=read('supabase/functions/archive-document-upload/index.ts');
const shared=read('supabase/functions/_shared/passive-pdf.ts');
const verifier=read('supabase/functions/verify-customer-invoice-document/index.ts');
const sql=read('supabase/migrations/20261019130200_server_verified_archive_upload.sql');
const config=read('supabase/config.toml');

test('the archive no longer uploads directly to Storage or inserts a completed original',()=>{
  const target=portal.slice(portal.indexOf('async function upload(form)'),portal.indexOf("document.addEventListener('change'"));
  assert.match(target,/functions\.uploadArchiveDocument\(/);
  assert.doesNotMatch(target,/LTSupabase\.storage\.upload\(/);
  assert.doesNotMatch(target,/LTSupabase\.from\(['"]documents['"][^\n]*\.insert\(/);
  assert.match(client,/uploadArchiveDocument:async\(form,token,companyId\)=>\{/);
  assert.match(client,/fetch\(cfg\.url\+'\/functions\/v1\/archive-document-upload'/);
  assert.match(client,/'x-lt-company-id':String\(companyId\)/);
  assert.doesNotMatch(target,/SERVICE_ROLE|CLOUDFLARE_AI_TOKEN|sb_secret_/);
});

test('both invoice and generic archive Edge functions use one unchanged passive PDF gate',()=>{
  assert.match(verifier,/from "\.\.\/_shared\/passive-pdf\.ts"/);
  assert.match(edge,/from "\.\.\/_shared\/passive-pdf\.ts"/);
  assert.match(shared,/PDFDocument\.load\(bytes,\{ignoreEncryption:false,updateMetadata:false\}\)/);
  assert.match(shared,/decodePdfNameEscapes/);
  assert.match(shared,/INVALID_PDF_EOF/);
  assert.match(shared,/ACTIVE_PDF_CONTENT_NOT_ALLOWED/);
  assert.match(shared,/ENCRYPTED_PDF_NOT_ALLOWED/);
  assert.match(shared,/MAX_PDF_BYTES=10\*1024\*1024/);
  assert.match(edge,/await assertSafePdfDeep\(bytes,info\.fileName\)/);
});

test('authenticated Edge upload verifies actual original bytes before Storage metadata and rechecks session',()=>{
  assert.match(config,/\[functions\.archive-document-upload\]\s+verify_jwt\s*=\s*true/);
  const positions=[
    edge.indexOf('await userClient.auth.getUser(token)'),
    edge.indexOf('await admin.rpc('),
    edge.indexOf('await readMultipart(req)'),
    edge.indexOf('await assertSafePdfDeep(bytes,info.fileName)'),
    edge.indexOf('.upload(objectPath,bytes,{'),
    edge.indexOf('.download(objectPath)'),
    edge.indexOf('.insert(row).select("id")')
  ];
  assert.ok(positions.every(x=>x>0),JSON.stringify(positions));
  assert.ok(positions.every((x,i)=>i===0||x>positions[i-1]),
    'check session/rate/file/PDF before writing final object and DB row');
  assert.match(edge,/maybeSingle\(\)/);
  assert.match(edge,/laterUser\?\.user\?\.id!==userData\.user\.id/);
  assert.match(edge,/if\(uploaded\)\{/);
  assert.match(edge,/if\(confirmed\)\{/);
  assert.match(edge,/ARCHIVE_CLEANUP_UNCONFIRMED/);
  assert.doesNotMatch(edge,/upsert:true/);
});

test('SQL disables browser inserts, enforces a restrictive Storage policy and keeps quota server-only',()=>{
  assert.match(sql,/revoke insert on public\.documents from authenticated/i);
  assert.match(sql,/documents_server_verified_sha_idx/);
  assert.match(sql,/lt archive blocks client replacement/);
  assert.match(sql,/on storage\.objects as restrictive for update to authenticated/i);
  assert.match(sql,/server_verified_at is not null/);
  assert.match(sql,/on storage\.objects as restrictive for insert to authenticated/i);
  assert.match(sql,/and \(storage\.foldername\(name\)\)\[2\]='documents'/);
  assert.match(sql,/archive_pdf_upload_rate_windows enable row level security/i);
  assert.match(sql,/revoke all on public\.archive_pdf_upload_rate_windows from public,anon,authenticated/i);
  assert.match(sql,/security invoker set search_path=''/i);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/grant execute on function public\.reserve_archive_pdf_upload\(text,uuid\)\s+to service_role/i);
});

class FakeFile extends Blob{
  constructor(parts,name,options){super(parts,options);this.name=name;}
}
class FakeFormData{
  constructor(form){this.items=new Map(Object.entries(form.fields||{}));}
  get(name){return this.items.get(name)??null;}
  set(name,value){this.items.set(name,value);}
}
function fixture({deferUpload=false,uploadResponse={saved:true,id:'doc_'+ 'a'.repeat(32),duplicate:false}}={}){
  let companyId='company-a',accessToken='synthetic-token-a',calls=0,mutations=0,complete=null;
  const form={
    dataset:{requestId:'20261019-test-document-upload-001'},
    fields:{
      file:new FakeFile([Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n')],'example.pdf',{type:'application/pdf'}),
      title:'Exempeldokument',category:'receipt',note:'',
      entityType:'',entityId:''
    }
  };
  const app={innerHTML:''};
  const document={
    getElementById:id=>id==='documents-app'?app:null,
    addEventListener:()=>{},
    querySelector:()=>null
  };
  const window={
    LTSupabaseUat:{context:async()=>({
      authenticated:true,company:{id:companyId,name:companyId},
      accessToken,authUser:{id:'person-a'},user:{displayName:'Användare'}
    })},
    LTSupabase:{
      functions:{uploadArchiveDocument:async(body,token,id)=>{
        calls++;
        assert.equal(body.get('companyId'),'company-a');
        assert.equal(body.get('requestId'),form.dataset.requestId);
        assert.equal(body.get('file'),form.fields.file);
        assert.equal(token,'synthetic-token-a');
        assert.equal(id,'company-a');
        return deferUpload?new Promise(resolve=>{complete=resolve;}):uploadResponse;
      }},
      from:(table,token)=>{
        assert.equal(table,'documents');
        assert.ok(token==='synthetic-token-a'||token==='synthetic-token-b');
        return {select:async()=>[],insert:async()=>{
          mutations++;throw Error('Unexpected browser database mutation');
        }};
      },
      storage:{
        upload:async()=>{mutations++;throw Error('Unexpected browser Storage upload');},
        remove:async()=>{mutations++;throw Error('Unexpected browser Storage delete');}
      }
    }
  };
  const sandbox={
    window,document,location:{hostname:'ludwigberglund-coder.github.io',search:'',href:''},
    sessionStorage:{getItem:()=>''},
    URLSearchParams,Intl,Date,Number,Object,String,Array,Set,
    FormData:FakeFormData,File:FakeFile,Blob,
    crypto:{randomUUID:()=>form.dataset.requestId},
    fetch:async()=>{mutations++;throw Error('Unexpected legacy API request');},
    requestAnimationFrame:()=>{},setTimeout:()=>{}
  };
  const context=vm.createContext(sandbox);
  vm.runInContext(portal,context,{filename:'apps/portal/documents.js'});
  return {
    form,app,
    submit:()=>{sandbox.currentForm=form;return vm.runInContext('upload(currentForm)',context);},
    redraw:()=>vm.runInContext('render()',context),
    changeCompany:(id,token)=>{companyId=id;accessToken=token;},
    complete:()=>{assert.equal(typeof complete,'function');complete(uploadResponse);},
    get calls(){return calls},
    get mutations(){return mutations}
  };
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('archive upload uses verified Edge result and never writes browser Storage',async()=>{
  const f=fixture();
  await settle();
  await f.submit();
  f.redraw(); // Normal submit handler renders only after upload succeeds.
  assert.equal(f.calls,1);
  assert.equal(f.mutations,0);
  assert.match(f.app.innerHTML,/Servern verifierade PDF-originalet före privat lagring/);
});

test('Edge success after tenant or token changed is not presented as archive success',async()=>{
  const f=fixture({deferUpload:true});
  await settle();
  const attempt=f.submit();
  await settle();
  f.changeCompany('company-b','synthetic-token-b');
  f.complete();
  await assert.rejects(attempt,/Företaget eller inloggningen har ändrats/);
  assert.equal(f.calls,1);
  assert.equal(f.mutations,0);
});

test('verified idempotent retry remains explicit and creates no browser copies',async()=>{
  const f=fixture({uploadResponse:{saved:true,id:'doc_'+ 'b'.repeat(32),duplicate:true}});
  await settle();
  await f.submit();
  f.redraw();
  assert.match(f.app.innerHTML,/redan sparat och verifierat/);
  assert.equal(f.mutations,0);
});
