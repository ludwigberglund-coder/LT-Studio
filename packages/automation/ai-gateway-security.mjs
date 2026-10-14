// Reusable safety boundary for a future Supabase AI Edge Function.
// Does not access the database, secrets, Cloudflare or the public browser.
// Pilot stays disabled until backend auth + durable quota controls are complete.
const SUPPORTED_SCENARIOS = Object.freeze(['office-paper', 'software-service', 'cleaning-supplies']);
const PILOT_INVOICE = Object.freeze({
  'office-paper': Object.freeze({
    supplierName: 'Syntetiskt Kontor AB', description: 'A4-kontorspapper, tio paket', expectedAccount: '6110'
  }),
  'software-service': Object.freeze({
    supplierName: 'Syntetisk IT AB', description: 'IT-drifttjänst under september', expectedAccount: '6540'
  }),
  'cleaning-supplies': Object.freeze({
    supplierName: 'Syntetisk Städ AB', description: 'Förbrukningsmaterial för städning', expectedAccount: '5460'
  })
});
function problem(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function safeObject(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some((key) => !keys.includes(key))) {
    throw problem('INVALID_INPUT');
  }
  return value;
}
function validateRequest(body) {
  safeObject(body, ['companyId', 'scenario', 'requestId']);
  if (typeof body.companyId !== 'string' || !/^[a-zA-Z0-9._:-]{6,100}$/.test(body.companyId)) {
    throw problem('INVALID_COMPANY');
  }
  if (!SUPPORTED_SCENARIOS.includes(body.scenario)) throw problem('UNSUPPORTED_SCENARIO');
  if (typeof body.requestId !== 'string' ||
      !/^[a-zA-Z0-9._:-]{16,100}$/.test(body.requestId)) {
    throw problem('INVALID_REQUEST_ID');
  }
  return {companyId:body.companyId,scenario:body.scenario,requestId:body.requestId};
}
function validateAuthorization({requestedCompany, verifiedUserId, membership, aal, sessionIsCurrent}) {
  if (typeof verifiedUserId !== 'string' || !verifiedUserId ||
      aal !== 'aal2' || sessionIsCurrent !== true) {
    throw problem('AUTH_REQUIRED');
  }
  if (!membership || membership.company_id !== requestedCompany ||
      membership.auth_user_id !== verifiedUserId ||
      !['admin','accountant'].includes(membership.role)) {
    throw problem('ACCESS_DENIED');
  }
  return Object.freeze({companyId:requestedCompany,actorId:verifiedUserId});
}
// Ground truth is server-only and deliberately excluded from invoice/model input.
function expectedPilotAccount(scenario) {
  if(typeof scenario!=='string'||!Object.hasOwn(PILOT_INVOICE,scenario)){
    throw problem('UNSUPPORTED_SCENARIO');
  }
  return PILOT_INVOICE[scenario].expectedAccount;
}
function syntheticInvoice(request, access) {
  if (!access || access.companyId !== request.companyId) throw problem('TENANT_MISMATCH');
  const template=PILOT_INVOICE[request.scenario];
  if (!template) throw problem('UNSUPPORTED_SCENARIO');
  return Object.freeze({
    synthetic:true,
    companyId:access.companyId,
    sourceId:'synthetic-'+request.requestId,
    documentType:'supplier-invoice',
    supplierName:template.supplierName,
    description:template.description,
    invoiceDate:'2026-09-15',
    currency:'SEK',
    sellerCountry:'SE',
    vatRateBps:2500,
    netOre:100000,
    vatOre:25000,
    grossOre:125000
  });
}
// This function is deliberately not a network client.
// A missing durable budget reservation MUST block future Cloudflare calls.
function requireBudgetReservation(reservation) {
  if (!reservation || reservation.persisted !== true ||
      reservation.companyAllowed !== true ||
      reservation.globalAllowed !== true ||
      reservation.idempotent !== true ||
      typeof reservation.reservationId !== 'string' ||
      !/^[a-zA-Z0-9._:-]{16,100}$/.test(reservation.reservationId)) {
    throw problem('BUDGET_NOT_RESERVED');
  }
  return reservation.reservationId;
}
function mayContactCloudflare({pilotEnabled, privacyApproved, reservation}) {
  if (pilotEnabled !== true || privacyApproved !== true) throw problem('AI_PILOT_DISABLED');
  requireBudgetReservation(reservation);
  return true;
}
export {SUPPORTED_SCENARIOS, validateRequest, validateAuthorization,
  syntheticInvoice, expectedPilotAccount, requireBudgetReservation, mayContactCloudflare};
