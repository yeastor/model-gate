import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {fail} from './errors.mjs';
import {episode,currentEpisode,newRound,project,recordFact,caseQuestionsUsed,
 subjectFor,bindQuestion,serveQuestion,answerQuestionReceipt,canServeQuestion} from './state.mjs';
import {interpretDps,dpsPendingValue,normalizeDpsText} from './dps-interpret.mjs';
import {createDpsQualifications,dpsEvidenceScope} from './dps-qualifications.mjs';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const POLICY_SHA='25422cb485269cd26ba1daaa9a0a74879355acf08388d1a42715a19c39b4e1bf';
const SOURCE_SHA='1be540a5d06d3798462c83564d81ce3289cd4e50c383fcd19d572584b7682af2';
const NEXT_SHA='ea74da6a787a527a4a2488b260be4d8f89cbab1aaf975de69025d8b2b734a791';
const digest=b=>createHash('sha256').update(b).digest('hex');
const own=(o,k)=>Object.hasOwn(o,k);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const parse=b=>JSON.parse(b.toString('utf8').replace(/^\uFEFF/,''));
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};
const escape=t=>String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const assert=(test,code)=>{if(!test)fail(code,409)};
function pinned(bytes,pin){assert(bytes.length===pin.bytes&&digest(bytes)===pin.sha256,'DPS_SOURCE_PIN_MISMATCH');return parse(bytes)}
export function createDpsProfile({categoryBytes,nextBytes,policyBytes,verifyReview,reviewedEvidenceProvider}={}) {
 policyBytes ||= fs.readFileSync(new URL('./policy/dps.v3.json',import.meta.url));
 assert(digest(policyBytes)===POLICY_SHA,'DPS_POLICY_PIN_MISMATCH');
 const policy=parse(policyBytes);
 const qualifications=createDpsQualifications({sourceSha256:SOURCE_SHA,policySha256:digest(policyBytes),verifyReview});
 assert(policy.schemaVersion==='dps-private-dialogue/v1'&&policy.source.sha256===SOURCE_SHA&&policy.next.sha256===NEXT_SHA,'DPS_POLICY_INVALID');
 categoryBytes ||= fs.readFileSync(path.join(root,policy.source.path));
 nextBytes ||= fs.readFileSync(path.join(root,policy.next.path));
 const bundle=pinned(categoryBytes,policy.source),next=pinned(nextBytes,policy.next);
 assert(bundle.category.id==='dps'&&bundle.metadata.format_version==='mvp_v3_next_chips_yes_no'&&next.category_id==='dps','DPS_SCHEMA_INVALID');
 // The accepted source is a pinned private assembly, not the public v2 envelope.
 assert(equal(Object.keys(bundle).sort(),['artifact_kind','assembly_id','canonical_stage_order','category','metadata','readiness','schema_version','source','stage_count','subcategories','variant_count'])&&bundle.subcategories.length===8,'DPS_ENVELOPE_INVALID');
 const rows=new Map(),fields=new Map(),stages=new Map();
 for(const s of bundle.subcategories){
  assert(equal(Object.keys(s).sort(),['context_fields','stage','variants']),'DPS_STAGE_SCHEMA_INVALID');
  stages.set(s.stage.id,s);
  const keys=s.context_fields.map(f=>f.id);
  for(const f of s.context_fields)fields.set('dps.'+s.stage.id+'.'+f.id,f);
  for(const v of s.variants){
   // Exact private-source exception: these six pinned historical masks omit a
   // held predicate. Absence constrains no outcome; it never becomes false or a
   // runtime observation. This reader does not certify the public JSON contract.
   const expectedKeys=s.stage.id==='document_check'&&/^dps_document_check_v(?:35|36|37|38|39|40)$/u.test(v.variant_id)
     ? keys.filter(k=>k!=='required_document_missing') : keys;
   assert(equal(Object.keys(v).sort(),['context','payload','question','variant_id'])&&equal(Object.keys(v.context).sort(),[...expectedKeys].sort())&&Object.values(v.context).every(v=>[true,false,null].includes(v)),'DPS_ROW_SCHEMA_INVALID');
   assert(!rows.has(v.variant_id)&&Array.isArray(v.payload.next)&&v.payload.next.length===0,'DPS_ID_OR_INLINE_NEXT_INVALID');
   rows.set(v.variant_id,{row:v,stage:s});
  }
 }
 assert(rows.size===83&&fields.size===51&&policy.bindings.length===83,'DPS_INVENTORY_INVALID');
 for(const b of policy.bindings){const found=rows.get(b.variantId);assert(found&&found.stage.stage.id===b.stageId&&equal(found.row.context,b.context)&&digest(JSON.stringify(found.row.payload.answer))===b.answerSha256,'DPS_BINDING_INVALID')}
 const questions=new Map(policy.questions.map(q=>[q.id,q]));
 assert(questions.size===43&&policy.serviceEntries.length===73&&policy.maxQuestionsPerCase===2&&equal(policy.thirdQuestionReasons,{}),'DPS_POLICY_COUNTS_INVALID');
 for(const q of next.stages.flatMap(s=>s.questions)){
  const p=policy.questions.find(p=>p.fieldKey===q.field_key);
  assert(p&&p.text===q.question_text&&equal(p.requires,q.requires||[])&&equal(p.controls.map(c=>c.value),q.answers)&&fields.has(q.field_key),'DPS_NEXT_BINDING_INVALID');
 }
 const entries=new Map(policy.serviceEntries.map(e=>[e.id,e]));
 const tables=new Map(policy.tables.map(t=>[t.stageKey.slice(4),t]));
 const blocked=new Set(policy.blockedFields);
 const blockedRows=new Set([...rows].filter(([,{row,stage}])=>policy.blockedVariants.includes(row.variant_id)||Object.entries(row.context).some(([k,v])=>v!==null&&blocked.has('dps.'+stage.stage.id+'.'+k))).map(([id])=>id));
 freeze(bundle);freeze(policy);freeze(next);
 const plain=(stage,facts)=>Object.fromEntries(Object.entries(facts).map(([k,v])=>[k.startsWith('dps.'+stage+'.')?k.slice(stage.length+5):k,v]));
 function guard(row,f){
  const id=row.variant_id,n=Number(id.split('_v').at(-1));
  if(id.startsWith('dps_stop_reason_')&&n!==190){
   for(const k of ['reason_later_explained','reason_requested_and_refused','exit_demanded','exit_proposed'])if(f[k]===true&&row.context[k]!==true)return false;
   if(f.reason_explanation_requested===true&&n>=155&&n<=161)return false;
   if(row.context.exit_proposed===true&&row.context.exit_demanded===null&&f.exit_demanded!==false)return false;
  }
  if(id.startsWith('dps_alcohol_test_')&&![61,63,64,66,68,69,70].includes(n)&&f.medical_exam_requested===true)return false;
  if(id.startsWith('dps_document_check_')&&n!==35)for(const k of ['documents_return_refused_after_check','documents_later_returned'])if(f[k]===true&&row.context[k]!==true)return false;
  if((id.startsWith('dps_protocol_')&&n!==77||id.startsWith('dps_fine_resolution_')&&n!==43)&&f.copy_refused===true&&row.context.copy_refused!==true)return false;
  if(id.startsWith('dps_vehicle_detention_')&&n!==129){if(f.vehicle_return_refused===true&&row.context.vehicle_return_refused!==true)return false;if(f.payment_required_before_return===true&&f.vehicle_return_refused===true&&row.context.payment_required_before_return!==true)return false}
  return true;
 }
 function resolve(stage,facts={},evidence=[]){
  const table=tables.get(stage);if(!table)return null;const f=plain(stage,facts);
  for(const r of table.rows){const row=rows.get(r.variantId).row;if((!blockedRows.has(row.variant_id)||evidence.length&&qualifications.allows(row,evidence,f))&&Object.entries(row.context).every(([k,v])=>v===null||f[k]===v)&&guard(row,f))return row.variant_id}
  return table.entryVariantId;
 }
 function eligible(stage,facts,asked=[]){
  const order=tables.get(stage).questionPriority;
  return policy.questions.filter(q=>q.stageId===stage&&!blocked.has(q.fieldKey)&&!own(facts,q.fieldKey)&&!asked.includes(q.id)&&q.requires.every(d=>facts[d.field_key]===d.value))
   .sort((a,b)=>order.indexOf(a.fieldKey)-order.indexOf(b.fieldKey));
 }
 function useful(stage,facts,q,remaining,asked=[]){
  const base=resolve(stage,facts);
  function changes(f,left,used){if(resolve(stage,f)!==base)return true;if(left===0)return false;return eligible(stage,f,used).some(q=>q.controls.some(c=>changes({...f,[q.fieldKey]:c.value},left-1,[...used,q.id])))}
  return q.controls.some(c=>changes({...facts,[q.fieldKey]:c.value},remaining-1,[...asked,q.id]));
 }
 function plan(s){
  const e=currentEpisode(s),stage=e.stageId;if(!stages.has(stage)||!e.dpsStageConfirmed||!e.dpsSubjects?.[stage]||!(e.actor==='traffic_police'||stage==='accident_processing'&&e.dpsOwnAccident))return {variantId:null,question:null};
  if(reviewedEvidenceProvider){const batch=reviewedEvidenceProvider({scope:dpsEvidenceScope(s,stage),sourceSha256:SOURCE_SHA,policySha256:digest(policyBytes)});if(!Array.isArray(batch))throw Error('DPS_REVIEW_PROVIDER_CONTRACT');for(const r of batch)qualifications.record(s,r);}
  const evidence=qualifications.current(s,stage),facts=project(s,stage);
  for(const[k,v]of Object.entries(qualifications.facts(evidence)))facts[k]=own(facts,k)&&facts[k]!==v?null:v;
  const variantId=resolve(stage,facts,evidence),remaining=2-caseQuestionsUsed(s);
  if(remaining<=0||s.dpsDeclined)return {variantId,question:null};
  const asked=s.caseState.served.filter(r=>r.episodeId===e.id&&r.subjectId===subjectFor(s,'dps.'+stage+'.x')&&r.status==='answered').map(r=>r.questionId);
  const q=eligible(stage,facts,asked).find(q=>useful(stage,facts,q,remaining,asked));
  return {variantId,question:q||null};
 }
 function prepareState(s){
  assert(!s.categoryId||s.categoryId==='dps','DPS_SAVED_CATEGORY_MISMATCH');
  s.categoryId='dps';s.dpsFieldKeys=[...fields.keys()];s.dpsBlockedFields=[...blocked];
  s.policyVersion=policy.version;
  if(s.dpsPolicyVersion!==policy.version){s.dpsPolicyVersion=policy.version;s.pending=null;s.lastResponse=null;s.nonce=randomUUID()}
 }
 function selectSubject(s,stage,reference=null){
  const e=currentEpisode(s);e.dpsSubjects ||= {};
  let map=e.dpsSubjects[stage];
  if(!map){const first=randomUUID();map=e.dpsSubjects[stage]={current:first,items:[{id:first,label:'first'}]}}
  if(reference){
   const label=reference==='new'?'item'+(map.items.length+1):reference;
   let item=map.items.find(i=>i.label===label);
   if(!item){assert(map.items.length<32,'DPS_SUBJECT_LIMIT');item={id:randomUUID(),label};map.items.push(item)}
   if(item.id!==map.current){newRound(s,'dps-subject');map.current=item.id;s.nonce=randomUUID()}
  }
  return map.current;
 }
 function sourceFor(s,source){return{...source,actor:currentEpisode(s).actor,subjectId:subjectFor(s,'dps.'+currentEpisode(s).stageId+'.x'),episodeId:s.activeEpisodeId,caseId:s.caseState.id}}
 function setPending(s,q,kind='next',key=null,conflictField=null){
  const p={kind,key:key||q.id,stageId:currentEpisode(s).stageId,fieldKey:q.fieldKey||conflictField,question:q};
  if(conflictField)p.key='conflict';
  if(canServeQuestion(s,p,{}))s.pending=p;else s.pending=null;
 }
 function serviceQuestion(s,key,conflictField=null){
  const e=entries.get('dps.dm.'+key);assert(e?.kind==='question','DPS_UNKNOWN_SERVICE_QUESTION');
  setPending(s,{id:e.id,text:e.text,controls:key==='actor'?[{label:'Да',value:true},{label:'Нет',value:false},{label:'Не знаю',value:null}]:[]},'service',key,conflictField);
 }
 function terminalText(key){return entries.get('dps.dm.'+key)?.text||''}
 function dispatch(s,input){
  const action=input.guided?.native,text=input.question||'',prior=s.pending;
  if(input.variantId)assert(rows.has(input.variantId),'DPS_UNKNOWN_ID');
  let parsed=interpretDps(s,text,input.turnId),e=currentEpisode(s),notice=null;
  const documentRequest=/^(?:открой|откройте|подготовь|подготовьте) (?:документ|форму)$/iu.test(text.trim());
  const repeatRequest=/^(?:покажи|покажите|повтори|повторите) (?:полную памятку|памятку|ответ)$/iu.test(text.trim());
  if(/^(?:продолжим|продолжить|вернемся к разбору)$/iu.test(text.trim()))s.dpsStopped=false;
  if(action){
   assert(prior&&action.kind==='answer'&&action.questionId===prior.question.id&&action.policyVersion===policy.version&&action.sourceSha256===SOURCE_SHA&&action.receiptId===prior.receiptId,'STALE_ACTION');
   assert(prior.question.controls.some(c=>c.value===action.value&&normalizeDpsText(c.label)===normalizeDpsText(text)),'DPS_UNOFFERED_ANSWER');
  }
  const reply=action?{value:action.value}:dpsPendingValue(prior,text);
  if(reply&&prior){
   assert(bindQuestion(s,prior),'STALE_ACTION');
   const source=sourceFor(s,{kind:action?'button':'user_text',turnId:input.turnId,quote:text,span:[0,Array.from(text).length],questionId:prior.question.id,nonce:s.nonce,revision:s.revision,sourceSha256:SOURCE_SHA});
   if(prior.kind==='next'){
    const q=questions.get(prior.question.id),facts=project(s,q.stageId);
    assert(q.requires.every(d=>facts[d.field_key]===d.value),'DPS_PREREQUISITE_CHANGED');
    recordFact(s,q.fieldKey,reply.value,source);
   }else if(prior.key==='actor'){
    if(reply.value===true)e.actor='traffic_police';else{s.dpsBoundary=reply.value===false?'outside_category':'actor_unknown_hold';s.dpsDeclined=true}
   }
   answerQuestionReceipt(s,prior,reply.value,source);s.pending=null;
   if(reply.value===null)notice='unknown';
  }else{
   if(parsed.newCase){episode(s,'new-case');newRound(s,'explicit-new-case');e=currentEpisode(s);s.dpsDeclined=false;s.dpsStopped=false;s.dpsBoundary=null;parsed=interpretDps(s,text,input.turnId);notice='new_episode'}
   if(parsed.stop||parsed.decline){
    if(prior){answerQuestionReceipt(s,prior,null,sourceFor(s,parsed.source));s.pending=null}
    s.dpsDeclined=true;notice=parsed.stop?'stop':'decline_questions';s.dpsStopped=!!parsed.stop;
   }else if(parsed.excluded){notice=parsed.excluded}
   else{
    // A free service description is answered in its original served scope,
    // before the description establishes a more specific document/vehicle.
    const serviceWasAnswered=prior?.kind==='service'&&bindQuestion(s,prior);
    if(serviceWasAnswered){answerQuestionReceipt(s,prior,null,sourceFor(s,parsed.source));s.pending=null}
    const oldStage=e.stageId;
    if(parsed.stage&&parsed.stageConfirmed){e.stageId=parsed.stage;e.dpsStageConfirmed=true;s.dpsBoundary=null;if(oldStage&&oldStage!==e.stageId)newRound(s,'dps-stage')}
    else if(parsed.stage&&!e.stageId)e.dpsHint=parsed.stage;
    if(parsed.actor){e.actor=parsed.actor;if(parsed.actor==='other'&&e.stageId!=='accident_processing'){
     s.dpsBoundary='outside_category';
     if(s.pending){answerQuestionReceipt(s,s.pending,null,{kind:'actor_scope_changed',turnId:input.turnId});s.pending=null}
    }}
    if(e.stageId==='accident_processing'&&parsed.stageConfirmed)e.dpsOwnAccident=true;
    if(e.stageId&&e.dpsStageConfirmed)selectSubject(s,e.stageId,parsed.subjectReference);
    const samePending=prior&&bindQuestion(s,prior);
    if(prior?.kind==='service'&&(samePending||serviceWasAnswered)){
     if(prior.key==='conflict'){
      const candidates=s.factLedger.filter(f=>f.fieldKey===prior.fieldKey&&f.status==='conflicted'&&f.subjectId===subjectFor(s,f.fieldKey));
      const last=candidates.at(-1);
      if(last&&/^(?:исправляю|я ошибся|исправление)/iu.test(text.trim())){
       const assertion=[...s.factLedger].reverse().find(f=>f.fieldKey===prior.fieldKey&&f.source?.turnId===last.source?.turnId);
       if(assertion?.proposedValue!==undefined)recordFact(s,prior.fieldKey,assertion.proposedValue,sourceFor(s,parsed.source),'correct');
      }
      else if(last){last.temporalClarification={source:sourceFor(s,parsed.source),status:'NO_NEW_BOOLEAN_WITHOUT_EXACT_EVENT_BINDING'};notice='conflict_hold'}
     }
     if(samePending)answerQuestionReceipt(s,prior,null,sourceFor(s,parsed.source));s.pending=null;
    }
    const withdrawn=parsed.withdrawField||(parsed.withdraw?prior?.fieldKey:null);
    if(withdrawn&&!blocked.has(withdrawn)&&fields.has(withdrawn)&&own(project(s,e.stageId),withdrawn)){recordFact(s,withdrawn,null,sourceFor(s,parsed.source),'withdraw');notice='withdrawn'}
    for(const fact of parsed.facts){
     if(blocked.has(fact.fieldKey)||!fields.has(fact.fieldKey))continue;
     if(fact.fieldKey.split('.')[1]!==e.stageId)continue;
     const stored=recordFact(s,fact.fieldKey,fact.value,sourceFor(s,fact.source),fact.operation);
     if(stored.status==='conflicted'){stored.proposedValue=fact.value;s.dpsConflict=fact.fieldKey;if(caseQuestionsUsed(s)>=2)notice='conflict_hold'}
     if(fact.operation==='correct')notice='corrected';
    }
    if(prior?.kind==='next'&&samePending&&parsed.facts.some(f=>f.fieldKey===prior.fieldKey)){
     answerQuestionReceipt(s,prior,project(s,e.stageId)[prior.fieldKey]??null,sourceFor(s,parsed.source));s.pending=null;
    }else if(prior?.kind==='next'&&samePending&&!parsed.facts.length&&!parsed.stage&&!documentRequest&&!repeatRequest){
     // An unparsed answer is not the user's explicit unknown observation.
     // Close its served receipt to prevent loops; leave the field absent.
     answerQuestionReceipt(s,prior,null,sourceFor(s,parsed.source));
     const receipt=s.caseState.served.find(r=>r.id===prior.receiptId);if(receipt)receipt.answer.disposition='UNPARSED_NOT_A_FACT';
     s.pending=null;notice='unoffered_answer';
    }
   }
  }
  if(s.dpsStopped){s.pending=null;return{variantId:null,notice:'stop'}}
  if((parsed.ambiguousSubject||parsed.ambiguousReference)&&s.pending){
   answerQuestionReceipt(s,s.pending,null,{kind:'scope_ambiguity',turnId:input.turnId});s.pending=null;
  }
  const planned=plan(s);
  if(s.pending?.kind==='next'){
   const q=questions.get(s.pending.question.id),facts=project(s,q.stageId);
   if(own(facts,q.fieldKey)||!q.requires.every(d=>facts[d.field_key]===d.value)||!useful(q.stageId,facts,q,Math.max(1,3-caseQuestionsUsed(s)))){
    answerQuestionReceipt(s,s.pending,null,{kind:'dependency_revalidation',turnId:input.turnId});s.pending=null;
   }
  }
  if(!s.pending&&!s.dpsDeclined){
   if(parsed.ambiguousSubject)serviceQuestion(s,'subject');
   else if(parsed.ambiguousReference)serviceQuestion(s,'actor_reference');
   else if(s.dpsConflict&&caseQuestionsUsed(s)<2){const f=s.factLedger.findLast(f=>f.fieldKey===s.dpsConflict&&f.status==='conflicted');if(f)serviceQuestion(s,'conflict',s.dpsConflict);s.dpsConflict=null}
   else if(planned.question)setPending(s,planned.question);
   else if(!planned.variantId&&!s.dpsBoundary){
    if(input.variantId&&!e.dpsStageConfirmed){s.dpsHint=rows.get(input.variantId)?.stage.stage.id;serviceQuestion(s,'article_entry')}
    else if(!text.trim())serviceQuestion(s,s.dpsHistoryUnavailableConfirmed?'fresh_no_history':'start');
    else if(parsed.ambiguousReference)serviceQuestion(s,'actor_reference');
    else if((e.stageId||e.dpsHint)&&e.actor!=='traffic_police'&&e.stageId!=='accident_processing')serviceQuestion(s,'actor');
    else if(/документ/u.test(normalizeDpsText(text))&&!e.stageId)serviceQuestion(s,'subject');
    else serviceQuestion(s,'stage_unclear');
   }
  }
  if(!planned.variantId&&!s.pending)notice=s.dpsBoundary||'actor_unknown_hold';
  if(documentRequest)notice=planned.variantId?'document_unavailable':'document_unavailable_no_answer';
  return{variantId:planned.variantId,notice,forceFull:repeatRequest};
 }
 function present(s,outcome,{turnId=null,forceFull=false}={}){
  const responseId=randomUUID(),e=currentEpisode(s),id=outcome.variantId,row=id&&rows.get(id).row;
  let question=s.pending;
  if(question&&!serveQuestion(s,question,responseId,turnId||'resume-'+responseId,{})){s.pending=null;question=null}
  const same=row&&s.presentation.lastFull===digest(JSON.stringify(row.payload.answer));
  const notices=outcome.notice?[terminalText(outcome.notice)]:[];
  let full=row&&(!same||forceFull||outcome.forceFull);
  const content=[...notices];
  const reference=s.presentation.lastFullResponseId||null;
  if(full){const a=row.payload.answer;content.push(a.now,...a.steps.map(x=>'• '+x),...a.dont,...a.say,...a.laws.map(l=>l.ref+': '+l.short+' ('+l.url+')'),...a.where_to.map(d=>d.title));s.presentation.lastFull=digest(JSON.stringify(a));s.presentation.lastFullResponseId=responseId}
  else if(row&&!question&&!notices.some(Boolean))content.push(terminalText(caseQuestionsUsed(s)>=2?'limit_with_answer':'same_answer'));
  if(!row&&!question&&!content.some(Boolean))content.push(terminalText('actor_unknown_hold'));
  const native={kind:'answer',sessionId:s.id,nonce:s.nonce,revision:s.revision,episodeId:s.activeEpisodeId,roundId:s.round?.id,policyVersion:policy.version,sourceSha256:SOURCE_SHA,questionId:question?.question.id,receiptId:question?.receiptId};
  const groups=question?[{type:question.question.controls.length?'choice':'text',questionText:question.question.text,questionId:question.question.id,view:question.question.controls.map(c=>({question:c.label,title:c.label,guided:{native:{...native,value:c.value}}}))}]:[];
  return{conversation:{sessionId:s.id,revision:s.revision,version:s.version,nonce:s.nonce},presentation:{responseId,mode:full?'full':row?'continuation':'boundary',referencesResponseId:full?null:reference,questionsUsed:caseQuestionsUsed(s),policyVersion:policy.version},answer:{category:'dps',variantId:id||undefined,content:content.filter(Boolean).map(escape).join('\n\n'),next:groups,sections:full?{laws:structuredClone(row.payload.answer.laws),documents:structuredClone(row.payload.answer.where_to),documentActionsUnavailable:true}:undefined},dialogue:{stageId:e.stageId||null,questionId:question?.question.id||null,terminal:question?null:id?'variant':outcome.notice||'boundary_no_scope'}};
 }
 return Object.freeze({categoryId:'dps',version:policy.version,sourceSha256:SOURCE_SHA,nextSha256:NEXT_SHA,bundle,policy,
  validate(candidate,sha){assert(sha===SOURCE_SHA&&equal(candidate,bundle),'DPS_SOURCE_VERSION_UNAVAILABLE')},
  prepareState,resolve,eligible,useful,plan,dispatch,present,selectSubject,
  evidenceScope:dpsEvidenceScope,recordReviewedEvidence:qualifications.record,
  qualificationPolicySha256:digest(policyBytes),
  qualifiedRecords:qualifications.current,
  rowFor(id){const r=rows.get(id);if(!r)fail('DPS_UNKNOWN_ID');return r},
  serviceEvent(id,event){const e=entries.get(id);assert(e,'DPS_UNKNOWN_SERVICE_EVENT');if(['silent','question'].includes(e.kind))return null;if(e.kind==='label')return event?.kind==='render_section'?{label:e.text}:null;if(/(?:document|consent|sent|send_|withdraw_failed)/u.test(id))return null;return event?.confirmed===true?{text:e.text}:null},
  blockedVariantIds:Object.freeze([...blockedRows]),
 });
}
