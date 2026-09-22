'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const {createApiApp} = require('./app.js');
const {createAutomationReviewRouter} = require('./automation-review-router.js');
const {createBankRouter} = require('./bank-router.js');
const {createPayablesRouter} = require('./payables-router.js');
const {createPaymentReleaseRouter} = require('./payment-release-router.js');
const {createPaymentConfirmationRouter} = require('./payment-confirmation-router.js');
const {createSupplierMasterdataRouter} = require('./supplier-masterdata-router.js');
const {createInventoryRouter} = require('./inventory-router.js');
const {createReportsRouter} = require('./reports-router.js');
const {createOperatorRouter}=require('./operator-router.js');
const {createExportsRouter}=require('./exports-router.js');
const {createPayrollRouter} = require('./payroll-router.js');
const {createDocumentsRouter} = require('./documents-router.js');
const {createAccountingAdminRouter} = require('./accounting-admin-router.js');
const {createOpeningMigrationImportRouter} = require('./opening-migration-import-router.js');
const {createWebsiteCmsRouter} = require('./website-cms-router.js');
const Db = require('./database.js');
const Queues = require('./queues.js');
const ReminderOutbox = require('./reminder-outbox.js');
const Bank = require('./bank-payments.js');
const Payables = require('./payables.js');
const PaymentConfirmation = require('./payment-confirmation.js');
const SupplierMasterdata = require('./supplier-masterdata.js');
const Inventory = require('./inventory.js');
const Payroll = require('./payroll.js');
const Documents = require('./documents.js');
const AccountingAdmin = require('./accounting-admin.js');
const WebsiteCms = require('./website-cms.js');
const PrivateObjectStoreFactory = require('./private-object-store-factory.js');
const PrivateObjectCopyLedger = require('./private-object-copy-ledger.js');
const {assertSyntheticStagingDatabase}=require('./staging-data-policy.js');

const repositoryRoot = path.resolve(__dirname,'..','..');
const {validateRuntime,protectedRuntimeMode,demoRequest,resolveStaticRequest,serveStatic} = require('./private-runtime.js');
const {readinessReport}=require('./readiness.js');
const OperationalLog=require('./operational-log.js');
const RequestSecurity=require('./request-security.js');

function normalizeHostname(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!raw) return '';
  if (raw === '::' || raw === '::1') return raw;
  try { return new URL(`http://${raw}`).hostname.replace(/^\[|\]$/g,'').replace(/\.$/,''); }
  catch { return raw.replace(/^\[|\]$/g,'').split(':')[0]; }
}
function isLoopback(value) { return ['127.0.0.1','localhost','::1'].includes(normalizeHostname(value)); }
function allowedHost(req, host, configuredAllowedHosts) {
  const requested = normalizeHostname(req.headers.host);
  if (!requested) return false;
  if (isLoopback(requested)) return true;
  const allowed = new Set(configuredAllowedHosts.map(normalizeHostname).filter(Boolean));
  const bound = normalizeHostname(host);
  if (!['0.0.0.0','::'].includes(bound)) allowed.add(bound);
  return allowed.has(requested);
}
function createServer(options = {}) {
  const host = String(options.host || process.env.ROLLANDS_API_HOST || '127.0.0.1').trim();
  const port = Number(options.port ?? process.env.PORT ?? 4180);
  const databasePath = options.databasePath || process.env.ROLLANDS_DATABASE_PATH || path.join(repositoryRoot,'data','platform.sqlite');
  const secureCookies = options.secureCookies ?? (process.env.ROLLANDS_API_SECURE_COOKIE !== '0');
  const authEncryptionKey = options.authEncryptionKey ?? process.env.ROLLANDS_AUTH_ENCRYPTION_KEY ?? '';
  const configuredAllowedHosts = options.allowedHosts || String(process.env.ROLLANDS_ALLOWED_HOSTS || '').split(',').map(value=>value.trim()).filter(Boolean);
  const trustCloudflare = options.trustCloudflare ?? (process.env.ROLLANDS_TRUST_CLOUDFLARE === '1');
  const rateLimitEnv = options.rateLimitEnv || process.env;
  const runtimeId = crypto.randomUUID();
  const operationalLogger=OperationalLog.createOperationalLogger({writer:options.operationalLogWriter??OperationalLog.defaultWriter(process.env)});
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT måste vara ett heltal mellan 1 och 65535.');
  if (trustCloudflare && !isLoopback(host)) throw new Error('Cloudflare-klient-IP får bara betros när origin-servern är bunden till loopback, exempelvis bakom Cloudflare Tunnel.');
  if (!isLoopback(host)) {
    if (!secureCookies) throw new Error('Säkra cookies måste vara aktiverade när API:t exponeras utanför den lokala datorn.');
    if (String(authEncryptionKey).length < 32) throw new Error('ROLLANDS_AUTH_ENCRYPTION_KEY måste vara minst 32 tecken innan API:t exponeras utanför den lokala datorn.');
    if (['0.0.0.0','::'].includes(normalizeHostname(host)) && !configuredAllowedHosts.length) throw new Error('ROLLANDS_ALLOWED_HOSTS måste anges när API:t lyssnar på en jokeradress.');
  }
  validateRuntime(process.env,{host,databasePath,secureCookies,authEncryptionKey,allowedHosts:configuredAllowedHosts,db:options.db});
  PrivateObjectStoreFactory.providerFromEnvironment(process.env);
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(databasePath)),{recursive:true,mode:0o700});
  const db = options.db || Db.openDatabase(databasePath);
  try{
    assertSyntheticStagingDatabase(db,process.env);
  }catch(error){
    try{db.close()}catch{}
    throw error;
  }
  PrivateObjectCopyLedger.initializePrivateObjectCopyLedger(db);
  Queues.initializeQueues(db); ReminderOutbox.initializeReminderOutbox(db); Bank.initializeBankPayments(db); Payables.initializePayables(db); SupplierMasterdata.initializeSupplierMasterdata(db); PaymentConfirmation.initializePaymentConfirmation(db); Inventory.initializeInventory(db); Payroll.initializePayroll(db); Documents.initializeDocuments(db); AccountingAdmin.initializeAccountingAdmin(db); WebsiteCms.initializeWebsiteCms(db);
  const clientIp=req=>RequestSecurity.clientIp(req,{trustCloudflare});
  const rateLimiter=RequestSecurity.createRateLimiter({env:rateLimitEnv,db,trustCloudflare});
  const api = createApiApp({db,secureCookies,authEncryptionKey,operationalLogger,operationalRuntimeId:runtimeId,clientIp});
  const automationReview = createAutomationReviewRouter({db}); const bank = createBankRouter({db}); const payables = createPayablesRouter({db}); const supplierMasterdata = createSupplierMasterdataRouter({db}); const paymentRelease = createPaymentReleaseRouter({db}); const paymentConfirmation = createPaymentConfirmationRouter({db}); const inventory = createInventoryRouter({db}); const reports = createReportsRouter({db}); const exportsRouter=createExportsRouter({db}); const payroll = createPayrollRouter({db}); const documents = createDocumentsRouter({db}); const openingMigrationImport=createOpeningMigrationImportRouter({db}); const accounting = createAccountingAdminRouter({db}); const websiteCms = createWebsiteCmsRouter({db});
  const protectedMode=protectedRuntimeMode(process.env);
  const stagingMode=String(process.env.ROLLANDS_ENV||'').trim()==='staging';
  const readinessPayload=({includeMonitoring=true}={})=>{
    const report=readinessReport({
      db,
      databasePath,
      backupPath:process.env.ROLLANDS_BACKUP_PATH||'',
      offsiteBackupEvidencePath:process.env.ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH||'',
      r2StagingAuditEvidencePath:process.env.R2_STAGING_AUDIT_EVIDENCE_PATH||'',
      restoreEvidencePath:process.env.ROLLANDS_RESTORE_DRILL_EVIDENCE_PATH||'',
      r2RestoreEvidencePath:process.env.ROLLANDS_R2_RESTORE_DRILL_EVIDENCE_PATH||'',
      monitoringEvidencePath:process.env.ROLLANDS_MONITORING_EVIDENCE_PATH||'',
      auditAnchorEvidencePath:process.env.ROLLANDS_AUDIT_ANCHOR_EVIDENCE_PATH||'',
      auditAnchorPath:process.env.ROLLANDS_AUDIT_ANCHOR_PATH||'',
      expectedR2StagingBucket:process.env.R2_STAGING_BUCKET||'',
      expectedR2BackupBucket:process.env.R2_BACKUP_BUCKET||'',
      expectedR2AuditBucket:process.env.R2_AUDIT_BUCKET||'',
      requireBackup:protectedMode,
      requireOffsiteBackupEvidence:protectedMode,
      requireR2StagingAuditEvidence:stagingMode,
      requireRestoreEvidence:protectedMode,
      requireR2RestoreEvidence:stagingMode,
      requireStagingEvidenceConsistency:stagingMode,
      requireMonitoringEvidence:protectedMode&&includeMonitoring,
      requireAuditAnchorEvidence:protectedMode
    });
    return {
      ok:report.ok,
      service:'rollands-api-v1',
      checks:report.checks,
      freeMiB:report.freeBytes===null?null:Math.floor(report.freeBytes/1048576),
      backupAgeMinutes:report.backupAgeMs===null?null:Math.floor(report.backupAgeMs/60000),
      offsiteBackupAgeMinutes:report.offsiteBackupAgeMs===null?null:Math.floor(report.offsiteBackupAgeMs/60000),
      r2StagingAuditAgeMinutes:report.r2StagingAuditAgeMs===null?null:Math.floor(report.r2StagingAuditAgeMs/60000),
      restoreDrillAgeMinutes:report.restoreDrillAgeMs===null?null:Math.floor(report.restoreDrillAgeMs/60000),
      r2RestoreDrillAgeMinutes:report.r2RestoreDrillAgeMs===null?null:Math.floor(report.r2RestoreDrillAgeMs/60000),
      monitoringAgeMinutes:report.monitoringAgeMs===null?null:Math.floor(report.monitoringAgeMs/60000),
      alertTestAgeMinutes:report.alertAgeMs===null?null:Math.floor(report.alertAgeMs/60000),
      auditAnchorAgeMinutes:report.auditAnchorAgeMs===null?null:Math.floor(report.auditAnchorAgeMs/60000)
    };
  };
  const operator=createOperatorRouter({db,secureCookies,authEncryptionKey,readinessProvider:readinessPayload,clientIp});

  // Apply guards after every router has initialized its tables, before accepting requests.
  require('./tenant-integrity.js').installTenantGuards(db);
  const server = http.createServer(async (req,res) => {
    const requestId=OperationalLog.requestId();
    const startedAt=Number(process.hrtime.bigint()/1000000n);
    const route=OperationalLog.routeClass(req.url||'/');
    let operationalCode='';
    res.setHeader('X-Request-Id',requestId);
    res.once('finish',()=>{
      const statusCode=Number(res.statusCode)||0;
      operationalLogger.emit({
        level:statusCode>=500?'error':statusCode>=400?'warning':'info',
        event:'http_request',
        runtimeId,
        requestId,
        method:req.method||'GET',
        route,
        statusCode,
        durationMs:Number(process.hrtime.bigint()/1000000n)-startedAt,
        code:operationalCode
      });
    });
    try{
    RequestSecurity.validateRequestTarget(req);
    const rateLimit=rateLimiter.check(req);
    if(!rateLimit.allowed){operationalCode='RATE_LIMITED';return RequestSecurity.sendRateLimited(res,rateLimit,requestId);}
    if (!allowedHost(req,host,configuredAllowedHosts)) { operationalCode='HOST_NOT_ALLOWED'; res.writeHead(421,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); return res.end(JSON.stringify({error:'Värdnamnet är inte tillåtet.',code:'HOST_NOT_ALLOWED'})); }
    if (demoRequest(req.url || '/')) { operationalCode='DEMO_DISABLED'; res.writeHead(400,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); return res.end(JSON.stringify({error:'Demoläge är inte tillåtet på den privata servern. Använd den separata demon.',code:'DEMO_DISABLED'})); }
    await RequestSecurity.validateRequestBody(req);
    if (String(req.url || '').split('?')[0] === '/_runtime-version') {
      if (!['GET','HEAD'].includes(req.method || 'GET')) { res.writeHead(405,{'Allow':'GET, HEAD','Cache-Control':'no-store'}); return res.end(); }
      const body=Buffer.from(JSON.stringify({runtimeId}));
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return res.end(req.method==='HEAD'?undefined:body);
    }
    if (String(req.url || '').split('?')[0] === '/api/v1/readiness/core') {
      if (!['GET','HEAD'].includes(req.method || 'GET')) { res.writeHead(405,{'Allow':'GET, HEAD','Cache-Control':'no-store'}); return res.end(); }
      const payload=readinessPayload({includeMonitoring:false});
      const body=Buffer.from(JSON.stringify(payload));
      res.writeHead(payload.ok?200:503,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return res.end(req.method==='HEAD'?undefined:body);
    }
    if (String(req.url || '').split('?')[0] === '/api/v1/readiness') {
      if (!['GET','HEAD'].includes(req.method || 'GET')) { res.writeHead(405,{'Allow':'GET, HEAD','Cache-Control':'no-store'}); return res.end(); }
      const payload=readinessPayload({includeMonitoring:true});
      const body=Buffer.from(JSON.stringify(payload));
      res.writeHead(payload.ok?200:503,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return res.end(req.method==='HEAD'?undefined:body);
    }
    if (String(req.url || '').startsWith('/api/operator/v1/')) {
      if (await operator.handle(req,res)) return;
    }
    if (String(req.url || '').startsWith('/website-preview/') && await websiteCms.handle(req,res)) return;
    if (!String(req.url || '').startsWith('/api/v1/')) {
      if (serveStatic(req,res)) return;
      res.writeHead(404,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); return res.end(JSON.stringify({error:'Hittades inte.',code:'NOT_FOUND'}));
    }
    if (await automationReview.handle(req,res)) return; if (await bank.handle(req,res)) return; if (await supplierMasterdata.handle(req,res)) return; if (await paymentRelease.handle(req,res)) return; if (await paymentConfirmation.handle(req,res)) return; if (await inventory.handle(req,res)) return; if (await reports.handle(req,res)) return; if (await exportsRouter.handle(req,res)) return; if (await payroll.handle(req,res)) return; if (await documents.handle(req,res)) return; if (await openingMigrationImport.handle(req,res)) return; if (await accounting.handle(req,res)) return; if (await websiteCms.handle(req,res)) return; if (await payables.handle(req,res)) return; return await api.handle(req,res);
    }catch(error){
      operationalCode=OperationalLog.safeCode?OperationalLog.safeCode(error?.code):'REQUEST_HANDLER_ERROR';
      operationalLogger.emit({
        level:'error',
        event:'request_handler_error',
        runtimeId,
        requestId,
        method:req.method||'GET',
        route,
        code:operationalCode||'REQUEST_HANDLER_ERROR'
      });
      if(!res.headersSent){
        const status=Number(error?.statusCode||500);
        operationalCode=operationalCode||'REQUEST_HANDLER_ERROR';
        res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        return res.end(JSON.stringify({
          error:status>=500?'Ett internt fel inträffade.':String(error?.message||'Begäran kunde inte behandlas.'),
          code:error?.code||'INTERNAL_ERROR',
          requestId
        }));
      }
      res.destroy();
    }
  });
  function close(callback) { server.close(() => { try { db.close(); } catch {} if (callback) callback(); }); }
  return Object.freeze({server,db,api,operator,automationReview,bank,payables,supplierMasterdata,paymentRelease,paymentConfirmation,inventory,reports,exportsRouter,payroll,documents,openingMigrationImport,accounting,websiteCms,host,port,databasePath,runtimeId,close});
}
if (require.main === module) {
  const runtime = createServer();
  runtime.server.listen(runtime.port,runtime.host,() => {
    const logger=OperationalLog.createOperationalLogger({writer:OperationalLog.defaultWriter(process.env)});
    if(logger.enabled)logger.emit({event:'service_started',runtimeId:runtime.runtimeId});
    else console.log('Rollands portal och API är startat.');
  });
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,() => runtime.close(() => process.exit(0)));
}
module.exports=Object.freeze({createServer,normalizeHostname,isLoopback,allowedHost,resolveStaticRequest,serveStatic});
