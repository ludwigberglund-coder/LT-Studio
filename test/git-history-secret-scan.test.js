'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {findingsInText}=require('../scripts/scan-git-history-secrets.js');

test('history secret scanner detects high-confidence provider tokens and private keys without exposing values',()=>{
  const sample=[
    'const githubToken = "'+'gh'+'p_'+'abcdefghijklmnopqrstuvwxyz1234567890'+'";',
    'AWS_ACCESS_KEY_ID='+'AK'+'IA'+'ABCDEFGHIJKLMNOP',
    '-----BEGIN '+'PRIVATE KEY-----'
  ].join('\n');
  const findings=findingsInText(sample);
  assert.deepEqual(findings.map(row=>row.rule),['github-token','aws-access-key','private-key']);
  assert.deepEqual(findings.map(row=>row.line),[1,2,3]);
});

test('history secret scanner ignores explicit placeholders and test-only fixtures',()=>{
  const sample=[
    'ROLLANDS_AUTH_ENCRYPTION_KEY=REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS',
    'token=ghp_placeholderplaceholderplaceholder',
    "passwordHash:'test-only'",
    'host=example.invalid',
    "export R2_BACKUP_"+"SECRET_ACCESS_KEY='<secret-key>'",
    'ROLLANDS_BACKUP_'+'ENCRYPTION_KEY=<stark slumpmässig hemlighet>'
  ].join('\n');
  assert.deepEqual(findingsInText(sample),[]);
});


test('history secret scanner detects project runtime credentials without storing a matching fixture in source',()=>{
  const sample=[
    'ROLLANDS_AUTH_'+'ENCRYPTION_KEY='+'a'.repeat(40),
    'R2_STAGING_'+'SECRET_ACCESS_KEY='+'b'.repeat(40),
    'ROLLANDS_BOOTSTRAP_'+'MFA_SECRET='+'c'.repeat(32)
  ].join('\n');
  const findings=findingsInText(sample);
  assert.deepEqual(findings.map(row=>row.rule),[
    'rollands-runtime-secret',
    'rollands-runtime-secret',
    'rollands-runtime-secret'
  ]);
});

test('history secret scanner detects database URLs that embed a password',()=>{
  const sample='DATA'+'BASE_URL=postgres://rollands:'+'super-secret-value'+'@db.internal/rollands';
  assert.deepEqual(findingsInText(sample).map(row=>row.rule),['database-url-password']);
});
