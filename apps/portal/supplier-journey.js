'use strict';

(function registerSupplierJourney(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LTStudioSupplierJourney = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSupplierJourney() {
  // Presentation only. These values never authorize an RPC or a bank operation.
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const state = (stage, label, action, group = 'help') => Object.freeze({ stage, label, action, group });
  const review = () => state('needs-review', 'Behöver kontroll', 'Granska faktura');

  function supplierJourney(snapshot) {
    if (!record(snapshot) || (snapshot.invoice !== undefined && !record(snapshot.invoice)) ||
        (snapshot.payment !== undefined && !record(snapshot.payment))) return review();
    const invoice = snapshot.invoice || {}, payment = snapshot.payment || {};
    const flags = ['reconciled', 'bankSettlementVerified', 'invoiceFullySettled', 'failed',
      'returned', 'cancelled', 'resultUnknown', 'bankSubmitted', 'authorized', 'planned'];
    if (flags.some(key => Object.hasOwn(payment, key) && typeof payment[key] !== 'boolean')) return review();
    if (['approved', 'liabilityPosted', 'readyForApproval', 'reviewRequired'].some(key =>
      Object.hasOwn(invoice, key) && typeof invoice[key] !== 'boolean')) return review();

    // A return, failure or ambiguous outcome takes precedence over old success flags.
    if (payment.failed === true || payment.returned === true)
      return state('payment-failed', 'Betalningen behöver åtgärdas', 'Granska betalning');
    if (payment.resultUnknown === true)
      return state('payment-unknown', 'Betalningsresultat behöver kontrolleras', 'Kontrollera med banken');
    if (payment.cancelled === true)
      return state('cancelled', 'Betalningsuppdrag avbrutet', 'Visa historik', 'history');
    if (invoice.reviewRequired === true) return review();
    if (payment.reconciled === true && payment.bankSettlementVerified === true &&
        payment.invoiceFullySettled === true && text(payment.bankTransactionId))
      return state('paid', 'Betald och avstämd', 'Visa betalning', 'history');
    if (payment.reconciled === true) return review();
    if (payment.bankSubmitted === true)
      return state('bank-pending', 'Skickad till banken – inväntar bekräftelse', 'Visa betalning', 'payment');
    if (payment.authorized === true)
      return state('authorized', 'Godkänd för betalning – inte skickad', 'Visa betalningsplan', 'payment');
    if (payment.planned === true)
      return state('planned', 'Betalning planerad – inte skickad', 'Granska betalningsplan', 'payment');
    if (invoice.liabilityPosted === true && invoice.approved === true)
      return state('ready-to-plan', 'Godkänd – planera betalning', 'Planera betalning', 'payment');
    if (invoice.approved === true)
      return state('approved', 'Faktura godkänd – inväntar bokföring', 'Visa nästa steg');
    if (invoice.readyForApproval === true)
      return state('ready', 'Att godkänna', 'Granska och godkänn', 'approval');
    return review();
  }

  // Adapter for the EXISTING authenticated portal invoice snapshot. A legacy
  // status "paid", a typed bank reference or a journal ID is NOT bank evidence.
  // No current invoice field is mapped to bankSettlementVerified/reconciled.
  function fromInvoice(invoice) {
    if (!record(invoice) || typeof invoice.status !== 'string') return review();
    if (invoice.reviewRequired === true) return review();
    switch (invoice.status) {
      case 'registered':
      case 'coding-review': return review();
      case 'coded': return supplierJourney({ invoice: { readyForApproval: true } });
      case 'approved':
        return supplierJourney({ invoice: { approved: true,
          liabilityPosted: invoice.liabilityPosted === true || text(invoice.liabilityAccountingEntryId) } });
      case 'payment-prepared':
        return state('planned', 'Betalning förberedd – inte bankbekräftad', 'Följ betalningen', 'payment');
      case 'paid':
        return state('recorded-paid', 'Betalning registrerad', 'Kontrollera bankavstämning', 'history');
      case 'cancelled': return state('cancelled', 'Faktura avbruten', 'Visa historik', 'history');
      case 'rejected': return state('rejected', 'Faktura avvisad – behöver kontroll', 'Granska faktura');
      default: return review();
    }
  }

  function summarize(invoices) {
    const counts = { approval: 0, payment: 0, help: 0, history: 0 };
    for (const invoice of Array.isArray(invoices) ? invoices : []) counts[fromInvoice(invoice).group]++;
    return Object.freeze(counts);
  }
  return Object.freeze({ supplierJourney, fromInvoice, summarize });
});
