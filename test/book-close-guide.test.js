const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const portal=path.join(__dirname,'../apps/portal');
test('bokslut checklist explicitly never attests or persists approval',()=>{
 const html=fs.readFileSync(path.join(portal,'bokslut.html'),'utf8');
 const js=fs.readFileSync(path.join(portal,'book-close-guide.js'),'utf8');
 assert.match(html,/id="book-close-guide-progress"/);
 assert.match(html,/id="book-close-guide-reset"/);
 assert.equal((html.match(/data-book-close-area=/g)||[]).length,6);
 assert.match(html,/inte en sparad attest/);
 assert.match(js,/Bokslut ej verifierat|Bokslut ej verifierat/i);
 assert.doesNotMatch(js,/localStorage|sessionStorage|\.rpc\(|fetch\(|\.insert\(|\.update\(/);
});

test('single-action preflight combines four existing read-only sources and never claims AI is active',()=>{
 const html=fs.readFileSync(path.join(portal,'bokslut.html'),'utf8');
 const js=fs.readFileSync(path.join(portal,'book-close-simple.js'),'utf8');
 assert.match(html,/id="book-close-start"/);
 assert.match(html,/AI-förslag och automatiska bokslutsbokningar är ännu inte aktiverade/);
 assert.match(html,/book-close-server-details/);
 for(const method of ['LTYearCloseCounts.scan','LTBookCloseLedger.inspect','LTBookCloseEvidence.inspect','LTBookCloseCutoff.inspect'])assert.ok(js.includes(method),method);
 assert.match(js,/Promise.allSettled/);
 assert.match(js,/company\.id!==companyId/);
 assert.match(js,/Bokslut är inte verifierat/);
 assert.doesNotMatch(js,/\.insert\(|\.update\(|localStorage|sessionStorage|ai-bookkeeping-suggest/);
});
