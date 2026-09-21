'use strict';

const Automation = require('./proposals.js');

function matcherError(message, code='BANK_MATCH_ERROR', statusCode=422) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function text(value) { return String(value ?? '').trim(); }
function normalize(value) {
  return text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('sv')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}
function compact(value) { return normalize(value).replace(/\s+/g,''); }
function digits(value) { return text(value).replace(/\D+/g,''); }
function tokens(value) { return normalize(value).split(/\s+/).filter(token=>token.length >= 3); }
function canonicalName(value) {
  const ignored = new Set(['ab','aktiebolag','hb','handelsbolag','kb','kommanditbolag','sweden','sverige']);
  return normalize(value).split(/\s+/).filter(token=>token && !ignored.has(token)).join(' ');
}

function referenceMatches(payment, value) {
  const targetText = compact(value);
  const targetDigits = digits(value);
  if (!targetText && !targetDigits) return false;
  const sources = [payment.reference,payment.message].filter(Boolean);
  for (const source of sources) {
    if (targetDigits && targetDigits.length >= 4) {
      const sourceTokens = text(source).split(/[^0-9]+/).filter(Boolean);
      if (sourceTokens.includes(targetDigits)) return true;
    }
    if (targetText && targetText.length >= 4 && tokens(source).some(token=>compact(token)===targetText)) return true;
    if (targetText && compact(source) === targetText) return true;
  }
  return false;
}

function nameSimilarity(paymentName, customerName) {
  const left = canonicalName(paymentName);
  const right = canonicalName(customerName);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length >= 6 && right.length >= 6 && (left.includes(right) || right.includes(left))) return 0.9;
  const a = new Set(left.split(/\s+/));
  const b = new Set(right.split(/\s+/));
  const intersection = [...a].filter(value=>b.has(value)).length;
  const union = new Set([...a,...b]).size;
  return union ? intersection / union : 0;
}

function scoreCandidate(payment, invoice) {
  const paymentAmount=Number(payment.amountOre),remaining=Number(invoice.remainingOre);
  const amountMatch = paymentAmount === remaining;
  const partialAmount = paymentAmount > 0 && paymentAmount < remaining;
  const amountWithinBalance = paymentAmount > 0 && paymentAmount <= remaining;
  const ocrMatch = referenceMatches(payment,invoice.ocr);
  const invoiceNumberMatch = referenceMatches(payment,invoice.invoiceNumber);
  const customerNameScore = nameSimilarity(payment.payerName,invoice.customerName);
  let score = 0;
  let deterministic = false;
  const evidence = [];

  if (ocrMatch) { score += 0.62; evidence.push({kind:'payment-reference',label:'OCR',value:text(invoice.ocr),sourceId:payment.id}); }
  else if (invoiceNumberMatch) { score += 0.56; evidence.push({kind:'payment-reference',label:'Fakturanummer',value:text(invoice.invoiceNumber),sourceId:payment.id}); }
  if (amountMatch) { score += 0.32; evidence.push({kind:'amount',label:'Exakt restbelopp',value:String(payment.amountOre),sourceId:payment.id}); }
  else if (partialAmount) { score += 0.18; evidence.push({kind:'amount',label:'Delbetalning inom restbelopp',value:String(payment.amountOre),sourceId:payment.id}); }
  if (customerNameScore >= 0.9) { score += 0.14; evidence.push({kind:'payer-name',label:'Betalarnamn',value:text(payment.payerName),sourceId:payment.id}); }
  else if (customerNameScore >= 0.5) { score += 0.07; evidence.push({kind:'payer-name',label:'Delvis namnmatchning',value:text(payment.payerName),sourceId:payment.id}); }

  score = Math.min(1,score);
  if ((ocrMatch || invoiceNumberMatch) && amountMatch) deterministic = true;
  return Object.freeze({invoice,score,deterministic,amountMatch,partialAmount,amountWithinBalance,ocrMatch,invoiceNumberMatch,customerNameScore,evidence:Object.freeze(evidence)});
}

function analyzeIncomingPayment(payment,invoices) {
  if (!payment || !text(payment.id) || !text(payment.companyId)) throw matcherError('Bankhändelsen saknar id eller företag.','INVALID_PAYMENT');
  if (!Number.isSafeInteger(payment.amountOre) || payment.amountOre <= 0) throw matcherError('Inbetalningen måste vara ett positivt heltalsbelopp i ören.','INVALID_PAYMENT_AMOUNT');
  if (!Array.isArray(invoices)) throw matcherError('Fakturalistan saknas.','INVALID_INVOICE_LIST');

  const eligible = invoices.filter(invoice=>invoice && invoice.companyId===payment.companyId && Number.isSafeInteger(invoice.remainingOre) && invoice.remainingOre>0);
  const scored = eligible.map(invoice=>scoreCandidate(payment,invoice)).filter(candidate=>candidate.amountWithinBalance&&candidate.score>=0.45).sort((a,b)=>b.score-a.score || String(a.invoice.id).localeCompare(String(b.invoice.id)));
  if (!scored.length) return Object.freeze({status:'no-match',paymentId:payment.id,candidates:Object.freeze([]),reason:'Ingen öppen kundfaktura gav tillräckligt starka matchningssignaler.'});

  const best = scored[0];
  const second = scored[1];
  const ambiguous = Boolean(second && second.score >= best.score - 0.05);
  const confidence = ambiguous ? Math.min(best.score,0.69) : best.score;
  const status = confidence >= 0.75 ? 'proposal' : 'manual-review';
  const reasonParts = [];
  if (best.ocrMatch) reasonParts.push('OCR matchar');
  else if (best.invoiceNumberMatch) reasonParts.push('fakturanummer matchar');
  if (best.amountMatch) reasonParts.push('beloppet matchar restbeloppet');
  else if (best.partialAmount) reasonParts.push('beloppet är en delbetalning inom restbeloppet');
  if (best.customerNameScore >= 0.9) reasonParts.push('betalarnamnet matchar kunden');
  if (ambiguous) reasonParts.push('flera fakturor ligger nära samma matchningspoäng');

  return Object.freeze({
    status,
    paymentId:payment.id,
    confidence,
    deterministic:best.deterministic && !ambiguous,
    ambiguous,
    targetInvoiceId:best.invoice.id,
    targetInvoiceNumber:text(best.invoice.invoiceNumber),
    targetCustomerName:text(best.invoice.customerName),
    amountOre:payment.amountOre,
    reason:reasonParts.join(', ') || 'Matchning baserad på betalningsinformationen.',
    evidence:best.evidence,
    candidates:Object.freeze(scored.slice(0,5).map(candidate=>Object.freeze({invoiceId:candidate.invoice.id,invoiceNumber:candidate.invoice.invoiceNumber,customerName:candidate.invoice.customerName,remainingOre:candidate.invoice.remainingOre,score:candidate.score})))
  });
}

function createMatchProposal(payment,analysis,{createdBy='system',engineVersion='2'}={}) {
  if (!analysis || !['proposal','manual-review'].includes(analysis.status) || !analysis.targetInvoiceId) return null;
  return Automation.createProposal({
    companyId:payment.companyId,
    type:'bank-payment-match',
    sourceId:payment.id,
    confidence:analysis.confidence,
    deterministic:analysis.deterministic,
    ambiguous:analysis.ambiguous,
    reason:analysis.reason,
    evidence:analysis.evidence,
    suggestion:{
      action:'match-customer-payment',
      bankPaymentId:payment.id,
      invoiceId:analysis.targetInvoiceId,
      invoiceNumber:analysis.targetInvoiceNumber,
      customerName:analysis.targetCustomerName,
      amountOre:payment.amountOre,
      bookingDate:payment.bookingDate,
      externalId:payment.externalId,
      bankAccount:'1930',
      receivableAccount:'1510'
    },
    engine:{kind:'rules',name:'incoming-payment-matcher',version:engineVersion},
    createdBy
  });
}

module.exports = Object.freeze({normalize,compact,digits,canonicalName,nameSimilarity,referenceMatches,scoreCandidate,analyzeIncomingPayment,createMatchProposal});
