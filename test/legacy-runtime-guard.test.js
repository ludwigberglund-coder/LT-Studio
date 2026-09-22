'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');

test('legacy server cannot start in protected environments',()=>{
  const result=spawnSync(process.execPath,['server.js'],{
    cwd:root,
    encoding:'utf8',
    env:{...process.env,NODE_ENV:'production',ROLLANDS_ENV:'pilot'}
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Legacy-servern får inte startas/);
});

test('legacy server cannot bind to a network interface even in development',()=>{
  const result=spawnSync(process.execPath,['server.js'],{
    cwd:root,
    encoding:'utf8',
    env:{...process.env,NODE_ENV:'development',ROLLANDS_ENV:'development',ROLLANDS_HOST:'0.0.0.0'}
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/bara bindas lokalt/);
});
