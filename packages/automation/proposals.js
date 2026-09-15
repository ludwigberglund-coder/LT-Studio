'use strict';

(function registerAutomation(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RollandsAutomation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function createAutomationDomain(){
  const TYPES=Object.freeze([
    'bank-payment-match',
    'booking-account-suggestion',
    'supplier-invoice-coding',
    'supplier-payment-preparation'
  ]);
  const STATUSES=Object.freeze(['manual-review','ready-for-approval','approved','rejected','superseded']);

  function proposalError(message,code='AUTOMATION_PROPOSAL_ERROR',statusCode=422){
    const error=new Error(message);error.code=code;error.statusCode=statusCode;return error;
  }
  function text(value){return String(value??'').trim()}
  function id(){
    if(typeof require==='function'){try{return require('node:crypto').randomUUID()}catch{}}
    if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
    throw proposalError('Säker slumpgenerator saknas.','NO_SECURE_RANDOM',500);
  }
  function assertConfidence(value){
    const confidence=Number(value);
    if(!Number.isFinite(confidence)||confidence<0||confidence>1)throw proposalError('Säkerhetsvärdet måste vara mellan 0 och 1.','INVALID_CONFIDENCE');
    return confidence;
  }
  function normalizeEvidence(evidence){
    if(!Array.isArray(evidence))throw proposalError('Förslaget måste ha en lista med bevis/underlag.','INVALID_EVIDENCE');
    const rows=evidence.map(item=>Object.freeze({
      kind:text(item?.kind),
      label:text(item?.label),
      value:text(item?.value),
      sourceId:text(item?.sourceId)
    })).filter(item=>item.kind&&item.label&&item.value);
    if(!rows.length)throw proposalError('Minst ett tydligt underlag krävs för ett automatiskt förslag.','MISSING_EVIDENCE');
    return Object.freeze(rows);
  }
  function reviewDecision({confidence,deterministic=false,ambiguous=false}){
    const score=assertConfidence(confidence);
    if(ambiguous)return Object.freeze({status:'manual-review',reason:'Underlaget ger flera möjliga tolkningar.'});
    if(deterministic&&score===1)return Object.freeze({status:'ready-for-approval',reason:'Deterministiska regler gav en entydig träff. En behörig person ska fortfarande godkänna åtgärden i denna fas.'});
    if(score>=0.90)return Object.freeze({status:'ready-for-approval',reason:'Förslaget har hög säkerhet men kräver mänskligt godkännande.'});
    return Object.freeze({status:'manual-review',reason:'Säkerheten är för låg för att förbereda ett godkännande utan manuell granskning.'});
  }
  function createProposal(input){
    const companyId=text(input?.companyId),type=text(input?.type),sourceId=text(input?.sourceId),reason=text(input?.reason);
    if(!companyId)throw proposalError('Företag saknas.','MISSING_COMPANY');
    if(!TYPES.includes(type))throw proposalError('Okänd typ av automationsförslag.','UNKNOWN_PROPOSAL_TYPE');
    if(!sourceId)throw proposalError('Källpost saknas.','MISSING_SOURCE');
    if(!reason)throw proposalError('Förslaget måste förklara varför rekommendationen ges.','MISSING_REASON');
    if(!input?.suggestion||typeof input.suggestion!=='object'||Array.isArray(input.suggestion))throw proposalError('Förslaget saknar strukturerad rekommendation.','MISSING_SUGGESTION');
    const confidence=assertConfidence(input.confidence);
    const evidence=normalizeEvidence(input.evidence);
    const decision=reviewDecision({confidence,deterministic:input.deterministic===true,ambiguous:input.ambiguous===true});
    const createdAt=new Date(input.createdAt||Date.now()).toISOString();
    return Object.freeze({
      id:`proposal_${id()}`,
      companyId,
      type,
      sourceId,
      status:decision.status,
      confidence,
      deterministic:input.deterministic===true,
      ambiguous:input.ambiguous===true,
      reason,
      decisionReason:decision.reason,
      evidence,
      suggestion:Object.freeze(structuredClone(input.suggestion)),
      engine:Object.freeze({
        kind:text(input.engine?.kind)||'rules',
        name:text(input.engine?.name)||'rollands-automation',
        version:text(input.engine?.version)||'1'
      }),
      createdAt,
      createdBy:text(input.createdBy)||'system',
      approvedAt:null,
      approvedBy:null,
      rejectedAt:null,
      rejectedBy:null,
      rejectionReason:null
    });
  }
  function assertActor(actor){
    if(!actor||!text(actor.id)||!text(actor.name))throw proposalError('Godkännande kräver en personlig användaridentitet.','PERSONAL_IDENTITY_REQUIRED',401);
    return {id:text(actor.id),name:text(actor.name)};
  }
  function approveProposal(proposal,actor,{at=new Date().toISOString()}={}){
    const user=assertActor(actor);
    if(!proposal||!['manual-review','ready-for-approval'].includes(proposal.status))throw proposalError('Förslaget kan inte godkännas i nuvarande status.','INVALID_PROPOSAL_STATUS',409);
    return Object.freeze({...proposal,status:'approved',approvedAt:new Date(at).toISOString(),approvedBy:Object.freeze(user)});
  }
  function rejectProposal(proposal,actor,{reason,at=new Date().toISOString()}={}){
    const user=assertActor(actor),why=text(reason);
    if(!why)throw proposalError('Ange varför förslaget avvisas.','MISSING_REJECTION_REASON');
    if(!proposal||!['manual-review','ready-for-approval'].includes(proposal.status))throw proposalError('Förslaget kan inte avvisas i nuvarande status.','INVALID_PROPOSAL_STATUS',409);
    return Object.freeze({...proposal,status:'rejected',rejectedAt:new Date(at).toISOString(),rejectedBy:Object.freeze(user),rejectionReason:why});
  }
  function mayExecute(proposal){
    // Avsiktligt konservativt: ett godkänt förslag är fortfarande bara ett beslutsunderlag.
    // Den faktiska bokningen/betalningen måste gå genom respektive domäns behörighets-
    // och transaktionskontroller. Den här modulen får aldrig exekvera pengar eller bokföring.
    return false;
  }
  return Object.freeze({TYPES,STATUSES,assertConfidence,normalizeEvidence,reviewDecision,createProposal,approveProposal,rejectProposal,mayExecute});
});
