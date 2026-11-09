import {randomUUID} from 'node:crypto';
import {currentEpisode, newRound, recordFact, subjectFor, hash, answerQuestionReceipt} from './state.mjs';
import {fail} from './errors.mjs';
import {interpretNeighbors, neighborsReply} from './neighbors-interpret.mjs';
const own=(o,k)=>Object.hasOwn(o,k), equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const requireNeighbors=(v,code)=>{if(!v)fail(code,409);};
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
export function createNeighborsStatePort(policy, questions) {
  const requestKey='neighbors.sanitary_conditions.inspection_requested';
  const blockedKey='neighbors.sanitary_conditions.inspection_blocked';
  const fields=[...policy.canonicalFields.map(f=>f.field_key),
    ...policy.privateFields.map(f=>`neighbors.${f.stage}.${f.next_key}`),requestKey,
    ...policy.rawBooleanFields.map(f=>f.key)];
  const version={policy:policy.version,source:policy.source.sha256,next:policy.next.sha256,
    port:policy.statePortVersion,attempt:policy.attemptVersion};
  function prepareState(s) {
    requireNeighbors(!s.categoryId||s.categoryId==='neighbors','NBR_CATEGORY_MISMATCH');
    requireNeighbors(s.neighbors?equal(s.neighbors.version,version):s.revision===0,'NBR_PREDECESSOR_STATE_UNAVAILABLE');
    s.categoryId='neighbors';s.policyVersion=policy.version;
    s.categoryFieldKeys=fields;s.categoryBlockedFields=policy.blockedFields;
    s.categoryScopeGroups=Object.fromEntries(fields.map(k=>[k,k.split('.')[1]]));
    s.neighbors ||= {schema:policy.statePortVersion,version,caseId:s.caseState.id,
      scopes:{},subjects:{},turns:{},raw:[],closed:[],correctionHolds:[],focus:false,stopped:false,retry:null,stageHistory:[]};
    requireNeighbors(s.neighbors.schema===policy.statePortVersion,'NBR_STATE_SCHEMA');
    requireNeighbors(Array.isArray(s.neighbors.correctionHolds),'NBR_STATE_SCHEMA');
    requireNeighbors(s.neighbors.caseId===s.caseState.id,'NBR_CASE_BINDING');
    requireNeighbors(s.caseState.baselineUsed===0&&s.caseState.legacyHistoryComplete===true
      &&!s.caseState.migrationReason,'NBR_PREDECESSOR_HISTORY_UNAVAILABLE');
    // A persisted in-flight flag cannot authorize an uncommitted user turn.
    delete s.neighbors.inflight;
    currentEpisode(s).categorySubjects ||= {};
    for(const [stage,scope] of Object.entries(s.neighbors.scopes)) {
      if(scope.episodeId===s.activeEpisodeId)
        currentEpisode(s).categorySubjects[stage]={current:scope.subjectId};
    }
    if(s.revision>0)checkHistory(s);
  }
  function currentScope(s,stage=currentEpisode(s).stageId) {
    const x=s.neighbors.scopes[stage];
    return x?.episodeId===s.activeEpisodeId?x:null;
  }
  function scopeBinding(s,stage=currentEpisode(s).stageId) {
    const sc=currentScope(s,stage);
    return sc?{actorId:s.userId,caseId:s.caseState.id,episodeId:s.activeEpisodeId,
      stageId:stage,subjectId:sc.subjectId,premises:sc.premises}:null;
  }
  const scopeDigest=(s,stage)=>hash(scopeBinding(s,stage));
  function retire(s,reason) {
    if(!s.pending)return;
    answerQuestionReceipt(s,s.pending,null,{kind:reason});
    const r=s.caseState.served.find(x=>x.id===s.pending.receiptId);
    if(r)r.neighborsDisposition=reason;
    s.pending=null;
  }
  function selectScope(s,stage,premises=null,newObject=false) {
    const n=s.neighbors,e=currentEpisode(s),old=currentScope(s,stage);
    const chosen=premises??(newObject?null:old?.premises??null);
    if(e.stageId===stage&&old&&!newObject&&old.premises===chosen)return;
    // Suspend an outstanding attempt on navigation. Its served receipt remains
    // charged and can be resumed for this same object without a new attempt.
    s.pending=null;
    if(e.stageId&&e.stageId!==stage)n.stageHistory.push(e.stageId);
    const key=JSON.stringify([s.caseState.id,e.id,stage,chosen??(newObject?randomUUID():'local-unlocated')]);
    const subject=n.subjects[key] ||= randomUUID();
    n.scopes[stage]={episodeId:e.id,premises:chosen,subjectId:subject};
    e.categorySubjects[stage]={current:subject};e.stageId=stage;
    newRound(s,'neighbors-scope');n.retry=null;n.stopped=false;
  }
  function beginTurn(s,input) {
    const action=input.guided?.native?.kind?input.guided.native:null;
    s.neighbors.turns[input.turnId]={text:input.question,action,
      ...(own(input,'variantId')?{variantId:input.variantId}:{}),
      ...(own(input,'launchHint')?{launchHint:input.launchHint}:{}),
      actorId:s.userId,caseId:s.caseState.id,episodeId:s.activeEpisodeId};
    s.neighbors.inflight=input.turnId;
  }
  function originalTurnValid(s,turnId) {
    const t=s.neighbors.turns[turnId];if(!t||t.actorId!==s.userId||t.caseId!==s.caseState.id
      ||t.episodeId!==s.activeEpisodeId)return false;
    if(s.neighbors.inflight===turnId)return true;
    return s.turns[turnId]?.requestHash===hash(stable({question:t.text,action:t.action,
      variantId:t.variantId,launchHint:t.launchHint}));
  }
  function recordFor(s,key) {
    return s.factLedger.findLast(f=>f.caseId===s.caseState.id&&f.episodeId===s.activeEpisodeId
      &&f.subjectId===subjectFor(s,key)&&f.fieldKey===key&&['active','conflicted','invalidated'].includes(f.status));
  }
  function receiptValid(s,r) {
    const q=questions.get(r?.questionId),proof=r?.neighborsProof;
    if(!q||!proof||!equal(q,proof.question)||proof.policy!==policy.version
      ||proof.caseId!==s.caseState.id||proof.actorId!==s.userId)return false;
    // New presentation is only trusted while constructing its committing response.
    if(s.neighbors.inflight===r.turnId)return true;
    const g=s.turns[r.turnId]?.response?.answer?.next?.find(g=>g.questionId===q.id
      &&g.view.every(c=>c.guided?.native?.receiptId===r.id));
    return !!g&&g.questionText===q.text&&equal(g.view.map(c=>({value:c.guided.native.value,label:c.title})),q.controls);
  }
  // Integrity of the server-owned transaction history, not authentication of an
  // attacker-controlled filesystem. Missing receipts must never refund a slot.
  function checkHistory(s) {
    const turns=Object.entries(s.turns),served=s.caseState.served;
    requireNeighbors(Array.isArray(served)&&served.length<=3&&new Set(served.map(r=>r.id)).size===served.length
      &&turns.length===s.revision&&Object.keys(s.neighbors.turns).length===turns.length
      &&s.lastResponse?.conversation?.revision===s.revision,'NBR_INCOMPLETE_HISTORY');
    const seen=new Set();
    for(const [turnId,t] of turns){
      requireNeighbors(originalTurnValid(s,turnId)&&t.response?.turn?.turnId===turnId
        &&Array.isArray(t.response?.answer?.next),'NBR_INCOMPLETE_HISTORY');
      for(const display of t.response.answer.next){
        const q=questions.get(display.questionId),controls=display.view;
        requireNeighbors(q&&Array.isArray(controls)&&controls.length===q.controls.length,'NBR_INCOMPLETE_HISTORY');
        for(const c of controls){
          const a=c.guided?.native,r=served.find(r=>r.id===a?.receiptId);
          requireNeighbors(r&&receiptValid(s,r)&&a.questionId===r.questionId
            &&a.attemptId===r.neighborsAttemptId&&a.caseId===r.caseId&&a.episodeId===r.episodeId
            &&a.subjectId===r.subjectId&&a.scopeDigest===r.neighborsProof.scopeDigest
            &&a.policyVersion===policy.version&&a.sourceSha256===policy.source.sha256
            &&a.nextSha256===policy.next.sha256,'NBR_INCOMPLETE_HISTORY');
          seen.add(r.id);
        }
      }
    }
    requireNeighbors(seen.size===served.length&&served.every(r=>receiptValid(s,r)
      &&['served','answered'].includes(r.status)),'NBR_INCOMPLETE_HISTORY');
  }
  function recordValid(s,f) {
    if(!f||f.status!=='active'||f.source?.operation==='withdraw')return false;
    const src=f.source,t=s.neighbors.turns[src?.turnId];
    if(!originalTurnValid(s,src?.turnId)||!t||!['user_text','button'].includes(src.kind)
      ||src.message!==t.text||!Array.isArray(src.span)||src.span.length!==2
      ||!src.span.every(Number.isInteger)||src.span[0]<0||src.span[1]<src.span[0]
      ||src.span[1]>Array.from(t.text).length||!equal(src.scope,scopeBinding(s,f.fieldKey.split('.')[1]))
      ||src.policy!==policy.version||src.sourceSha256!==policy.source.sha256
      ||src.nextSha256!==policy.next.sha256||f.value!==src.proposedValue
      ||!equal(Array.from(t.text).slice(...src.span).join(''),src.quote))return false;
    if(src.questionId){
      const r=s.caseState.served.find(x=>x.id===src.receiptId),q=questions.get(src.questionId),reply=neighborsReply(t.text,q);
      return !!r&&receiptValid(s,r)&&r.fieldKey===f.fieldKey&&r.subjectId===f.subjectId
        &&r.episodeId===f.episodeId&&r.neighborsProof.scopeDigest===hash(src.scope)&&r.answer?.value===f.value
        &&r.answer?.source?.turnId===src.turnId&&reply?.value===f.value;
    }
    const p=interpretNeighbors(t.text,src.turnId,policy);
    return p.valid&&p.observations.some(x=>x.fieldKey===f.fieldKey&&x.value===f.value
      &&x.operation===src.operation&&x.source.quote===src.quote&&equal(x.source.span,src.span));
  }
  function admit(s,p) {
    if(!fields.includes(p.fieldKey)||policy.blockedFields.includes(p.fieldKey)
      ||p.stageId!==currentEpisode(s).stageId||![true,false,null].includes(p.value))return null;
    const old=recordFor(s,p.fieldKey),source={...p.source,scope:scopeBinding(s),
      policy:policy.version,sourceSha256:policy.source.sha256,nextSha256:policy.next.sha256,
      operation:p.operation||'assert',proposedValue:p.value};
    const operation=p.operation||'assert';
    if(operation==='withdraw'&&!old)return null;
    if(operation==='correct'&&!old)return null;
    const stored=recordFact(s,p.fieldKey,operation==='withdraw'?null:p.value,
      {...source,proposedValue:operation==='withdraw'?null:p.value},operation,[]);
    // Facts are immutable observations plus lineage; an invalid dependency stays local.
    if(old&&old.id!==stored.id)for(const f of s.factLedger)
      if(f.status==='active'&&f.dependencies.includes(old.id))f.status='invalidated';
    return stored;
  }
  function correctionHeld(s){return s.neighbors.correctionHolds.includes(scopeDigest(s));}
  function holdCorrection(s){const key=scopeDigest(s);if(!s.neighbors.correctionHolds.includes(key))s.neighbors.correctionHolds.push(key);}
  function clearCorrection(s){s.neighbors.correctionHolds=s.neighbors.correctionHolds.filter(x=>x!==scopeDigest(s));}
  function facts(s,stage=currentEpisode(s).stageId,{ignoreCorrectionHold=false}={}) {
    const values={};
    if(!ignoreCorrectionHold&&stage===currentEpisode(s).stageId&&correctionHeld(s))return values;
    for(const key of fields.filter(k=>k.startsWith('neighbors.'+stage+'.'))){
      const f=recordFor(s,key);if(recordValid(s,f))values[key]=f.value;
    }
    return values;
  }
  function effective(s) {
    const values=facts(s);
    if(values[requestKey]!==true)delete values[blockedKey];
    return values;
  }
  const closedKey=(s,key)=>JSON.stringify([s.caseState.id,s.activeEpisodeId,subjectFor(s,key),key]);
  function close(s,key){if(!s.neighbors.closed.includes(closedKey(s,key)))s.neighbors.closed.push(closedKey(s,key));}
  function known(s,key){return !!recordFor(s,key)||s.neighbors.closed.includes(closedKey(s,key));}
  function third(s,q) {
    if(!s.neighbors.focus||![requestKey,blockedKey].includes(q.fieldKey))return {};
    // An answered unknown is already a completed question, not an unfinished
    // prerequisite pair. Retrying it alone cannot authorize the third slot.
    if(known(s,q.fieldKey))return {};
    const request=recordFor(s,requestKey),values=facts(s);
    if(request?.status==='conflicted'||request?.source?.operation==='withdraw'
      ||values[requestKey]===false||values[requestKey]===null)return {};
    return {[q.id]:policy.thirdReason};
  }
  function newPending(s,q,{retry=false}={}) {
    const prior=s.caseState.served.findLast(r=>r.neighborsProof&&r.fieldKey===q.fieldKey
      &&r.subjectId===subjectFor(s,q.fieldKey)&&r.episodeId===s.activeEpisodeId
      &&r.status==='served'&&!r.neighborsDisposition);
    // Return to an outstanding question reuses its original attempt/receipt.
    const attemptId=!retry&&prior?prior.neighborsAttemptId:randomUUID();
    return {kind:'next',key:q.id,fieldKey:q.fieldKey,stageId:q.stageId,question:structuredClone(q),
      scopeDigest:scopeDigest(s),neighborsAttemptId:attemptId};
  }
  function checkPending(s) {
    const p=s.pending;if(!p)return;
    const r=s.caseState.served.find(x=>x.id===p.receiptId);
    requireNeighbors(equal(p.question,questions.get(p.question?.id))&&p.scopeDigest===scopeDigest(s)
      &&r&&r.neighborsAttemptId===p.neighborsAttemptId&&r.fieldKey===p.fieldKey
      &&r.subjectId===subjectFor(s,p.fieldKey)&&r.episodeId===s.activeEpisodeId
      &&r.status==='served'&&!r.neighborsDisposition&&receiptValid(s,r),'NBR_STALE_PENDING');
  }
  return Object.freeze({prepareState,selectScope,currentScope,scopeBinding,scopeDigest,beginTurn,
    recordFor,recordValid,admit,facts,effective,known,close,retire,third,newPending,checkPending,
    receiptValid,originalTurnValid,correctionHeld,holdCorrection,clearCorrection,requestKey,blockedKey});
}
