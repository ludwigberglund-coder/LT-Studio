'use strict';

// CI sync marker: verify CMS retry behavior against the latest main base.

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');

function clone(value){return JSON.parse(JSON.stringify(value))}

test('CMS save, publish och restore är idempotenta vid identiska retries',async()=>{
  const f=await fixture();
  try{
    const headers=await f.login(f.admin.username);

    const initialResponse=await fetch(f.base+'/api/v1/website/cms',{headers});
    assert.equal(initialResponse.status,200);
    const initial=(await initialResponse.json()).state;

    const site=clone(initial.draft.site);
    site.hero.title='Idempotent CMS-test';
    const savePayload={
      expectedRevision:initial.draft.revision,
      site,
      company:initial.draft.company
    };

    const save=await fetch(f.base+'/api/v1/website/cms/draft',{
      method:'PUT',headers,body:JSON.stringify(savePayload)
    });
    const saveBody=await save.json();
    assert.equal(save.status,200);
    assert.equal(saveBody.duplicate,false);
    assert.equal(saveBody.state.draft.revision,initial.draft.revision+1);

    const saveRetry=await fetch(f.base+'/api/v1/website/cms/draft',{
      method:'PUT',headers,body:JSON.stringify(savePayload)
    });
    const saveRetryBody=await saveRetry.json();
    assert.equal(saveRetry.status,200);
    assert.equal(saveRetryBody.duplicate,true);
    assert.equal(saveRetryBody.state.draft.revision,saveBody.state.draft.revision);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='WEBSITE_DRAFT_SAVED').length,
      1
    );

    const changedSite=clone(site);
    changedSite.hero.title='Annat stale innehåll';
    const staleSave=await fetch(f.base+'/api/v1/website/cms/draft',{
      method:'PUT',headers,body:JSON.stringify({...savePayload,site:changedSite})
    });
    assert.equal(staleSave.status,409);
    assert.equal((await staleSave.json()).code,'CMS_REVISION_CONFLICT');

    const publishPayload={
      expectedRevision:saveBody.state.draft.revision,
      expectedPublishedVersion:saveBody.state.published.version
    };
    const publish=await fetch(f.base+'/api/v1/website/cms/publish',{
      method:'POST',headers,body:JSON.stringify(publishPayload)
    });
    const publishBody=await publish.json();
    assert.equal(publish.status,201);
    assert.equal(publishBody.duplicate,false);
    assert.equal(publishBody.state.published.version,saveBody.state.published.version+1);

    const publishRetry=await fetch(f.base+'/api/v1/website/cms/publish',{
      method:'POST',headers,body:JSON.stringify(publishPayload)
    });
    const publishRetryBody=await publishRetry.json();
    assert.equal(publishRetry.status,200);
    assert.equal(publishRetryBody.duplicate,true);
    assert.equal(publishRetryBody.state.published.version,publishBody.state.published.version);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='WEBSITE_VERSION_PUBLISHED').length,
      1
    );

    const secondSite=clone(publishBody.state.draft.site);
    secondSite.hero.title='Tillfälligt nytt utkast';
    const secondSave=await fetch(f.base+'/api/v1/website/cms/draft',{
      method:'PUT',headers,body:JSON.stringify({
        expectedRevision:publishBody.state.draft.revision,
        site:secondSite,
        company:publishBody.state.draft.company
      })
    });
    const secondSaveBody=await secondSave.json();
    assert.equal(secondSave.status,200);
    assert.equal(secondSaveBody.duplicate,false);

    const restorePayload={expectedRevision:secondSaveBody.state.draft.revision};
    const version=publishBody.state.published.version;
    const restore=await fetch(f.base+'/api/v1/website/cms/revisions/'+version+'/restore',{
      method:'POST',headers,body:JSON.stringify(restorePayload)
    });
    const restoreBody=await restore.json();
    assert.equal(restore.status,200);
    assert.equal(restoreBody.duplicate,false);
    assert.equal(restoreBody.state.draft.revision,secondSaveBody.state.draft.revision+1);
    assert.equal(restoreBody.state.draft.site.hero.title,'Idempotent CMS-test');

    const restoreRetry=await fetch(f.base+'/api/v1/website/cms/revisions/'+version+'/restore',{
      method:'POST',headers,body:JSON.stringify(restorePayload)
    });
    const restoreRetryBody=await restoreRetry.json();
    assert.equal(restoreRetry.status,200);
    assert.equal(restoreRetryBody.duplicate,true);
    assert.equal(restoreRetryBody.state.draft.revision,restoreBody.state.draft.revision);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='WEBSITE_REVISION_RESTORED_TO_DRAFT').length,
      1
    );

    const revisions=await fetch(f.base+'/api/v1/website/cms',{headers}).then(r=>r.json());
    assert.equal(revisions.revisions.filter(row=>row.version===version).length,1);
  }finally{
    await f.close();
  }
});
