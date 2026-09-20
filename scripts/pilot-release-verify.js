'use strict';

const {execFileSync}=require('node:child_process');
const path=require('node:path');

function releaseError(message,code='RELEASE_VERIFY_FAILED'){const e=new Error(message);e.code=code;return e}
function git(cwd,args){
  try{return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}
  catch(error){throw releaseError('Git-kontrollen kunde inte genomföras: '+String(error.stderr||error.message||'okänt fel').trim(),'RELEASE_GIT_UNAVAILABLE')}
}
function normalizeCommit(value){
  const sha=String(value||'').trim().toLowerCase();
  if(!/^[a-f0-9]{40}$/.test(sha))throw releaseError('ROLLANDS_RELEASE_COMMIT måste vara en fullständig 40-teckens Git-SHA.','RELEASE_COMMIT_INVALID');
  return sha;
}
function verifyRelease({cwd=path.resolve(__dirname,'..'),expectedCommit}={}){
  const expected=normalizeCommit(expectedCommit);
  const actual=git(cwd,['rev-parse','HEAD']).toLowerCase();
  if(actual!==expected)throw releaseError(`Deployad commit avviker från godkänd release. Förväntad ${expected.slice(0,12)}, faktisk ${actual.slice(0,12)}.`,'RELEASE_COMMIT_MISMATCH');
  const dirty=git(cwd,['status','--porcelain','--untracked-files=no']);
  if(dirty)throw releaseError('Git-checkouten innehåller lokala ändringar i spårade filer. Deployen är inte reproducerbar.','RELEASE_WORKTREE_DIRTY');
  const commitType=git(cwd,['cat-file','-t',expected]);
  if(commitType!=='commit')throw releaseError('Den angivna release-SHA:n är inte ett Git-commitobjekt.','RELEASE_COMMIT_NOT_FOUND');
  return Object.freeze({ok:true,commit:actual,trackedWorktreeClean:true});
}
function main(){
  try{
    const result=verifyRelease({expectedCommit:process.env.ROLLANDS_RELEASE_COMMIT});
    console.log(JSON.stringify({verified:true,commit:result.commit,trackedWorktreeClean:true}));
  }catch(error){
    console.error(`${error.code||'RELEASE_VERIFY_FAILED'}: ${error.message}`);
    process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports=Object.freeze({normalizeCommit,verifyRelease});
