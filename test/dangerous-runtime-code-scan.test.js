'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {findingsInText}=require('../scripts/scan-dangerous-runtime-code.js');

test('runtime scanner blocks dynamic code execution and process primitives',()=>{
  const samples=[
    ['eval','e'+'val(userInput)'],
    ['function-constructor','new '+'Function(userInput)'],
    ['node-vm',"require('node:"+'vm'+"')"],
    ['child-process',"require('node:"+'child_'+'process'+"')"],
    ['document-write','document.'+'write(userInput)'],
    ['srcdoc-assignment','frame.'+'srcdoc = userInput'],
    ['string-timeout','set'+'Timeout("doSomething()",100)'],
    ['string-interval','set'+'Interval("doSomething()",100)'],
    ['javascript-url','href="java'+'script:alert(1)"'],
    ['inline-event-attribute','<img src="x" on'+'error="alert(1)">']
  ];
  for(const [rule,source] of samples){
    assert.ok(findingsInText(source).some(hit=>hit.rule===rule),rule);
  }
});

test('runtime scanner allows ordinary safe application code',()=>{
  const safe=[
    "element.textContent = userInput;",
    "const value = JSON.parse(payload);",
    "setTimeout(()=>refresh(),100);",
    "db.exec('CREATE TABLE example(id TEXT)');",
    "const href = safeHref(input);"
  ].join('\n');
  assert.deepEqual(findingsInText(safe),[]);
});
