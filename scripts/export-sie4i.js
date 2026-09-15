'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Store = require('../lib/store.js');
const SIE = require('../lib/sie4i.js');

function argument(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : '';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

try {
  const dataFile = path.join(Store.resolveDataDir(), 'store.json');
  const loaded = Store.loadJsonWithBackup(dataFile);
  if (loaded.recovered) throw new Error('SIE-export stoppad: primärfilen är skadad och data lästes från backup. Återställ datalagret kontrollerat innan export.');

  const report = Store.validateStore(loaded.data);
  if (!report.ok) throw new Error(`SIE-export stoppad av integritetskontrollen: ${report.errors[0]}`);
  if (Number(report.summary.journalPending || 0) > 0 || Number(report.summary.invoicePending || 0) > 0) {
    throw new Error('SIE-export stoppad: bokföringsdata väntar på integritetsförsegling. Starta systemet och genomför en säker skrivning innan export.');
  }

  const generatedAt = argument('date') || today();
  const outputArgument = argument('output');
  const output = outputArgument
    ? path.resolve(outputArgument)
    : path.join(Store.resolveDataDir(), 'exports', `rollands-transaktioner-${generatedAt.replaceAll('-', '')}.SI`);
  const directory = path.dirname(output);
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});

  const buffer = SIE.buildSie4i(loaded.data, {
    generatedAt,
    signature: 'Rollands',
    programName: 'Rollands Ekonomi',
    programVersion: '0.1.0',
    currency: 'SEK'
  });

  fs.writeFileSync(output, buffer, {flag: 'wx', mode: 0o600});
  const digest = Store.sha256(buffer);
  fs.writeFileSync(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`, {flag: 'wx', mode: 0o600});

  console.log(`SIE 4I skapad: ${output}`);
  console.log(`Verifikationer: ${(loaded.data.journal || []).length}`);
  console.log(`SHA-256: ${digest}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
