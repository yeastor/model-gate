import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {currentEpisode, caseQuestionsUsed, canServeQuestion, serveQuestion,
  answerQuestionReceipt, subjectFor, hash} from './state.mjs';
import {validateQuestionDefinition} from './questions.mjs';
import {createNeighborsStatePort, requireNeighbors as check} from './neighbors-state-port.mjs';
import {interpretNeighbors, neighborsReply} from './neighbors-interpret.mjs';
const POLICY='02c25b2bd62c370beda32a29af341cd515090d0fc5c5866a96fe129333fe146d';
const digest=b=>createHash('sha256').update(b).digest('hex');
const own=(o,k)=>Object.hasOwn(o,k),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o)}return o;};
function pinned(pin){const bytes=fs.readFileSync(pin.path);check(bytes.length===pin.bytes&&digest(bytes)===pin.sha256,'NBR_INPUT_PIN_MISMATCH');return JSON.parse(bytes.toString('utf8'));}

// Explicit dependency-injected private factory. No adapter/server default is changed.
export async function createNeighborsProfile({policyBytes}={}) {
  policyBytes ||= fs.readFileSync(new URL('./policy/neighbors.v1.json',import.meta.url));
  check(digest(policyBytes)===POLICY,'NBR_POLICY_PIN_MISMATCH');
  const policy=JSON.parse(policyBytes.toString('utf8'));
  check(policy.defaultActivation===false&&policy.categoryId==='neighbors','NBR_PRIVATE_POLICY');
  const manifest=pinned(policy.manifest),root=path.dirname(policy.manifest.path);
  for(const f of manifest.files){const file=path.resolve(root,f.relative_path),rel=path.relative(root,file);
    check(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'NBR_MANIFEST_PATH');
    const bytes=fs.readFileSync(file);check(bytes.length===f.bytes&&digest(bytes)===f.sha256,'NBR_COMPONENT_PIN_MISMATCH');}
  pinned(policy.internalContract);
  const bundle=pinned(policy.source),next=pinned(policy.next),native=path.join(root,'next-package/next');
  // Import only accepted validators and pure predicate helpers after all pins pass.
  const {validateHandoff}=await import(pathToFileURL(path.join(native,'successor-validation.mjs')));
  const {createBoundRuntime}=await import(pathToFileURL(path.join(native,'baseline/engine/neighbors-private-applicability-20261018-v5/runtime-core.mjs')));
  const validation=validateHandoff(next);
  const evaluator=createBoundRuntime(next.provenance.retained_v5_bundle,
    {bundle_sha256:policy.next.sha256,source_digest:next.source_digest,contract_sha256:hash(next.runtime_contract)},validation);
  const stages=new Map(bundle.subcategories.map(s=>[s.stage.id,s]));
  const rows=new Map(bundle.subcategories.flatMap(s=>s.variants.map(row=>[row.variant_id,{row,stage:s.stage.id}])));
  const questions=new Map(policy.questions.map(q=>[q.id,{...q,fieldKey:q.field_key,text:q.question_text,
    controls:q.answers.map(value=>({value,label:value===true?'Да':value===false?'Нет':q.uncertainty_kind==='document'?'Нужно проверить':'Не знаю'}))}]));
  const catalog=next.next_catalog.stages.flatMap(s=>s.questions);
  check(rows.size===400&&policy.canonicalFields.length===46&&policy.blockedFields.length===12
    &&questions.size===36&&[...questions.values()].filter(q=>q.controls.length).length===31,'NBR_INVENTORY');
  check(equal(catalog,policy.questions.map(({id,stageId,...q})=>q)),'NBR_CATALOG_MISMATCH');
  const validationEngine={bundle,rowFor:id=>{check(rows.has(id),'NBR_UNKNOWN_ID');return{row:rows.get(id).row,stage:stages.get(rows.get(id).stage)}}};
  for(const q of questions.values())if(q.controls.length)validateQuestionDefinition({id:q.id,
    branches:q.controls.map(c=>({value:c.value,kind:'stage',stageId:q.stageId}))},validationEngine);
  freeze(bundle);freeze(next);freeze(policy);
  const port=createNeighborsStatePort(policy,questions);
  const {requestKey,blockedKey}=port;
  function prepareState(s){port.prepareState(s);if(s.pending)port.checkPending(s);}
  function eligible(s,q){
    const n=s.neighbors,stage=currentEpisode(s).stageId,f=port.facts(s);
    if(n.stopped||port.correctionHeld(s)||q.stageId!==stage||!q.controls.length)return false;
    if(n.retry!==q.fieldKey&&port.known(s,q.fieldKey))return false;
    if(s.factLedger.some(x=>x.status==='conflicted'&&x.subjectId===subjectFor(s,x.fieldKey)
      &&x.episodeId===s.activeEpisodeId))return false;
    if((q.requires||[]).some(r=>f[r.field_key]!==r.value))return false;
    return true;
  }
  function evaluate(s,{safetyOnly=false}={}){
    const stage=currentEpisode(s).stageId;if(!stages.has(stage))return null;
    const effective=safetyOnly?Object.fromEntries(Object.entries(port.facts(s,stage,{ignoreCorrectionHold:true}))
      .filter(([key,value])=>value===true&&['immediate_danger','fire_danger_signs','acute_health_signs','evacuation_blocked'].includes(key.split('.').at(-1)))):port.effective(s),facts={},facets={};
    for(const f of policy.canonicalFields.filter(f=>f.field_key.startsWith('neighbors.'+stage+'.')))
      if(own(effective,f.field_key))facts[f.field_key.split('.').at(-1)]=effective[f.field_key];
    for(const f of policy.privateFields.filter(f=>f.stage===stage)){
      const k=`neighbors.${stage}.${f.next_key}`;if(own(effective,k))facets[f.id]=effective[k];}
    for(const f of policy.rawBooleanFields.filter(f=>f.stage===stage))
      if(own(effective,f.key))facets[f.id]=effective[f.key];
    // No callback/Boolean/evidence object is treated as an installed proof producer.
    const result=evaluator.evaluate(stage,{facts,facets,case_id:s.caseState.id,
      case_revision:s.revision+1,assessment_context:{incident_region:null,receiving_premises_kind:null,event_time_scope:null}},{});
    check(rows.has(result.row.variant_id),'NBR_EVALUATOR_TARGET');
    result.row=rows.get(result.row.variant_id).row; // Current B45 display, never historical evaluator prose.
    return result;
  }
  function plan(s){
    const n=s.neighbors,stage=currentEpisode(s).stageId,evaluation=evaluate(s);
    if(!evaluation)return {variantId:null,question:null,evaluation:null};
    const values=port.facts(s),request=port.recordFor(s,requestKey);
    const focused=n.focus&&stage==='sanitary_conditions';
    const done=focused&&(request?.status==='conflicted'||request?.source?.operation==='withdraw'
      ||values[requestKey]===false||values[requestKey]===null
      ||values[requestKey]===true&&port.known(s,blockedKey));
    const qs=[...questions.values()].filter(q=>q.stageId===stage
      &&(!focused||[requestKey,blockedKey].includes(q.fieldKey)));
    if(focused)qs.sort((a,b)=>Number(![requestKey,blockedKey].includes(a.fieldKey))-Number(![requestKey,blockedKey].includes(b.fieldKey)));
    if(n.retry)qs.sort((a,b)=>Number(b.fieldKey===n.retry)-Number(a.fieldKey===n.retry));
    const question=done&&!n.retry?null:qs.find(q=>eligible(s,q)&&canServeQuestion(s,
      s.pending?.question.id===q.id?s.pending:port.newPending(s,q,{retry:n.retry===q.fieldKey}),port.third(s,q)))||null;
    return {variantId:evaluation.row.variant_id,question,evaluation};
  }
  function checkAction(s,input,q){
    const action=input.guided?.native,p=s.pending,reply=neighborsReply(input.question,q);
    check(p&&action.kind==='answer'&&action.questionId===q.id&&action.receiptId===p.receiptId
      &&action.caseId===s.caseState.id&&action.subjectId===subjectFor(s,p.fieldKey)
      &&action.scopeDigest===port.scopeDigest(s)&&action.policyVersion===policy.version
      &&action.sourceSha256===policy.source.sha256&&action.nextSha256===policy.next.sha256
      &&action.attemptId===p.neighborsAttemptId&&reply&&reply.value===action.value,'NBR_STALE_ACTION');
  }
  function dispatch(s,input){
    for(const key of ['facts','context','snapshot','state','caseState','origin','proof','history','complexity'])
      check(!own(input,key),'NBR_CLIENT_STATE_FORBIDDEN');
    const n=s.neighbors,prior=s.pending,text=input.question||'',p=interpretNeighbors(text,input.turnId,policy);
    if(prior)port.checkPending(s);
    const action=input.guided?.native,reply=prior&&neighborsReply(text,prior.question);
    if(action)checkAction(s,input,prior?.question);
    port.beginTurn(s,input);
    if(prior&&reply){
      check(eligible(s,prior.question),'NBR_INELIGIBLE_REPLY');
      const source={kind:action?'button':'user_text',turnId:input.turnId,message:text,quote:text,
        span:[0,Array.from(text).length],questionId:prior.question.id,receiptId:prior.receiptId};
      answerQuestionReceipt(s,prior,reply.value,source);
      check(port.admit(s,{fieldKey:prior.fieldKey,stageId:prior.stageId,value:reply.value,source}),'NBR_REPLY_REJECTED');
      n.retry=null;s.pending=null;
    }else if(!action){
      if(input.variantId){check(rows.has(input.variantId),'NBR_SOURCE_ID_UNAVAILABLE');
        const selected=rows.get(input.variantId);n.selector=input.variantId;
        if(!p.stage)port.selectScope(s,selected.stage);
        if(selected.stage==='sanitary_conditions'&&selected.row.context.inspection_blocked===true)n.focus=true;
      }
      if(p.valid){
        // Distinct-case reset remains closed in this first private adapter: retain raw rather than guess identity.
        if(p.newCase){n.raw.push({turnId:input.turnId,text,reason:'NEW_CASE_REQUIRES_SEPARATE_CONTEXT'});return plan(s);}
        if(p.command==='return'){
          const history=[...n.stageHistory],stage=history.pop();
          if(stage){port.selectScope(s,stage);n.stageHistory=history;}
        }else if(p.stage)port.selectScope(s,p.stage,p.premises,p.newObject);
        else if((p.premises||p.newObject)&&currentEpisode(s).stageId)
          port.selectScope(s,currentEpisode(s).stageId,p.premises,p.newObject);
        if(p.focus)n.focus=true;
        if(p.command==='decline'){
          if(prior){port.close(s,prior.fieldKey);port.retire(s,'declined');}
          n.stopped=true;
        }else if(p.command==='resume')n.stopped=false;
        else if(p.command?.startsWith('retry_')){
          const key=p.command==='retry_request'?requestKey:blockedKey;
          check(!n.stopped&&port.facts(s)[key]===null&&caseQuestionsUsed(s)<3,'NBR_RETRY_NOT_AVAILABLE');
          n.retry=key;
          const q=questions.get(key),pending=port.newPending(s,q,{retry:true});
          check(eligible(s,q)&&canServeQuestion(s,pending,port.third(s,q)),'NBR_RETRY_LIMIT');
          port.retire(s,'explicit_retry');s.pending=pending;
        }
        for(const observation of p.observations){
          const stored=port.admit(s,observation);
          if(stored&&['correct','withdraw'].includes(observation.operation))port.clearCorrection(s);
          if(stored&&s.pending?.fieldKey===observation.fieldKey)port.retire(s,'supplied_in_original_message');
        }
      }else {
        n.raw.push({turnId:input.turnId,text,reason:'UNSUPPORTED_NO_FACT'});
        if(['correct','withdraw'].includes(p.operation)&&currentEpisode(s).stageId){
          port.holdCorrection(s);port.retire(s,'unresolved_correction');
        }
      }
    }
    const outcome=plan(s);
    if(s.pending&&!eligible(s,s.pending.question))port.retire(s,'no_longer_eligible');
    else if(s.pending&&outcome.question?.id!==s.pending.question.id)s.pending=null;
    if(!s.pending&&outcome.question&&(p.valid||reply||input.variantId))
      s.pending=port.newPending(s,outcome.question,{retry:n.retry===outcome.question.fieldKey});
    return {...outcome,forceFull:p.command==='repeat'||p.operation==='correct'||p.operation==='withdraw'};
  }
  function present(s,outcome,{turnId=null}={}){
    const responseId=randomUUID(),n=s.neighbors,e=currentEpisode(s);let p=s.pending;
    if(p&&!serveQuestion(s,p,responseId,turnId,port.third(s,p.question))){s.pending=null;p=null;}
    if(p){const r=s.caseState.served.find(x=>x.id===p.receiptId);
      r.neighborsAttemptId=p.neighborsAttemptId;
      r.neighborsProof ||= {question:structuredClone(p.question),scopeDigest:p.scopeDigest,
        policy:policy.version,actorId:s.userId,caseId:s.caseState.id};}
    const evaluation=outcome.evaluation||evaluate(s),row=evaluation?.row,a=row?.payload.answer;
    const safety=port.correctionHeld(s)?evaluate(s,{safetyOnly:true})?.priority_action:null;
    const priority=safety?`Если ранее описанная опасность сохраняется: ${safety}`:evaluation?.priority_action;
    const fingerprint=a&&hash([s.caseState.id,s.activeEpisodeId,port.scopeDigest(s),a,priority]);
    const same=fingerprint&&s.presentation.neighborsFingerprint===fingerprint&&!outcome.forceFull;
    let content=a?(same?'Рекомендации выше остаются актуальными. Известные обстоятельства сохранены.':
      [priority,a.now,...a.steps,...a.dont,...a.say,...a.laws.map(l=>`${l.ref}: ${l.short} (${l.url})`)].filter(Boolean).map(escape).join('\n\n')):
      'Опишите, что произошло с соседями и в каком месте. Пока неустановленные обстоятельства останутся неизвестными.';
    if(a&&!same){s.presentation.neighborsFingerprint=fingerprint;s.presentation.lastFullResponseId=responseId;}
    const native=p?{kind:'answer',sessionId:s.id,revision:s.revision,nonce:s.nonce,episodeId:e.id,
      roundId:s.round.id,caseId:s.caseState.id,subjectId:subjectFor(s,p.fieldKey),
      scopeDigest:p.scopeDigest,policyVersion:policy.version,sourceSha256:policy.source.sha256,
      nextSha256:policy.next.sha256,questionId:p.question.id,receiptId:p.receiptId,attemptId:p.neighborsAttemptId}:null;
    return {conversation:{sessionId:s.id,revision:s.revision,version:s.version,nonce:s.nonce},
      presentation:{responseId,mode:a?(same?'continuation':'full'):'boundary',questionsUsed:caseQuestionsUsed(s),policyVersion:policy.version},
      answer:{category:'neighbors',variantId:row?.variant_id,content,
        next:p?[{type:'choice',questionText:p.question.text,questionId:p.question.id,
          view:p.question.controls.map(c=>({title:c.label,question:c.label,guided:{native:{...native,value:c.value}}}))}]:[],
        sections:a&&!same?{body:structuredClone(a),documentActionsUnavailable:true}:undefined},
      dialogue:{stageId:e.stageId||null,questionId:p?.question.id||null,
        supportedVariantId:row?.variant_id||null,finalVariantId:null,scope:port.scopeBinding(s),
        facts:port.effective(s),sourceSelectorIsFact:false,proofProducer:'NOT_INSTALLED',
        holds:[...(evaluation?.holds||[]),...policy.blockedFields.filter(k=>k.startsWith('neighbors.'+e.stageId+'.')).map(field_key=>({field_key,code:'PROOF_PRODUCER_NOT_INSTALLED'}))],
        navigation:'TWO_GUARDED_TRANSITIONS_HELD_WITHOUT_ORIGINAL_REPORT_PRODUCER',
        questionLimit:p&&port.third(s,p.question)[p.question.id]?3:2,
        languageCoverage:'FINITE_LITERAL_AND_CURRENT_TFU',categoryClosed:false,production:false}};
  }
  return Object.freeze({categoryId:'neighbors',version:policy.version,sourceSha256:policy.source.sha256,
    bundle,policy,prepareState,dispatch,present,plan,scopedFacts:port.effective,port,
    validate(candidate,sha){check(candidate===bundle&&sha===policy.source.sha256,'NBR_SOURCE_VERSION_UNAVAILABLE');}});
}
