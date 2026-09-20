'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const Rollback=require('../scripts/pilot-rollback-verify.js');

function git(cwd,args){return execFileSync('git',args,{cwd,encoding:'utf8'}).trim()}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-rollback-check-'));
  git(dir,['init','-q']);
  git(dir,['config','user.email','test@example.invalid']);
  git(dir,['config','user.name','Rollands Test']);
  fs.writeFileSync(path.join(dir,'tracked.txt'),'one\n');
  git(dir,['add','tracked.txt']);git(dir,['commit','-q','-m','one']);
  const first=git(dir,['rev-parse','HEAD']);
  fs.writeFileSync(path.join(dir,'tracked.txt'),'two\n');
  git(dir,['add','tracked.txt']);git(dir,['commit','-q','-m','two']);
  const second=git(dir,['rev-parse','HEAD']);
  const branchName=git(dir,['rev-parse','--abbrev-ref','HEAD']);
  return{dir,first,second,branchName};
}

test('rollback verifier accepterar en tidigare ancestor-commit',()=>{
  const {dir,first,second}=fixture();
  try{
    const result=Rollback.verifyRollback({cwd:dir,currentCommit:second,targetCommit:first});
    assert.equal(result.ok,true);
    assert.equal(result.currentCommit,second);
    assert.equal(result.targetCommit,first);
    assert.equal(result.commitsToRollback,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('rollback verifier stoppar samma commit som nuvarande release',()=>{
  const {dir,second}=fixture();
  try{
    assert.throws(
      ()=>Rollback.verifyRollback({cwd:dir,currentCommit:second,targetCommit:second}),
      error=>error.code==='ROLLBACK_TARGET_SAME_AS_CURRENT'
    );
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('rollback verifier stoppar commit från sidogren',()=>{
  const {dir,first,second,branchName}=fixture();
  try{
    git(dir,['checkout','-q','-b','side',first]);
    fs.writeFileSync(path.join(dir,'side.txt'),'side\n');
    git(dir,['add','side.txt']);git(dir,['commit','-q','-m','side']);
    const side=git(dir,['rev-parse','HEAD']);
    git(dir,['checkout','-q',branchName]);
    assert.equal(git(dir,['rev-parse','HEAD']),second);
    assert.throws(
      ()=>Rollback.verifyRollback({cwd:dir,currentCommit:second,targetCommit:side}),
      error=>error.code==='ROLLBACK_TARGET_NOT_ANCESTOR'
    );
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('rollback verifier stoppar dirty tracked checkout',()=>{
  const {dir,first,second}=fixture();
  try{
    fs.writeFileSync(path.join(dir,'tracked.txt'),'local change\n');
    assert.throws(
      ()=>Rollback.verifyRollback({cwd:dir,currentCommit:second,targetCommit:first}),
      error=>error.code==='RELEASE_WORKTREE_DIRTY'
    );
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
