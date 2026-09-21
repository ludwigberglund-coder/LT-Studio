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
    'ROLLANDS_STAGING_SIGNOFF_PATH=/srv/lt-studio-ops/staging-signoff.json',
    'ROLLANDS_RELEASE_COMMIT=<FULL_40_CHARACTER_GIT_SHA>',
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

test('staging secret-bearing fields remain explicit placeholders',()=>{
  const env=read('deploy/staging/staging.env.example');
  const values=new Map(
    env.split(/\r?\n/)
      .filter(line=>line&&!line.startsWith('#')&&line.includes('='))
      .map(line=>{
        const index=line.indexOf('=');
        return [line.slice(0,index),line.slice(index+1)];
      })
  );
  const secretNames=[
    ['ROLLANDS','AUTH','ENCRYPTION','KEY'].join('_'),
    ['ROLLANDS','BACKUP','ENCRYPTION','KEY'].join('_'),
    ['R2','STAGING','ACCESS','KEY','ID'].join('_'),
    ['R2','STAGING','SECRET','ACCESS','KEY'].join('_'),
    ['R2','BACKUP','ACCESS','KEY','ID'].join('_'),
    ['R2','BACKUP','SECRET','ACCESS','KEY'].join('_'),
    ['R2','AUDIT','ACCESS','KEY','ID'].join('_'),
    ['R2','AUDIT','SECRET','ACCESS','KEY'].join('_')
  ];
  for(const name of secretNames)assert.equal(values.get(name),'<SECRET_STORE_VALUE>',name);
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
  assert.doesNotMatch(service,/MemoryDenyWriteExecute=true/);
});

test('Caddy staging template proxies only to loopback API',()=>{
  const caddy=read('deploy/staging/Caddyfile.example');
  assert.match(caddy,/^<STAGING_HOST> \{$/m);
  assert.match(caddy,/reverse_proxy 127\.0\.0\.1:4180/);
  assert.doesNotMatch(caddy,/0\.0\.0\.0/);
  assert.doesNotMatch(caddy,/file_server/);
});

test('staging deployment assets contain no private-key blocks',()=>{
  const dir=path.join(root,'deploy','staging');
  for(const name of fs.readdirSync(dir)){
    const file=path.join(dir,name);
    if(!fs.statSync(file).isFile())continue;
    const value=fs.readFileSync(file,'utf8');
    assert.equal(value.includes('BEGIN PRIVATE KEY'),false);
    assert.equal(value.includes('BEGIN RSA PRIVATE KEY'),false);
    assert.equal(value.includes('BEGIN OPENSSH PRIVATE KEY'),false);
  }
});
