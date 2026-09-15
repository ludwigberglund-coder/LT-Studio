'use strict';

(function registerMoneyDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RollandsMoney = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMoneyDomain() {
  const ORE_PER_KRONA = 100;
  const QUANTITY_SCALE = 1000;
  const BASIS_POINTS_PER_PERCENT = 100;
  const BASIS_POINTS_PER_ONE = 10000;

  function domainError(message) {
    const error = new TypeError(message);
    error.code = 'INVALID_MONEY_VALUE';
    return error;
  }

  function assertSafeInteger(value, label = 'Värdet') {
    if (!Number.isSafeInteger(value)) throw domainError(`${label} måste vara ett säkert heltal.`);
    return value;
  }

  function addSafe(left, right, label = 'Summan') {
    assertSafeInteger(left, 'Vänster värde');
    assertSafeInteger(right, 'Höger värde');
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw domainError(`${label} är för stort.`);
    return result;
  }

  function multiplySafe(left, right, label = 'Produkten') {
    assertSafeInteger(left, 'Vänster värde');
    assertSafeInteger(right, 'Höger värde');
    const result = left * right;
    if (!Number.isSafeInteger(result)) throw domainError(`${label} är för stort.`);
    return result;
  }

  function normalizeDecimalInput(value, label) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw domainError(`${label} måste anges som text eller tal.`);
    }
    const normalized = String(value)
      .trim()
      .replace(/[\s\u00a0\u202f]/g, '');
    if (!normalized) throw domainError(`${label} saknas.`);
    return normalized;
  }

  function parseScaledDecimal(value, decimals, label) {
    const normalized = normalizeDecimalInput(value, label);
    const match = normalized.match(/^([+-]?)(\d+)(?:[.,](\d+))?$/);
    if (!match) throw domainError(`${label} har ogiltigt format.`);

    const fraction = match[3] || '';
    if (fraction.length > decimals) {
      throw domainError(`${label} får ha högst ${decimals} decimaler.`);
    }

    const scale = 10 ** decimals;
    const whole = Number(match[2]);
    const fractional = Number(fraction.padEnd(decimals, '0') || '0');
    if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fractional)) {
      throw domainError(`${label} är för stort.`);
    }

    const absolute = addSafe(multiplySafe(whole, scale, label), fractional, label);
    const signed = match[1] === '-' ? -absolute : absolute;
    return Object.is(signed, -0) ? 0 : signed;
  }

  function parseOre(value, options = {}) {
    const result = parseScaledDecimal(value, 2, options.label || 'Beloppet');
    if (options.allowNegative === false && result < 0) throw domainError(`${options.label || 'Beloppet'} får inte vara negativt.`);
    if (options.allowZero === false && result === 0) throw domainError(`${options.label || 'Beloppet'} får inte vara noll.`);
    return result;
  }

  function parseQuantityMilli(value, options = {}) {
    const result = parseScaledDecimal(value, 3, options.label || 'Antalet');
    if (options.allowNegative !== true && result < 0) throw domainError(`${options.label || 'Antalet'} får inte vara negativt.`);
    if (options.allowZero !== true && result === 0) throw domainError(`${options.label || 'Antalet'} måste vara större än noll.`);
    return result;
  }

  function parseVatBasisPoints(value, options = {}) {
    const result = parseScaledDecimal(value, 2, options.label || 'Momssatsen');
    const maximum = options.maximum ?? BASIS_POINTS_PER_ONE;
    if (result < 0 || result > maximum) {
      throw domainError(`${options.label || 'Momssatsen'} måste ligga mellan 0 och ${maximum / BASIS_POINTS_PER_PERCENT} procent.`);
    }
    return result;
  }

  function roundDivide(numerator, denominator) {
    assertSafeInteger(numerator, 'Täljaren');
    assertSafeInteger(denominator, 'Nämnaren');
    if (denominator <= 0) throw domainError('Nämnaren måste vara större än noll.');

    const sign = numerator < 0 ? -1 : 1;
    const absolute = Math.abs(numerator);
    const quotient = Math.floor(absolute / denominator);
    const remainder = absolute % denominator;
    const rounded = remainder * 2 >= denominator ? quotient + 1 : quotient;
    return sign * rounded;
  }

  function calculateVatOre(netOre, vatBasisPoints) {
    assertSafeInteger(netOre, 'Nettobeloppet');
    assertSafeInteger(vatBasisPoints, 'Momssatsen');
    if (vatBasisPoints < 0 || vatBasisPoints > BASIS_POINTS_PER_ONE) {
      throw domainError('Momssatsen måste ligga mellan 0 och 100 procent.');
    }
    return roundDivide(multiplySafe(netOre, vatBasisPoints, 'Momsberäkningen'), BASIS_POINTS_PER_ONE);
  }

  function calculateLine(input) {
    if (!input || typeof input !== 'object') throw domainError('Fakturaraden saknas.');
    const quantityMilli = assertSafeInteger(input.quantityMilli, 'Antalet');
    const unitPriceOre = assertSafeInteger(input.unitPriceOre, 'Styckepriset');
    const vatBasisPoints = assertSafeInteger(input.vatBasisPoints, 'Momssatsen');
    if (quantityMilli <= 0) throw domainError('Antalet måste vara större än noll.');

    const netOre = roundDivide(
      multiplySafe(unitPriceOre, quantityMilli, 'Radbeloppet'),
      QUANTITY_SCALE
    );
    const vatOre = calculateVatOre(netOre, vatBasisPoints);
    const grossOre = addSafe(netOre, vatOre, 'Radens totalbelopp');

    return {
      description: String(input.description || ''),
      quantityMilli,
      unitPriceOre,
      vatBasisPoints,
      netOre,
      vatOre,
      grossOre
    };
  }

  function sumOre(values, label = 'Summan') {
    if (!Array.isArray(values)) throw domainError(`${label} måste vara en lista.`);
    return values.reduce((sum, value) => addSafe(sum, assertSafeInteger(value, label), label), 0);
  }

  function calculateInvoice(lines) {
    if (!Array.isArray(lines) || lines.length === 0) throw domainError('Fakturan måste innehålla minst en rad.');
    const calculatedLines = lines.map(calculateLine);
    const netOre = sumOre(calculatedLines.map(line => line.netOre), 'Fakturans nettobelopp');
    const vatOre = sumOre(calculatedLines.map(line => line.vatOre), 'Fakturans moms');
    const grossOre = addSafe(netOre, vatOre, 'Fakturans totalbelopp');

    const grouped = new Map();
    for (const line of calculatedLines) {
      const current = grouped.get(line.vatBasisPoints) || {vatBasisPoints: line.vatBasisPoints, netOre: 0, vatOre: 0, grossOre: 0};
      current.netOre = addSafe(current.netOre, line.netOre, 'Momsunderlaget');
      current.vatOre = addSafe(current.vatOre, line.vatOre, 'Momsbeloppet');
      current.grossOre = addSafe(current.grossOre, line.grossOre, 'Momsgruppens total');
      grouped.set(line.vatBasisPoints, current);
    }

    return {
      lines: calculatedLines,
      netOre,
      vatOre,
      grossOre,
      vatBreakdown: [...grouped.values()].sort((left, right) => left.vatBasisPoints - right.vatBasisPoints)
    };
  }

  function remainingOre(totalOre, paidOre) {
    assertSafeInteger(totalOre, 'Totalbeloppet');
    assertSafeInteger(paidOre, 'Betalt belopp');
    return addSafe(totalOre, -paidOre, 'Återstående belopp');
  }

  function legacyKronorToOre(value, label = 'Kronbeloppet') {
    const kronor = parseScaledDecimal(value, 0, label);
    return multiplySafe(kronor, ORE_PER_KRONA, `${label} i ören`);
  }

  function formatSek(ore, options = {}) {
    assertSafeInteger(ore, 'Beloppet');
    const formatted = new Intl.NumberFormat(options.locale || 'sv-SE', {
      style: 'currency',
      currency: 'SEK',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      signDisplay: options.showPlus ? 'exceptZero' : 'auto'
    }).format(ore / ORE_PER_KRONA);
    return formatted.replace(/\u00a0/g, ' ');
  }

  function formatQuantity(quantityMilli) {
    assertSafeInteger(quantityMilli, 'Antalet');
    return new Intl.NumberFormat('sv-SE', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3
    }).format(quantityMilli / QUANTITY_SCALE);
  }

  return Object.freeze({
    ORE_PER_KRONA,
    QUANTITY_SCALE,
    BASIS_POINTS_PER_PERCENT,
    BASIS_POINTS_PER_ONE,
    assertSafeInteger,
    parseOre,
    parseQuantityMilli,
    parseVatBasisPoints,
    roundDivide,
    calculateVatOre,
    calculateLine,
    calculateInvoice,
    sumOre,
    remainingOre,
    legacyKronorToOre,
    formatSek,
    formatQuantity
  });
});
