'use strict';

const {execFileSync}=require('node:child_process');
const path=require('node:path');
const Release=require('./pilot-release-verify.js');

function rollbackError(message,code='ROLLBACK_VERIFY_FAILED'){const e=new Error(message);e.code=code;return e}
function git(cwd,args){
  try{return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}
  catch(error){throw rollbackError('Git-kontrollen kunde inte genomföras: '+String(error.stderr||error.message||'okänt fel').trim(),'ROLLBACK_GIT_UNAVAILABLE')}
}
function normalizeTarget(value){
  const sha=String(value||'').trim().toLowerCase();
  if(!/^[a-f0-9]{40}$/.test(sha))throw rollbackError('ROLLANDS_ROLLBACK_COMMIT måste vara en fullständig 40-teckens Git-SHA.','ROLLBACK_COMMIT_INVALID');
  return sha;
}
function verifyRollback({cwd=path.resolve(__dirname,'..'),currentCommit,targetCommit}={}){
  const current=Release.normalizeCommit(currentCommit);
  Release.verifyRelease({cwd,expectedCommit:current});
  const target=normalizeTarget(targetCommit);
  if(target===current)throw rollbackError('Rollbackmålet är samma commit som nuvarande release.','ROLLBACK_TARGET_SAME_AS_CURRENT');
  let type;
  try{type=git(cwd,['cat-file','-t',target])}catch{throw rollbackError('Rollbackmålet finns inte i den lokala Git-historiken.','ROLLBACK_TARGET_NOT_FOUND')}
  if(type!=='commit')throw rollbackError('Rollbackmålet är inte ett Git-commitobjekt.','ROLLBACK_TARGET_NOT_FOUND');
  let isAncestor=true;
  try{execFileSync('git',['merge-base','--is-ancestor',target,current],{cwd,stdio:'ignore'})}
  catch{isAncestor=false}
  if(!isAncestor)throw rollbackError('Rollbackmålet är inte en tidigare commit i den nuvarande releasens historik.','ROLLBACK_TARGET_NOT_ANCESTOR');
  const distance=Number(git(cwd,['rev-list','--count',target+'..'+current]));
  if(!Number.isSafeInteger(distance)||distance<1)throw rollbackError('Rollbackavståndet kunde inte verifieras.','ROLLBACK_DISTANCE_INVALID');
  return Object.freeze({ok:true,currentCommit:current,targetCommit:target,commitsToRollback:distance,trackedWorktreeClean:true});
}
function main(){
  try{
    const result=verifyRollback({
      currentCommit:process.env.ROLLANDS_RELEASE_COMMIT,
      targetCommit:process.env.ROLLANDS_ROLLBACK_COMMIT
    });
    console.log(JSON.stringify({verified:true,...result}));
    console.log('Ingen kod eller databas ändrades. Detta är endast ett rollback-förhandsprov.');
  }catch(error){
    console.error(`${error.code||'ROLLBACK_VERIFY_FAILED'}: ${error.message}`);
    process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports=Object.freeze({normalizeTarget,verifyRollback});
