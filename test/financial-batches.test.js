const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('buntsystemet finns i portal och migration',()=>{
 const nav=read('apps/portal/portal-nav.js');
 const html=read('apps/portal/batches.html');
 const js=read('apps/portal/batches.js');
 const sql=read('supabase/migrations/20260925_financial_batches.sql');
 assert.match(nav,/\['batches','Buntar','portal\/batches\.html'\]/);
 assert.doesNotMatch(nav,/Buntar \(äldre demo\)/);
 assert.match(html,/Buntar · LT Studio/);
 assert.match(js,/approve_financial_batch/);
 assert.match(js,/const isDemo=/);
 assert.match(js,/class="batch-workspace"><aside class="sidebar"><\/aside>/);
 assert.match(sql,/check\(batch_number between 10000 and 99999\)/);
 assert.match(sql,/APPROVED_BATCH_LOCKED/);
 assert.match(sql,/BATCH_NOT_BALANCED/);
 assert.match(sql,/EXTERNAL_TOTAL_MISMATCH/);
 assert.match(sql,/FINANCIAL_BATCH_APPROVED/);
});

test('godkännande är enda vägen från bunt till journal',()=>{
 const sql=read('supabase/migrations/20260925_financial_batches.sql');
 const save=sql.slice(sql.indexOf('create or replace function public.save_financial_batch'),sql.indexOf('create or replace function public.mark_financial_batch_ready'));
 assert.doesNotMatch(save,/insert into public\.journal_entries/);
 const approve=sql.slice(sql.indexOf('create or replace function public.approve_financial_batch'));
 assert.match(approve,/insert into public\.journal_entries/);
 assert.match(approve,/status<>'ready'/);
});

test('gränssnittet stöder massregistrering, ångra och rollstyrt godkännande',()=>{
 const js=read('apps/portal/batches.js');
 assert.match(js,/Massregistrera/);
 assert.match(js,/Ångra osparade ändringar/);
 assert.match(js,/const canEdit=.*accountant/);
 assert.match(js,/const canApprove=.*accountant.*approver/);
 assert.match(js,/reject_financial_batch/);
 assert.match(js,/transaction_number/);
});

test('härdningen ger radspårning och egen-godkännande styrs av sista migrationen',()=>{
 const js=read('apps/portal/batches.js');
 const sql=read('supabase/migrations/20260925_financial_batches_hardening.sql');
 assert.match(sql,/audit_financial_batch_transaction/);
 assert.match(sql,/audit_financial_batch_line/);
 assert.match(sql,/SEPARATION_OF_DUTIES_FAILED/);
 assert.match(sql,/TRANSACTION_EXTERNAL_TOTAL_MISMATCH/);
 assert.match(sql,/reject_financial_batch/);
 assert.match(sql,/financial_batches_created_by_idx/);
 assert.doesNotMatch(sql,/for all to authenticated/);
 const selfApproval=read('supabase/migrations/20260925_financial_batches_self_approval.sql');
 assert.match(selfApproval,/m\.role in \('admin','accountant','approver'\)/);
 assert.doesNotMatch(selfApproval,/SEPARATION_OF_DUTIES_FAILED/);
 assert.match(selfApproval,/'selfApproval',v_self_approval/);
 assert.match(js,/Du kan godkänna även en bunt du själv har skapat/);
});


test('buntgodkännande använder kontrollerad och append-only revisionslogg',()=>{
 const sql=read('supabase/migrations/20260925_financial_batches_audit_write.sql');
 assert.match(sql,/revoke all on public\.audit_events from anon/);
 assert.match(sql,/revoke update,delete,truncate,trigger,references on public\.audit_events from authenticated/);
 assert.match(sql,/grant select,insert on public\.audit_events to authenticated/);
 assert.match(sql,/as permissive[\s\S]*for insert[\s\S]*app\.audit_event_write/);
 assert.match(sql,/actor_user_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/m\.company_id=audit_events\.company_id/);
 assert.match(sql,/perform set_config\('app\.audit_event_write','1',true\)/);
 assert.match(sql,/FINANCIAL_BATCH_APPROVED/);
});
