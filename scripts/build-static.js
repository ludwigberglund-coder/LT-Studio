'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {validateContent} = require('./validate-content.js');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'dist');

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Källkatalog saknas: ${path.relative(root, source)}`);
  fs.mkdirSync(destination, {recursive: true});
  fs.cpSync(source, destination, {recursive: true});
}

function copyFile(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Källfil saknas: ${path.relative(root, source)}`);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.copyFileSync(source, destination);
}

function buildStatic() {
  const report = validateContent();
  if (!report.ok) throw new Error(`Innehållet är ogiltigt: ${report.errors[0]}`);

  fs.rmSync(target, {recursive: true, force: true});
  fs.mkdirSync(target, {recursive: true});

  copyDirectory(path.join(root, 'apps', 'website'), target);
  copyDirectory(path.join(root, 'apps', 'admin'), path.join(target, 'admin'));
  copyDirectory(path.join(root, 'packages', 'shared', 'browser'), path.join(target, 'shared'));
  copyDirectory(path.join(root, 'content'), path.join(target, 'content'));
  copyDirectory(path.join(root, 'config'), path.join(target, 'config'));
  copyDirectory(path.join(root, 'public'), path.join(target, 'legacy'));

  copyFile(path.join(root, 'apps', 'website', 'index.html'), path.join(target, '404.html'));
  fs.writeFileSync(path.join(target, '.nojekyll'), '');
  fs.writeFileSync(path.join(target, 'build-info.json'), `${JSON.stringify({
    source: 'GitHub main',
    commit: process.env.GITHUB_SHA || 'local',
    generatedAt: new Date().toISOString(),
    demoOnly: true
  }, null, 2)}\n`);

  const required = [
    'index.html', 'app.js', 'styles.css', 'admin/index.html', 'admin/app.js',
    'shared/content.js', 'content/company.json', 'content/site.json',
    'content/admin.json', 'config/rolands-business-decisions.json', 'legacy/index.html'
  ];
  for (const relativePath of required) {
    if (!fs.existsSync(path.join(target, relativePath))) throw new Error(`Byggfil saknas: ${relativePath}`);
  }

  console.log(`Ny statisk demo byggd: ${target}`);
  return target;
}

if (require.main === module) {
  try {
    buildStatic();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {buildStatic};
