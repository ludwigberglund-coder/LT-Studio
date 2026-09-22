'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {findingsInWorkflow}=require('../scripts/check-ci-trust-boundary.js');

test('CI trust boundary accepts pinned read-only pull request workflow',()=>{
  const workflow=`name: test
on:
  pull_request:
    branches: [main]
permissions:
  contents: read
  security-events: write
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false
      - uses: github/codeql-action/analyze@1c5b675653bb5c22dbe9b12b556ec555138e09fd
`;
  assert.deepEqual(findingsInWorkflow(workflow),[]);
});

test('CI trust boundary blocks pull_request_target and PR write permissions',()=>{
  const workflow=`name: unsafe
on:
  pull_request_target:
  pull_request:
permissions:
  contents: write
  id-token: write
jobs:
  unsafe:
    permissions:
      packages: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false
`;
  const rules=findingsInWorkflow(workflow).map(hit=>hit.rule);
  assert.ok(rules.includes('pull-request-target-forbidden'));
  assert.ok(rules.filter(rule=>rule==='pr-workflow-write-permission').length>=3);
});

test('CI trust boundary blocks unpinned external actions, secrets and persisted checkout credentials',()=>{
  const workflow=`name: unsafe-pr
on:
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: true
      - run: echo "\${{ secrets.DEPLOY_TOKEN }}"
`;
  const rules=findingsInWorkflow(workflow).map(hit=>hit.rule);
  assert.ok(rules.includes('action-not-pinned-to-commit'));
  assert.ok(rules.includes('pr-workflow-secret-reference'));
  assert.ok(rules.includes('pr-checkout-persists-credentials'));
  assert.ok(rules.includes('pr-checkout-must-disable-persisted-credentials'));
});

test('write permissions are allowed for workflows that cannot run on pull requests',()=>{
  const workflow=`name: deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346
`;
  assert.deepEqual(findingsInWorkflow(workflow),[]);
});
