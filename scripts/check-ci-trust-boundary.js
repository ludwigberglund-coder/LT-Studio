'use strict';

const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.resolve(__dirname,'..');
const WORKFLOW_DIR=path.join(ROOT,'.github','workflows');
const WRITE_PERMISSIONS=new Set([
  'actions','checks','contents','deployments','id-token','issues','packages','pages','pull-requests','statuses'
]);

function findingsInWorkflow(text,filename='workflow.yml'){
  const source=String(text||'');
  const findings=[];
  const lines=source.split(/\r?\n/);
  const hasPullRequest=lines.some(line=>/^\s{2}pull_request\s*:/.test(line));
  const hasPullRequestTarget=lines.some(line=>/^\s{2}pull_request_target\s*:/.test(line));

  if(hasPullRequestTarget){
    findings.push({rule:'pull-request-target-forbidden',filename,line:lines.findIndex(line=>/^\s{2}pull_request_target\s*:/.test(line))+1});
  }

  for(const [index,line] of lines.entries()){
    const uses=line.match(/^\s*-?\s*uses:\s*([^\s#]+)\s*(?:#.*)?$/);
    if(uses){
      const target=uses[1];
      if(!target.startsWith('./')){
        const at=target.lastIndexOf('@');
        const ref=at>=0?target.slice(at+1):'';
        if(!/^[a-f0-9]{40}$/i.test(ref)){
          findings.push({rule:'action-not-pinned-to-commit',filename,line:index+1,value:target});
        }
      }
    }

    if(hasPullRequest){
      const permission=line.match(/^\s+([a-z-]+):\s*write\s*(?:#.*)?$/);
      if(permission&&WRITE_PERMISSIONS.has(permission[1])){
        findings.push({rule:'pr-workflow-write-permission',filename,line:index+1,value:permission[1]});
      }
      if(/\$\{\{\s*secrets\./.test(line)){
        findings.push({rule:'pr-workflow-secret-reference',filename,line:index+1});
      }
      if(/^\s+persist-credentials:\s*true\s*(?:#.*)?$/i.test(line)){
        findings.push({rule:'pr-checkout-persists-credentials',filename,line:index+1});
      }
    }
  }

  if(hasPullRequest&&/uses:\s*actions\/checkout@/i.test(source)&&!/persist-credentials:\s*false/i.test(source)){
    findings.push({rule:'pr-checkout-must-disable-persisted-credentials',filename,line:1});
  }
  return findings;
}

function workflowFiles(directory=WORKFLOW_DIR){
  if(!fs.existsSync(directory))return[];
  return fs.readdirSync(directory)
    .filter(name=>/\.ya?ml$/i.test(name))
    .map(name=>path.join(directory,name))
    .sort();
}

function scanWorkflows(directory=WORKFLOW_DIR){
  const findings=[];
  for(const filename of workflowFiles(directory)){
    const relative=path.relative(ROOT,filename);
    findings.push(...findingsInWorkflow(fs.readFileSync(filename,'utf8'),relative));
  }
  return findings;
}

function main(){
  const findings=scanWorkflows();
  if(findings.length){
    console.error('CI-säkerhetskontrollen hittade en osäker GitHub Actions-konfiguration.');
    for(const finding of findings){
      console.error(`- ${finding.rule} @ ${finding.filename}:${finding.line}${finding.value?` (${finding.value})`:''}`);
    }
    process.exitCode=1;
    return;
  }
  console.log('GitHub Actions trust boundary kontrollerad: inga förbjudna PR-/supply-chain-mönster hittades.');
}

if(require.main===module)main();
module.exports=Object.freeze({WRITE_PERMISSIONS,findingsInWorkflow,workflowFiles,scanWorkflows});
