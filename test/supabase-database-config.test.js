'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Config=require('../apps/api/database-runtime-config.js');

test('database runtime defaults safely to sqlite',()=>{
  const target=Config.resolveDatabaseTarget({});
  assert.deepEqual(target,{engine:'sqlite',databasePath:null,shared:false});
});

test('database runtime accepts configured sqlite path',()=>{
  const target=Config.resolveDatabaseTarget({
    LT_DATABASE_ENGINE:'sqlite',
    ROLLANDS_DATABASE_PATH:'/tmp/lt-studio.sqlite'
  });
  assert.equal(target.engine,'sqlite');
  assert.equal(target.databasePath,'/tmp/lt-studio.sqlite');
  assert.equal(target.shared,false);
});

test('database runtime normalizes supabase alias to postgresql',()=>{
  const target=Config.resolveDatabaseTarget({
    LT_DATABASE_ENGINE:'supabase',
    SUPABASE_DATABASE_URL:'postgresql://uat_user:secret@db.example.supabase.co:6543/postgres?sslmode=require'
  });
  assert.equal(target.engine,'postgresql');
  assert.equal(target.shared,true);
  assert.match(target.databaseUrl,/^postgresql:\/\//);
});

test('postgresql mode fails closed without a database URL',()=>{
  assert.throws(
    ()=>Config.resolveDatabaseTarget({LT_DATABASE_ENGINE:'postgresql'}),
    error=>error?.code==='MISSING_SUPABASE_DATABASE_URL'
  );
});

test('postgresql mode rejects non-postgresql URLs',()=>{
  assert.throws(
    ()=>Config.resolveDatabaseTarget({
      LT_DATABASE_ENGINE:'postgresql',
      SUPABASE_DATABASE_URL:'https://example.supabase.co'
    }),
    error=>error?.code==='INVALID_SUPABASE_DATABASE_URL'
  );
});

test('database target description never exposes credentials',()=>{
  const target=Config.resolveDatabaseTarget({
    LT_DATABASE_ENGINE:'postgresql',
    SUPABASE_DATABASE_URL:'postgresql://uat_user:super-secret@db.example.supabase.co:6543/postgres?sslmode=require'
  });
  const description=Config.describeDatabaseTarget(target);
  assert.deepEqual(description,{
    engine:'postgresql',
    shared:true,
    host:'db.example.supabase.co',
    database:'postgres'
  });
  assert.doesNotMatch(JSON.stringify(description),/super-secret|uat_user/);
});

test('unknown database engines are rejected',()=>{
  assert.throws(
    ()=>Config.resolveDatabaseTarget({LT_DATABASE_ENGINE:'mysql'}),
    error=>error?.code==='INVALID_DATABASE_ENGINE'
  );
});
