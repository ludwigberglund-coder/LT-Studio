'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20260926_fk_covering_indexes.sql'),'utf8');

const expected=[
  ['company_revenue_accounts','created_by'],
  ['company_revenue_accounts','updated_by'],
  ['invoice_comments','author_user_id'],
  ['invoice_comments','invoice_id'],
  ['invoice_reminders','created_by'],
  ['invoice_reminders','invoice_id'],
  ['supplier_invoice_date_corrections','company_id,batch_id'],
  ['supplier_invoice_date_corrections','company_id,reversal_transaction_id'],
  ['supplier_invoice_date_corrections','company_id,replacement_transaction_id'],
  ['supplier_invoice_date_corrections','company_id,original_entry_id'],
  ['supplier_invoice_date_corrections','company_id,reversal_entry_id'],
  ['supplier_invoice_date_corrections','company_id,replacement_entry_id'],
  ['supplier_invoice_date_corrections','created_by'],
  ['supplier_invoice_date_corrections','approved_by'],
  ['website_cms_revisions','published_by'],
  ['website_cms_state','draft_updated_by'],
  ['website_cms_state','published_by']
];

test('all Supabase unindexed foreign-key findings have covering indexes',()=>{
  for(const [table,columns] of expected){
    const parts=columns.split(',');
    const columnPattern=parts.join('\\s*,\\s*');
    const pattern=new RegExp(
      'create\\s+index\\s+if\\s+not\\s+exists[\\s\\S]*?on\\s+public\\.'+
      table+'\\s*\\(\\s*'+columnPattern+'\\s*\\)',
      'i'
    );
    assert.match(sql,pattern,table+'('+columns+') saknar täckande index');
  }
  assert.equal((sql.match(/create\\s+index\\s+if\\s+not\\s+exists/gi)||[]).length,17);
});
