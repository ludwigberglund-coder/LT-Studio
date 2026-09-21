'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Queues=require('../apps/api/queues.js');

test('automationsförslag stoppar edit, approve och reject över företagsgränsen',async()=>{
  const f=await fixture();
  try{
    const foreign=Queues.saveAutomationProposal(f.db,{
      companyId:f.b.id,
      type:'bank-payment-match',
      sourceId:'foreign-source-001',
      status:'manual-review',
      confidence:0.5,
      deterministic:false,
      ambiguous:true,
      reason:'Testförslag för företagsgräns',
      decisionReason:'Kräver manuell granskning',
      evidence:[],
      suggestion:{},
      engine:{name:'tenant-test',version:'1'},
      createdBy:f.other.id
    },{idempotencyKey:'foreign-proposal-001'}).proposal;

    const headers=await f.login(f.admin.username);

    const edit=await fetch(f.base+'/api/v1/automation/proposals/'+foreign.id+'/suggestion',{
      method:'PUT',
      headers,
      body:JSON.stringify({})
    });
    assert.equal(edit.status,404);
    assert.equal((await edit.json()).code,'PROPOSAL_NOT_FOUND');

    const approve=await fetch(f.base+'/api/v1/automation/proposals/'+foreign.id+'/approve',{
      method:'POST',
      headers,
      body:JSON.stringify({})
    });
    assert.equal(approve.status,404);
    assert.equal((await approve.json()).code,'PROPOSAL_NOT_FOUND');

    const reject=await fetch(f.base+'/api/v1/automation/proposals/'+foreign.id+'/reject',{
      method:'POST',
      headers,
      body:JSON.stringify({reason:'Otillåtet försök'})
    });
    assert.equal(reject.status,404);
    assert.equal((await reject.json()).code,'PROPOSAL_NOT_FOUND');

    assert.equal(Queues.automationProposalById(f.db,f.b.id,foreign.id).status,'manual-review');

    const wrongCompanyAudit=Db.auditForCompany(f.db,f.a.id).filter(event=>
      ['AUTOMATION_PROPOSAL_EDITED','AUTOMATION_PROPOSAL_APPROVED','AUTOMATION_PROPOSAL_REJECTED'].includes(event.action)&&
      event.entityId===foreign.id
    );
    assert.equal(wrongCompanyAudit.length,0);
  }finally{
    await f.close();
  }
});
