'use strict';

const path = require('node:path');
const Store = require('../lib/store');

const dataDir = Store.resolveDataDir();
const dataFile = path.join(dataDir, 'store.json');

try {
  const loaded = Store.loadJsonWithBackup(dataFile);
  const report = Store.validateStore(loaded.data);
  console.log(`Datalager: ${dataFile}`);
  console.log(`Källa: ${loaded.recovered ? 'säkerhetskopia' : 'primärfil'}`);
  console.log(`Status: ${report.ok ? 'OK' : 'FEL'}`);
  for (const [key, value] of Object.entries(report.summary)) console.log(`- ${key}: ${value}`);
  for (const warning of report.warnings) console.log(`VARNING: ${warning}`);
  for (const error of report.errors) console.error(`FEL: ${error}`);
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
