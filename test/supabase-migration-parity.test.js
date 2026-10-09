'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'supabase/migration-history-parity.json'),'utf8'));

test('Supabase parity manifest points to real migration files',()=>{
  assert.equal(manifest.project_ref,'bwbhnotpuuhgghjpmflk');
  assert.ok(Array.isArray(manifest.aliases));
  assert.ok(Array.isArray(manifest.unresolved_repo_only));

  const seenLive=new Set();
  const seenRepo=new Set();

  for(const item of manifest.aliases){
    assert.ok(item.live_version);
    assert.ok(item.repo_version);
    assert.ok(item.repo_path);
    assert.ok(fs.existsSync(path.join(root,item.repo_path)),item.repo_path);
    assert.ok(!seenLive.has(item.live_version),'duplicate live version '+item.live_version);
    assert.ok(!seenRepo.has(item.repo_version),'duplicate repo version '+item.repo_version);
    seenLive.add(item.live_version);
    seenRepo.add(item.repo_version);
  }
});

test('unresolved repo-only migrations remain explicit and non-overlapping',()=>{
  const aliasRepo=new Set(manifest.aliases.map(x=>x.repo_version));
  const seen=new Set();

  for(const item of manifest.unresolved_repo_only){
    assert.ok(item.version);
    assert.ok(item.path);
    assert.ok(fs.existsSync(path.join(root,item.path)),item.path);
    assert.ok(!aliasRepo.has(item.version),'repo-only migration already mapped as alias '+item.version);
    assert.ok(!seen.has(item.version),'duplicate unresolved migration '+item.version);
    seen.add(item.version);
  }
});


test('current parity classification has no wholly unverified repo-only migrations',()=>{
  assert.equal(manifest.summary.unresolved_unverified,0);
  assert.equal(
    manifest.unresolved_repo_only.filter(x=>x.status==='unverified').length,
    0
  );
  assert.equal(
    manifest.unresolved_repo_only.filter(x=>x.status==='schema_effect_confirmed_live').length,
    manifest.unresolved_repo_only.length
  );
});
