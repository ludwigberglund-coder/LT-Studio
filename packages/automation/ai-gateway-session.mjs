// Server-only authenticated preflight for the future AI Edge Function.
// Accepts a user-scoped Supabase client. A frontend must never create trusted context.
// The actual endpoint must still perform persistent IP/user quotas before inference.
import { validateAuthorization, validateRequest, syntheticInvoice } from './ai-gateway-security.mjs';
function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function decodeVerifiedClaims(token) {
  if (typeof token !== 'string' || token.length < 50 || token.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw fail('AUTH_REQUIRED');
  }
  try {
    const padded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const binary = typeof atob === 'function'
      ? atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
      : '';
    if (!binary || binary.length > 8192) throw new Error('Bad JWT');
    const claims = JSON.parse(binary);
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error('Bad claims');
    return claims;
  } catch {
    throw fail('AUTH_REQUIRED');
  }
}
function verifiedSessionId(claims, verifiedUserId) {
  // Reading JWT fields is ONLY safe after auth.getUser(token) verified the exact token.
  if (claims.sub !== verifiedUserId || claims.aal !== 'aal2' ||
      typeof claims.session_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.session_id)) {
    throw fail('AUTH_REQUIRED');
  }
  return claims.session_id;
}
async function preflightSyntheticPilot({ body, accessToken, userClient }) {
  const request = validateRequest(body);
  if (!userClient || typeof userClient.auth?.getUser !== 'function' ||
      typeof userClient.from !== 'function') throw fail('BACKEND_NOT_CONFIGURED');

  // Supabase Auth validates signature, expiry and user of the bearer token.
  let auth;
  try { auth = await userClient.auth.getUser(accessToken); }
  catch { throw fail('AUTH_REQUIRED'); }
  if (auth.error || typeof auth.data?.user?.id !== 'string') throw fail('AUTH_REQUIRED');
  const userId = auth.data.user.id;
  const claims = decodeVerifiedClaims(accessToken);
  verifiedSessionId(claims, userId);

  // This MUST be a user-scoped client (Authorization: Bearer <accessToken>).
  // Existing company_memberships restrictive RLS invokes the personal-session
  // server guard, including auth.sessions revocation and disabled user checks.
  // Never replace this with service-role/admin table reads.
  let membershipResult;
  try {
    membershipResult = await userClient
      .from('company_memberships')
      .select('company_id,auth_user_id,role')
      .eq('company_id', request.companyId)
      .eq('auth_user_id', userId)
      .maybeSingle();
  } catch { throw fail('ACCESS_DENIED'); }
  if (membershipResult?.error) throw fail('ACCESS_DENIED');
  const access = validateAuthorization({
    requestedCompany: request.companyId,
    verifiedUserId: userId,
    membership: membershipResult?.data,
    aal: claims.aal,
    sessionIsCurrent: true // RLS-personal-session guard required on membership read.
  });
  const invoice = syntheticInvoice(request, access);
  return Object.freeze({
    request,
    invoice,
    trustedContext: Object.freeze({
      verified: true, pilotMode: 'synthetic',
      companyId: access.companyId, actorId: userId, aal: 'aal2'
    })
  });
}
export { decodeVerifiedClaims, verifiedSessionId, preflightSyntheticPilot };
