'use strict';

const crypto=require('node:crypto');
const net=require('node:net');
const Auth=require('./auth.js');
const OperatorAuth=require('./operator-auth.js');

function securityError(message,code='REQUEST_SECURITY_ERROR',statusCode=400){
  const error=new Error(message);
  error.code=code;
  error.statusCode=statusCode;
  return error;
}
function intSetting(env,name,fallback,{min=1,max=100000}={}){
  const raw=env?.[name];
  if(raw===undefined||raw==='')return fallback;
  const value=Number(raw);
  if(!Number.isSafeInteger(value)||value<min||value>max)throw securityError(`${name} har ett ogiltigt värde.`,'UNSAFE_RUNTIME_CONFIGURATION',500);
  return value;
}
function sha(value){return crypto.createHash('sha256').update(String(value||''),'utf8').digest('hex')}
function cleanIp(value){
  const raw=String(value||'').trim().replace(/^::ffff:/,'');
  return net.isIP(raw)?raw:'';
}
function clientIp(req,{trustCloudflare=false}={}){
  if(trustCloudflare){
    const cf=cleanIp(req?.headers?.['cf-connecting-ip']);
    if(cf)return cf;
  }
  return cleanIp(req?.socket?.remoteAddress)||'unknown';
}
function identityKey(req,db){
  if(!db)return '';
  try{
    const cookies=Auth.parseCookies(req?.headers?.cookie||'');
    const userToken=cookies.rollands_session;
    if(userToken){
      const now=new Date().toISOString();
      const session=db.prepare(`SELECT s.user_id AS userId,u.disabled
        FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=? AND s.expires_at>? AND s.absolute_expires_at>?`).get(Auth.hashToken(userToken),now,now);
      if(session&&!session.disabled)return 'user:'+sha(session.userId);
    }
    const operatorToken=OperatorAuth.operatorTokenFromRequest(req);
    if(operatorToken){
      const now=new Date().toISOString();
      const session=db.prepare(`SELECT s.operator_id AS operatorId,o.disabled
        FROM platform_operator_sessions s JOIN platform_operators o ON o.id=s.operator_id
        WHERE s.token_hash=? AND s.expires_at>? AND s.absolute_expires_at>?`).get(Auth.hashToken(operatorToken),now,now);
      if(session&&!session.disabled)return 'operator:'+sha(session.operatorId);
    }
  }catch{}
  return '';
}
function apiPath(req){
  try{return new URL(req?.url||'/','http://localhost').pathname}catch{return'/'}
}
function routeClass(req){
  const path=apiPath(req);
  const method=String(req?.method||'GET').toUpperCase();
  if(path==='/api/v1/auth/login')return'login';
  if(path==='/api/operator/v1/auth/login')return'operator-login';
  if(path==='/api/v1/readiness'||path==='/api/v1/readiness/core'||path==='/api/v1/health'||path==='/api/operator/v1/health'||path==='/_runtime-version')return'health';
  if(method==='PUT'&&(
    /^\/api\/v1\/documents\/[^/]+\/content$/.test(path)||
    /^\/api\/v1\/payables\/invoices\/[^/]+\/document$/.test(path)
  ))return'upload';
  if(path.startsWith('/api/operator/v1/'))return'operator-api';
  if(path.startsWith('/api/v1/'))return'api';
  if(path.startsWith('/website-preview/'))return'preview';
  return'other';
}
function policyFor(req,env={}){
  const kind=routeClass(req);
  const windowMs=60000;
  const genericIp=intSetting(env,'ROLLANDS_RATE_LIMIT_IP_PER_MINUTE',180,{min:20,max:10000});
  const genericUser=intSetting(env,'ROLLANDS_RATE_LIMIT_USER_PER_MINUTE',300,{min:20,max:20000});
  if(kind==='login')return{windowMs,ipLimit:intSetting(env,'ROLLANDS_RATE_LIMIT_LOGIN_IP_PER_MINUTE',20,{min:5,max:1000}),identityLimit:0};
  if(kind==='operator-login')return{windowMs,ipLimit:intSetting(env,'ROLLANDS_RATE_LIMIT_OPERATOR_LOGIN_IP_PER_MINUTE',10,{min:3,max:500}),identityLimit:0};
  if(kind==='health')return{windowMs,ipLimit:intSetting(env,'ROLLANDS_RATE_LIMIT_HEALTH_IP_PER_MINUTE',120,{min:10,max:5000}),identityLimit:0};
  if(kind==='preview')return{windowMs,ipLimit:intSetting(env,'ROLLANDS_RATE_LIMIT_PREVIEW_IP_PER_MINUTE',240,{min:20,max:10000}),identityLimit:genericUser};
  if(kind==='upload')return{
    windowMs,
    ipLimit:intSetting(env,'ROLLANDS_RATE_LIMIT_UPLOAD_IP_PER_MINUTE',12,{min:2,max:120}),
    identityLimit:intSetting(env,'ROLLANDS_RATE_LIMIT_UPLOAD_USER_PER_MINUTE',20,{min:2,max:240})
  };
  if(kind==='api'||kind==='operator-api')return{windowMs,ipLimit:genericIp,identityLimit:genericUser};
  // Static/public routes also get a generous IP ceiling so no exposed endpoint is unbounded.
  return{windowMs,ipLimit:intSetting(env,'ROLLANDS_RATE_LIMIT_PUBLIC_IP_PER_MINUTE',600,{min:60,max:30000}),identityLimit:genericUser};
}
function createRateLimiter({env=process.env,db,trustCloudflare=env.ROLLANDS_TRUST_CLOUDFLARE==='1'}={}){
  // Parse every configurable ceiling at startup so a typo cannot silently disable protection.
  for(const sample of [
    {url:'/api/v1/auth/login',method:'POST'},
    {url:'/api/operator/v1/auth/login',method:'POST'},
    {url:'/api/v1/health',method:'GET'},
    {url:'/website-preview/',method:'GET'},
    {url:'/api/v1/documents/example/content',method:'PUT'},
    {url:'/api/v1/customers',method:'GET'},
    {url:'/',method:'GET'}
  ])policyFor(sample,env);
  const buckets=new Map();
  let operations=0;
  function consume(key,limit,windowMs,now){
    const windowStart=Math.floor(now/windowMs)*windowMs;
    const current=buckets.get(key);
    const state=current&&current.windowStart===windowStart?current:{windowStart,count:0};
    state.count+=1;
    buckets.set(key,state);
    return{allowed:state.count<=limit,remaining:Math.max(0,limit-state.count),resetAt:windowStart+windowMs,limit};
  }
  function sweep(now){
    operations+=1;
    if(operations%1000!==0)return;
    for(const[key,state]of buckets)if(state.windowStart<now-120000)buckets.delete(key);
  }
  function check(req){
    const policy=policyFor(req,env);
    if(!policy)return{allowed:true};
    const now=Date.now();
    sweep(now);
    const ip=clientIp(req,{trustCloudflare});
    const route=routeClass(req);
    const ipResult=consume(`ip|${route}|${sha(ip)}`,policy.ipLimit,policy.windowMs,now);
    let identityResult=null;
    const identity=policy.identityLimit>0?identityKey(req,db):'';
    if(identity)identityResult=consume(`identity|${route}|${identity}`,policy.identityLimit,policy.windowMs,now);
    const blocking=!ipResult.allowed?ipResult:(identityResult&&!identityResult.allowed?identityResult:null);
    if(!blocking)return{allowed:true,limit:Math.min(ipResult.limit,identityResult?.limit||Infinity),remaining:Math.min(ipResult.remaining,identityResult?.remaining??Infinity),resetAt:Math.min(ipResult.resetAt,identityResult?.resetAt??Infinity)};
    return{allowed:false,limit:blocking.limit,remaining:0,resetAt:blocking.resetAt,retryAfterSeconds:Math.max(1,Math.ceil((blocking.resetAt-now)/1000))};
  }
  return Object.freeze({check,clientIp:req=>clientIp(req,{trustCloudflare})});
}
function sendRateLimited(res,result,requestId=''){
  if(res.writableEnded)return;
  const retry=String(result.retryAfterSeconds||60);
  const resetSeconds=Math.max(1,Math.ceil((Number(result.resetAt||Date.now()+60000)-Date.now())/1000));
  res.writeHead(429,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Retry-After':retry,
    'RateLimit-Limit':String(result.limit||0),
    'RateLimit-Remaining':'0',
    'RateLimit-Reset':String(resetSeconds)
  });
  res.end(JSON.stringify({error:'För många förfrågningar. Försök igen senare.',code:'RATE_LIMITED',requestId}));
}

const QUERY_RULES=Object.freeze([
  ['GET',/^\/api\/v1\/customers$/,new Set(['includeArchived'])],
  ['GET',/^\/api\/v1\/automation\/proposals$/,new Set(['status'])],
  ['GET',/^\/api\/v1\/bank\/payments$/,new Set(['status'])],
  ['GET',/^\/api\/v1\/documents$/,new Set(['category','entityType','entityId'])],
  ['GET',/^\/api\/v1\/inventory\/movements$/,new Set(['itemId'])],
  ['GET',/^\/api\/v1\/inventory\/adjustments$/,new Set(['status'])],
  ['GET',/^\/api\/v1\/payables\/payments$/,new Set(['date'])],
  ['GET',/^\/api\/v1\/payroll\/runs$/,new Set(['period'])],
  ['GET',/^\/api\/v1\/accounting\/entries$/,new Set(['limit'])],
  ['GET',/^\/api\/v1\/accounting\/periods$/,new Set(['year'])],
  ['GET',/^\/api\/v1\/accounting\/unlock-requests$/,new Set(['status'])],
  ['GET',/^\/api\/operator\/v1\/security-events$/,new Set(['limit'])],

  ['GET',/^\/api\/v1\/reports\/(?:trial-balance|profit-loss|sales|supplier-purchases)$/,new Set(['from','to'])],
  ['GET',/^\/api\/v1\/reports\/general-ledger$/,new Set(['from','to','account'])],
  ['GET',/^\/api\/v1\/reports\/(?:receivables-aging|payables-aging)$/,new Set(['asOf','to'])],
  ['GET',/^\/api\/v1\/reports\/vat-control$/,new Set(['period'])],
  ['GET',/^\/api\/v1\/reports\/(?:receivables-control|payables-control)$/,new Set()],
  ['GET',/^\/api\/v1\/reports\/payments-overview$/,new Set(['mode','date','status','direction','query','account','sort','order'])],

  ['GET',/^\/api\/v1\/exports\/(?:receivables|customer-invoices|payables|supplier-invoices|payments)$/,new Set(['from','to','status'])],
  ['GET',/^\/api\/v1\/exports\/(?:receipts|journal|sales|supplier-purchases)$/,new Set(['from','to'])],
  ['GET',/^\/api\/v1\/exports\/ledger$/,new Set(['from','to','account'])],
  ['GET',/^\/api\/v1\/exports\/(?:receivables-aging|payables-aging)$/,new Set(['asOf','to'])],
  ['GET',/^\/api\/v1\/exports\/vat$/,new Set(['period'])],
  ['GET',/^\/api\/v1\/exports\/payments-overview$/,new Set(['mode','date','status','direction','query','account','sort','order'])]
]);

const BODY_RULES=Object.freeze([
  ['POST',/^\/api\/v1\/auth\/login$/,new Set(['username','password','totp','companyId'])],
  ['POST',/^\/api\/operator\/v1\/auth\/login$/,new Set(['username','password','totp'])],
  ['POST',/^\/api\/v1\/customers$/,new Set(['requestId','name','email','orgNumber','address','reminderFeeAgreed'])],
  ['PUT',/^\/api\/v1\/customers\/[^/]+$/,new Set(['name','email','orgNumber','address','reminderFeeAgreed'])],
  ['PUT',/^\/api\/v1\/customer-invoices\/draft$/,new Set(['requestId','draft'])],
  ['POST',/^\/api\/v1\/customer-invoices$/,new Set(['requestId','customerNumber','invoiceDate','postingDate','dueDate','paymentTermsDays','ourReference','yourReference','notes','lines'])],
  ['POST',/^\/api\/v1\/customer-invoices\/[^/]+\/credit$/,new Set(['requestId','creditDate','reason'])],
  ['POST',/^\/api\/v1\/invoices\/[^/]+\/comments$/,new Set(['text'])],
  ['POST',/^\/api\/v1\/invoices\/[^/]+\/reminders\/preview$/,new Set(['sentDate','includeReminderFee','includeInterest','includeBusinessLatePaymentCompensation'])],
  ['POST',/^\/api\/v1\/invoices\/[^/]+\/reminders$/,new Set(['sentDate','includeReminderFee','includeInterest','includeBusinessLatePaymentCompensation','kind','note'])],
  ['PUT',/^\/api\/v1\/automation\/proposals\/[^/]+\/suggestion$/,new Set(['accountingLines','invoiceId','invoiceNumber'])],
  ['POST',/^\/api\/v1\/automation\/proposals\/[^/]+\/reclassify$/,new Set(['targetInvoiceId','requestId','correctionDate','reason'])],
  ['POST',/^\/api\/v1\/automation\/proposals\/[^/]+\/reject$/,new Set(['reason'])],
  ['POST',/^\/api\/v1\/bank\/payments$/,new Set(['externalId','bookingDate','valueDate','amountOre','currency','reference','message','payerName','payerAccount'])],
  ['POST',/^\/api\/v1\/documents$/,new Set(['requestId','title','category','note','fileName','mimeType','entityType','entityId','linkLabel'])],
  ['POST',/^\/api\/v1\/documents\/[^/]+\/links$/,new Set(['entityType','entityId','label'])],
  ['POST',/^\/api\/v1\/inventory\/items$/,new Set(['sku','name','unit','purchaseAccount','inventoryAccount'])],
  ['POST',/^\/api\/v1\/inventory\/movements$/,new Set(['itemId','movementDate','type','quantityMilli','unitCostOre','referenceType','referenceId','note','requestId'])],
  ['POST',/^\/api\/v1\/inventory\/adjustments$/,new Set(['itemId','adjustmentDate','countedQuantityMilli','reason','requestId'])],
  ['POST',/^\/api\/v1\/accounting\/entries\/[^/]+\/correct$/,new Set(['postingDate','reason','replacementLines'])],
  ['POST',/^\/api\/v1\/accounting\/opening-migration\/preview$/,new Set(['year','postingDate','lines','receivables','payables'])],
  ['POST',/^\/api\/v1\/accounting\/opening-migration\/import$/,new Set(['confirmImport','year','postingDate','lines','receivables','payables'])],
  ['POST',/^\/api\/v1\/accounting\/opening-balances\/(?:19|20|21)\d{2}$/,new Set(['postingDate','lines'])],
  ['POST',/^\/api\/v1\/accounting\/periods\/\d{4}-\d{2}\/unlock-request$/,new Set(['reason'])],
  ['POST',/^\/api\/v1\/accounting\/unlock-requests\/[^/]+\/(?:approve|reject)$/,new Set(['reason'])],
  ['POST',/^\/api\/v1\/payables\/suppliers$/,new Set(['supplierNumber','name','orgNumber','email','bankgiro','plusgiro','defaultCostAccount'])],
  ['POST',/^\/api\/v1\/payables\/invoices$/,new Set(['supplierId','supplierInvoiceNumber','invoiceDate','dueDate','totalOre','vatOre','currency','vatTreatment'])],
  ['PUT',/^\/api\/v1\/payables\/invoices\/[^/]+\/coding$/,new Set(['lines'])],
  ['POST',/^\/api\/v1\/payables\/invoices\/[^/]+\/approve$/,new Set(['expectedCodingSha256','expectedDocumentSha256'])],
  ['POST',/^\/api\/v1\/payables\/invoices\/[^/]+\/correct-dates$/,new Set(['requestId','invoiceDate','dueDate','reason'])],
  ['POST',/^\/api\/v1\/payables\/invoices\/[^/]+\/prepare-payment$/,new Set(['paymentDate','account'])],
  ['POST',/^\/api\/v1\/payables\/payments\/[^/]+\/confirm-post$/,new Set(['confirmationReference','postingDate'])],
  ['POST',/^\/api\/v1\/payables\/payments\/[^/]+\/correct$/,new Set(['requestId','correctionDate','reason'])],
  ['POST',/^\/api\/v1\/payroll\/runs$/,new Set(['period','payDate','sourceName','grossSalaryOre','withheldTaxOre','employerContributionsOre','netPayOre','vacationLiabilityChangeOre','lines'])],
  ['PUT',/^\/api\/v1\/suppliers\/[^/]+\/profile$/,new Set(['requestId','name','orgNumber','email','defaultCostAccount'])],
  ['POST',/^\/api\/v1\/suppliers\/[^/]+\/payment-details$/,new Set(['requestId','bankgiro','plusgiro'])],
  ['POST',/^\/api\/v1\/suppliers\/changes\/[^/]+\/reject$/,new Set(['reason'])],
  ['PUT',/^\/api\/v1\/website\/cms\/draft$/,new Set(['expectedRevision','site','company'])],
  ['POST',/^\/api\/v1\/website\/cms\/publish$/,new Set(['expectedRevision','expectedPublishedVersion'])],
  ['POST',/^\/api\/v1\/website\/cms\/revisions\/\d+\/restore$/,new Set(['expectedRevision'])]
]);


const EMPTY_BODY_RULES=Object.freeze([
  ['POST',/^\/api\/v1\/auth\/logout$/],
  ['POST',/^\/api\/v1\/accounting\/periods\/\d{4}-\d{2}\/lock$/],
  ['DELETE',/^\/api\/v1\/customers\/[^/]+$/],
  ['POST',/^\/api\/v1\/customers\/[^/]+\/restore$/],
  ['DELETE',/^\/api\/v1\/customer-invoices\/draft$/],
  ['POST',/^\/api\/v1\/automation\/proposals\/[^/]+\/(?:approve|execute)$/],
  ['POST',/^\/api\/v1\/bank\/payments\/[^/]+\/match$/],
  ['POST',/^\/api\/v1\/inventory\/adjustments\/[^/]+\/(?:approve|reject)$/],
  ['POST',/^\/api\/v1\/payables\/payments\/[^/]+\/release$/],
  ['POST',/^\/api\/v1\/payables\/invoices\/[^/]+\/(?:coding-suggestion|post)$/],
  ['POST',/^\/api\/v1\/payroll\/runs\/[^/]+\/post$/],
  ['POST',/^\/api\/v1\/suppliers\/changes\/[^/]+\/approve$/],
  ['POST',/^\/api\/operator\/v1\/auth\/logout$/]
]);

const BINARY_BODY_RULES=Object.freeze([
  ['PUT',/^\/api\/v1\/documents\/[^/]+\/content$/],
  ['PUT',/^\/api\/v1\/payables\/invoices\/[^/]+\/document$/]
]);

const EMPTY_BODY_LIMIT=64;

const ACCOUNTING_LINE_FIELDS=new Set(['account','text','label','vatCode','debitOre','creditOre']);
const INVOICE_LINE_FIELDS=new Set(['description','unit','quantity','unitPrice','vatTreatment','vatRate','revenueAccount','kind']);
const RECEIVABLE_FIELDS=new Set(['customerNumber','invoiceNumber','invoiceDate','dueDate','totalOre','remainingOre']);
const PAYABLE_FIELDS=new Set(['supplierNumber','invoiceNumber','invoiceDate','dueDate','totalOre','remainingOre']);

function assertAllowedObject(value,allowed,label){
  if(!value||typeof value!=='object'||Array.isArray(value))throw securityError(`${label} måste vara ett objekt.`,'INVALID_INPUT_TYPE',422);
  const unexpected=Object.keys(value).filter(key=>!allowed.has(key));
  if(unexpected.length)throw securityError(`${label} innehåller oväntade fält: ${unexpected.slice(0,5).join(', ')}.`,'UNEXPECTED_FIELDS',422);
}
function assertObjectArray(value,allowed,label,max=500){
  if(!Array.isArray(value))throw securityError(`${label} måste vara en lista.`,'INVALID_INPUT_TYPE',422);
  if(value.length>max)throw securityError(`${label} innehåller för många poster.`,'ARRAY_TOO_LARGE',422);
  value.forEach((row,index)=>assertAllowedObject(row,allowed,`${label} rad ${index+1}`));
}
function assertInvoiceDraft(draft){
  assertAllowedObject(draft,new Set(['customerNumber','buyer','seller','invoiceDate','postingDate','dueDate','paymentTermsDays','currency','ourReference','yourReference','notes','useFees','includeMessage','lines','freight','administration']),'Fakturautkast');
  if(Object.hasOwn(draft,'buyer'))assertAllowedObject(draft.buyer,new Set(['name','address','orgNumber','email']),'Fakturautkastets köpare');
  if(Object.hasOwn(draft,'seller'))assertAllowedObject(draft.seller,new Set(['name','address','orgNumber','vatNumber','phone','email','website','bankgiro','taxStatus']),'Fakturautkastets säljare');
  if(Object.hasOwn(draft,'lines'))assertObjectArray(draft.lines,INVOICE_LINE_FIELDS,'Fakturarader',200);
  for(const field of ['freight','administration'])if(Object.hasOwn(draft,field))assertAllowedObject(draft[field],new Set(['amount','vatRate','revenueAccount']),`Fakturautkastets ${field}`);
}
function assertCmsSite(site){
  assertAllowedObject(site,new Set(['meta','navigation','hero','highlights','services','story','contact','footer']),'Webbplatsinnehåll');
  assertAllowedObject(site.meta,new Set(['title','description','language']),'Webbplatsens meta');
  assertObjectArray(site.navigation,new Set(['label','href']),'Navigering',12);
  assertAllowedObject(site.hero,new Set(['eyebrow','title','body','primaryCta','secondaryCta']),'Hero');
  assertAllowedObject(site.hero.primaryCta,new Set(['label','href']),'Primär CTA');
  assertAllowedObject(site.hero.secondaryCta,new Set(['label','href']),'Sekundär CTA');
  assertObjectArray(site.highlights,new Set(['value','label']),'Höjdpunkter',8);
  assertAllowedObject(site.services,new Set(['eyebrow','title','body','items']),'Tjänster');
  assertObjectArray(site.services.items,new Set(['id','symbol','title','description']),'Tjänster',12);
  assertAllowedObject(site.story,new Set(['eyebrow','title','body','points']),'Om-sektion');
  if(!Array.isArray(site.story.points))throw securityError('Om-punkter måste vara en lista.','INVALID_INPUT_TYPE',422);
  assertAllowedObject(site.contact,new Set(['eyebrow','title','body','openingHours']),'Kontaktsektion');
  assertObjectArray(site.contact.openingHours,new Set(['days','hours']),'Öppettider',14);
  assertAllowedObject(site.footer,new Set(['tagline','adminLabel']),'Sidfot');
}
function assertCmsCompany(company){
  assertAllowedObject(company,new Set(['legalName','displayName','orgNumber','vatNumber','registeredOffice','address','contact','website','invoice','business','links']),'Företagsprofil');
  assertAllowedObject(company.address,new Set(['street','postalCode','city','full']),'Företagsadress');
  assertAllowedObject(company.contact,new Set(['phone','phoneHref','email']),'Företagskontakt');
  if(Object.hasOwn(company,'invoice'))assertAllowedObject(company.invoice,new Set(['bankgiro','taxStatus']),'Fakturainställningar');
  if(Object.hasOwn(company,'business'))assertAllowedObject(company.business,new Set(['sni','description','currency']),'Verksamhetsprofil');
  assertAllowedObject(company.links,new Set(['maps']),'Företagslänkar');
}
function assertNestedSchema(req,payload){
  const method=String(req?.method||'GET').toUpperCase(),pathname=apiPath(req);
  if(method==='PUT'&&pathname==='/api/v1/customer-invoices/draft'){assertInvoiceDraft(payload.draft);return}
  if((method==='POST'&&pathname==='/api/v1/customer-invoices')||(method==='POST'&&/^\/api\/v1\/customer-invoices\/[^/]+\/credit$/.test(pathname))){
    if(payload.lines!==undefined)assertObjectArray(payload.lines,INVOICE_LINE_FIELDS,'Fakturarader',200);
    return;
  }
  if(method==='PUT'&&/^\/api\/v1\/automation\/proposals\/[^/]+\/suggestion$/.test(pathname)&&payload.accountingLines!==undefined){assertObjectArray(payload.accountingLines,ACCOUNTING_LINE_FIELDS,'Konteringsrader',20);return}
  if(method==='POST'&&/^\/api\/v1\/accounting\/entries\/[^/]+\/correct$/.test(pathname)&&payload.replacementLines!==undefined){assertObjectArray(payload.replacementLines,ACCOUNTING_LINE_FIELDS,'Ersättningsrader',500);return}
  if(method==='POST'&&(pathname==='/api/v1/accounting/opening-migration/preview'||pathname==='/api/v1/accounting/opening-migration/import')){
    assertObjectArray(payload.lines,ACCOUNTING_LINE_FIELDS,'Ingående balans',500);
    assertObjectArray(payload.receivables||[],RECEIVABLE_FIELDS,'Öppna kundposter',2000);
    assertObjectArray(payload.payables||[],PAYABLE_FIELDS,'Öppna leverantörsposter',2000);
    return;
  }
  if(method==='POST'&&/^\/api\/v1\/accounting\/opening-balances\/(?:19|20|21)\d{2}$/.test(pathname)){assertObjectArray(payload.lines,ACCOUNTING_LINE_FIELDS,'Ingående balans',500);return}
  if(method==='PUT'&&/^\/api\/v1\/payables\/invoices\/[^/]+\/coding$/.test(pathname)){assertObjectArray(payload.lines,ACCOUNTING_LINE_FIELDS,'Konteringsrader',500);return}
  if(method==='POST'&&pathname==='/api/v1/payroll/runs'){assertObjectArray(payload.lines,ACCOUNTING_LINE_FIELDS,'Lönejournal',500);return}
  if(method==='PUT'&&pathname==='/api/v1/website/cms/draft'){assertCmsSite(payload.site);assertCmsCompany(payload.company)}
}
function assertTextField(payload,field,max,{pattern=null}={}){
  if(payload[field]===undefined)return;
  if(typeof payload[field]!=='string')throw securityError(`${field} måste vara text.`,'INVALID_INPUT_TYPE',422);
  if(payload[field].length>max)throw securityError(`${field} är för långt.`,'STRING_TOO_LONG',422);
  if(pattern&&payload[field]&&!pattern.test(payload[field]))throw securityError(`${field} har ogiltigt format.`,'INVALID_INPUT_FORMAT',422);
}
function assertPrimitiveTypes(req,payload){
  const method=String(req?.method||'GET').toUpperCase(),pathname=apiPath(req);
  if(pathname.endsWith('/auth/login')){
    assertTextField(payload,'username',120);
    assertTextField(payload,'password',256);
    assertTextField(payload,'totp',8,{pattern:/^\d{6}$/});
    assertTextField(payload,'companyId',200);
  }
  if((method==='POST'&&pathname==='/api/v1/customers')||(method==='PUT'&&/^\/api\/v1\/customers\/[^/]+$/.test(pathname))){
    assertTextField(payload,'requestId',200);
    assertTextField(payload,'name',160);
    assertTextField(payload,'email',254,{pattern:/^[^\s@]+@[^\s@]+\.[^\s@]+$/});
    assertTextField(payload,'orgNumber',40);
    assertTextField(payload,'address',500);
    if(payload.reminderFeeAgreed!==undefined&&typeof payload.reminderFeeAgreed!=='boolean')throw securityError('reminderFeeAgreed måste vara true eller false.','INVALID_INPUT_TYPE',422);
  }
  if(method==='POST'&&pathname==='/api/v1/bank/payments'){
    assertTextField(payload,'externalId',200);
    assertTextField(payload,'bookingDate',10,{pattern:/^\d{4}-\d{2}-\d{2}$/});
    assertTextField(payload,'valueDate',10,{pattern:/^\d{4}-\d{2}-\d{2}$/});
    assertTextField(payload,'currency',3);
    assertTextField(payload,'reference',500);
    assertTextField(payload,'message',1000);
    assertTextField(payload,'payerName',200);
    assertTextField(payload,'payerAccount',100);
  }
  if(method==='POST'&&pathname==='/api/v1/payables/suppliers'){
    assertTextField(payload,'supplierNumber',40);
    assertTextField(payload,'name',160);
    assertTextField(payload,'orgNumber',40);
    assertTextField(payload,'email',254,{pattern:/^[^\s@]+@[^\s@]+\.[^\s@]+$/});
    assertTextField(payload,'bankgiro',50);
    assertTextField(payload,'plusgiro',50);
    assertTextField(payload,'defaultCostAccount',4,{pattern:/^\d{4}$/});
  }
  if(method==='POST'&&pathname==='/api/v1/payables/invoices'){
    assertTextField(payload,'supplierId',200);
    assertTextField(payload,'supplierInvoiceNumber',100);
    assertTextField(payload,'invoiceDate',10,{pattern:/^\d{4}-\d{2}-\d{2}$/});
    assertTextField(payload,'dueDate',10,{pattern:/^\d{4}-\d{2}-\d{2}$/});
    assertTextField(payload,'currency',3);
    assertTextField(payload,'vatTreatment',80);
  }
  if(method==='POST'&&pathname==='/api/v1/inventory/items'){
    assertTextField(payload,'sku',60);
    assertTextField(payload,'name',160);
    assertTextField(payload,'unit',8);
    assertTextField(payload,'purchaseAccount',4,{pattern:/^\d{4}$/});
    assertTextField(payload,'inventoryAccount',4,{pattern:/^\d{4}$/});
  }
  if(method==='POST'&&pathname==='/api/v1/inventory/movements'){
    assertTextField(payload,'itemId',200);
    assertTextField(payload,'movementDate',10,{pattern:/^\d{4}-\d{2}-\d{2}$/});
    assertTextField(payload,'type',20);
    assertTextField(payload,'referenceType',80);
    assertTextField(payload,'referenceId',200);
    assertTextField(payload,'note',500);
    assertTextField(payload,'requestId',100);
  }
  if(method==='POST'&&pathname==='/api/v1/inventory/adjustments'){
    assertTextField(payload,'itemId',200);
    assertTextField(payload,'adjustmentDate',10,{pattern:/^\d{4}-\d{2}-\d{2}$/});
    assertTextField(payload,'reason',500);
    assertTextField(payload,'requestId',100);
  }
  if(method==='POST'&&pathname==='/api/v1/documents'){
    assertTextField(payload,'requestId',100);
    assertTextField(payload,'title',180);
    assertTextField(payload,'category',40);
    assertTextField(payload,'note',1000);
    assertTextField(payload,'fileName',180);
    assertTextField(payload,'mimeType',100);
    assertTextField(payload,'entityType',80);
    assertTextField(payload,'entityId',200);
    assertTextField(payload,'linkLabel',180);
  }
  if(method==='POST'&&/^\/api\/v1\/documents\/[^/]+\/links$/.test(pathname)){
    assertTextField(payload,'entityType',80);
    assertTextField(payload,'entityId',200);
    assertTextField(payload,'label',180);
  }
  if(method==='PUT'&&/^\/api\/v1\/suppliers\/[^/]+\/profile$/.test(pathname)){
    assertTextField(payload,'requestId',100);
    assertTextField(payload,'name',160);
    assertTextField(payload,'orgNumber',40);
    assertTextField(payload,'email',254,{pattern:/^[^\s@]+@[^\s@]+\.[^\s@]+$/});
    assertTextField(payload,'defaultCostAccount',4,{pattern:/^\d{4}$/});
  }
  if(method==='POST'&&/^\/api\/v1\/suppliers\/[^/]+\/payment-details$/.test(pathname)){
    assertTextField(payload,'requestId',100);
    assertTextField(payload,'bankgiro',50);
    assertTextField(payload,'plusgiro',50);
  }
  if(method==='POST'&&/^\/api\/v1\/suppliers\/changes\/[^/]+\/reject$/.test(pathname))assertTextField(payload,'reason',1000);
  if(method==='POST'&&/^\/api\/v1\/automation\/proposals\/[^/]+\/reclassify$/.test(pathname)){
    assertTextField(payload,'targetInvoiceId',200);
    assertTextField(payload,'requestId',100);
    assertTextField(payload,'correctionDate',10,{pattern:/^\d{4}-\d{2}-\d{2}$/});
    assertTextField(payload,'reason',500);
  }
  if(method==='POST'&&/^\/api\/v1\/automation\/proposals\/[^/]+\/reject$/.test(pathname))assertTextField(payload,'reason',1000);
  if(method==='POST'&&/^\/api\/v1\/accounting\/entries\/[^/]+\/correct$/.test(pathname)){
    assertTextField(payload,'postingDate',10,{pattern:/^\d{4}-\d{2}-\d{2}$/});
    assertTextField(payload,'reason',1000);
  }
  if(method==='POST'&&/^\/api\/v1\/accounting\/periods\/\d{4}-\d{2}\/unlock-request$/.test(pathname))assertTextField(payload,'reason',1000);
  if(method==='POST'&&/^\/api\/v1\/accounting\/unlock-requests\/[^/]+\/(?:approve|reject)$/.test(pathname))assertTextField(payload,'reason',1000);
  if(method==='POST'&&/^\/api\/v1\/payables\/payments\/[^/]+\/confirm-post$/.test(pathname)){
    assertTextField(payload,'confirmationReference',200);
    assertTextField(payload,'postingDate',10,{pattern:/^\d{4}-\d{2}-\d{2}$/});
  }
  if(method==='POST'&&/^\/api\/v1\/payables\/payments\/[^/]+\/correct$/.test(pathname)){
    assertTextField(payload,'requestId',100);
    assertTextField(payload,'correctionDate',10,{pattern:/^\d{4}-\d{2}-\d{2}$/});
    assertTextField(payload,'reason',500);
  }
  if(method==='POST'&&pathname==='/api/v1/payroll/runs'){
    assertTextField(payload,'period',7,{pattern:/^\d{4}-\d{2}$/});
    assertTextField(payload,'payDate',10,{pattern:/^\d{4}-\d{2}-\d{2}$/});
    assertTextField(payload,'sourceName',120);
  }
  if(method==='POST'&&/^\/api\/v1\/invoices\/[^/]+\/reminders(?:\/preview)?$/.test(pathname)){
    assertTextField(payload,'sentDate',10,{pattern:/^\d{4}-\d{2}-\d{2}$/});
    assertTextField(payload,'kind',50);
    assertTextField(payload,'note',1000);
    for(const field of ['includeReminderFee','includeInterest','includeBusinessLatePaymentCompensation']){
      if(payload[field]!==undefined&&typeof payload[field]!=='boolean')throw securityError(`${field} måste vara true eller false.`,'INVALID_INPUT_TYPE',422);
    }
  }
  if(method==='POST'&&/^\/api\/v1\/customer-invoices\/[^/]+\/credit$/.test(pathname)){
    assertTextField(payload,'requestId',100);
    assertTextField(payload,'creditDate',10,{pattern:/^\d{4}-\d{2}-\d{2}$/});
    assertTextField(payload,'reason',500);
  }
  if(method==='POST'&&/^\/api\/v1\/invoices\/[^/]+\/comments$/.test(pathname))assertTextField(payload,'text',2000);
  for(const field of ['amountOre','totalOre','vatOre','quantityMilli','unitCostOre','countedQuantityMilli','paymentTermsDays','expectedRevision','expectedPublishedVersion','grossSalaryOre','withheldTaxOre','employerContributionsOre','netPayOre','vacationLiabilityChangeOre']){
    if(payload[field]!==undefined&&!Number.isSafeInteger(payload[field]))throw securityError(`${field} måste vara ett säkert heltal.`,'INVALID_INPUT_TYPE',422);
  }
}
function schemaFor(method,pathname){
  return BODY_RULES.find(([verb,pattern])=>verb===method&&pattern.test(pathname))?.[2]||null;
}
function sanitizeJson(value,state={depth:0,counter:{nodes:0}}){
  state.counter.nodes+=1;
  if(state.counter.nodes>10000)throw securityError('JSON-innehållet är för komplext.','JSON_TOO_COMPLEX',422);
  if(state.depth>10)throw securityError('JSON-innehållet är för djupt nästlat.','JSON_TOO_DEEP',422);
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value)||!Number.isSafeInteger(value))throw securityError('Numeriska värden måste vara säkra heltal.','INVALID_NUMBER',422);
    return value;
  }
  if(typeof value==='string'){
    if(value.length>20000)throw securityError('Ett textfält är för långt.','STRING_TOO_LONG',422);
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw securityError('Text innehåller otillåtna kontrolltecken.','INVALID_CONTROL_CHARACTER',422);
    return value.normalize('NFC');
  }
  if(Array.isArray(value)){
    if(value.length>2000)throw securityError('En lista innehåller för många poster.','ARRAY_TOO_LARGE',422);
    return value.map(item=>sanitizeJson(item,{depth:state.depth+1,counter:state.counter}));
  }
  if(typeof value==='object'){
    const proto=Object.getPrototypeOf(value);
    if(proto!==Object.prototype&&proto!==null)throw securityError('JSON-objektet har ogiltig struktur.','INVALID_OBJECT',422);
    const keys=Object.keys(value);
    if(keys.length>100)throw securityError('Ett objekt innehåller för många fält.','OBJECT_TOO_LARGE',422);
    const clean={};
    for(const key of keys){
      if(key.length>80||!/^[-A-Za-z0-9_]+$/.test(key)||['__proto__','prototype','constructor'].includes(key))throw securityError('JSON innehåller ett otillåtet fältnamn.','INVALID_FIELD_NAME',422);
      clean[key]=sanitizeJson(value[key],{depth:state.depth+1,counter:state.counter});
    }
    return clean;
  }
  throw securityError('JSON innehåller en otillåten datatyp.','INVALID_JSON_TYPE',422);
}
function validateJsonInput(req,payload){
  const method=String(req?.method||'GET').toUpperCase();
  const pathname=apiPath(req);
  const allowed=schemaFor(method,pathname);
  if(!allowed)throw securityError('Den här API-rutten saknar ett registrerat inputschema.','INPUT_SCHEMA_REQUIRED',500);
  const clean=sanitizeJson(payload);
  const unexpected=Object.keys(clean).filter(key=>!allowed.has(key));
  if(unexpected.length)throw securityError(`Begäran innehåller oväntade fält: ${unexpected.slice(0,5).join(', ')}.`,'UNEXPECTED_FIELDS',422);
  assertPrimitiveTypes(req,clean);
  assertNestedSchema(req,clean);
  return clean;
}
function validateQueryValue(pathname,key,value){
  const optionalDate=new Set(['from','to','asOf','date']);
  if(optionalDate.has(key)&&value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))throw securityError(`Query-parametern ${key} måste vara datum ÅÅÅÅ-MM-DD.`,'INVALID_QUERY_VALUE',422);
  if(key==='period'&&value&&!/^\d{4}-\d{2}$/.test(value))throw securityError('Query-parametern period måste vara ÅÅÅÅ-MM.','INVALID_QUERY_VALUE',422);
  if(key==='year'&&value&&!/^(?:19|20|21)\d{2}$/.test(value))throw securityError('Query-parametern year måste vara ett fyrsiffrigt år.','INVALID_QUERY_VALUE',422);
  if(key==='includeArchived'&&!/^[01]$/.test(value))throw securityError('includeArchived måste vara 0 eller 1.','INVALID_QUERY_VALUE',422);
  if(key==='limit'){
    const limit=Number(value);
    const max=pathname==='/api/operator/v1/security-events'?200:1000;
    if(!/^\d{1,4}$/.test(value)||!Number.isSafeInteger(limit)||limit<1||limit>max)throw securityError(`limit måste vara 1–${max}.`,'INVALID_QUERY_VALUE',422);
  }
  if(key==='account'&&value&&!/^\d{4}$/.test(value))throw securityError('Konto måste bestå av fyra siffror.','INVALID_QUERY_VALUE',422);
  if(key==='mode'&&value&&!['day','week','month','quarter'].includes(value))throw securityError('mode måste vara day, week, month eller quarter.','INVALID_QUERY_VALUE',422);
  if(key==='direction'&&value&&!['in','out'].includes(value))throw securityError('direction måste vara in eller out.','INVALID_QUERY_VALUE',422);
  if(key==='sort'&&value&&!['date','amount','counterparty'].includes(value))throw securityError('sort har ett ogiltigt värde.','INVALID_QUERY_VALUE',422);
  if(key==='order'&&value&&!['asc','desc'].includes(value))throw securityError('order måste vara asc eller desc.','INVALID_QUERY_VALUE',422);
  const perFieldMax={status:80,category:40,entityType:80,entityId:200,itemId:200,query:200};
  if(perFieldMax[key]&&value.length>perFieldMax[key])throw securityError(`Query-parametern ${key} är för lång.`,'INVALID_QUERY_VALUE',422);
}

function bodyPolicyFor(req){
  const method=String(req?.method||'GET').toUpperCase();
  const pathname=apiPath(req);
  if(BODY_RULES.some(([verb,pattern])=>verb===method&&pattern.test(pathname)))return'json';
  if(BINARY_BODY_RULES.some(([verb,pattern])=>verb===method&&pattern.test(pathname)))return'binary';
  if(EMPTY_BODY_RULES.some(([verb,pattern])=>verb===method&&pattern.test(pathname)))return'empty-json';
  if(method==='GET'||method==='HEAD')return'none';
  return'unknown';
}
function requestHasBody(req){
  const rawLength=String(req?.headers?.['content-length']??'').trim();
  const transfer=String(req?.headers?.['transfer-encoding']??'').trim();
  if(transfer)return true;
  if(!rawLength)return false;
  if(!/^\d+$/.test(rawLength))throw securityError('Content-Length är ogiltig.','INVALID_CONTENT_LENGTH',400);
  return Number(rawLength)>0;
}
function readEmptyJsonBody(req){
  const contentType=String(req?.headers?.['content-type']||'').split(';')[0].trim().toLowerCase();
  if(contentType!=='application/json'){
    req.resume?.();
    throw securityError('Den här åtgärden accepterar ingen data. Om en tom JSON-body skickas måste Content-Type vara application/json.','UNSUPPORTED_MEDIA_TYPE',415);
  }
  const rawLength=String(req?.headers?.['content-length']??'').trim();
  if(rawLength){
    if(!/^\d+$/.test(rawLength))throw securityError('Content-Length är ogiltig.','INVALID_CONTENT_LENGTH',400);
    if(Number(rawLength)>EMPTY_BODY_LIMIT){
      req.resume?.();
      throw securityError('Den här åtgärden accepterar endast ett tomt JSON-objekt.','UNEXPECTED_REQUEST_BODY',422);
    }
  }
  return new Promise((resolve,reject)=>{
    const chunks=[];
    let size=0,settled=false;
    const fail=error=>{
      if(settled)return;
      settled=true;
      req.resume?.();
      reject(error);
    };
    req.on('data',chunk=>{
      if(settled)return;
      size+=chunk.length;
      if(size>EMPTY_BODY_LIMIT)return fail(securityError('Den här åtgärden accepterar endast ett tomt JSON-objekt.','UNEXPECTED_REQUEST_BODY',422));
      chunks.push(chunk);
    });
    req.on('end',()=>{
      if(settled)return;
      settled=true;
      let value;
      try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}
      catch{return reject(securityError('Den här åtgärden accepterar endast ett tomt JSON-objekt.','UNEXPECTED_REQUEST_BODY',422))}
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length){
        return reject(securityError('Den här åtgärden accepterar endast ett tomt JSON-objekt.','UNEXPECTED_REQUEST_BODY',422));
      }
      resolve();
    });
    req.on('error',error=>fail(error));
  });
}
async function validateRequestBody(req){
  const policy=bodyPolicyFor(req);
  if(policy==='json'||policy==='binary'||policy==='unknown')return;
  if(!requestHasBody(req))return;
  if(policy==='empty-json')return await readEmptyJsonBody(req);
  req.resume?.();
  throw securityError('Den här request-metoden accepterar ingen body.','UNEXPECTED_REQUEST_BODY',400);
}

function validateRequestTarget(req){
  const raw=String(req?.url||'/');
  if(raw.length>4096)throw securityError('Adressen är för lång.','URL_TOO_LONG',414);
  const rawPath=raw.split('?')[0];
  if(/%2f|%5c|%00/i.test(rawPath))throw securityError('Adressen innehåller otillåten kodning.','INVALID_URL_ENCODING',400);
  let url;
  try{url=new URL(raw,'http://localhost')}catch{throw securityError('Ogiltig adress.','INVALID_URL',400)}
  let decoded;
  try{decoded=decodeURIComponent(url.pathname)}catch{throw securityError('Adressen innehåller ogiltig kodning.','INVALID_URL_ENCODING',400)}
  if(decoded.length>2048||decoded.includes('\\')||/[\u0000-\u001f\u007f]/.test(decoded)||decoded.split('/').some(part=>part==='..'||part.length>240))throw securityError('Adressen innehåller en otillåten sökväg.','INVALID_PATH',400);
  const entries=[...url.searchParams.entries()];
  if(entries.length>20)throw securityError('För många query-parametrar.','TOO_MANY_QUERY_PARAMETERS',422);
  const seen=new Set();
  const rule=QUERY_RULES.find(([verb,pattern])=>verb===String(req?.method||'GET').toUpperCase()&&pattern.test(url.pathname));
  for(const[key,value]of entries){
    if(seen.has(key))throw securityError(`Query-parametern ${key} får bara anges en gång.`,'DUPLICATE_QUERY_PARAMETER',422);
    seen.add(key);
    if(key.length>80||!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key))throw securityError('Ogiltigt query-fältnamn.','INVALID_QUERY_PARAMETER',422);
    if(value.length>500||/[\u0000-\u001f\u007f]/.test(value))throw securityError('Ogiltigt query-värde.','INVALID_QUERY_VALUE',422);
    if(key.toLowerCase()==='demo')continue;
    if(url.pathname.startsWith('/api/')&&(!rule||!rule[2].has(key)))throw securityError(`Query-parametern ${key} stöds inte på den här rutten.`,'UNEXPECTED_QUERY_PARAMETER',422);
    validateQueryValue(url.pathname,key,value);
  }
  return url;
}

module.exports=Object.freeze({
  securityError,intSetting,clientIp,identityKey,routeClass,policyFor,createRateLimiter,sendRateLimited,
  validateRequestTarget,validateRequestBody,bodyPolicyFor,validateJsonInput,sanitizeJson,QUERY_RULES,BODY_RULES,EMPTY_BODY_RULES,BINARY_BODY_RULES
});
