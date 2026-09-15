'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const Store = require('../lib/store');

const apply = process.argv.includes('--apply');
const dataFile = path.join(Store.resolveDataDir(), 'store.json');

try {
  const loaded = Store.loadJsonWithBackup(dataFile);
  Store.ensureAuditChain(loaded.data);
  const before = Store.detectDemoRecords(loaded.data);
  if (!before.length) {
    console.log('Inga kända demo-/testposter hittades. Ingen ändring behövs.');
    process.exit(0);
  }
  const draft = structuredClone(loaded.data);
  const removed = Store.stripKnownDemoData(draft);
  Store.appendAudit(draft, {
    id: `audit_${crypto.randomUUID()}`,
    at: new Date().toISOString(),
    actor: 'Underhållsverktyg',
    action: 'DEMOPOSITIONER_BORTTAGNA',
    details: Object.entries(removed).map(([key, value]) => `${key}: ${value}`).join('; ')
  });
  console.log(`Hittade ${before.length} kända demo-/testposter.`);
  console.log(Object.entries(removed).map(([key, value]) => `- ${key}: ${value}`).join('\n'));
  if (!apply) {
    console.log('Förhandsgranskning: inget har ändrats. Kör "npm run data:remove-demo -- --apply" för att skapa backup och spara rensningen.');
    process.exit(0);
  }
  const backup = Store.createBackup(dataFile);
  Store.atomicWriteJson(dataFile, draft);
  console.log(`Rensningen är sparad. Extra backup: ${backup.target}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
