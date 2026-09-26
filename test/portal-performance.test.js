'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('dashboard collapses Supabase metrics into one RPC and keeps a compatibility fallback',()=>{
  const js=read('apps/portal/dashboard.js');
  assert.match(js,/LTSupabase\.rpc\('portal_dashboard_metrics',\{p_company_id:ctx\.company\.id\},ctx\.accessToken\)/);
  assert.match(js,/async function loadSupabaseMetricsFallback\(ctx\)/);
  assert.match(js,/return loadSupabaseMetricsFallback\(ctx\)/);
});

test('Supabase session validation and bootstrap reads run in parallel',()=>{
  const js=read('apps/portal/supabase-session.js');
  const start=js.indexOf('[authUser,profiles,memberships,companies]=await Promise.all([');
  const end=js.indexOf(']);',start);
  assert.ok(start>=0&&end>start,'parallel bootstrap Promise.all saknas');
  const body=js.slice(start,end);
  assert.match(body,/api\(\)\.getUser\(t\)/);
  assert.match(body,/from\('app_users'/);
  assert.match(body,/from\('company_memberships'/);
  assert.match(body,/from\('companies'/);
  assert.match(js,/uid!==claimedUid/);
});

test('dashboard Realtime only watches tables that can change its visible metrics',()=>{
  const js=read('apps/portal/supabase-client.js');
  const match=js.match(/'dashboard\.html':\[([^\]]+)\]/);
  assert.ok(match,'dashboard realtime config saknas');
  const value=match[1];
  for(const name of ['invoices','supplier_invoices','bank_payments','automation_proposals','inventory_adjustments','period_unlock_requests']){
    assert.match(value,new RegExp("'"+name+"'"));
  }
  for(const name of ['customers','supplier_payments','financial_batches','payroll_runs']){
    assert.doesNotMatch(value,new RegExp("'"+name+"'"));
  }
});

test('dashboard preconnects to the configured Supabase origin',()=>{
  const html=read('apps/portal/dashboard.html');
  assert.match(html,/rel="preconnect" href="https:\/\/bwbhnotpuuhgghjpmflk\.supabase\.co" crossorigin/);
  assert.match(html,/rel="dns-prefetch"/);
});

test('dashboard metrics RPC preserves RLS and explicit execution grants',()=>{
  const sql=read('supabase/migrations/20260926_portal_dashboard_metrics.sql');
  assert.match(sql,/create or replace function public\.portal_dashboard_metrics\(p_company_id text\)/i);
  assert.match(sql,/security invoker/i);
  assert.match(sql,/set search_path=''/i);
  assert.match(sql,/from public\.company_memberships/i);
  assert.match(sql,/m\.auth_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql,/revoke all on function public\.portal_dashboard_metrics\(text\) from public, anon/i);
  assert.match(sql,/grant execute on function public\.portal_dashboard_metrics\(text\) to authenticated/i);
});
