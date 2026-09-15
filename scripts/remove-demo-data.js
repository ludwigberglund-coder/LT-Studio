'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const Store = require('../lib/store');

const apply = process.argv.includes('--apply');
const dataFile = path.join(Store.resolveDataDir(), 'store.json');

function clearAccountingSealsForControlledRewrite(store) {
  delete store.accountingIntegrity;
  for (const entry of store.journal || []) delete entry.integrity;
  for (const invoice of [...(store.invoices || []), ...(store.supplierInvoices || [])]) delete invoice.integrity;
}

try {
  const loaded = Store.loadJsonWithBackup(dataFile);
  Store.ensureAuditChain(loaded.data);
  const integrityBefore = Store.validateStore(loaded.data);
  if (!integrityBefore.ok) throw new Error(`Datalagret är inte säkert att rensa: ${integrityBefore.errors[0]}`);

  const before = Store.detectDemoRecords(loaded.data);
  if (!before.length) {
    console.log('Inga kända demo-/testposter hittades. Ingen ändring behövs.');
    process.exit(0);
  }

  const draft = structuredClone(loaded.data);
  const removed = Store.stripKnownDemoData(draft);
  clearAccountingSealsForControlledRewrite(draft);
  Store.appendAudit(draft, {
    id: `audit_${crypto.randomUUID()}`,
    at: new Date().toISOString(),
    actor: 'Underhållsverktyg',
    action: 'DEMOPOSITIONER_BORTTAGNA',
    details: `${Object.entries(removed).map(([key, value]) => `${key}: ${value}`).join('; ')}; bokföringens integritetsförsegling byggdes om efter kontrollerad borttagning av enbart kända demo-/testposter.`
  });

  console.log(`Hittade ${before.length} kända demo-/testposter.`);
  console.log(Object.entries(removed).map(([key, value]) => `- ${key}: ${value}`).join('\n'));
  if (!apply) {
    console.log('Förhandsgranskning: inget har ändrats. Kör "npm run data:remove-demo -- --apply" för att skapa backup, rensa och återförsegla kvarvarande bokföring.');
    process.exit(0);
  }

  const backup = Store.createBackup(dataFile);
  Store.atomicWriteJson(dataFile, draft);
  const after = Store.validateStore(draft);
  if (!after.ok) throw new Error(`Rensningen sparades inte korrekt: ${after.errors[0]}`);
  console.log(`Rensningen är sparad och integritetsförseglingen är verifierad. Extra backup: ${backup.target}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
