// Deliberately NOT a public endpoint. An Edge Function must inject an authenticated
// user-scoped Supabase client AND a durable atomic budget reservation backend.
// Never let browser input select the provider, model, quota or trusted context.
import { preflightSyntheticPilot } from './ai-gateway-session.mjs';
import { mayContactCloudflare, expectedPilotAccount } from './ai-gateway-security.mjs';
import { suggestSyntheticInvoice } from './cloudflare-bookkeeping.mjs';

function blocked(code) {
  const error=new Error(code);
  error.code=code;
  return error;
}
async function runSyntheticPilot({
  body, accessToken, userClient, pilotEnabled = false,
  privacyApproved = false, reserveBudget, provider
}) {
  // Deny without touching Supabase or Cloudflare when globally disabled.
  if (pilotEnabled !== true || privacyApproved !== true) throw blocked('AI_PILOT_DISABLED');
  if (typeof reserveBudget !== 'function') throw blocked('BUDGET_NOT_CONFIGURED');
  if (typeof provider !== 'function') throw blocked('AI_DISABLED');
  const verified=await preflightSyntheticPilot({body,accessToken,userClient});

  // A server implementation MUST atomically persist/rate-limit this call before
  // returning a reservation. This orchestrator has no database write privileges.
  let reservation;
  try {
    reservation=await reserveBudget({
      companyId:verified.trustedContext.companyId,
      actorId:verified.trustedContext.actorId,
      sessionId:verified.trustedContext.sessionId,
      requestId:verified.request.requestId
    });
  } catch {
    throw blocked('BUDGET_NOT_RESERVED');
  }
  mayContactCloudflare({pilotEnabled,privacyApproved,reservation});
  // Keep the verified session identifier inside the quota boundary. It must not
  // enter the provider context or the minimized synthetic model request.
  const {sessionId: _sessionId, ...providerContext}=verified.trustedContext;
  // The pilot proposal is ephemeral, remains manual-review, never posts a journal.
  const proposal=await suggestSyntheticInvoice({
    invoice:verified.invoice,
    trustedContext:providerContext,
    provider
  });
  // Structural validity and a balanced 25% VAT journal do not prove the
  // model chose the right expense account for these fixed synthetic examples.
  // Never send an obviously misclassified pilot result to the client.
  if(proposal?.suggestion?.expenseAccount!==expectedPilotAccount(verified.request.scenario)){
    throw blocked('UNSAFE_AI_PROPOSAL');
  }
  return proposal;
}
export {runSyntheticPilot};
