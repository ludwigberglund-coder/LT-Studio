'use strict';

/**
 * Safe, display-only supplier payment journey.
 * No network call, authorization, approval, posting or bank execution.
 * Unknown/missing evidence always yields a review state, never "paid".
 */
function supplierJourney(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { stage: 'needs-review', label: 'Behöver kontroll', action: 'Granska faktura' };
  }
  const invoice = snapshot.invoice || {};
  const payment = snapshot.payment || {};
  // Only trustworthy ledger/bank reconciliation evidence can label an invoice paid.
  const reconciled = payment.reconciled === true &&
    payment.bankSettlementVerified === true &&
    payment.invoiceFullySettled === true &&
    typeof payment.bankTransactionId === 'string' &&
    payment.bankTransactionId.trim().length > 0;
  if (reconciled) return { stage: 'paid', label: 'Betald och avstämd', action: 'Visa betalning' };

  if (payment.failed === true || payment.returned === true) {
    return { stage: 'payment-failed', label: 'Betalningen behöver åtgärdas', action: 'Granska betalning' };
  }
  if (payment.bankSubmitted === true) {
    return { stage: 'bank-pending', label: 'Skickad till banken – inväntar bekräftelse', action: 'Visa betalning' };
  }
  if (payment.authorized === true) {
    return { stage: 'authorized', label: 'Godkänd för betalning – inte skickad', action: 'Visa betalningsplan' };
  }
  if (payment.planned === true) {
    return { stage: 'planned', label: 'Betalning planerad – inte skickad', action: 'Granska betalningsplan' };
  }
  if (invoice.liabilityPosted === true && invoice.approved === true) {
    return { stage: 'ready-to-plan', label: 'Faktura godkänd – betalning ej planerad', action: 'Planera betalning' };
  }
  if (invoice.approved === true) {
    return { stage: 'approved', label: 'Faktura godkänd – inväntar bokföring', action: 'Visa nästa steg' };
  }
  if (invoice.readyForApproval === true && invoice.reviewRequired !== true) {
    return { stage: 'ready', label: 'Redo att godkänna', action: 'Granska och godkänn' };
  }
  return { stage: 'needs-review', label: 'Behöver kontroll', action: 'Granska faktura' };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { supplierJourney };
if (typeof globalThis !== 'undefined') globalThis.LTStudioSupplierJourney = { supplierJourney };
