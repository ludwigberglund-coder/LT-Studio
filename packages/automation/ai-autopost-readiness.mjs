// Future low-risk automatic bookkeeping preflight (synthetic evaluation only).
// SERVER-ONLY DESIGN AID. NEVER an authorization boundary, journal writer or release switch.
// All flags MUST be derived and re-verified by trusted server/database code.
// Even an eligible candidate returns canPost:false until an independently audited
// financial domain RPC, tenant/RLS and release mechanism are implemented.
const CANDIDATE_KEYS=Object.freeze([
  'companyId','kind','sourceId','sourceSha256','supplierId','invoiceDate',
  'postingDate','currency','netOre','vatOre','grossOre','vatTreatment',
  'creditNote','lines'
]);
const SESSION_KEYS=Object.freeze(['companyId','role','tenantVerified','aal2Verified','sessionValid']);
const POLICY_KEYS=Object.freeze(['companyOptedIn','maxGrossOre']);
const CHECK_KEYS=Object.freeze([
  'originalPdfVerified','supplierStable','templateApprovals','sameSupplierTemplate',
  'periodOpen','accountsActive','vatRulesVerified','duplicateChecked',
  'duplicateFound','idempotencyReserved','previouslyPosted','auditReady'
]);
const TEMPLATE_KEYS=Object.freeze(['expenseAccount','vatAccount','payableAccount']);
const LINE_KEYS=Object.freeze(['account','debitOre','creditOre']);
const INPUT_KEYS=Object.freeze(['candidate','session','companyPolicy','checks','template']);

function exactObject(value,keys){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    Object.getPrototypeOf(value)===Object.prototype&&
    Object.keys(value).length===keys.length&&
    keys.every(key=>Object.hasOwn(value,key));
}
function positiveOre(value){return Number.isSafeInteger(value)&&value>0&&value<=100000000;}
function nonnegativeOre(value){return Number.isSafeInteger(value)&&value>=0&&value<=100000000;}
function identifier(value){return typeof value==='string'&&/^[A-Za-z0-9._:-]{6,100}$/.test(value);}
function day(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(value+'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
function eligibleLines(candidate,template){
  const accounts=[template.expenseAccount,template.vatAccount,template.payableAccount];
  if(!accounts.every(account=>typeof account==='string'&&/^[1-8]\d{3}$/.test(account))||
      new Set(accounts).size!==3)return false;
  if(!Array.isArray(candidate.lines)||candidate.lines.length!==3)return false;
  const rows=candidate.lines;
  if(rows.some(row=>!exactObject(row,LINE_KEYS)||
      !accounts.includes(row.account)||
      !nonnegativeOre(row.debitOre)||!nonnegativeOre(row.creditOre)||
      (row.debitOre>0&&row.creditOre>0)||
      (row.debitOre===0&&row.creditOre===0)))return false;
  if(new Set(rows.map(row=>row.account)).size!==3)return false;
  const byAccount=new Map(rows.map(row=>[row.account,row]));
  const expense=byAccount.get(template.expenseAccount);
  const vat=byAccount.get(template.vatAccount);
  const payable=byAccount.get(template.payableAccount);
  if(!expense||!vat||!payable)return false;
  return expense.debitOre===candidate.netOre&&expense.creditOre===0&&
    vat.debitOre===candidate.vatOre&&vat.creditOre===0&&
    payable.debitOre===0&&payable.creditOre===candidate.grossOre&&
    rows.reduce((sum,row)=>sum+row.debitOre,0)===
    rows.reduce((sum,row)=>sum+row.creditOre,0);
}
function evaluateAutoPostReadiness(input={}){
  if(!exactObject(input,INPUT_KEYS)){
    return Object.freeze({schemaVersion:1,simulationEligible:false,canPost:false,
      action:'manual-review',reasons:Object.freeze(['INVALID_INPUT'])});
  }
  const {candidate,session,companyPolicy,checks,template}=input;
  const reasons=[];
  const block=code=>{if(!reasons.includes(code))reasons.push(code);};
  if(!exactObject(candidate,CANDIDATE_KEYS)||
      !exactObject(session,SESSION_KEYS)||
      !exactObject(companyPolicy,POLICY_KEYS)||
      !exactObject(checks,CHECK_KEYS)||
      !exactObject(template,TEMPLATE_KEYS)){
    return Object.freeze({
      schemaVersion:1,simulationEligible:false,canPost:false,
      action:'manual-review',reasons:Object.freeze(['INVALID_INPUT'])
    });
  }
  if(!identifier(candidate.companyId)||!identifier(session.companyId)||
      candidate.companyId!==session.companyId||
      session.tenantVerified!==true||session.sessionValid!==true||
      session.aal2Verified!==true||
      !['admin','accountant'].includes(session.role))block('AUTH_OR_TENANT_UNVERIFIED');
  if(companyPolicy.companyOptedIn!==true||
      !positiveOre(companyPolicy.maxGrossOre))block('OPT_IN_OR_LIMIT_MISSING');
  if(candidate.kind!=='supplier-invoice'||candidate.creditNote!==false||
      candidate.currency!=='SEK'||candidate.vatTreatment!=='domestic-25')
    block('TRANSACTION_REQUIRES_REVIEW');
  if(!identifier(candidate.sourceId)||!identifier(candidate.supplierId)||
      typeof candidate.sourceSha256!=='string'||!/^[a-f0-9]{64}$/i.test(candidate.sourceSha256)||
      checks.originalPdfVerified!==true)block('SOURCE_NOT_VERIFIED');
  if(!day(candidate.invoiceDate)||!day(candidate.postingDate)||
      candidate.postingDate<candidate.invoiceDate||checks.periodOpen!==true)
    block('INVALID_OR_LOCKED_PERIOD');
  if(!positiveOre(candidate.grossOre)||!positiveOre(candidate.netOre)||
      !nonnegativeOre(candidate.vatOre)||candidate.netOre+candidate.vatOre!==candidate.grossOre||
      candidate.vatOre!==Math.round(candidate.netOre/4))block('AMOUNT_OR_VAT_MISMATCH');
  if(!positiveOre(candidate.grossOre)||candidate.grossOre>companyPolicy.maxGrossOre)
    block('AMOUNT_ABOVE_LIMIT');
  if(checks.supplierStable!==true||checks.sameSupplierTemplate!==true||
      !Number.isSafeInteger(checks.templateApprovals)||checks.templateApprovals<3)
    block('UNPROVEN_SUPPLIER_TEMPLATE');
  if(checks.accountsActive!==true||checks.vatRulesVerified!==true||
      !eligibleLines(candidate,template))block('ACCOUNTS_OR_JOURNAL_INVALID');
  if(checks.duplicateChecked!==true||checks.duplicateFound!==false||
      checks.previouslyPosted!==false||checks.idempotencyReserved!==true)
    block('DUPLICATE_OR_IDEMPOTENCY_RISK');
  if(checks.auditReady!==true)block('AUDIT_NOT_READY');
  return Object.freeze({
    schemaVersion:1,simulationEligible:reasons.length===0,
    // Deliberately unconditional: a pure JavaScript evaluator cannot grant posting authority.
    canPost:false,action:'manual-review',
    reasons:Object.freeze(reasons.length?reasons:['LIVE_POSTING_NOT_RELEASED'])
  });
}
export {evaluateAutoPostReadiness};
