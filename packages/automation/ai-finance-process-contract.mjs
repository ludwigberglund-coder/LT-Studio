// Structured, provider-independent contract for LT Studio finance AI.
// This is a SERVER-ONLY, SYNTHETIC-ONLY building block; no endpoint, SQL,
// file access, payment action or journal write is provided by this module.
import { isVerifiedAiSession } from './ai-gateway-session.mjs';

const PROCESS_DEFINITIONS=Object.freeze({
  'customer-invoice-review': Object.freeze({
    label:'Kundfaktura',kind:'customer-invoice',
    facts:Object.freeze({invoiceDate:'2026-09-15',grossOre:125000,currency:'SEK',state:'draft'})
  }),
  'supplier-invoice-review': Object.freeze({
    label:'Leverantörsfaktura',kind:'supplier-invoice',
    facts:Object.freeze({netOre:100000,vatOre:25000,grossOre:125000,currency:'SEK',state:'unreviewed'})
  }),
  'bank-reconciliation': Object.freeze({
    label:'Bankavstämning',kind:'bank-reconciliation',
    facts:Object.freeze({bankTransactionOre:125000,invoiceRemainingOre:125000,state:'unmatched'})
  }),
  'unplaced-payment': Object.freeze({
    label:'Oplacerad betalning',kind:'unplaced-payment',
    facts:Object.freeze({amountOre:56000,matchingInvoiceFound:false,state:'unmatched'})
  }),
  'vat-review': Object.freeze({
    label:'Momskontroll',kind:'vat-review',
    facts:Object.freeze({inputVatOre:25000,outputVatOre:50000,state:'unverified'})
  }),
  'report-explanation': Object.freeze({
    label:'Ekonomirapport',kind:'report',
    facts:Object.freeze({salesOre:200000,expensesOre:125000,state:'preliminary'})
  }),
  'month-close': Object.freeze({
    label:'Månadsavstämning',kind:'month-close',
    facts:Object.freeze({unmatchedPayments:2,unreviewedProposals:1,state:'not-approved'})
  }),
  'year-close': Object.freeze({
    label:'Bokslut',kind:'year-close',
    facts:Object.freeze({unverifiedAccounts:3,missingDocuments:2,state:'not-approved'})
  }),
  'payroll-review': Object.freeze({
    label:'Lönekontroll',kind:'payroll',
    facts:Object.freeze({employeeCount:2,payrollReviewed:false,state:'not-approved'})
  }),
  'inventory-review': Object.freeze({
    label:'Lagerkontroll',kind:'inventory',
    facts:Object.freeze({countedItems:50,discrepancies:2,state:'unverified'})
  })
});

const SUPPORTED_PURPOSES=Object.freeze(Object.keys(PROCESS_DEFINITIONS));
const DECISIONS=Object.freeze(['review-source','review-numbers','ask-human']);
const RESPONSE_KEYS=Object.freeze(['decision','explanation','uncertainties']);
const VERIFIED_CASES=new WeakSet();

function reject(code){
  const error=new Error(code);
  error.code=code;
  return error;
}
function record(value,keys,code){
  if(!value||typeof value!=='object'||Array.isArray(value)||
      Object.getPrototypeOf(value)!==Object.prototype||
      Object.keys(value).some(key=>!keys.includes(key))||
      Object.keys(value).length!==keys.length)throw reject(code);
}
function identifier(value){
  return typeof value==='string'&&/^[A-Za-z0-9._:-]{6,100}$/.test(value);
}
function validateProcessRequest(body){
  record(body,['companyId','purpose','requestId'],'INVALID_PROCESS_REQUEST');
  if(!identifier(body.companyId))throw reject('INVALID_COMPANY');
  if(!SUPPORTED_PURPOSES.includes(body.purpose))throw reject('UNSUPPORTED_PURPOSE');
  if(typeof body.requestId!=='string'||!/^[A-Za-z0-9._:-]{16,100}$/.test(body.requestId)){
    throw reject('INVALID_REQUEST_ID');
  }
  return Object.freeze({
    companyId:body.companyId,purpose:body.purpose,requestId:body.requestId
  });
}
function buildSyntheticProcessCase(request,verifiedSession){
  // The session object comes exclusively from a verified Auth + RLS preflight.
  // No caller-supplied boolean or company ID can serve as proof of identity.
  if(!isVerifiedAiSession(verifiedSession))throw reject('AUTH_REQUIRED');
  if(verifiedSession.companyId!==request?.companyId)throw reject('TENANT_MISMATCH');
  const definition=PROCESS_DEFINITIONS[request?.purpose];
  if(!definition||!identifier(request?.requestId))throw reject('INVALID_PROCESS_REQUEST');
  const example=Object.freeze({
    synthetic:true,
    purpose:request.purpose,
    kind:definition.kind,
    label:definition.label,
    facts:definition.facts
  });
  VERIFIED_CASES.add(example);
  return example;
}
function isVerifiedSyntheticCase(value){
  return Boolean(value&&typeof value==='object'&&VERIFIED_CASES.has(value));
}
function cleanModelText(value,min,max){
  if(typeof value!=='string'||value.length<min||value.length>max||
      value.trim()!==value||/[\u0000-\u001f\u007f<>]/u.test(value))throw reject('INVALID_MODEL_ADVICE');
  return value;
}
const MODEL_RESPONSE_SCHEMA=Object.freeze({
  type:'object',
  additionalProperties:false,
  properties:Object.freeze({
    decision:Object.freeze({type:'string',enum:DECISIONS}),
    explanation:Object.freeze({type:'string',minLength:16,maxLength:240}),
    uncertainties:Object.freeze({
      type:'array',minItems:0,maxItems:3,
      items:Object.freeze({type:'string',minLength:8,maxLength:120})
    })
  }),
  required:RESPONSE_KEYS
});
function validateProcessAdvice(output){
  record(output,RESPONSE_KEYS,'INVALID_MODEL_ADVICE');
  if(!DECISIONS.includes(output.decision)||
      !Array.isArray(output.uncertainties)||output.uncertainties.length>3||
      Object.getPrototypeOf(output.uncertainties)!==Array.prototype){
    throw reject('INVALID_MODEL_ADVICE');
  }
  const explanation=cleanModelText(output.explanation,16,240);
  const uncertainties=output.uncertainties.map(value=>cleanModelText(value,8,120));
  return Object.freeze({
    decision:output.decision,explanation,
    uncertainties:Object.freeze(uncertainties)
  });
}
function formatProcessProposal({request,session,advice}){
  if(!isVerifiedAiSession(session)||session.companyId!==request?.companyId)throw reject('TENANT_MISMATCH');
  if(!SUPPORTED_PURPOSES.includes(request.purpose))throw reject('UNSUPPORTED_PURPOSE');
  const approved=validateProcessAdvice(advice);
  // Only the server generates identifiers. The model cannot set status, journal
  // numbers, company, sources, trusted facts, approver or execution flags.
  return Object.freeze({
    schemaVersion:1,
    sourceId:'synthetic-'+request.purpose+'-'+request.requestId,
    companyId:session.companyId,
    purpose:request.purpose,
    status:'manual-review',
    posted:false,
    requiresHumanApproval:true,
    synthetic:true,
    advice:approved
  });
}
export {
  SUPPORTED_PURPOSES, DECISIONS, PROCESS_DEFINITIONS, MODEL_RESPONSE_SCHEMA,
  validateProcessRequest,buildSyntheticProcessCase,isVerifiedSyntheticCase,
  validateProcessAdvice,formatProcessProposal
};
