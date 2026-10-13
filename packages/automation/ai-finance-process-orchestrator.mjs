// Shared, non-deployed server orchestration for financial AI process proposals.
// No SQL writes, document access, journal posting, payment execution or live route.
// The calling Edge gateway MUST verify the proxy IP and reserve quotas atomically.
import { verifyAiCompanySession } from './ai-gateway-session.mjs';
import { mayContactCloudflare } from './ai-gateway-security.mjs';
import { validateReviewOnlySyntheticProposal } from './ai-synthetic-quality-gate.mjs';
import {
  validateProcessRequest,buildSyntheticProcessCase,
  formatProcessProposal
} from './ai-finance-process-contract.mjs';

function failure(code) {
  const error=new Error(code);
  error.code=code;
  return error;
}
async function runSyntheticFinanceProcess({
  body,accessToken,userClient,
  enabled=false,privacyApproved=false,
  reserveBudget,provider
} = {}) {
  // Do not authenticate, consume quota or read user content when the pilot is off.
  if(enabled!==true || privacyApproved!==true)throw failure('AI_PILOT_DISABLED');
  if(typeof reserveBudget!=='function')throw failure('BUDGET_NOT_CONFIGURED');
  if(typeof provider!=='function')throw failure('AI_DISABLED');
  const request=validateProcessRequest(body);
  const trusted=await verifyAiCompanySession({
    companyId:request.companyId,accessToken,userClient
  });

  // Same durable five-field quota/idempotency contract as the old synthetic
  // supplier-invoice pilot. Never use client-supplied actor or session IDs.
  let reservation;
  try {
    reservation=await reserveBudget({
      companyId:trusted.companyId,
      actorId:trusted.actorId,
      sessionId:trusted.sessionId,
      requestId:request.requestId
    });
  }catch{
    throw failure('BUDGET_NOT_RESERVED');
  }
  mayContactCloudflare({pilotEnabled:enabled,privacyApproved,reservation});

  // The provider sees ONLY fixed synthetic facts and the server-approved purpose.
  // No company, actor, session, request ID, document ID or private source data.
  const testCase=buildSyntheticProcessCase(request,trusted);
  const modelOutput=await provider(testCase);
  const draft=formatProcessProposal({
    request,session:trusted,advice:modelOutput
  });
  // Independent postcondition: even if a future model/formatter changes, the
  // server must never return approved, posted or wrong-tenant AI proposals.
  return validateReviewOnlySyntheticProposal(draft,{
    companyId:trusted.companyId,purpose:request.purpose,requestId:request.requestId
  });
}
export {runSyntheticFinanceProcess};
