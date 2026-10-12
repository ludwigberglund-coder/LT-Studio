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
 assert.match(js,/Bokslut ej verifierat/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|\.rpc\(|fetch\(|\.insert\(|\.update\(/);
});
