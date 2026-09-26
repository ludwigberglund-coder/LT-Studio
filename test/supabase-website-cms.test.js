'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('website CMS is tenant-scoped in Supabase and direct browser writes are denied',()=>{
  const sql=read('supabase/migrations/20260926_website_cms_supabase.sql');
  assert.match(sql,/create table if not exists public\.website_cms_state/i);
  assert.match(sql,/create table if not exists public\.website_cms_revisions/i);
  assert.match(sql,/alter table public\.website_cms_state enable row level security/i);
  assert.match(sql,/alter table public\.website_cms_revisions enable row level security/i);
  assert.match(sql,/revoke all on table public\.website_cms_state from anon,authenticated/i);
  assert.match(sql,/revoke all on table public\.website_cms_revisions from anon,authenticated/i);
  assert.match(sql,/m\.role = 'admin'/i);
  assert.match(sql,/session_within_personal_limit/i);
  assert.match(sql,/coalesce\(\(select auth\.jwt\(\)->>'aal'\),'aal1'\) = 'aal2'/i);
  assert.doesNotMatch(sql,/grant\s+(insert|update|delete).*website_cms_state\s+to\s+authenticated/i);
  assert.doesNotMatch(sql,/grant\s+(insert|update|delete).*website_cms_revisions\s+to\s+authenticated/i);
});

test('website CMS mutations use guarded RPCs with optimistic concurrency',()=>{
  const sql=read('supabase/migrations/20260926_website_cms_supabase.sql');
  assert.match(sql,/function public\.save_website_cms_draft/i);
  assert.match(sql,/draft_revision = p_expected_revision/i);
  assert.match(sql,/CMS_REVISION_CONFLICT/i);
  assert.match(sql,/function public\.publish_website_cms/i);
  assert.match(sql,/published_version <> p_expected_published_version/i);
  assert.match(sql,/CMS_PUBLICATION_CONFLICT/i);
  assert.match(sql,/function public\.restore_website_cms_revision/i);
  assert.match(sql,/revoke all on function public\.save_website_cms_draft[\s\S]*from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.save_website_cms_draft[\s\S]*to authenticated/i);
  assert.match(sql,/legalName/i);
  assert.match(sql,/orgNumber/i);
});

test('GitHub Pages website CMS uses Supabase rather than local demo state',()=>{
  const html=read('apps/portal/website.html');
  const js=read('apps/portal/website.js');
  assert.match(html,/supabase-config\.js/);
  assert.match(html,/supabase-client\.js/);
  assert.match(html,/supabase-session\.js/);
  assert.match(js,/const isDemo=pageParams\.get\('demo'\)==='1'/);
  assert.match(js,/const isSupabase=location\.hostname==='ludwigberglund-coder\.github\.io'&&!isDemo/);
  assert.doesNotMatch(js,/const isDemo=location\.hostname==='ludwigberglund-coder\.github\.io'/);
  assert.match(js,/LTSupabaseUat\.context/);
  assert.match(js,/from\('website_cms_state'/);
  assert.match(js,/from\('website_cms_revisions'/);
  assert.match(js,/rpc\('save_website_cms_draft'/);
  assert.match(js,/rpc\('publish_website_cms'/);
  assert.match(js,/rpc\('restore_website_cms_revision'/);
  assert.match(js,/membership\?\.role!=='admin'/);
});

test('Supabase CMS preview remains local-only while saved state stays shared',()=>{
  const js=read('apps/portal/website.js');
  assert.match(js,/SITE_PREVIEW_KEY/);
  assert.match(js,/COMPANY_PREVIEW_KEY/);
  assert.match(js,/else if\(isSupabase\)\{await saveDraft\(\);tab\.location\.href=setPreview\(\);\}/);
  assert.match(js,/Utkast, publicerade versioner och historik sparas gemensamt i företagets Supabase-databas/);
});
