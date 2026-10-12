/* A temporary user checklist, never a financial approval or persisted attestation. */
(function(root){
'use strict';
const group=root.document.getElementById('book-close-guide-actions');
const progress=root.document.getElementById('book-close-guide-progress');
const reset=root.document.getElementById('book-close-guide-reset');
if(!group||!progress||!reset)return;
const inputs=Array.from(group.querySelectorAll('input[type="checkbox"][data-book-close-area]'));
function update(){
 const count=inputs.filter(input=>input.checked).length;
 progress.textContent=count+' av '+inputs.length+' områden markerade för uppföljning i denna vy. Bokslut ej verifierat.';
}
group.addEventListener('change',update);
reset.addEventListener('click',()=>{inputs.forEach(input=>{input.checked=false;});update();});
update();
})(globalThis);
