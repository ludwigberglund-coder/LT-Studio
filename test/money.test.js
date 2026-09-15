'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const Money = require('../packages/accounting/money.js');

test('svenska decimalbelopp tolkas exakt som heltal i ören', () => {
  assert.equal(Money.parseOre('1 234,56'), 123456);
  assert.equal(Money.parseOre('0,10') + Money.parseOre('0,20'), 30);
  assert.equal(Money.parseOre('-0,01'), -1);
  assert.equal(Money.formatSek(123456), '1 234,56 kr');
});

test('ogiltig precision och osäkra belopp stoppas före beräkning', () => {
  assert.throws(() => Money.parseOre('10,001'), /högst 2 decimaler/);
  assert.throws(() => Money.parseQuantityMilli('1,0001'), /högst 3 decimaler/);
  assert.throws(() => Money.parseVatBasisPoints('101'), /mellan 0 och 100/);
  assert.throws(() => Money.calculateLine({quantityMilli: 0, unitPriceOre: 100, vatBasisPoints: 2500}), /större än noll/);
});

test('faktura med blandad moms summeras per momssats utan flyttalsfel', () => {
  const invoice = Money.calculateInvoice([
    {
      description: 'Fruktlåda',
      quantityMilli: Money.parseQuantityMilli('2'),
      unitPriceOre: Money.parseOre('149,50'),
      vatBasisPoints: Money.parseVatBasisPoints('12')
    },
    {
      description: 'Leverans',
      quantityMilli: Money.parseQuantityMilli('1'),
      unitPriceOre: Money.parseOre('75,00'),
      vatBasisPoints: Money.parseVatBasisPoints('25')
    }
  ]);

  assert.equal(invoice.netOre, 37400);
  assert.equal(invoice.vatOre, 5463);
  assert.equal(invoice.grossOre, 42863);
  assert.deepEqual(invoice.vatBreakdown, [
    {vatBasisPoints: 1200, netOre: 29900, vatOre: 3588, grossOre: 33488},
    {vatBasisPoints: 2500, netOre: 7500, vatOre: 1875, grossOre: 9375}
  ]);
});

test('decimal kvantitet avrundas en gång på radnivå', () => {
  const line = Money.calculateLine({
    description: 'Viktvara',
    quantityMilli: Money.parseQuantityMilli('1,5'),
    unitPriceOre: Money.parseOre('19,95'),
    vatBasisPoints: Money.parseVatBasisPoints('12')
  });

  assert.equal(line.netOre, 2993);
  assert.equal(line.vatOre, 359);
  assert.equal(line.grossOre, 3352);
  assert.equal(Money.formatQuantity(line.quantityMilli), '1,5');
});

test('betalningssaldo och kontrollerad migrering från hela kronor är exakta', () => {
  assert.equal(Money.legacyKronorToOre(4375), 437500);
  assert.equal(Money.remainingOre(500000, 250000), 250000);
  assert.equal(Money.remainingOre(420000, 450000), -30000);
  assert.throws(() => Money.legacyKronorToOre('12,50'), /högst 0 decimaler/);
});
