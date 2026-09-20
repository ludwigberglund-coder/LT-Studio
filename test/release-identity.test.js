'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const Release=require('../scripts/pilot-release-verify.js');

function git(cwd,args){return execFileSync('git',args,{cwd,encoding:'utf8'}).trim()}
function repoFixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-release-check-'));
  git(dir,['init','-q']);
  git(dir,['config','user.email','test@example.invalid']);
  git(dir,['config','user.name','Rollands Test']);
  fs.writeFileSync(path.join(dir,'tracked.txt'),'version one\n');
  git(dir,['add','tracked.txt']);
  git(dir,['commit','-q','-m','fixture']);
  return{dir,head:git(dir,['rev-parse','HEAD'])};
}

test('release verifier accepterar exakt HEAD med ren tracked worktree',()=>{
  const {dir,head}=repoFixture();
  try{
    fs.writeFileSync(path.join(dir,'untracked-runtime.log'),'runtime only\n');
    const result=Release.verifyRelease({cwd:dir,expectedCommit:head});
    assert.equal(result.ok,true);
    assert.equal(result.commit,head);
    assert.equal(result.trackedWorktreeClean,true);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('release verifier stoppar annan godkänd commit än deployad HEAD',()=>{
  const {dir}=repoFixture();
  try{
    assert.throws(
      ()=>Release.verifyRelease({cwd:dir,expectedCommit:'0'.repeat(40)}),
      error=>error.code==='RELEASE_COMMIT_MISMATCH'
    );
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('release verifier stoppar lokala ändringar i spårade filer',()=>{
  const {dir,head}=repoFixture();
  try{
    fs.writeFileSync(path.join(dir,'tracked.txt'),'locally changed\n');
    assert.throws(
      ()=>Release.verifyRelease({cwd:dir,expectedCommit:head}),
      error=>error.code==='RELEASE_WORKTREE_DIRTY'
    );
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('release verifier kräver fullständig SHA',()=>{
  assert.throws(
    ()=>Release.normalizeCommit('abc123'),
    error=>error.code==='RELEASE_COMMIT_INVALID'
  );
});
