import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {fail} from './errors.mjs';
import {episode,currentEpisode,newRound,recordFact,project,subjectFor,caseQuestionsUsed,
 canServeQuestion,serveQuestion,answerQuestionReceipt,bindQuestion} from './state.mjs';
import {validateQuestionDefinition} from './questions.mjs';
import {interpretDetention,detentionPendingValue,normalizeDetention} from './detention-guide-interpret.mjs';
const base=fileURLToPath(new URL('../../../../../',import.meta.url));
const SOURCE='91818a46d822acf0325ef8e1b2dc786034cb0a328e9897746c9978ee6531f149';
const NEXT='16f7cc30629833ab88522ed0b792140d4f0ea1ce569cde73677282ee89f70d22';
const POLICY='1c7c50b6fc8b9df2c4dff87abff31d6c1826cab476e589d17213096b9b12cd71';
const digest=b=>createHash('sha256').update(b).digest('hex'),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const assert=(v,code)=>{if(!v)fail(code,409)},own=(o,k)=>Object.hasOwn(o,k);
const parse=b=>JSON.parse(b.toString('utf8').replace(/^\uFEFF/,''));
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o)}return o};
const escape=t=>String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const signature=(stage,context)=>stage+':'+Object.entries(context).filter(([,v])=>v!==null).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('|');
export function createDetentionGuideProfile({categoryBytes,nextBytes,policyBytes}={}) {
 policyBytes ||= fs.readFileSync(new URL('./policy/detention_guide.v1.json',import.meta.url));
 assert(digest(policyBytes)===POLICY,'DT_POLICY_PIN_MISMATCH');const policy=parse(policyBytes);
 function pinned(bytes,p){assert(bytes.length===p.bytes&&digest(bytes)===p.sha256,'DT_SOURCE_PIN_MISMATCH');return parse(bytes)}
 categoryBytes ||= fs.readFileSync(path.join(base,policy.source.path));nextBytes ||= fs.readFileSync(path.join(base,policy.next.path));
 const bundle=pinned(categoryBytes,policy.source),next=pinned(nextBytes,policy.next);
 assert(policy.source.sha256===SOURCE&&policy.next.sha256===NEXT&&policy.categoryId==='detention_guide','DT_POLICY_INVALID');
 const rows=new Map(),stages=new Map(),fields=new Map(policy.fields.map(f=>[f.fieldKey,f])),blocked=new Set(policy.blockedFields),material=new Map(),effects=new Map();
 assert(bundle.category.id==='detention_guide'&&bundle.subcategories.length===8&&next.category==='detention_guide','DT_CATEGORY_INVALID');
 // Only these exact private bytes are admitted. Do not alter the public validator or normalize source order.
 assert(equal(Object.keys(bundle).sort(),['artifact_kind','assembly_id','canonical_stage_order','category','metadata','readiness','schema_version','source','stage_count','subcategories','variant_count']),'DT_PRIVATE_ENVELOPE');
 for(const s of bundle.subcategories){stages.set(s.stage.id,s);const keys=s.context_fields.map(f=>f.id),effect={};
  for(const f of s.context_fields)assert(fields.has('detention_guide.'+s.stage.id+'.'+f.id),'DT_FIELD_INVALID');
  for(const v of s.variants){
   assert(!rows.has(v.variant_id)&&equal(Object.keys(v.context).sort(),[...keys].sort())&&Object.values(v.context).every(x=>[true,false,null].includes(x))&&v.payload.next.length===0,'DT_ROW_INVALID');
   rows.set(v.variant_id,{row:v,stage:s});const k=signature(s.stage.id,v.context);assert(!material.has(k),'DT_MATERIAL_COLLISION');material.set(k,v.variant_id);
   for(const [f,value]of Object.entries(v.context))if(value!==null)(effect[f]||=(new Set())).add(value);
  }effects.set(s.stage.id,effect);
 }
 assert(rows.size===472&&fields.size===48&&policy.bindings.length===472&&blocked.size===6,'DT_INVENTORY_INVALID');
 for(const b of policy.bindings){const found=rows.get(b.variantId);assert(found&&equal(found.row.context,b.context)&&digest(JSON.stringify(found.row.payload.answer))===b.answerSha256&&signature(b.stageId,b.context)===b.materialKey,'DT_BINDING_INVALID')}
 const questions=new Map(policy.questions.map(q=>[q.id,q])),stagePolicy=new Map(policy.stages.map(s=>[s.stageId,s]));
 const questionEngine={bundle,rowFor(id){assert(rows.has(id),'DT_UNKNOWN_ID');return rows.get(id)}};
 assert(questions.size===17&&policy.maxQuestionsPerCase===2&&equal(policy.thirdQuestionReasons,{}),'DT_QUESTION_POLICY');
 for(const s of next.stages)for(const q of s.questions){const p=questions.get(q.question_key);assert(p&&p.fieldKey==='detention_guide.'+s.stage.id+'.'+q.field&&p.text===q.wording&&equal(p.controls,q.controls),'DT_NEXT_BINDING');validateQuestionDefinition({id:p.id,branches:p.controls.map(c=>({value:c.value,kind:'stage',stageId:s.stage.id}))},questionEngine)}
 let controls=0,terminals=0;for(const s of next.stages){const nodes=new Map(s.nodes.map(n=>[n.node_key,n]));for(const n of s.nodes)for(const c of n.controls){controls++;assert(questions.has(n.question_key),'DT_NODE_QUESTION');assert(equal(c.meaning,questions.get(n.question_key).controls.find(a=>a.value===c.value)?.meaning),'DT_MEANING_MIRROR');if(c.next_question)assert(nodes.has(c.next_question),'DT_NODE_TARGET');else{terminals++;const found=rows.get(c.go_to_variant);assert(found&&Object.entries(found.row.context).every(([k,v])=>v===null||c.requires_trusted_observations?.[k]===v),'DT_TERMINAL_MASK')}}}
 assert(controls===123&&terminals===90,'DT_GRAPH_COUNTS');
 const blockedRows=new Set([...rows].filter(([,r])=>Object.entries(r.row.context).some(([k,v])=>v!==null&&blocked.has('detention_guide.'+r.stage.stage.id+'.'+k))).map(([id])=>id));
 assert(blockedRows.size===136,'DT_HELD_ROWS');freeze(bundle);freeze(next);freeze(policy);
 function compatible(id,facts){const found=rows.get(id);return !!found&&!blockedRows.has(id)&&Object.entries(found.row.context).every(([k,v])=>v===null||facts['detention_guide.'+found.stage.stage.id+'.'+k]===v)}
 function resolve(stage,facts={}){
  const spec=stagePolicy.get(stage);if(!spec)return {variantId:null,specializationHeld:true};
  const context={},effect=effects.get(stage);let qualified=false;
  for(const [key,value]of Object.entries(facts)){if(!key.startsWith('detention_guide.'+stage+'.'))continue;const id=key.split('.').at(-1);if(value!==null&&blocked.has(key)){qualified=true;continue}if([true,false].includes(value)&&effect[id]?.has(value))context[id]=value}
  // Accepted bounded general: refusal evidence never manufactures a missing lawyer request.
  if(stage==='lawyer_and_call'&&context.lawyer_access_refused===true&&facts['detention_guide.lawyer_and_call.lawyer_requested']!==true&&Object.keys(context).length===1)return {variantId:spec.generalId,specializationHeld:true,boundedGeneral:true};
  const id=material.get(signature(stage,context));
  return id&&compatible(id,facts)&&!qualified?{variantId:id,specializationHeld:false}:{variantId:spec.generalId,specializationHeld:true};
 }
 function initSubjects(s){const e=currentEpisode(s);e.categorySubjects||={};for(const group of new Set(policy.fields.map(f=>f.group)))if(!e.categorySubjects[group]){const id=group==='person'?e.personId:randomUUID();e.categorySubjects[group]={current:id,items:[{id,label:'first'}]}}}
 function prepareState(s){
  assert(!s.categoryId||s.categoryId==='detention_guide','DT_SAVED_CATEGORY_MISMATCH');assert(!s.dtPolicyVersion||s.dtPolicyVersion===policy.version,'DT_POLICY_VERSION_UNAVAILABLE');
  s.categoryId='detention_guide';s.categoryFieldKeys=[...fields.keys()];s.categoryBlockedFields=[...blocked];s.categoryScopeGroups=Object.fromEntries(policy.fields.map(f=>[f.fieldKey,f.group]));s.policyVersion=policy.version;s.dtPolicyVersion=policy.version;initSubjects(s);
 }
 function retire(s,why,source={}){if(s.pending){answerQuestionReceipt(s,s.pending,null,{kind:why,...source});const r=s.caseState.served.find(r=>r.id===s.pending.receiptId);if(r)r.answer.disposition=why;s.pending=null}}
 function selectSubject(s,group,label){initSubjects(s);const map=currentEpisode(s).categorySubjects[group];assert(map&&label,'DT_SUBJECT_INVALID');let item=map.items.find(x=>x.label===label);if(!item){assert(map.items.length<32,'DT_SUBJECT_LIMIT');item={id:randomUUID(),label};map.items.push(item)}if(item.id!==map.current){retire(s,'subject_changed');newRound(s,'dt-subject');map.current=item.id;s.nonce=randomUUID()}return item.id}
 function sourceFor(s,f){return {...f.source,caseId:s.caseState.id,episodeId:s.activeEpisodeId,subjectId:subjectFor(s,f.fieldKey),personId:currentEpisode(s).personId,actor:currentEpisode(s).actor,revision:s.revision,sourceSha256:SOURCE,nextSha256:NEXT,policyVersion:policy.version}}
 function admit(s,f,{mirror=true}={}){
  if(!fields.has(f.fieldKey)||blocked.has(f.fieldKey))return null;
  const source=sourceFor(s,f),old=s.factLedger.findLast(x=>x.fieldKey===f.fieldKey&&x.subjectId===source.subjectId&&x.episodeId===s.activeEpisodeId&&['active','conflicted'].includes(x.status));
  const stored=recordFact(s,f.fieldKey,f.value,source,f.operation||'assert',f.dependencies||[]);
  if(old&&old.id!==stored.id){const invalid=new Set([old.id]);let changed=true;while(changed){changed=false;for(const d of s.factLedger)if(d.status==='active'&&d.dependencies?.some(id=>invalid.has(id))){d.status='invalidated';invalid.add(d.id);changed=true}}}
  if(['correct','withdraw','later'].includes(f.operation))for(const prior of s.factLedger)if(prior.id!==stored.id&&prior.episodeId===s.activeEpisodeId&&prior.subjectId===source.subjectId&&prior.fieldKey===f.fieldKey&&prior.status==='conflicted')prior.status='superseded';
  if(stored.status==='conflicted'){s.dtConflict=f.fieldKey;return stored;}
  if(mirror&&f.fieldKey.endsWith('.lawyer_requested')){
   const other=f.fieldKey.includes('.first_words.')?'detention_guide.lawyer_and_call.lawyer_requested':'detention_guide.first_words.lawyer_requested';
   // Explicit same current person/case/request subject and same observation, not equality of short names.
   if(subjectFor(s,other)===source.subjectId)admit(s,{...f,fieldKey:other,source:{...source,kind:'same_request_reuse',originFieldKey:f.fieldKey},dependencies:[stored.id]},{mirror:false});
  }
  return stored;
 }
 function asked(s,q){return s.caseState.served.some(r=>r.caseId===s.caseState.id&&r.episodeId===s.activeEpisodeId&&r.subjectId===subjectFor(s,q.fieldKey)&&r.fieldKey===q.fieldKey&&r.status==='answered')}
 function eligible(s,q){return !blocked.has(q.fieldKey)&&!own(project(s,q.stageId),q.fieldKey)&&!asked(s,q)}
 function useful(s,q){const facts=project(s,q.stageId),before=resolve(q.stageId,facts);return q.controls.some(c=>resolve(q.stageId,{...facts,[q.fieldKey]:c.value}).variantId!==before.variantId)}
 function selection(s,stage){const e=currentEpisode(s);return stage==='search_and_seizure'&&e.dtReturnedSearchSubjects?.includes(subjectFor(s,'detention_guide.search_and_seizure.phone_seized'))?{variantId:stagePolicy.get(stage).generalId,specializationHeld:true}:resolve(stage,project(s,stage))}
 function plan(s){
  const e=currentEpisode(s);if(e.actor!=='police'||!e.dtStageConfirmed||!stages.has(e.stageId))return {variantId:null,question:null,specializationHeld:true};
  const facts=project(s,e.stageId),selected=selection(s,e.stageId);const conflict=s.factLedger.some(f=>f.episodeId===e.id&&f.subjectId===subjectFor(s,f.fieldKey)&&f.status==='conflicted');
  let q=null;if(!s.dtDeclined&&caseQuestionsUsed(s)<2&&!conflict){let ids=stagePolicy.get(e.stageId).questionIds;if(e.dtIssue==='copy')ids=[...ids].sort((a,b)=>Number(b.endsWith('-q2'))-Number(a.endsWith('-q2')));q=ids.map(id=>questions.get(id)).find(q=>eligible(s,q)&&useful(s,q))||null}
  return {...selected,question:q,specializationHeld:selected.specializationHeld||conflict};
 }
 const serviceText={actor:'С вами сейчас взаимодействует сотрудник полиции?',describe:'Опишите, пожалуйста, что происходит с вами сейчас.',subject:'О каком вашем документе или действии сейчас речь?',conflict:'Уточните, пожалуйста, какое из ваших прежних сообщений об этом событии нужно исправить.'};
 function setPending(s,q,kind='next',key=q.id,fieldKey=q.fieldKey){const p={kind,key,fieldKey,stageId:currentEpisode(s).stageId,question:q};if(canServeQuestion(s,p,{}))s.pending=p}
 function serviceQuestion(s,key,fieldKey=null){const q={id:'DT-service-'+key,text:serviceText[key],controls:key==='actor'?[{value:true,label:'Да'},{value:false,label:'Нет'},{value:null,label:'Не знаю'}]:[]};setPending(s,q,'service',key,fieldKey)}
 function dispatch(s,input){
  const action=input.guided?.native,text=input.question||'',prior=s.pending;let e=currentEpisode(s),parsed=interpretDetention(s,text,input.turnId),notice=null;
  if(input.variantId)assert(rows.has(input.variantId),'DT_UNKNOWN_ID');
  if(action){assert(prior&&action.kind==='answer'&&action.questionId===prior.question.id&&action.receiptId===prior.receiptId&&action.policyVersion===policy.version&&action.sourceSha256===SOURCE&&action.nextSha256===NEXT,'STALE_ACTION');assert(prior.question.controls.some(c=>c.value===action.value&&normalizeDetention(c.label)===normalizeDetention(text)),'DT_UNOFFERED_ANSWER')}
  const reply=action?{value:action.value}:detentionPendingValue(prior,text);
  if(reply&&prior){assert(bindQuestion(s,prior),'STALE_ACTION');const f={fieldKey:prior.fieldKey,value:reply.value,source:{kind:action?'button':'user_text',turnId:input.turnId,questionId:prior.question.id,receiptId:prior.receiptId,quote:text,span:[0,Array.from(text).length]}};
   if(prior.kind==='next'){admit(s,f);if(prior.fieldKey.endsWith('.copy_refused')&&reply.value!==null){e.dtCopyRequests||={};e.dtCopyRequests[subjectFor(s,prior.fieldKey)]={...f.source,confirmed:true}}}else if(prior.key==='actor'){if(reply.value===true)e.actor='police';else{s.dtDeclined=true;e.actor=reply.value===false?'other':null}}
   answerQuestionReceipt(s,prior,reply.value,sourceFor(s,f));s.pending=null;
  }else if(!parsed.excluded){
   if(parsed.newCase){retire(s,'explicit_new_case',parsed.source);episode(s,'new-case');prepareState(s);newRound(s,'dt-new-case');e=currentEpisode(s);s.dtDeclined=false;s.dtConflict=null}
   if(parsed.stop){retire(s,'declined',parsed.source);s.dtDeclined=true}
   if(parsed.resume)s.dtDeclined=false;
   if(parsed.urgent)e.dtUrgent={source:parsed.source,active:true};
   if(parsed.urgentEnded)e.dtUrgent={source:parsed.source,active:false};
   if(parsed.actor==='other'||parsed.ambiguousActor||parsed.foreignSubject||parsed.ambiguousSubject){e.dtUnboundObservations||=[];e.dtUnboundObservations.push({...parsed.source,caseId:s.caseState.id,episodeId:e.id,disposition:'UNBOUND_SCOPE_NOT_FACT'});retire(s,'scope_ambiguity',parsed.source);e.dtScopeHeld=true;if(parsed.actor==='other')e.actor='other';notice='scope_hold'}
   else{
    e.dtScopeHeld=false;
    if(parsed.actor)e.actor=parsed.actor;
    if(parsed.stage&&stages.has(parsed.stage)){if(e.stageId&&e.stageId!==parsed.stage){retire(s,'stage_changed',parsed.source);newRound(s,'dt-stage')}e.stageId=parsed.stage;e.dtStageConfirmed=true}
    initSubjects(s);
    if(parsed.subjectReference)selectSubject(s,'document',parsed.subjectReference);
    if(parsed.newRequest)selectSubject(s,'lawyer_request','request-'+input.turnId);
    if(parsed.newSearch)selectSubject(s,'search','search-'+input.turnId);
    if(parsed.urgent)e.dtUrgent={source:parsed.source,active:true};
    if(parsed.urgentEnded)e.dtUrgent={source:parsed.source,active:false};
    if(/копи[юяи]/iu.test(text))e.dtIssue='copy';
    e.dtRawObservations||=[];e.dtRawObservations.push({...parsed.source,caseId:s.caseState.id,episodeId:e.id,stageId:e.stageId||null,revision:s.revision,disposition:'RAW_NOT_CONTEXT',scopeSnapshot:structuredClone(e.categorySubjects),subjectId:subjectFor(s,'detention_guide.'+e.stageId+'.x')});
    if(e.actor==='police'&&e.dtStageConfirmed){
     if(parsed.withdraw){
      const latest=s.factLedger.findLast(f=>f.episodeId===e.id&&['active','conflicted'].includes(f.status)&&f.subjectId===subjectFor(s,f.fieldKey)&&f.source.kind!=='same_request_reuse');
      const fields=parsed.withdrawFields?.length?parsed.withdrawFields:latest?[...new Set(s.factLedger.filter(f=>f.episodeId===e.id&&f.subjectId===subjectFor(s,f.fieldKey)&&f.source.turnId===latest.source.turnId&&f.source.kind!=='same_request_reuse'&&['active','conflicted'].includes(f.status)).map(f=>f.fieldKey))]:[];
      if(fields.length===1)admit(s,{fieldKey:fields[0],value:null,operation:'withdraw',source:parsed.source});
      else {e.dtUnboundObservations||=[];e.dtUnboundObservations.push({...parsed.source,disposition:'AMBIGUOUS_WITHDRAWAL_NOT_APPLIED'});notice='withdrawal_ambiguous'}
      retire(s,'withdrawn',parsed.source);
     }
     for(const f of parsed.facts)admit(s,f);
     const doc=subjectFor(s,'detention_guide.protocols_and_copies.copy_refused');e.dtCopyRequests||={};
     if(parsed.copyRequested)e.dtCopyRequests[doc]={...parsed.source,confirmed:true};
     if(parsed.copyNotRequested){e.dtCopyRequests[doc]={...parsed.source,confirmed:false};const existing=s.factLedger.findLast(f=>f.fieldKey==='detention_guide.protocols_and_copies.copy_refused'&&f.subjectId===doc&&f.status==='active');if(existing)existing.status='invalidated'}
     if(parsed.copyResult&&e.dtCopyRequests[doc]?.confirmed)admit(s,{fieldKey:'detention_guide.protocols_and_copies.copy_refused',value:parsed.copyResult.value,operation:parsed.copyResult.value===false?'later':'assert',source:parsed.copyResult.source});
     // Later return after actual retention is a timed private event, not retroactive denial.
     if(parsed.laterPhoneReturn||parsed.laterItemsReturn){e.dtLaterReturns||=[];e.dtLaterReturns.push({phone:!!parsed.laterPhoneReturn,items:!!parsed.laterItemsReturn,source:parsed.source});e.dtReturnedSearchSubjects||=[];e.dtReturnedSearchSubjects.push(subjectFor(s,'detention_guide.search_and_seizure.phone_seized'))}
    }
    if(prior&&s.pending===prior){if(prior.kind==='service')retire(s,'service_description',parsed.source);else if(parsed.facts.some(f=>f.fieldKey===prior.fieldKey)||parsed.withdraw)retire(s,'answered_by_observation',parsed.source);else if(!parsed.repeat&&!parsed.documentRequest&&!parsed.confused)retire(s,'UNPARSED_NOT_A_FACT',parsed.source)}
   }
  }else {e.dtRawObservations||=[];e.dtRawObservations.push({...parsed.source,caseId:s.caseState.id,episodeId:e.id,disposition:'NONASSERTED_NOT_CONTEXT'});if(prior)retire(s,'HYPOTHETICAL_NOT_A_FACT',parsed.source);}
  let planned=plan(s);if(e.dtScopeHeld||e.actor==='other')planned={variantId:null,question:null,specializationHeld:true};
  if(s.pending?.kind==='next'&&!eligible(s,s.pending.question))retire(s,'no_longer_missing',parsed.source);
  if(!s.pending&&!s.dtDeclined&&caseQuestionsUsed(s)<2){
   if(e.dtScopeHeld)serviceQuestion(s,'subject');
   else if(e.actor!=='police')serviceQuestion(s,'actor');
   else if(s.dtConflict){const f=s.factLedger.findLast(f=>f.fieldKey===s.dtConflict&&f.status==='conflicted');if(f){serviceQuestion(s,'conflict',f.fieldKey);s.dtConflict=null}}
   else if(planned.question)setPending(s,planned.question);
   else if(!planned.variantId)serviceQuestion(s,'describe');
  }
  if(parsed.documentRequest)notice='document_unavailable';if(planned.specializationHeld)notice||='specialization_hold';if(parsed.confused)notice='question_confusion';
  const additional=[];
  if(!e.dtScopeHeld&&e.actor==='police'&&!parsed.excluded)for(const stage of new Set(parsed.repeat?(e.dtAdditionalStages||[]):parsed.facts.map(f=>f.fieldKey.split('.')[1]))){if(stage===e.stageId||!stages.has(stage))continue;const extra=selection(s,stage);additional.push({...extra,stageId:stage})}
  if(additional.length)e.dtAdditionalStages=additional.map(x=>x.stageId);else if(parsed.stage&&!parsed.repeat)e.dtAdditionalStages=[];
  return {...planned,additional,notice,forceFull:parsed.repeat};
 }
 function present(s,outcome,{turnId=null,forceFull=false}={}){
  const e=currentEpisode(s),responseId=randomUUID(),id=outcome.variantId,row=id&&rows.get(id)?.row;let pending=s.pending;
  if(pending&&!serveQuestion(s,pending,responseId,turnId||'resume-'+responseId,{})){s.pending=null;pending=null}
  const extras=(outcome.additional||[]).map(x=>({outcome:x,row:rows.get(x.variantId)?.row})).filter(x=>x.row),a=row?.payload.answer,scope=policy.fields.filter(f=>f.stageId===e.stageId).map(f=>subjectFor(s,f.fieldKey)),fingerprint=a&&digest(JSON.stringify([a,s.caseState.id,e.id,scope])),same=a&&s.presentation.lastFull===fingerprint,full=a&&(!same||forceFull||outcome.forceFull),content=[];
  s.presentation.dtSupplemental||={};const shownExtras=extras.filter(x=>{const stage=x.outcome.stageId,scope=policy.fields.filter(f=>f.stageId===stage).map(f=>subjectFor(s,f.fieldKey)),fp=digest(JSON.stringify([x.row.payload.answer,s.caseState.id,e.id,scope]));if(s.presentation.dtSupplemental[fp]&&!forceFull&&!outcome.forceFull)return false;s.presentation.dtSupplemental[fp]=responseId;return true});
  if(e.dtUrgent?.active){const r=policy.safetyReferences.find(r=>r.kind==='health');content.push(rows.get(r.variantId).row.payload.answer[r.part][r.index])}
  if(e.stageId==='search_and_seizure'&&e.dtReturnedSearchSubjects?.includes(subjectFor(s,'detention_guide.search_and_seizure.phone_seized')))content.push('Учёл сообщение о возврате вещей. Предыдущее изъятие сохранено в истории; дальнейшие действия по возвращённым вещам требуют уточнения.');
  if(e.actor==='police'){const r=policy.safetyReferences.find(r=>r.kind==='safety');if(full||!row)content.push(rows.get(r.variantId).row.payload.answer[r.part][r.index])}
  if(outcome.notice==='document_unavailable')content.push('Открытие и подготовка документов здесь пока недоступны. Доступные действия по вашей ситуации остаются ниже.');
  if((outcome.specializationHeld||extras.some(x=>x.outcome.specializationHeld))&&row)content.push('Часть обстоятельств пока не подтверждена. Ниже доступные общие действия; известные вам сведения сохранены.');
  if(outcome.notice==='withdrawal_ambiguous')content.push('Не удалось определить, какое прежнее сообщение вы отзываете. Можно указать его своими словами.');
  if(outcome.notice==='question_confusion')content.push('Можно описать происходящее своими словами или оставить это неизвестным.');
  if(full){content.push(a.now,...a.steps,...a.dont,...a.say,...a.laws.map(l=>l.ref+': '+l.short+' ('+l.url+')'));s.presentation.lastFull=fingerprint;s.presentation.lastFullResponseId=responseId}
  if(shownExtras.length)for(const extra of shownExtras){const a=extra.row.payload.answer;content.push(a.now,...a.steps,...a.dont,...a.say,...a.laws.map(l=>l.ref+': '+l.short+' ('+l.url+')'));}
  else if(!full&&row&&!pending)content.push(caseQuestionsUsed(s)>=2?'Лимит уточнений достигнут. Действия из памятки выше остаются доступны; новые сведения можно добавить сообщением.':'Эти сведения уже учтены. Если ситуация изменилась, расскажите об этом.');

  if(!row&&!content.length)content.push('Пока не удалось установить вашу ситуацию. Опишите, что происходит с вами сейчас.');
  const native={kind:'answer',sessionId:s.id,nonce:s.nonce,revision:s.revision,episodeId:e.id,roundId:s.round?.id,policyVersion:policy.version,sourceSha256:SOURCE,nextSha256:NEXT,questionId:pending?.question.id,receiptId:pending?.receiptId};
  const groups=pending?[{type:pending.question.controls.length?'choice':'text',questionText:pending.question.text,questionId:pending.question.id,view:pending.question.controls.map(c=>({question:c.label,title:c.label,guided:{native:{...native,value:c.value}}}))}]:[];
  return {conversation:{sessionId:s.id,revision:s.revision,version:s.version,nonce:s.nonce},presentation:{responseId,mode:(full||shownExtras.length)?'full':row?'continuation':'boundary',referencesResponseId:full?null:s.presentation.lastFullResponseId||null,questionsUsed:caseQuestionsUsed(s),policyVersion:policy.version},answer:{category:'detention_guide',variantId:id||undefined,content:content.map(escape).join('\n\n'),next:groups,sections:(full||shownExtras.length)?{laws:structuredClone([...(full?[a]:[]),...shownExtras.map(x=>x.row.payload.answer)].flatMap(a=>a.laws)),documents:structuredClone([...(full?[a]:[]),...shownExtras.map(x=>x.row.payload.answer)].flatMap(a=>a.where_to)),documentActionsUnavailable:true}:undefined},dialogue:{stageId:e.stageId||null,questionId:pending?.question.id||null,terminal:pending?null:id?'variant':'boundary',specializationHeld:!!outcome.specializationHeld||extras.some(x=>x.outcome.specializationHeld)}};
 }
 return Object.freeze({categoryId:'detention_guide',version:policy.version,sourceSha256:SOURCE,nextSha256:NEXT,bundle,policy,next,blockedVariantIds:Object.freeze([...blockedRows]),validate(candidate,sha){assert(sha===SOURCE&&equal(candidate,bundle),'DT_SOURCE_VERSION_UNAVAILABLE')},prepareState,selectSubject,admit,compatible,resolve,plan,dispatch,present,rowFor(id){assert(rows.has(id),'DT_UNKNOWN_ID');return rows.get(id)}});
}
