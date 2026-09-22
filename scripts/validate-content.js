'use strict';

const fs = require('node:fs');
const path = require('node:path');
const AccessControl = require('../packages/access-control/authorization.js');

const root = path.resolve(__dirname, '..');

function readJson(relativePath) {
  const file = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${relativePath}: ${error.message}`);
  }
}

function getAtPath(value, keyPath) {
  return keyPath.split('.').reduce((current, key) => current?.[key], value);
}

function requireString(value, keyPath, errors, fileLabel) {
  const selected = getAtPath(value, keyPath);
  if (typeof selected !== 'string' || !selected.trim()) errors.push(`${fileLabel}: ${keyPath} måste vara en text.`);
}

function requireArray(value, keyPath, errors, fileLabel, minimum = 1) {
  const selected = getAtPath(value, keyPath);
  if (!Array.isArray(selected) || selected.length < minimum) errors.push(`${fileLabel}: ${keyPath} måste innehålla minst ${minimum} post(er).`);
}

function duplicates(items) {
  const seen = new Set();
  const found = new Set();
  for (const item of items) {
    if (seen.has(item)) found.add(item);
    seen.add(item);
  }
  return [...found];
}

function validate(company, site, admin, decisions, access) {
  const errors = [];

  for (const keyPath of [
    'legalName', 'displayName', 'orgNumber', 'vatNumber', 'address.full',
    'contact.phone', 'contact.phoneHref', 'contact.email', 'business.currency'
  ]) requireString(company, keyPath, errors, 'content/company.json');

  if (!/^\d{6}-\d{4}$/.test(company.orgNumber || '')) errors.push('content/company.json: orgNumber ska ha formatet 000000-0000.');
  if (!/^SE\d{12}$/.test(company.vatNumber || '')) errors.push('content/company.json: vatNumber ska ha svenskt VAT-format.');
  if (!/^\+\d{8,15}$/.test(company.contact?.phoneHref || '')) errors.push('content/company.json: contact.phoneHref ska vara ett internationellt telefonnummer utan mellanslag.');
  if (company.orgNumber !== '000000-0000') errors.push('content/company.json: publik demo måste använda det omöjliga demo-organisationsnumret 000000-0000.');
  if (company.vatNumber !== 'SE000000000001') errors.push('content/company.json: publik demo måste använda demo-VAT SE000000000001.');
  if (!String(company.contact?.email || '').toLowerCase().endsWith('.invalid')) errors.push('content/company.json: publik demo-e-post måste använda reserverad .invalid-domän.');
  try {
    const website = new URL(String(company.website || ''));
    if (!website.hostname.toLowerCase().endsWith('.invalid')) errors.push('content/company.json: publik demo-webbplats måste använda reserverad .invalid-domän.');
  } catch { errors.push('content/company.json: website måste vara en giltig demo-URL.'); }

  for (const keyPath of [
    'meta.title', 'meta.description', 'hero.eyebrow', 'hero.title', 'hero.body',
    'services.title', 'services.body', 'story.title', 'story.body', 'contact.title',
    'contact.body', 'footer.tagline', 'footer.adminLabel'
  ]) requireString(site, keyPath, errors, 'content/site.json');

  for (const keyPath of ['navigation', 'highlights', 'services.items', 'story.points', 'contact.openingHours']) {
    requireArray(site, keyPath, errors, 'content/site.json');
  }

  for (const [index, item] of (site.navigation || []).entries()) {
    if (!item?.label || !item?.href) errors.push(`content/site.json: navigation[${index}] behöver label och href.`);
    if (item?.href && !/^(?:#|\.\.?\/|https?:\/\/|mailto:|tel:)/i.test(item.href)) errors.push(`content/site.json: navigation[${index}].href är inte en säker länk.`);
  }
  for (const duplicate of duplicates((site.navigation || []).map(item => item.href))) errors.push(`content/site.json: dubblerad navigationslänk ${duplicate}.`);

  for (const [index, item] of (site.services?.items || []).entries()) {
    for (const key of ['id', 'symbol', 'title', 'description']) {
      if (typeof item?.[key] !== 'string' || !item[key].trim()) errors.push(`content/site.json: services.items[${index}].${key} måste vara text.`);
    }
  }
  for (const duplicate of duplicates((site.services?.items || []).map(item => item.id))) errors.push(`content/site.json: dubblerat tjänste-id ${duplicate}.`);

  for (const keyPath of ['productName', 'environment']) requireString(admin, keyPath, errors, 'content/admin.json');
  for (const keyPath of ['navigation', 'modules', 'principles', 'roadmap']) requireArray(admin, keyPath, errors, 'content/admin.json');
  for (const duplicate of duplicates((admin.navigation || []).map(item => item.id))) errors.push(`content/admin.json: dubblerat navigation-id ${duplicate}.`);
  for (const duplicate of duplicates((admin.modules || []).map(item => item.id))) errors.push(`content/admin.json: dubblerat modul-id ${duplicate}.`);

  if (decisions?.dataClassification !== 'synthetic-demo') errors.push('config: publika verksamhetsbeslut måste vara klassade som synthetic-demo.');
  if (decisions?.company?.orgNumber !== company.orgNumber) errors.push('config och company.json innehåller olika organisationsnummer.');
  if (decisions?.accounting?.moneyPrecision?.storageUnit !== 'ore') errors.push('config: penningprecision ska vara ore.');
  if (decisions?.inventory?.mode !== 'integrated-in-rollands') errors.push('config: lager ska vara integrerat i Rollands.');

  const accessReport = AccessControl.validateConfig(access);
  for (const error of accessReport.errors) errors.push(`config/access-control.json: ${error}`);

  return errors;
}

function validateContent() {
  const company = readJson('content/company.json');
  const site = readJson('content/site.json');
  const admin = readJson('content/admin.json');
  const decisions = readJson('config/rolands-business-decisions.json');
  const access = readJson('config/access-control.json');
  const accessReport = AccessControl.validateConfig(access);
  const errors = validate(company, site, admin, decisions, access);
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      navigationItems: site.navigation?.length || 0,
      services: site.services?.items?.length || 0,
      adminModules: admin.modules?.length || 0,
      roadmapSteps: admin.roadmap?.length || 0,
      accessPermissions: accessReport.summary.permissions || 0,
      separationWorkflows: accessReport.summary.workflows || 0
    }
  };
}

if (require.main === module) {
  const report = validateContent();
  if (!report.ok) {
    console.error('Innehållskontrollen misslyckades:');
    for (const error of report.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Innehållet är giltigt: ${report.summary.navigationItems} menyval, ${report.summary.services} erbjudanden, ${report.summary.adminModules} moduler, personliga företagsmedlemskap.`);
  }
}

module.exports = {validate, validateContent};
