const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');
test('buntsystemet finns i portal och migration',()=>{
 const nav=fs.readFileSync(path.join(root,'apps/portal/portal-nav.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'apps/portal/batches.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'apps/portal/batches.js'),'utf8');
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20260925_financial_batches.sql'),'utf8');
 assert.match(nav,/\['batches','Buntar','portal\/batches\.html'\]/);
 assert.match(html,/Buntar · LT Studio/);
 assert.match(js,/approve_financial_batch/);
 assert.match(sql,/check\(batch_number between 10000 and 99999\)/);
 assert.match(sql,/APPROVED_BATCH_LOCKED/);
 assert.match(sql,/BATCH_NOT_BALANCED/);
 assert.match(sql,/EXTERNAL_TOTAL_MISMATCH/);
 assert.match(sql,/source_type,source_id,created_by/);
 assert.match(sql,/FINANCIAL_BATCH_APPROVED/);
});
test('godkännande är enda vägen från bunt till journal',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20260925_financial_batches.sql'),'utf8');
 const save=sql.slice(sql.indexOf('create or replace function public.save_financial_batch'),sql.indexOf('create or replace function public.mark_financial_batch_ready'));
 assert.doesNotMatch(save,/insert into public\.journal_entries/);
 const approve=sql.slice(sql.indexOf('create or replace function public.approve_financial_batch'));
 assert.match(approve,/insert into public\.journal_entries/);
 assert.match(approve,/status<>'ready'/);
});