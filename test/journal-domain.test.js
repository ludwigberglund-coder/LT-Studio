'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AccessControl = require('../packages/access-control/authorization.js');
const Journal = require('../packages/accounting/journal.js');

const accessConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'access-control.json'), 'utf8'));
const access = AccessControl.createModel(accessConfig);

const accountant = {id: 'accountant-1', roles: ['accountant']};
const approver = {id: 'approver-1', roles: ['approver']};
const controller = {id: 'controller-1', roles: ['controller']};
const auditor = {id: 'auditor-1', roles: ['auditor']};

function idFactory() {
  let counter = 0;
  return prefix => `${prefix}-test-${++counter}`;
}

function context(actor, options = {}) {
  return {
    actor,
    access,
    idFactory: options.idFactory || idFactory(),
    now: options.now || '2026-09-15T10:00:00.000Z',
    ...options
  };
}

function balancedDraft(overrides = {}) {
  return {
    date: '2026-09-15',
    description: 'Inköp av frukt för butik',
    source: {type: 'supplier-invoice', reference: 'VF-1001'},
    rows: [
      {account: '4010', text: 'Varuinköp', debitOre: 100000, creditOre: 0},
      {account: '2641', text: 'Ingående moms', debitOre: 12000, creditOre: 0},
      {account: '2440', text: 'Leverantörsskuld', debitOre: 0, creditOre: 112000}
    ],
    ...overrides
  };
}

test('bokföring skapar en balanserad, numrerad och oföränderlig ny post i ören', () => {
  const ledger = Journal.createLedger({fiscalYearStart: '2026-01-01', fiscalYearEnd: '2026-12-31'});
  const result = Journal.postEntry(ledger, balancedDraft(), context(accountant));

  assert.equal(ledger.entries.length, 0, 'ursprungligt state får inte muteras');
  assert.equal(result.entry.number, 'A1');
  assert.equal(result.entry.sequence, 1);
  assert.equal(result.entry.period, '2026-09');
  assert.equal(result.entry.totals.debitOre, 112000);
  assert.equal(result.entry.totals.creditOre, 112000);
  assert.equal(result.entry.createdBy, accountant.id);
  assert.equal(result.state.sequences['A:2026'], 1);
  assert.equal(result.state.events.at(-1).type, 'ENTRY_POSTED');
  assert.equal(Journal.validateLedger(result.state).ok, true);
});

test('obalans, ogiltiga konton, datum, reserverade typer och otillräcklig behörighet stoppas före bokföring', () => {
  const ledger = Journal.createLedger({fiscalYearStart: '2026-01-01', fiscalYearEnd: '2026-12-31'});

  assert.throws(
    () => Journal.postEntry(ledger, balancedDraft({rows: [
      {account: '4010', debitOre: 10000, creditOre: 0},
      {account: '2440', debitOre: 0, creditOre: 9999}
    ]}), context(accountant)),
    error => error.code === 'INVALID_ENTRY' && /balanserar inte/.test(error.message)
  );

  assert.throws(
    () => Journal.postEntry(ledger, balancedDraft({rows: [
      {account: '40A0', debitOre: 10000, creditOre: 0},
      {account: '2440', debitOre: 0, creditOre: 10000}
    ]}), context(accountant)),
    error => error.code === 'INVALID_ENTRY' && /kontot/.test(error.message)
  );

  assert.throws(
    () => Journal.postEntry(ledger, balancedDraft({date: '2027-01-01'}), context(accountant)),
    error => error.code === 'INVALID_ENTRY' && /räkenskapsåret/.test(error.message)
  );

  assert.throws(
    () => Journal.postEntry(ledger, balancedDraft({kind: 'reversal'}), context(accountant)),
    error => error.code === 'RESERVED_ENTRY_KIND'
  );

  assert.throws(
    () => Journal.postEntry(ledger, balancedDraft(), context(auditor)),
    error => error.code === 'ACCESS_DENIED'
  );

  assert.throws(
    () => Journal.postEntry(ledger, balancedDraft(), context(auditor, {permissionId: 'reports.view'})),
    error => error.code === 'ACCESS_DENIED'
  );
  assert.equal(ledger.entries.length, 0);
});

test('periodlås stoppar bokföring och upplåsning kräver rätt roll samt en annan beställare', () => {
  const ledger = Journal.createLedger({fiscalYearStart: '2026-01-01', fiscalYearEnd: '2026-12-31'});
  const ids = idFactory();
  const locked = Journal.lockPeriod(ledger, '2026-09', context(approver, {
    idFactory: ids,
    reason: 'September är avstämd och klar'
  }));

  assert.equal(Journal.periodStatus(locked.state, '2026-09'), 'locked');
  assert.throws(
    () => Journal.postEntry(locked.state, balancedDraft(), context(accountant, {idFactory: ids})),
    error => error.code === 'PERIOD_LOCKED'
  );

  assert.throws(
    () => Journal.unlockPeriod(locked.state, '2026-09', context(controller, {
      idFactory: ids,
      requestedBy: controller.id,
      reason: 'Behöver rätta en felkontering'
    })),
    error => error.code === 'SEPARATION_OF_DUTIES_FAILED'
  );

  const unlocked = Journal.unlockPeriod(locked.state, '2026-09', context(controller, {
    idFactory: ids,
    requestedBy: accountant.id,
    reason: 'Behöver rätta en felkontering'
  }));
  assert.equal(Journal.periodStatus(unlocked.state, '2026-09'), 'open');
  assert.equal(unlocked.period.history.length, 2);
  assert.notEqual(unlocked.state.events[0].id, unlocked.state.events[1].id);

  const posted = Journal.postEntry(unlocked.state, balancedDraft(), context(accountant, {idFactory: ids}));
  assert.equal(posted.entry.number, 'A1');
});

test('rättelse bevarar originalet och skapar motverifikation samt valfri ersättningspost', () => {
  const ids = idFactory();
  let ledger = Journal.createLedger({fiscalYearStart: '2026-01-01', fiscalYearEnd: '2026-12-31'});
  const posted = Journal.postEntry(ledger, balancedDraft(), context(accountant, {idFactory: ids}));
  ledger = posted.state;
  const originalSnapshot = structuredClone(posted.entry);

  const corrected = Journal.correctEntry(ledger, {
    entryId: posted.entry.id,
    date: '2026-09-16',
    reason: 'Fel kostnadskonto användes',
    replacement: balancedDraft({
      date: '2026-09-16',
      description: 'Rättat inköp av frukt för butik',
      rows: [
        {account: '4000', text: 'Varuinköp rättat', debitOre: 100000, creditOre: 0},
        {account: '2641', text: 'Ingående moms', debitOre: 12000, creditOre: 0},
        {account: '2440', text: 'Leverantörsskuld', debitOre: 0, creditOre: 112000}
      ]
    })
  }, context(controller, {idFactory: ids, now: '2026-09-16T08:00:00.000Z'}));

  assert.deepEqual(corrected.original, originalSnapshot);
  assert.deepEqual(corrected.state.entries[0], originalSnapshot, 'originalposten får inte skrivas över');
  assert.equal(corrected.reversal.number, 'A2');
  assert.equal(corrected.reversal.kind, 'reversal');
  assert.equal(corrected.reversal.rows[0].debitOre, 0);
  assert.equal(corrected.reversal.rows[0].creditOre, 100000);
  assert.equal(corrected.replacement.number, 'A3');
  assert.equal(corrected.replacement.kind, 'replacement');
  assert.equal(corrected.state.corrections[posted.entry.id].reversalEntryId, corrected.reversal.id);
  assert.equal(corrected.state.corrections[posted.entry.id].replacementEntryId, corrected.replacement.id);
  assert.equal(Journal.validateLedger(corrected.state).ok, true);

  const relinked = structuredClone(corrected.state);
  const reversal = relinked.entries.find(entry => entry.id === corrected.reversal.id);
  reversal.links.reversalOf = 'entry-wrong-target';
  const relinkReport = Journal.validateLedger(relinked);
  assert.equal(relinkReport.ok, false);
  assert.ok(relinkReport.errors.some(error => /fel ursprungskoppling|saknar motsvarande rättelsepost/.test(error)));

  const orphaned = structuredClone(corrected.state);
  delete orphaned.corrections[posted.entry.id];
  const orphanReport = Journal.validateLedger(orphaned);
  assert.equal(orphanReport.ok, false);
  assert.ok(orphanReport.errors.some(error => /saknar motsvarande rättelsepost/.test(error)));

  assert.throws(
    () => Journal.correctEntry(corrected.state, {
      entryId: posted.entry.id,
      date: '2026-09-17',
      reason: 'Försök till dubbel rättelse'
    }, context(controller, {idFactory: ids})),
    error => error.code === 'ENTRY_ALREADY_CORRECTED'
  );
});

test('integritetskontrollen hittar manipulerade totalsummor, nummer, serieluckor och händelser', () => {
  const ids = idFactory();
  const first = Journal.postEntry(
    Journal.createLedger({fiscalYearStart: '2026-01-01', fiscalYearEnd: '2026-12-31'}),
    balancedDraft(),
    context(accountant, {idFactory: ids})
  );
  const second = Journal.postEntry(
    first.state,
    balancedDraft({date: '2026-09-16', description: 'Andra inköpet i nummerserien'}),
    context(accountant, {idFactory: ids, now: '2026-09-16T10:00:00.000Z'})
  );

  const broken = structuredClone(second.state);
  broken.entries.shift();
  broken.entries[0].totals.debitOre = 1;
  broken.entries[0].number = 'A99';
  broken.events.push({...broken.events[0]});

  const report = Journal.validateLedger(broken);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(error => /totals stämmer inte/.test(error)));
  assert.ok(report.errors.some(error => /number stämmer inte/.test(error)));
  assert.ok(report.errors.some(error => /Löpnummer A:2026 saknar 1/.test(error)));
  assert.ok(report.errors.some(error => /Dubblerat händelse-id/.test(error)));
  assert.throws(() => Journal.assertLedger(broken), error => error.code === 'INVALID_LEDGER');
});
