'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {normalize,inspect}=require('../apps/portal/book-close-evidence.js');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261012155200_book_close_evidence_preflight.sql'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../apps/portal/bokslut.html'),'utf8');
const fixture=()=>({
 version:1,scope:'book-close-evidence-preflight-not-reconciled',company_id:'TENANT_A',
 start_date:'2026-01-01',end_exclusive:'2027-01-01',observed_at:'2026-10-12T14:00:00Z',
 bank:{period_records:'1203',unmatched:'0',pending_proposal:'0',missing_status:'0',non_sek:'0',zero_or_missing_amount:'0',duplicate_external_id_groups:'0',undated_company_records:'0'},
 customer:{period_posted_invoices:'1600',missing_pdf_reference:'0',zero_or_missing_amount:'0',undated_invoices_with_period_invoice_date:'0'},
 supplier:{period_posted_invoices:'1700',missing_pdf_reference:'0',missing_liability_reference:'0',non_sek:'0',zero_or_missing_amount:'0',undated_invoices_with_period_invoice_date:'0'},
 reconciliation:{bank_to_external_statement:'not_verified',customer_1510_as_of:'not_verified',supplier_2440_as_of:'not_verified'}
});
test('many rows and no indicators never mark the balances reconciled',()=>{
 const report=normalize(fixture(),'TENANT_A','2026-01-01','2027-01-01');
 assert.equal(report.areas.customer.counts.period_posted_invoices,'1600');
 assert.equal(report.status,'not_reconciled');
 assert.equal(report.areas.bank.reconciled,false);
 assert.equal(report.areas.supplier.needsReview,false);
});
test('every evidence exception is visible and not a clearance',()=>{
 const f=fixture();f.bank.unmatched='9';f.customer.missing_pdf_reference='1';f.supplier.missing_liability_reference='6';
 const report=normalize(f,'TENANT_A','2026-01-01','2027-01-01');
 assert.equal(report.areas.bank.needsReview,true);
 assert.equal(report.areas.customer.needsReview,true);
 assert.equal(report.areas.supplier.needsReview,true);
 assert.equal(report.status,'not_reconciled');
});
test('strict tenant and period isolation',()=>{
 assert.throws(()=>normalize(fixture(),'TENANT_B','2026-01-01','2027-01-01'));
 assert.throws(()=>normalize(fixture(),'TENANT_A','2025-01-01','2026-01-01'));
 const f=fixture();f.reconciliation.bank_to_external_statement='verified';
 assert.throws(()=>normalize(f,'TENANT_A','2026-01-01','2027-01-01'));
});
test('untrusted numeric and incomplete data fail closed',()=>{
 const f=fixture();f.bank.period_records=123;
 assert.throws(()=>normalize(f,'TENANT_A','2026-01-01','2027-01-01'));
 const g=fixture();delete g.supplier.missing_pdf_reference;
 assert.throws(()=>normalize(g,'TENANT_A','2026-01-01','2027-01-01'));
 assert.throws(()=>normalize(null,'TENANT_A','2026-01-01','2027-01-01'));
});
test('RPC sends company, year and user token, never writes',async()=>{
 const calls=[];
 await inspect({companyId:'TENANT_A',token:'synthetic-token',year:'2026',client:{rpc:async(...args)=>{calls.push(args);return fixture();}}});
 assert.deepEqual(calls,[['book_close_evidence_preflight',{p_company_id:'TENANT_A',p_start:'2026-01-01',p_end:'2027-01-01'},'synthetic-token']]);
});
test('migration uses invoker AAL2 RLS and no financial writes',()=>{
 assert.match(sql,/security invoker/i);
 assert.match(sql,/request_has_aal2_personal_session/);
 assert.match(sql,/m.auth_user_id = auth.uid\(\)/);
 assert.match(sql,/m.company_id = p_company_id/);
 assert.match(sql,/revoke all on function public.book_close_evidence_preflight/);
 assert.match(sql,/grant execute on function public.book_close_evidence_preflight.*authenticated/);
 assert.doesNotMatch(sql,/security definer|\bupdate\s+public\.|\binsert\s+into\s+public\.|\bdelete\s+from\s+public\./i);
 assert.match(sql,/bank_to_external_statement', 'not_verified'/);
});
test('UI is separate from shared navigation, no false bank clearance',()=>{
 assert.match(html,/book-close-evidence-ui\.js/);
 assert.match(html,/id="book-close-evidence-results"/);
 assert.match(html,/Inte avstämt:/);
 assert.match(html,/historiska restbelopp/);
});
