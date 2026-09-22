'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const Security=require('../apps/api/request-security.js');

function request(url,{method='GET',headers={},ip='127.0.0.1'}={}){
  return{url,method,headers,socket:{remoteAddress:ip}};
}

test('Cloudflare-IP betros bara när trust uttryckligen är aktiverat',()=>{
  const req=request('/api/v1/health',{headers:{'cf-connecting-ip':'203.0.113.44'},ip:'127.0.0.1'});
  assert.equal(Security.clientIp(req,{trustCloudflare:false}),'127.0.0.1');
  assert.equal(Security.clientIp(req,{trustCloudflare:true}),'203.0.113.44');
});

test('API-query avvisar oväntade och duplicerade parametrar men bevarar statisk navigation',()=>{
  assert.throws(()=>Security.validateRequestTarget(request('/api/v1/customers?admin=1')),{code:'UNEXPECTED_QUERY_PARAMETER'});
  assert.throws(()=>Security.validateRequestTarget(request('/api/v1/customers?includeArchived=1&includeArchived=0')),{code:'DUPLICATE_QUERY_PARAMETER'});
  assert.doesNotThrow(()=>Security.validateRequestTarget(request('/portal/customers.html?customer=K-1001&return=invoice')));
  assert.doesNotThrow(()=>Security.validateRequestTarget(request('/api/v1/reports/payments-overview?mode=month&date=2026-09-22&query=BG%2F123')));
  assert.doesNotThrow(()=>Security.validateRequestTarget(request('/api/v1/session?demo=1')));
  assert.doesNotThrow(()=>Security.validateRequestTarget(request('/api/v1/reports/payments-overview?query=INV%2F2026')));
  assert.throws(()=>Security.validateRequestTarget(request('/portal/%2e%2e%2fpackage.json')),{code:'INVALID_URL_ENCODING'});
});

test('JSON-schema avvisar oväntade toppnivåfält och fel typer',()=>{
  const login=request('/api/v1/auth/login',{method:'POST'});
  assert.throws(()=>Security.validateJsonInput(login,{username:'user',password:'password',totp:'123456',admin:true}),{code:'UNEXPECTED_FIELDS'});
  const customer=request('/api/v1/customers',{method:'POST'});
  assert.throws(()=>Security.validateJsonInput(customer,{requestId:'12345678',name:'Test AB',reminderFeeAgreed:'yes'}),{code:'INVALID_INPUT_TYPE'});
  assert.doesNotThrow(()=>Security.validateJsonInput(customer,{requestId:'12345678',name:'Test AB',email:'',orgNumber:'',address:'',reminderFeeAgreed:false}));
});

test('LT adminens kundanvändar-rutter har explicit inputschema',async()=>{
  const create=request('/api/operator/v1/companies/company-1/users',{method:'POST'});
  assert.doesNotThrow(()=>Security.validateJsonInput(create,{username:'anna@example.test',displayName:'Anna Andersson',password:'Starkt1!',role:'readonly'}));
  assert.throws(()=>Security.validateJsonInput(create,{username:'anna',displayName:'Anna',password:'Starkt1!',role:'owner'}),{code:'INVALID_INPUT_FORMAT'});
  assert.throws(()=>Security.validateJsonInput(create,{username:'anna',displayName:'Anna',password:'Starkt1!',role:'readonly',admin:true}),{code:'UNEXPECTED_FIELDS'});

  const role=request('/api/operator/v1/companies/company-1/users/user-1/role',{method:'PUT'});
  assert.doesNotThrow(()=>Security.validateJsonInput(role,{role:'accountant'}));
  assert.throws(()=>Security.validateJsonInput(role,{role:'superadmin'}),{code:'INVALID_INPUT_FORMAT'});

  const password=request('/api/operator/v1/companies/company-1/users/user-1/password',{method:'PUT'});
  assert.doesNotThrow(()=>Security.validateJsonInput(password,{password:'Nyttlosen1!'}));
  assert.throws(()=>Security.validateJsonInput(password,{password:'Nyttlosen1!',role:'admin'}),{code:'UNEXPECTED_FIELDS'});

  assert.equal(Security.bodyPolicyFor(create),'json');
  assert.equal(Security.bodyPolicyFor(role),'json');
  assert.equal(Security.bodyPolicyFor(password),'json');
  assert.equal(Security.bodyPolicyFor(request('/api/operator/v1/companies/company-1/users/user-1',{method:'DELETE'})),'empty-json');
});

test('nästlade faktura- och CMS-fält är allowlistade',()=>{
  const invoice=request('/api/v1/customer-invoices',{method:'POST'});
  const base={requestId:'1234567890abcdef',customerNumber:'K-1001',invoiceDate:'2026-09-22',postingDate:'2026-09-22',dueDate:'2026-10-22',paymentTermsDays:30,ourReference:'',yourReference:'',notes:'',lines:[{description:'Tjänst',quantity:'1',unit:'st',unitPrice:'100,00',vatTreatment:'se-standard-25',vatRate:'25',revenueAccount:'3041'}]};
  assert.doesNotThrow(()=>Security.validateJsonInput(invoice,base));
  assert.throws(()=>Security.validateJsonInput(invoice,{...base,lines:[{...base.lines[0],isAdmin:true}]}),{code:'UNEXPECTED_FIELDS'});

  const cms=request('/api/v1/website/cms/draft',{method:'PUT'});
  const site={meta:{title:'Titel',description:'Text',language:'sv'},navigation:[{label:'Hem',href:'#hem'}],hero:{eyebrow:'E',title:'T',body:'B',primaryCta:{label:'A',href:'#hem'},secondaryCta:{label:'B',href:'#kontakt'}},highlights:[{value:'1',label:'L'}],services:{eyebrow:'E',title:'T',body:'B',items:[{id:'a',symbol:'1',title:'T',description:'D'}]},story:{eyebrow:'E',title:'T',body:'B',points:['P']},contact:{eyebrow:'E',title:'T',body:'B',openingHours:[{days:'Mån',hours:'10-18'}]},footer:{tagline:'T',adminLabel:'Admin'}};
  const company={legalName:'Test AB',displayName:'Test',orgNumber:'559000-0000',vatNumber:'SE559000000001',registeredOffice:'Göteborg',address:{street:'Gatan 1',postalCode:'411 00',city:'Göteborg',full:'Gatan 1, 411 00 Göteborg'},contact:{phone:'031-000000',phoneHref:'+4631000000',email:'test@example.test'},website:'',invoice:{bankgiro:'',taxStatus:''},business:{sni:'',description:'',currency:'SEK'},links:{maps:'#kontakt'}};
  assert.doesNotThrow(()=>Security.validateJsonInput(cms,{expectedRevision:1,site,company}));
  assert.throws(()=>Security.validateJsonInput(cms,{expectedRevision:1,site:{...site,script:'alert(1)'},company}),{code:'UNEXPECTED_FIELDS'});
});

test('PDF-uppladdningar har en separat strikt rate-limit-klass',()=>{
  const documentUpload=request('/api/v1/documents/doc-1/content',{method:'PUT'});
  const supplierUpload=request('/api/v1/payables/invoices/inv-1/document',{method:'PUT'});
  assert.equal(Security.routeClass(documentUpload),'upload');
  assert.equal(Security.routeClass(supplierUpload),'upload');
  assert.equal(Security.routeClass(request('/api/v1/documents/doc-1/content',{method:'GET'})),'api');

  const policy=Security.policyFor(documentUpload,{
    ROLLANDS_RATE_LIMIT_UPLOAD_IP_PER_MINUTE:'3',
    ROLLANDS_RATE_LIMIT_UPLOAD_USER_PER_MINUTE:'4'
  });
  assert.equal(policy.ipLimit,3);
  assert.equal(policy.identityLimit,4);

  const limiter=Security.createRateLimiter({
    env:{ROLLANDS_RATE_LIMIT_UPLOAD_IP_PER_MINUTE:'3',ROLLANDS_RATE_LIMIT_UPLOAD_USER_PER_MINUTE:'4'}
  });
  for(let i=0;i<3;i+=1)assert.equal(limiter.check(documentUpload).allowed,true);
  assert.equal(limiter.check(documentUpload).allowed,false);
});

test('IP-rate-limit ger block efter konfigurerad login-gräns',()=>{
  const limiter=Security.createRateLimiter({env:{ROLLANDS_RATE_LIMIT_LOGIN_IP_PER_MINUTE:'5'}});
  const req=request('/api/v1/auth/login',{method:'POST',ip:'198.51.100.9'});
  for(let i=0;i<5;i+=1)assert.equal(limiter.check(req).allowed,true);
  const blocked=limiter.check(req);
  assert.equal(blocked.allowed,false);
  assert.equal(blocked.remaining,0);
  assert.ok(blocked.retryAfterSeconds>=1);
});

test('autentiserad användare har egen rate-limit utöver IP-gränsen',()=>{
  const db={prepare(sql){return{get(){return sql.includes('FROM sessions')?{userId:'user-1',disabled:0}:null}}}};
  const limiter=Security.createRateLimiter({env:{ROLLANDS_RATE_LIMIT_IP_PER_MINUTE:'100',ROLLANDS_RATE_LIMIT_USER_PER_MINUTE:'20'},db});
  const req=request('/api/v1/customers',{headers:{cookie:'rollands_session=test-token'},ip:'198.51.100.10'});
  for(let i=0;i<20;i+=1)assert.equal(limiter.check(req).allowed,true);
  assert.equal(limiter.check(req).allowed,false);
});


function streamedRequest(url,{method='POST',body='',contentType='application/json'}={}){
  const req=Readable.from(body?[Buffer.from(body,'utf8')]:[]);
  req.url=url;
  req.method=method;
  req.headers={};
  if(body){
    req.headers['content-type']=contentType;
    req.headers['content-length']=String(Buffer.byteLength(body));
  }
  req.socket={remoteAddress:'127.0.0.1'};
  return req;
}

test('body policy skiljer JSON, binär upload och bodylösa actions',()=>{
  assert.equal(Security.bodyPolicyFor(request('/api/v1/customers',{method:'POST'})),'json');
  assert.equal(Security.bodyPolicyFor(request('/api/v1/documents/doc-1/content',{method:'PUT'})),'binary');
  assert.equal(Security.bodyPolicyFor(request('/api/v1/bank/payments/p-1/match',{method:'POST'})),'empty-json');
  assert.equal(Security.bodyPolicyFor(request('/api/v1/health',{method:'GET'})),'none');
});

test('bodylösa actions accepterar ingen body eller exakt tomt JSON-objekt',async()=>{
  await assert.doesNotReject(()=>Security.validateRequestBody(streamedRequest('/api/v1/bank/payments/p-1/match',{method:'POST'})));
  await assert.doesNotReject(()=>Security.validateRequestBody(streamedRequest('/api/v1/bank/payments/p-1/match',{method:'POST',body:'{}'})));
  await assert.rejects(
    ()=>Security.validateRequestBody(streamedRequest('/api/v1/bank/payments/p-1/match',{method:'POST',body:'{"admin":true}'})),
    error=>error?.code==='UNEXPECTED_REQUEST_BODY'&&error?.statusCode===422
  );
  await assert.rejects(
    ()=>Security.validateRequestBody(streamedRequest('/api/v1/bank/payments/p-1/match',{method:'POST',body:'{}',contentType:'text/plain'})),
    error=>error?.code==='UNSUPPORTED_MEDIA_TYPE'&&error?.statusCode===415
  );
});

test('GET och HEAD avvisar request-body',async()=>{
  await assert.rejects(
    ()=>Security.validateRequestBody(streamedRequest('/api/v1/health',{method:'GET',body:'x',contentType:'text/plain'})),
    error=>error?.code==='UNEXPECTED_REQUEST_BODY'&&error?.statusCode===400
  );
});
