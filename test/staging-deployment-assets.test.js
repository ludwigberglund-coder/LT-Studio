'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
function read(rel){return fs.readFileSync(path.join(root,rel),'utf8')}

test('staging environment template is synthetic-only and uses runtime-supported R2 names',()=>{
  const env=read('deploy/staging/staging.env.example');
  for(const required of [
    'NODE_ENV=production',
    'ROLLANDS_ENV=staging',
    'ROLLANDS_DATA_CLASSIFICATION=synthetic',
    'ROLLANDS_REAL_DATA_ALLOWED=0',
    'ROLLANDS_DEMO_DATA=0',
    'ROLLANDS_API_HOST=127.0.0.1',
    'ROLLANDS_API_SECURE_COOKIE=1',
    'R2_STAGING_AUDIT_EVIDENCE_PATH=/srv/lt-studio-ops/r2-staging-audit-evidence.json',
    'R2_STAGING_ENABLED=1',
    'R2_STAGING_JURISDICTION=eu',
    'R2_STAGING_ACCOUNT_ID=<SECRET_STORE_VALUE>',
    'R2_BACKUP_ENABLED=1',
    'R2_BACKUP_JURISDICTION=eu',
    'R2_BACKUP_ACCOUNT_ID=<SECRET_STORE_VALUE>',
    'R2_AUDIT_ENABLED=1',
    'R2_AUDIT_JURISDICTION=eu',
    'R2_AUDIT_ACCOUNT_ID=<SECRET_STORE_VALUE>'
  ]) assert.ok(env.includes(required),required);

  assert.doesNotMatch(env,/R2_(?:STAGING|BACKUP|AUDIT)_ENDPOINT=/);
  assert.doesNotMatch(env,/ROLLANDS_ENV=(?:pilot|production)/);
  assert.doesNotMatch(env,/ROLLANDS_REAL_DATA_ALLOWED=1/);
});

test('staging systemd service is least-write and fail-restart hardened',()=>{
  const service=read('deploy/staging/lt-studio-staging.service');
  assert.match(service,/^User=ltstudio$/m);
  assert.match(service,/^Group=ltstudio$/m);
  assert.match(service,/^EnvironmentFile=\/etc\/lt-studio\/staging\.env$/m);
  assert.match(service,/^ExecStart=\/usr\/bin\/npm start$/m);
  assert.match(service,/^Restart=on-failure$/m);
  assert.match(service,/^UMask=0077$/m);
  assert.match(service,/^NoNewPrivileges=true$/m);
  assert.match(service,/^ProtectSystem=strict$/m);
  assert.match(service,/^ProtectHome=true$/m);
  assert.match(service,/^ReadWritePaths=\/srv\/lt-studio-data \/srv\/lt-studio-backups \/srv\/lt-studio-restore \/srv\/lt-studio-ops$/m);
  assert.match(service,/^CapabilityBoundingSet=$/m);
});

test('Caddy staging template proxies only to loopback API',()=>{
  const caddy=read('deploy/staging/Caddyfile.example');
  assert.match(caddy,/^<STAGING_HOST> \{$/m);
  assert.match(caddy,/reverse_proxy 127\.0\.0\.1:4180/);
  assert.doesNotMatch(caddy,/0\.0\.0\.0/);
  assert.doesNotMatch(caddy,/file_server/);
});

test('staging deployment assets remain templates and contain no filled secrets',()=>{
  const dir=path.join(root,'deploy','staging');
  for(const name of fs.readdirSync(dir)){
    const file=path.join(dir,name);
    if(!fs.statSync(file).isFile())continue;
    const content=fs.readFileSync(file,'utf8');
    assert.doesNotMatch(content,/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/);
    assert.doesNotMatch(content,/ROLLANDS_AUTH_ENCRYPTION_KEY=[^<\r\n][^\r\n]*/);
    assert.doesNotMatch(content,/ROLLANDS_BACKUP_ENCRYPTION_KEY=[^<\r\n][^\r\n]*/);
  }
});
