import fs from 'node:fs/promises';
import {acquireStore,commitStore,assertNewCaseUnbound,readStore,expireStore} from './children-site-sqlite-store.mjs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createExplicitEngine } from '../explicit/engine.mjs';
import { choiceValue } from './questions.mjs';
import { digest, isQualifiedPackage } from './qualified-package.mjs';
import { qualifiedRuntimeVersion as baseRuntimeVersion, renderQualifiedAnswer, qualifiedNotice, presentationRequest, escapeQualifiedText } from './children-site-presentation.mjs';
const qualifiedRuntimeVersion=baseRuntimeVersion+'/a48-inactive-help-retention/a50-private-storage/sqlite-wal-full-v1';

const own = (a,k) => Object.hasOwn(a,k);
const tfu = v => v===true || v===false || v===null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = code => { throw Object.assign(new Error(code), {status:409}); };
const stable = o => Array.isArray(o) ? o.map(stable) : o && typeof o==='object'
  ? Object.fromEntries(Object.keys(o).sort().map(k=>[k,stable(o[k])])) : o;
const equal = (a,b) => JSON.stringify(stable(a))===JSON.stringify(stable(b));
const fingerprint = value => digest(JSON.stringify(stable(value)));
const composite = 'children_alimony.travel_consent.own_exit_objection_withdrawal_requested';
const priorKey = 'private.own_prior_filing';
const intentKey = 'private.present_withdrawal_intent';
const dangerKey = 'private.current_child_danger';
const dangerFields = {child_residence:'immediate_child_safety_risk_present',guardianship:'child_in_immediate_danger'};
function directCurrentDanger(text) {
  const t=text.trim().toLocaleLowerCase('ru').replaceAll('ё','е').replace(/[.!]+$/u,'').replace(/\s+/gu,' ');
  return ['ребенка сейчас бьют','моего ребенка сейчас бьют','ребенок сейчас в непосредственной опасности',
    'мой ребенок сейчас в непосредственной опасности'].includes(t);
}
export function projectOwnWithdrawal(prior,intent) {
  // undefined means absent, not the explicitly answered unknown value null.
  if (!tfu(prior) || !tfu(intent)) return undefined;
  return prior===false || intent===false ? false : prior===true && intent===true ? true : null;
}
function latest(s,key) { return s.ledger.findLast(e=>e.key===key && e.status==='active'); }
function unresolvedPriorConflict(s) {
  const prior=latest(s,priorKey);
  return s.events.findLast(e=>e.kind==='observation_conflict' && e.observationId===prior?.id
    && !s.events.some(r=>r.kind==='conflict_resolved' && r.conflictId===e.id));
}
function resolvePriorConflicts(s,observationId,resolutionId,source) {
  const open=s.events.filter(e=>e.kind==='observation_conflict' && e.observationId===observationId
    && !s.events.some(r=>r.kind==='conflict_resolved' && r.conflictId===e.id));
  for(const conflict of open)s.events.push({kind:'conflict_resolved',id:randomUUID(),conflictId:conflict.id,
    observationId,resolutionId,source,scope:structuredClone(s.scope)});
  return open.length;
}
function invalidatePriorIntent(s,prior,source,by,reason) {
  const dependent=latest(s,intentKey);
  if(!dependent)return;
  if(!dependent.dependencies?.includes(prior.id))fail('DEPENDENCY_BINDING_REQUIRED');
  dependent.status='invalidated';
  s.events.push({kind:'dependency_invalidated',id:randomUUID(),observationId:dependent.id,
    dependencyId:prior.id,by,reason,source,scope:structuredClone(s.scope)});
}
function factsFor(s) {
  const facts={};
  for (const e of s.ledger) if (e.status==='active' && e.key.startsWith('children_alimony.')) facts[e.key]=e.value;
  const prior=latest(s,priorKey), intent=latest(s,intentKey);
  const derived=projectOwnWithdrawal(prior?.value,intent?.value);
  if (derived!==undefined) facts[composite]=derived;
  const danger=latest(s,dangerKey),field=dangerFields[s.stageId];
  if(danger && field)facts[`children_alimony.${s.stageId}.${field}`]=danger.value;
  return facts;
}
function append(s,key,value,source,{operation='assert',supersedes=null}={}) {
  if (!tfu(value)) fail('INVALID_TFU');
  const old=latest(s,key);
  if (old && operation==='assert' && old.value!==value) fail('EXPLICIT_CORRECTION_REQUIRED');
  if(key===priorKey && operation==='correct' && old?.value===value && equal(old.scope,s.scope)) {
    const id=randomUUID();
    s.events.push({kind:'observation_correction_noop',id,observationId:old.id,key,value,source,scope:structuredClone(s.scope)});
    return resolvePriorConflicts(s,old.id,id,source)>0;
  }
  if (old) old.status='superseded';
  const event={id:randomUUID(),key,value,status:'active',operation,supersedes:old?.id??supersedes,
    actor:s.identity,scope:structuredClone(s.scope),source,atRevision:s.revision+1,
    ...(key===intentKey?{dependencies:[latest(s,priorKey)?.id]}:{})};
  s.ledger.push(event);
  s.events.push({kind:'observation',id:event.id,operation,key,value,source,scope:structuredClone(s.scope)});
  if (key===priorKey && old) {
    invalidatePriorIntent(s,old,source,event.id,'prior_value_changed');
    resolvePriorConflicts(s,old.id,event.id,source);
  }
  if(key===`children_alimony.${s.stageId}.${dangerFields[s.stageId]}`) {
    const derivedSource=latest(s,dangerKey);if(derivedSource)derivedSource.status='invalidated';
  }
  return true;
}
function projectionRecord(s) {
  const prior=latest(s,priorKey),intent=latest(s,intentKey);
  const value=projectOwnWithdrawal(prior?.value,intent?.value);
  return value===undefined ? null : {key:composite,value,dependencies:[prior.id,intent.id],version:s.tuple.projectionVersion};
}
function helpHold(bundle,stage,row,facts) {
  // Never choose a more generic mask that drops another independently known material axis.
  for (const [key,value] of Object.entries(facts)) {
    const prefix=`${bundle.category.id}.${stage.stage.id}.`;
    if (!key.startsWith(prefix) || value===null) continue;
    const field=key.slice(prefix.length);
    if (stage.variants.some(r=>r.context[field]===value) && row.context[field]!==value) return 'HELP_RETENTION_NOT_PROVEN';
  }
  return null;
}
function scopeOf(input) {
  const x=input.privateDialogue.scope;
  const keys=['caseId','childId','subjectId','obligationId','periodId','objectId','objectVersion'];
  if (!x || Object.keys(x).some(k=>!keys.includes(k))) fail('INVALID_CASE_SCOPE');
  for (const k of keys) if (!(x[k]===null || typeof x[k]==='string' && /^[\p{L}\p{N}_.:/-]{1,120}$/u.test(x[k]))) fail('INVALID_CASE_SCOPE');
  if (!x.caseId || !x.childId || !x.subjectId) fail('UNRESOLVED_CASE_SCOPE');
  return structuredClone(x);
}
function gateFor(pkg,s,{question,stage}) {
  if(latest(s,dangerKey)?.value===true && !dangerFields[stage.stage.id])return 'SAFETY_HELP_FIRST';
  if(unresolvedPriorConflict(s))return 'EXPLICIT_CORRECTION_REQUIRED';
  const key=`${pkg.policy.categoryId}.${stage.stage.id}.${question.field_key}`;
  const gate=pkg.policy.qualified[key];
  if (gate==='official-removal-act/v1' || gate==='official-bailiff-calculation/v1') return 'DOCUMENT_SOURCE_NOT_SUPPORTED';
  if (gate==='own-prior-filing-and-present-intent/v1' && latest(s,priorKey)?.value!==true) return 'OWN_PRIOR_FILING_NOT_CONFIRMED';
  if (gate==='own-prior-filing-and-present-intent/v1' && !latest(s,intentKey)
    && s.ledger.some(e=>e.key===intentKey && ['retracted','invalidated'].includes(e.status))) return 'RETRACTED_FACT_REQUIRES_VOLUNTARY_CORRECTION';
  return null;
}
function privatePrior(s,pkg) {
  if (s.ledger.some(e=>e.key===priorKey && e.status==='retracted')) return false;
  if (latest(s,priorKey) || !s.statementReferent || !s.scope.objectId || !s.scope.objectVersion) return false;
  // A descriptor is not evidence of filing. This question establishes only the user's self-report.
  if (s.used>=2) return false;
  const semanticKey=`${priorKey}:${fingerprint(s.scope)}`;
  if (s.asked.includes(semanticKey)) return false;
  s.used++;s.asked.push(semanticKey);
  s.pending={kind:'private_prior',question:{id:'private-own-prior-filing-v1',question:pkg.policy.priorFilingQuestion,
    data:[{value:true,label:'Да'},{value:false,label:'Нет'},{value:null,label:'Не знаю'}]},semanticKey};
  s.status='question';s.hold=null;
  return true;
}
function runEngine(s,pkg,{answer}={}) {
  const engine=createExplicitEngine(pkg.bundle,{maxQuestions:2,
    questionHold:args=>gateFor(pkg,s,args),
    targetHold:({row,stage,state})=>helpHold(pkg.bundle,stage,row,state.facts)});
  const facts=factsFor(s);
  let next;
  if (answer!==undefined) {
    const previous=structuredClone(s.engine);
    previous.presented=s.used;
    // Engine writes exactly the pending field. N05 value is supplied only after private AND projection.
    delete previous.facts[`${pkg.policy.categoryId}.${previous.pending.stageId}.${previous.pending.question.field_key}`];
    next=engine.answer(previous,answer.value);
  } else {
    const entry=engine.entryFor(s.stageId);
    const previous={id:s.id,facts,history:s.engine?.history??[],presented:s.used,
      revision:s.engine?.revision??0,askedQuestionIds:s.engine?.askedQuestionIds??[]};
    next=engine.start(entry,previous);
  }
  // Retraction/correction must never leave an incompatible retained answer in place.
  if (next.current && !engine.compatible(next.current,factsFor(s))) next.current=engine.entryFor(s.stageId);
  s.engine=next;s.used=Math.max(s.used,next.presented);
  s.pending=next.pending?{kind:'next',...next.pending}:null;
  s.status=next.status;s.hold=next.reason;
  if (!s.pending && next.reason==='OWN_PRIOR_FILING_NOT_CONFIRMED') privatePrior(s,pkg);
  if (s.used>2) fail('QUESTION_BUDGET_INVARIANT');
  s.projection=projectionRecord(s);
}
function refresh(s,pkg) {
  const budget=s.used;
  runEngine(s,pkg);
  // Re-showing a semantically answered/retracted field is prohibited even with another embedded ID.
  if (s.pending?.kind==='next') {
    const key=`${pkg.policy.categoryId}.${s.pending.stageId}.${s.pending.question.field_key}`;
    const oldAsked=s.displayedFields.includes(key);
    if (oldAsked && !latest(s,key) && s.events.some(e=>e.kind==='retract' && e.key===key)) {
      s.pending=null;s.status='hold';s.hold='RETRACTED_FACT_REQUIRES_VOLUNTARY_CORRECTION';s.used=budget;
    }
  }
}
function retainedTravelHelp(s,pkg,current) {
  // This is presentation retention for this reviewed overlap, not a new resolver.
  // A resolved danger event still needs compatible known help after corrections.
  if(s.stageId!=='travel_consent' || !s.ledger.some(e=>e.key===dangerKey))return [];
  const stage=pkg.bundle.subcategories.find(x=>x.stage.id===s.stageId),facts=factsFor(s);
  const own=latest(s,priorKey),intent=latest(s,intentKey);
  const bound=e=>!!e && equal(e.scope,s.scope) && equal(e.actor,s.identity);
  const ownSupported=own?.value===true && intent?.value===true && bound(own) && bound(intent)
    && intent.dependencies?.includes(own.id) && !!s.scope.objectId && !!s.scope.objectVersion;
  const components=new Map();
  function include(id,origin) {
    if(id===current.variant_id || components.has(id))return;
    const row=stage.variants.find(r=>r.variant_id===id);
    if(!row || Object.values(row.context).every(v=>v===null))return;
    const evidence=[];
    for(const [field,value] of Object.entries(row.context)) {
      if(value===null)continue;
      const key=`children_alimony.${s.stageId}.${field}`;
      if(!Object.hasOwn(facts,key) || facts[key]!==value)return;
      if(key===composite) {
        if(!ownSupported || value!==true)return;
        evidence.push({key,value,observationIds:[own.id,intent.id]});
      } else {
        const reported=latest(s,key);
        if(!bound(reported) || reported.value!==value)return;
        evidence.push({key,value,observationIds:[reported.id]});
      }
    }
    components.set(id,{row,proof:{variantId:id,origin,requirements:evidence,
      categorySha256:pkg.tuple.categorySha256,scopeFingerprint:fingerprint(s.scope),
      answerSha256:fingerprint(row.payload.answer)}});
  }
  // Historical IDs identify already delivered source help only. They supply no facts.
  // Keep every unique still-compatible component; never select a first/best mask.
  for(const turn of Object.values(s.turns)) {
    const response=turn.response;
    if(!equal(response?.conversation?.scope,s.scope) || !equal(response?.conversation?.tuple,s.tuple)
      || response?.presentation?.runtimeVersion!==qualifiedRuntimeVersion)continue;
    include(response.variantId,'previously_delivered_same_scope_source');
  }
  // The exact reviewed own-withdrawal component can also be applicable when a
  // different known axis kept the ordinary single-row engine on general help.
  if(ownSupported)include('children_alimony_travel_consent_next_own_withdrawal_v01','independently_bound_prior_and_present_intent');
  return [...components.values()];
}
function present(s,pkg,{forceFull=false,acknowledgement=false}={}) {
  const stage=pkg.bundle.subcategories.find(x=>x.stage.id===s.stageId);
  const general=stage.variants.find(r=>Object.values(r.context).every(v=>v===null));
  const current=s.hold==='FREE_TEXT_NOT_PROJECTED'?general:(stage.variants.find(r=>r.variant_id===s.engine?.current)??general);
  const q=s.pending;
  const bind={sessionId:s.id,revision:s.revision,nonce:s.nonce,questionId:q?.question.id,
    scope:structuredClone(s.scope),tuple:s.tuple};
  const control=action=>({version:pkg.tuple.categorySha256,categoryId:pkg.policy.categoryId,stageId:s.stageId,context:{},
    native:{privateDialogue:{tuple:s.tuple,scope:s.scope,stageId:s.stageId,...(action?{action}:{})}}});
  const a=current.payload.answer;
  const answerFingerprint=fingerprint([pkg.tuple.categorySha256,current.variant_id,a]);
  const notice=qualifiedNotice(s.hold,s.stageId);
  const urgent=latest(s,dangerKey)?.value===true;
  const urgentPrefix=urgent?escapeQualifiedText(pkg.urgentHelp.text):null;
  const retained=s.hold==='FREE_TEXT_NOT_PROJECTED'?[]:retainedTravelHelp(s,pkg,current);
  const materialStateFingerprint=fingerprint([s.identity,s.scope,s.tuple,s.stageId,
    s.ledger.filter(e=>e.status==='active').map(e=>({id:e.id,key:e.key,value:e.value,scope:e.scope,dependencies:e.dependencies??[]})),
    s.projection,urgent]);
  const materialStateChanged=s.lastFull?.materialStateFingerprint!==materialStateFingerprint;
  // The existing transport has no supported proof of client-visible prior full help.
  // Conservatively render full help; an outbox ACK is not a visibility capability.
  const repeat=false;
  const fullHelpReason=forceFull?'explicit_full_request':!s.lastFull?'first_full_answer'
    :materialStateChanged?'material_state_changed':'prior_full_visibility_not_established';
  const answers=[a,...retained.map(component=>component.row.payload.answer)];
  const laws=[...new Map(answers.flatMap(answer=>answer.laws).map(law=>[JSON.stringify(law),law])).values()];
  const fullContent=retained.length
    ? [...answers.map(answer=>renderQualifiedAnswer({...answer,laws:[]})),
      renderQualifiedAnswer({now:'',steps:[],dont:[],say:[],where_to:[],laws}).trim()].filter(Boolean).join('\n\n')
    : renderQualifiedAnswer(a);
  const content=repeat
    ? [urgentPrefix,...[acknowledgement?'Хорошо.':'Памятка выше остаётся доступной.',notice].filter(Boolean).map(escapeQualifiedText)].filter(Boolean).join('\n\n')
    : [urgentPrefix,notice?escapeQualifiedText(notice):null,fullContent].filter(Boolean).join('\n\n');
  const responseId=randomUUID();
  const referencesResponseId=repeat?s.lastFull.responseId:null;
  if(!repeat)s.lastFull={answerFingerprint,materialStateFingerprint,responseId,variantId:current.variant_id};
  const views=q?[{type:'choice',questionText:q.question.question,view:q.question.data.map(a=>({
    type:'badge',id:randomUUID(),value:a.label,question:a.label,variantId:'',categoryId:pkg.policy.categoryId,
    guided:control({kind:'answer',value:a.value,binding:bind})}))}]:[];
  const response={protocolVersion:2,category:pkg.policy.categoryId,privateNonProduction:true,
    status:q?'question':'answer',hold:s.hold,variantId:current.variant_id,
    answer:{...structuredClone(current.payload.answer),category:pkg.bundle.category,content,variantId:current.variant_id,next:views},
    guided:control(),presentation:{kind:repeat?'continuation':'full',responseId,answerFingerprint,referencesResponseId,
      materialStateFingerprint,materialStateChanged,fullHelpReason,continuationSupported:false,
      retainedHelp:retained.map(component=>component.proof),helpRetentionContract:'children-travel-known-help/20261024-a48-inactive',
      composedLawTuples:retained.length?laws:[],
      privateNonProduction:true,runtimeVersion:qualifiedRuntimeVersion,dialogueStatus:s.status,hold:s.hold,notice,questionsUsed:s.used,questionsRemaining:2-s.used,
      urgentPriority:urgent,urgentSource:urgent?pkg.urgentHelp.sourceVariantId:null},
    // The full verified general answer stays available before any question or unresolved gate.
    generalHelp:{variantId:general.variant_id,answer:structuredClone(general.payload.answer)},
    conversation:{sessionId:s.id,revision:s.revision,nonce:s.nonce,scope:structuredClone(s.scope),tuple:s.tuple},
    questionsUsed:s.used,questionsRemaining:2-s.used,
    observations:s.ledger.filter(e=>e.status==='active').map(e=>({id:e.id,key:e.key,value:e.value})),
    question:q?{id:q.question.id,text:q.question.question,kind:q.kind,
      options:q.question.data.map(a=>({label:a.label,value:a.value})),
      binding:{sessionId:s.id,revision:s.revision,nonce:s.nonce,questionId:q.question.id,
        scope:structuredClone(s.scope),tuple:s.tuple}}:null,
    documentDelivery:{mode:'guidance_only',availableForms:[],automaticGeneration:false},generationReady:false,categoryClosed:false};
  return response;
}
async function save(file,state) { await commitStore(file,state); }
export async function respondQualified(input,{identity,file,qualifiedPackage:pkg}) {
  if (!isQualifiedPackage(pkg)) fail('PINNED_PACKAGE_REQUIRED');
  if (!input.privateDialogue || !equal(input.privateDialogue.tuple,pkg.tuple)) fail('DIALOGUE_VERSION_MISMATCH');
  if (['facts','observations','referents','documentReview','verifiedSources'].some(k=>own(input,k)||own(input.privateDialogue,k))) fail('CALLER_FACTS_NOT_AUTHORITY');
  const scope=scopeOf(input);
  const statePath=file+'.qualified.json';
  const lock=await acquireStore(statePath,{identity,scope,tuple:pkg.tuple,runtimeVersion:qualifiedRuntimeVersion});
  try {
    let s;
    s=readStore(statePath);
    if (s && (!equal(s.identity,identity)||!equal(s.scope,scope))) fail('CASE_SCOPE_MISMATCH');
    if (s && (!equal(s.tuple,pkg.tuple)||s.schema!=='qualified-session/v2'||s.runtimeVersion!==qualifiedRuntimeVersion)) fail('SESSION_VERSION_UNAVAILABLE');
    if (input.resume) { if(!s)fail('SESSION_NOT_FOUND');return {...structuredClone(s.lastResponse),_historyEnvelope:s.outbox??null}; }
    if (!uuid.test(input.turnId??'') || typeof input.question!=='string' || input.question.length>10000) fail('INVALID_EVENT');
    const eventHash=fingerprint(input);
    if (s?.turns[input.turnId]) {
      const old=s.turns[input.turnId];if(old.hash!==eventHash)fail('TURN_ID_CONFLICT');
      return {...structuredClone(old.response),_historyEnvelope:s.outbox??null};
    }
    const action=input.privateDialogue.action;
    if(s?.outbox)fail('HISTORY_DELIVERY_PENDING');
    if (s) {
      const c=input.conversation;
      if(!c || c.sessionId!==s.id || c.revision!==s.revision || c.nonce!==s.nonce
        || Object.keys(c).some(k=>!['sessionId','revision','nonce','scope','tuple'].includes(k))
        || (own(c,'scope') && !equal(c.scope,s.scope)) || (own(c,'tuple') && !equal(c.tuple,s.tuple)))fail('STALE_STATE');
    } else {
      if (action || input.conversation) fail('SESSION_NOT_FOUND');
      if (!pkg.bundle.subcategories.some(x=>x.stage.id===input.privateDialogue.stageId)) fail('EXPLICIT_STAGE_REQUIRED');
      // Bind a case to its first authenticated chat as well as binding a chat to its case.
      // Opening another chat cannot reset the same user's same-case global2 budget.
      await assertNewCaseUnbound(file,{identity,scope,tuple:pkg.tuple});
      s={schema:'qualified-session/v2',runtimeVersion:qualifiedRuntimeVersion,id:randomUUID(),identity,scope,tuple:pkg.tuple,revision:0,
        nonce:randomUUID(),used:0,asked:[],displayedFields:[],ledger:[],events:[],turns:{},stageId:input.privateDialogue.stageId,
        engine:null,pending:null,projection:null,status:'answer',hold:null};
    }
    if (input.privateDialogue.stageId && input.privateDialogue.stageId!==s.stageId) fail('STAGE_SWITCH_REQUIRES_EXPLICIT_SUPPORTED_ROUTING');
    const source={kind:action?'authenticated_user_action':'authenticated_user_text',turnId:input.turnId,
      questionId:s.pending?.question.id??null,quote:input.question};
    // Deliberately narrow producer. Whole current-user utterances only, not quoted, hypothetical,
    // third-party or assistant text. The binding attests authorship, NOT legal validity of the filing.
    const statementText=input.question.trim().replaceAll('ё','е');
    const referentText='Я хочу разобраться со своим заявлением о несогласии на выезд этого ребенка.';
    const filedTexts=['Я лично подавал заявление о несогласии на выезд этого ребенка.',
      'Я лично подавала заявление о несогласии на выезд этого ребенка.'];
    let reportedStatement=false,reportedConflict=false;
    if (!action && s.stageId==='travel_consent' && s.scope.objectId && s.scope.objectVersion
        && (statementText===referentText || filedTexts.includes(statementText))) {
      s.statementReferent={source,scope:structuredClone(s.scope)};
      if(filedTexts.includes(statementText)) {
        const prior=latest(s,priorKey);
        if(!prior)append(s,priorKey,true,source);
        else if(prior.value!==true) {
          s.events.push({kind:'observation_conflict',id:randomUUID(),key:priorKey,observationId:prior.id,
            previousValue:prior.value,incomingValue:true,actor:s.identity,source,scope:structuredClone(s.scope)});
          s.pending=null;s.status='hold';s.hold='EXPLICIT_CORRECTION_REQUIRED';reportedConflict=true;
        } else s.events.push({kind:'observation_repeat',id:randomUUID(),observationId:prior.id,key:priorKey,value:true,source,scope:structuredClone(s.scope)});
      }
      reportedStatement=true;
    }
    const displayRequest=!action?presentationRequest(input.question):null;
    const reportedDanger=!action && directCurrentDanger(input.question);
    if(reportedDanger) {
      const field=dangerFields[s.stageId];
      const old=field?latest(s,`children_alimony.${s.stageId}.${field}`):null;
      if(old)old.status='superseded_by_current_safety_report';
      append(s,dangerKey,true,source,{operation:'current_status_update'});
    }
    if (action?.kind==='retract' || action?.kind==='correct') {
      const e=s.ledger.find(e=>e.id===action.observationId && e.status==='active');
      if (!e) fail('OBSERVATION_NOT_ACTIVE');
      let changed=true;
      if (action.kind==='correct') changed=append(s,e.key,action.value,source,{operation:'correct'});
      else {
        const id=randomUUID();
        e.status='retracted';s.events.push({kind:'retract',id,key:e.key,observationId:e.id,source});
        if (e.key===priorKey) {
          invalidatePriorIntent(s,e,source,id,'prior_retracted');
          resolvePriorConflicts(s,e.id,id,source);
        }
      }
      if(changed)refresh(s,pkg);
    } else if (action && action.kind!=='answer') fail('UNSUPPORTED_ACTION');
    else {
      let value;
      if (action) {
        if (!s.pending || !equal(action.binding,{sessionId:s.id,revision:s.revision,nonce:s.nonce,
            questionId:s.pending.question.id,scope:s.scope,tuple:s.tuple}) || !tfu(action.value)) fail('STALE_OR_FOREIGN_BUTTON');
        value={value:action.value};
      } else if (s.pending) value=choiceValue(input.question);
      if(reportedConflict) {
        // Keep both user sources and the active old observation until an explicit correction.
      } else if (value) {
        if (s.pending.kind==='private_prior') {
          append(s,priorKey,value.value,source);s.pending=null;runEngine(s,pkg);
        } else {
          const key=`${pkg.policy.categoryId}.${s.pending.stageId}.${s.pending.question.field_key}`;
          const blocked=gateFor(pkg,s,{question:s.pending.question,stage:{stage:{id:s.pending.stageId}}});
          if(blocked)fail(blocked);
          if (key===composite) {
            append(s,intentKey,value.value,source);
            const projected=projectOwnWithdrawal(latest(s,priorKey)?.value,value.value);
            if(projected===undefined)fail('PARTIAL_PROJECTION');
            runEngine(s,pkg,{answer:{value:projected}});
          } else { append(s,key,value.value,source);runEngine(s,pkg,{answer:value}); }
        }
      } else if(displayRequest && s.engine) {
        // A UI acknowledgement/help request is neither a new fact nor a change of subject.
        s.events.push({kind:'presentation_request',request:displayRequest,source});
      } else if (reportedStatement || reportedDanger) {
        refresh(s,pkg);
      } else if (!s.engine) {
        // No free text is silently converted into boolean context or used to seed a row mask.
        runEngine(s,pkg);
      } else {
        s.events.push({kind:'unparsed_user_message',source});
        // A different child/period or unrecognised correction cannot leave a stale yes/no prompt live.
        s.pending=null;s.status='hold';s.hold='FREE_TEXT_NOT_PROJECTED';
      }
    }
    if(s.pending?.kind==='next') {
      const key=`${pkg.policy.categoryId}.${s.pending.stageId}.${s.pending.question.field_key}`;
      if(!s.displayedFields.includes(key))s.displayedFields.push(key);
    }
    s.events.push({kind:'turn',turnId:input.turnId,questionsUsed:s.used,status:s.status});
    s.revision++;s.nonce=randomUUID();
    const response=present(s,pkg,{forceFull:displayRequest==='full',acknowledgement:displayRequest==='ack'});
    s.lastResponse=response;s.turns[input.turnId]={hash:eventHash,response};
    s.outbox={turnId:input.turnId,messageId:response.presentation.responseId,createdAt:new Date().toISOString(),
      question:input.question,answer:[response.answer.content,...response.answer.next.map(q=>q.questionText)].join('\n\n'),
      category:pkg.policy.categoryId,responseId:response.presentation.responseId};
    await save(statePath,s);
    return {...structuredClone(response),_historyEnvelope:s.outbox};
  } finally { await lock.release(); }
}

export async function internalQualified(input,operation,{identity,file,qualifiedPackage:pkg}) {
  const statePath=file+'.qualified.json';
  const lock=await acquireStore(statePath,{identity,tuple:pkg.tuple,runtimeVersion:qualifiedRuntimeVersion});
  try {
    if(operation==='expire'){expireStore(statePath);return {ok:true};}
    let s;
    s=readStore(statePath);if(!s)return null;
    if(!equal(s.identity,identity)||!equal(s.tuple,pkg.tuple)||s.schema!=='qualified-session/v2'||s.runtimeVersion!==qualifiedRuntimeVersion)fail('SESSION_VERSION_UNAVAILABLE');
    if(operation==='pending')return {historyEnvelope:s.outbox??null};
    if(operation==='ack') {
      if(s.outbox?.turnId===input.turnId){s.outbox=null;await save(statePath,s);}
      return {ok:true};
    }
    // Deleting a case is intentionally not an escape hatch for a new question budget in this preview.
    fail('PRIVATE_SESSION_DELETE_REQUIRES_SEPARATE_RETENTION_WORKFLOW');
  }finally{await lock.release();}
}
