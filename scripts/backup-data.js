'use strict';

const path = require('node:path');
const Store = require('../lib/store');

const dataFile = path.join(Store.resolveDataDir(), 'store.json');
try {
  const result = Store.createBackup(dataFile);
  console.log(`Säkerhetskopia skapad: ${result.target}`);
  console.log(`Storlek: ${result.bytes} byte`);
  console.log(`SHA-256: ${result.sha256}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
