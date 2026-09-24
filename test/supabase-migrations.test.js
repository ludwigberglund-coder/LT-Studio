const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function migration(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', name), 'utf8');
}

test('Supabase RLS helper is not executable from API roles', () => {
  const sql = migration('20260924212023_secure_rls_auto_enable.sql');
  assert.match(sql, /revoke execute on function public\.rls_auto_enable\(\) from public/i);
  assert.match(sql, /from anon/i);
  assert.match(sql, /from authenticated/i);
});

test('Supabase tenant foundation enables RLS and scopes membership reads', () => {
  const sql = migration('20260924212047_tenant_foundation.sql');
  assert.match(sql, /alter table public\.companies enable row level security/i);
  assert.match(sql, /alter table public\.company_memberships enable row level security/i);
  assert.match(sql, /user_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(sql, /m\.company_id\s*=\s*companies\.id/i);
  assert.doesNotMatch(sql, /grant\s+(?:all|insert|update|delete)[^;]*to\s+anon/i);
});


test('Supabase identity compatibility preserves prefixed application IDs', () => {
  const sql = migration('20260924212520_tenant_identity_compatibility.sql');
  assert.match(sql, /alter column id type text using id::text/i);
  assert.match(sql, /create table if not exists public\.app_users/i);
  assert.match(sql, /auth_user_id uuid not null unique references auth\.users/i);
  assert.match(sql, /foreign key \(user_id, auth_user_id\)/i);
  assert.match(sql, /auth_user_id\s*=\s*\(select auth\.uid\(\)\)/i);
});


test('Supabase membership identity foreign key has a covering index', () => {
  const sql = migration('20260924212546_index_membership_identity_fk.sql');
  assert.match(sql, /company_memberships\(user_id, auth_user_id\)/i);
});
