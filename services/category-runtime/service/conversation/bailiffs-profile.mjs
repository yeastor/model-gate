import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {fail} from './errors.mjs';
import {episode,currentEpisode,newRound,recordFact,subjectFor,caseQuestionsUsed,canServeQuestion,serveQuestion,answerQuestionReceipt,bindQuestion} from './state.mjs';
import {validateQuestionDefinition,choiceValue} from './questions.mjs';
import {createExplicitEngine} from '../explicit/engine.mjs';
import {interpretBailiffs} from './bailiffs-interpret.mjs';
const POLICY='16d75850e2b4993ba1daffc7e3a2c4a454a6e34c0a4b950be1bcf011af1ff453';
const sha=x=>createHash('sha256').update(x).digest('hex'),hash=x=>sha(JSON.stringify(x)),eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b),own=(o,k)=>Object.hasOwn(o,k),tfu=x=>[true,false,null].includes(x);
const check=(v,c)=>{if(!v)fail(c,409)},parse=b=>JSON.parse(b.toString('utf8').replace(/^\uFEFF/,''));
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const escape=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function createBailiffsProfile({policyBytes,componentBytes={}}={}){
 policyBytes||=fs.readFileSync(new URL('./policy/bailiffs.v1.json',import.meta.url));check(sha(policyBytes)===POLICY,'BA_POLICY_PIN_MISMATCH');const policy=parse(policyBytes),components={};
 check(policy.categoryId==='bailiffs'&&policy.defaultActivation===false&&policy.maxQuestionsPerCase===2&&eq(policy.thirdQuestionReasons,{}),'BA_POLICY');
 for(const[k,p]of Object.entries(policy.sources)){const b=componentBytes[k]||fs.readFileSync(p.path);check(b.length===p.bytes&&sha(b)===p.sha256,'BA_COMPONENT_PIN_MISMATCH');components[k]=b;}
 const bundle=parse(components.category),bindings=parse(components.bindings),next=parse(components.NEXT),SOURCE=policy.sources.category.sha256,NEXT=policy.sources.NEXT.sha256;
 const fields=new Map(policy.fields.map(f=>[f.fieldKey,f])),predicates=new Map(policy.predicates.map(f=>[f.fieldKey,f])),questions=new Map(policy.questions.map(q=>[q.id,q])),specs=new Map(policy.stages.map(s=>[s.id,s])),rows=new Map(),blocked=policy.fields.filter(f=>f.status==='RAW_HOLD').map(f=>f.fieldKey);
 check(SOURCE==='d9c68a0c9f927a207da7bcf487b16227fbd4a67478c85af48f57c3d2451f979b'&&eq(Object.keys(bundle),['category','metadata','subcategories'])&&bundle.category.id==='bailiffs','BA_SOURCE');
 let nodes=0,branches=0;function validateNode(q,stage){nodes++;branches+=q.data.length;const key='bailiffs.'+stage+'.'+q.field_key,p=questions.get(q.id);check(p&&p.text===q.question&&p.fieldKey===key&&eq(p.branches,q.data)&&eq(p.controls,q.data.map(({value,label})=>({value,label}))),'BA_QUESTION_BINDING');validateQuestionDefinition({id:q.id,branches:q.data.map(b=>({value:b.value,kind:b.go_to_variant?'variant':'stage',variantId:b.go_to_variant,stageId:stage}))},{bundle,rowFor(id){check(rows.has(id),'BA_TARGET');return rows.get(id);}});for(const b of q.data)if(b.ask_next_question)validateNode(b.ask_next_question,stage);}
 for(const s of bundle.subcategories){check(eq(s.context_fields.map(f=>f.id),policy.fields.filter(f=>f.stageId===s.stage.id).map(f=>f.fieldId)),'BA_FIELD_ORDER');for(const v of s.variants){check(!rows.has(v.variant_id)&&eq(Object.keys(v.context),s.context_fields.map(f=>f.id))&&Object.values(v.context).every(tfu),'BA_CONTEXT');rows.set(v.variant_id,{row:v,stage:s});const b=bindings.bindings.find(b=>b.draft_key===v.variant_id);check(b&&b.current_object_sha256===hash(v)&&b.answer_sha256===hash(v.payload.answer)&&b.context_sha256===hash(v.context)&&b.retrieval_sha256===hash(v.question)&&b.NEXT_sha256===hash(v.payload.next)&&b.laws_sha256===hash(v.payload.answer.laws)&&b.where_to_sha256===hash(v.payload.answer.where_to)&&eq(b.current_full_answer,v.payload.answer),'BA_CURRENT_BINDING');}}
 const core=createExplicitEngine(bundle); // Only pure row compatibility; case receipts own all question accounting.
 for(const s of bundle.subcategories)for(const v of s.variants)for(const q of v.payload.next)validateNode(q,s.stage.id);
 check(rows.size===30&&fields.size===59&&predicates.size===59&&policy.predicates.filter(x=>x.existingNext).length===16&&blocked.length===0&&nodes===31&&branches===93&&next.all70paths.length===70,'BA_INVENTORY');
 const quoted=x=>x&&typeof x.message==='string'&&typeof x.quote==='string'&&x.quote.length>0&&Array.isArray(x.span)&&x.span.length===2&&x.span.every(Number.isInteger)&&x.span[0]>=0&&x.span[1]>=x.span[0]&&Array.from(x.message).slice(...x.span).join('')===x.quote;
 const baseKeys={ip_opened:['order'],account_arrest:['bank','account'],money_writeoff:['bank','account','payment'],wage_garnishment:['bank','account','payer','payment'],property_arrest:['asset'],restrictions:['order'],installment_suspension:['act'],complaint_bailiff:['request']};
 const scopeFor=(s,stage)=>currentEpisode(s).baScopes?.[stage]||null;
 const turn=(s,src)=>currentEpisode(s).baTurns?.find(t=>t.turnId===src?.turnId&&t.message===src.message);
 const parseAt=(s,stage,src)=>interpretBailiffs({...s,episodes:s.episodes.map(e=>e.id===s.activeEpisodeId?{...e,stageId:stage}:e)},src.message,src.turnId,policy);
 function prepareState(s){check(!s.categoryId||s.categoryId==='bailiffs','BA_SAVED_CATEGORY');check((!s.baPolicyVersion&&s.revision===0)||s.baPolicyVersion===policy.version,'BA_POLICY_VERSION_UNAVAILABLE');s.categoryId='bailiffs';s.policyVersion=policy.version;s.baPolicyVersion=policy.version;s.categoryFieldKeys=[...fields.keys()];s.categoryBlockedFields=[...blocked];s.categoryScopeGroups=Object.fromEntries(policy.fields.map(f=>[f.fieldKey,f.group]));const e=currentEpisode(s);e.baScopes||={};e.baSubjects||={};e.baTurns||=[];e.baRaw||=[];e.baLater||=[];e.categorySubjects||={};}
 function fieldScope(s,key){const st=fields.get(key)?.stageId,sc=st&&scopeFor(s,st);return sc?{caseId:s.caseState.id,episodeId:s.activeEpisodeId,stage:st,person:sc.person,role:sc.role,proceeding:sc.proceeding,event:sc.event,...Object.fromEntries(policy.scopeKeys.filter(k=>!['person','role','proceeding'].includes(k)).map(k=>[k,sc[k]??null]))}:null;}
 function scopeReady(s,stage){const sc=scopeFor(s,stage),selected=currentEpisode(s).baCurrentProceeding;if(!sc||!sc.route||!selected||selected.value!==sc.proceeding||!turn(s,selected.source))return false;const current=parseAt(s,stage,selected.source);if(current.excluded||current.foreign||current.ambiguous||current.scope.proceeding!==selected.value||!eq(current.scopeSources.proceeding,selected.source))return false;return ['route','person','role','proceeding',...(baseKeys[stage]||[]),...policy.scopeKeys.filter(k=>sc[k])].every(k=>{const src=sc.evidence[k];if(!turn(s,src)||!quoted(src)||src.kind!=='user_text')return false;const p=parseAt(s,stage,src);return !p.excluded&&!p.foreign&&!p.ambiguous&&(k==='route'?p.stage===stage&&eq(p.routeSource?.span,src.span):p.scope[k]===sc[k]&&eq(p.scopeSources[k]?.span,src.span));});}
 function retire(s,reason){if(!s.pending)return;answerQuestionReceipt(s,s.pending,null,{kind:reason});const r=s.caseState.served.find(r=>r.id===s.pending.receiptId);if(r?.answer)r.answer.disposition=reason;s.pending=null;}
 function selectScope(s,stage,p){const e=currentEpisode(s),old=scopeFor(s,stage),sc=old?structuredClone(old):{evidence:{},event:'reported-event:'+p.source.turnId};let changed=false;
  if(p.scope.proceeding)e.baCurrentProceeding={value:p.scope.proceeding,source:p.scopeSources.proceeding};
  if(p.stage===stage){sc.route=stage;sc.evidence.route=p.routeSource;}
  if(p.scope.proceeding&&sc.proceeding&&p.scope.proceeding!==sc.proceeding)for(const k of policy.scopeKeys)if(!p.scope[k]){delete sc[k];delete sc.evidence[k];}
  if((p.scope.bank&&sc.bank&&p.scope.bank!==sc.bank)||(p.scope.account&&sc.account&&p.scope.account!==sc.account))for(const k of ['account','payment'])if(!p.scope[k]){delete sc[k];delete sc.evidence[k];}
  for(const[k,value]of Object.entries(p.scope))if(value!==sc[k]){changed||=!!sc[k];sc[k]=value;sc.evidence[k]=p.scopeSources[k];}
  if(changed){retire(s,'scope_changed');sc.event='reported-event:'+p.source.turnId;}
  e.baScopes[stage]=sc;const digest=hash(fieldScope(s,policy.fields.find(f=>f.stageId===stage).fieldKey));e.baSubjects[stage]||={};e.categorySubjects[stage]={current:e.baSubjects[stage][digest]||=randomUUID()};return scopeReady(s,stage);
 }
 const record=(s,key)=>s.factLedger.findLast(f=>f.fieldKey===key&&f.episodeId===s.activeEpisodeId&&f.subjectId===subjectFor(s,key)&&['active','conflicted'].includes(f.status));
 const factScopeReady=(s,key)=>{const q=predicates.get(key),sc=q&&scopeFor(s,q.stageId);return !!q&&scopeReady(s,q.stageId)&&(q.requiredScope||[]).every(k=>!!sc?.[k]);};
 const admission=(s,key,src)=>turn(s,src)?.admissions.find(a=>a.fieldKey===key&&eq(a.source,src));
 function validSource(s,key,src){const t=turn(s,src);return quoted(src)&&!!t&&factScopeReady(s,key)&&src.caseId===s.caseState.id&&src.episodeId===s.activeEpisodeId&&src.sourceSha256===SOURCE&&src.nextSha256===NEXT&&src.policyVersion===policy.version&&src.semanticRevision===predicates.get(key).semanticRevision&&eq(src.scope,fieldScope(s,key))&&src.observationRecordedAt===t.recordedAt&&Number.isFinite(Date.parse(src.observationRecordedAt))&&Date.parse(src.observationRecordedAt)<=Date.now();}
 const receiptEvidence=(s,q)=>({question:structuredClone(q),source:SOURCE,next:NEXT,policy:policy.version,scope:fieldScope(s,q.fieldKey)});
 function validOffer(s,r,q){
  const response=s.turns[r?.turnId]?.response,offered=response?.answer?.next?.find(x=>x.questionId===q?.id),origin=r?.baOrigin;
  return !!(q&&origin&&response&&offered&&response.presentation.responseId===r.responseId&&response.turn.turnId===r.turnId&&
   origin.responseId===r.responseId&&origin.turnId===r.turnId&&origin.questionSha256===hash(offered)&&
   offered.questionText===q.text&&offered.view.length===q.controls.length&&offered.view.every((b,i)=>{
    const c=q.controls[i],n=b.guided?.native;return b.title===c.label&&b.question===c.label&&n&&n.value===c.value&&n.questionId===q.id&&n.fieldKey===q.fieldKey&&n.receiptId===r.id&&n.sessionId===s.id&&n.caseId===r.caseId&&n.episodeId===r.episodeId&&n.subjectId===r.subjectId&&n.revision===response.conversation.revision&&n.nonce===response.conversation.nonce&&n.sourceSha256===SOURCE&&n.nextSha256===NEXT&&n.policyVersion===policy.version&&n.scopeDigest===hash(r.baEvidence.scope);
   }));
 }
 function checkPending(s,p,creating=null){if(!p)return;const q=questions.get(p.question.id),r=s.caseState.served.find(r=>r.id===p.receiptId);check(q&&eq(p.question,q)&&r&&eq(r.baEvidence,receiptEvidence(s,q))&&(validOffer(s,r,q)||(creating&&!r.baOrigin&&r.turnId===creating.turnId&&r.responseId===creating.responseId)),'STALE_ACTION');}
 function observedAnswer(s,key,value,src,historical=false){if(!validSource(s,key,src)||!['button','question_reply'].includes(src.kind))return false;const q=questions.get(src.questionId),r=s.caseState.served.find(r=>r.id===src.receiptId),a=admission(s,key,src);return a&&a.value===value&&q?.fieldKey===key&&r&&validOffer(s,r,q)&&eq(r.baEvidence,receiptEvidence(s,q))&&r.caseId===s.caseState.id&&r.episodeId===s.activeEpisodeId&&r.subjectId===subjectFor(s,key)&&r.fieldKey===key&&r.questionId===q.id&&r.status==='answered'&&(!r.answer?.disposition||(historical&&r.answer.disposition==='superseded'))&&r.answer?.value===value&&eq(r.answer.source,src)&&q.controls.some(c=>c.value===value&&(src.kind==='button'?c.label===src.message:choiceValue(src.message)?.value===value))&&src.quote===src.message&&eq(src.span,[0,Array.from(src.message).length]);}
 const recordRevision=f=>hash(Object.fromEntries(['id','fieldKey','caseId','episodeId','subjectId','value','source','observedAt','operation','dependencies','supersedes'].map(k=>[k,f[k]])));
 function observedRecord(s,f,historical=false,seen=new Set()){
  if(!f||seen.has(f.id)||!validSource(s,f.fieldKey,f.source)||f.caseId!==s.caseState.id||f.episodeId!==s.activeEpisodeId||f.subjectId!==subjectFor(s,f.fieldKey))return false;seen.add(f.id);
  const a=admission(s,f.fieldKey,f.source);if(!a||a.recordId!==f.id||a.observedAt!==f.observedAt||a.operation!==f.operation||!eq(a.dependencies,f.dependencies)||a.storedValue!==f.value||!eq(a.supersedes,f.supersedes))return false;
  if(f.supersedes.length){const parent=s.factLedger.find(x=>x.id===f.supersedes[0]);if(f.supersedes.length!==1||!parent||a.parentRevision!==recordRevision(parent)||!observedRecord(s,parent,true,seen))return false;}else if(a.parentRevision!==null)return false;
  if(['button','question_reply'].includes(f.source.kind))return observedAnswer(s,f.fieldKey,a.value,f.source,historical);
  if(f.source.kind!=='user_text')return false;const p=parseAt(s,fields.get(f.fieldKey).stageId,f.source);return !p.excluded&&!p.foreign&&!p.ambiguous&&p.facts.some(x=>x.fieldKey===f.fieldKey&&x.value===a.value&&x.operation===f.operation&&eq(x.source.span,f.source.span)&&x.source.quote===f.source.quote);
 }
 function known(s,key){const f=fields.get(key);if(currentEpisode(s).baScopeHeld||!predicates.has(key)||!factScopeReady(s,key))return null;const r=record(s,key);if(r){return r.status==='active'&&r.caseId===s.caseState.id&&observedRecord(s,r)?{value:r.value,source:r.source,recordId:r.id}:null;}
  const old=s.factLedger.findLast(x=>x.fieldKey===key&&x.subjectId===subjectFor(s,key));if(old&&['invalidated','superseded'].includes(old.status))return null;const receipt=s.caseState.served.findLast(x=>x.fieldKey===key&&x.subjectId===subjectFor(s,key)&&x.status==='answered'&&!x.answer?.disposition);return receipt&&observedAnswer(s,key,receipt.answer.value,receipt.answer.source)?{value:receipt.answer.value,source:receipt.answer.source,recordId:admission(s,key,receipt.answer.source)?.recordId}:null;
 }
 const scopedFacts=(s,stage)=>Object.fromEntries(policy.predicates.filter(f=>f.stageId===stage).flatMap(f=>{const k=known(s,f.fieldKey);return k?[[f.fieldId,k.value]]:[];}));
 function admit(s,f){const q=predicates.get(f.fieldKey),src=f.source;if(currentEpisode(s).baScopeHeld||!q||!tfu(f.value)||!factScopeReady(s,f.fieldKey)||!turn(s,src)||!quoted(src))return null;
  if(src.kind==='user_text'){const p=parseAt(s,q.stageId,src);if(p.excluded||p.foreign||p.ambiguous||!p.facts.some(x=>x.fieldKey===f.fieldKey&&x.value===f.value&&x.operation===(f.operation||'assert')&&eq(x.source.span,src.span)))return null;}
  else if(['button','question_reply'].includes(src.kind)){const pending=s.pending;if(!pending||pending.fieldKey!==f.fieldKey||pending.question.id!==src.questionId||pending.receiptId!==src.receiptId||!pending.question.controls.some(c=>c.value===f.value&&(src.kind==='button'?c.label===src.message:choiceValue(src.message)?.value===f.value)))return null;}else return null;
  const old=record(s,f.fieldKey);if(old&&!observedRecord(s,old,true))return null;if(['correct','withdraw'].includes(f.operation)&&!old)return null;
  const source={...src,scope:fieldScope(s,f.fieldKey),caseId:s.caseState.id,episodeId:s.activeEpisodeId,sourceSha256:SOURCE,nextSha256:NEXT,policyVersion:policy.version,semanticRevision:q.semanticRevision,observationRecordedAt:turn(s,src).recordedAt,verified:false,canonicalContextWrite:false,evaluatorInput:false},stored=recordFact(s,f.fieldKey,f.value,source,f.operation||'assert',[]);
  if(stored.source.turnId===src.turnId)turn(s,src).admissions.push({fieldKey:f.fieldKey,value:f.value,storedValue:stored.value,operation:f.operation||'assert',source:structuredClone(source),dependencies:structuredClone(stored.dependencies),supersedes:[...stored.supersedes],parentRevision:old&&stored.id!==old.id?recordRevision(old):null,recordId:stored.id,observedAt:stored.observedAt});
  if(old&&stored.id!==old.id)for(const r of s.caseState.served)if(r.fieldKey===f.fieldKey&&r.subjectId===subjectFor(s,f.fieldKey)&&r.answer&&r.answer.source?.turnId!==src.turnId)r.answer.disposition='superseded';
  if(['correct','withdraw'].includes(f.operation))for(const x of s.factLedger)if(x.id!==stored.id&&x.fieldKey===f.fieldKey&&x.subjectId===stored.subjectId&&x.status==='conflicted')x.status='superseded';
  return stored;
 }
 function validLater(s,x){const t=turn(s,x.source);if(!t||!quoted(x.source)||!eq(x.scope,scopeFor(s,x.stage)))return false;const p=parseAt(s,x.stage,x.source);return !p.excluded&&!p.foreign&&!p.ambiguous&&eq(p.later,{kind:x.kind,stage:x.stage,source:x.source});}
 function resolve(stage,facts={}){check(specs.has(stage),'BA_STAGE');const qualified=Object.fromEntries(Object.entries(facts).map(([k,v])=>['bailiffs.'+stage+'.'+k,v]));const candidates=[...rows.values()].filter(x=>x.stage.stage.id===stage&&core.compatible(x.row.variant_id,qualified)),req=x=>new Set(Object.entries(x.row.context).filter(([,v])=>v!==null).map(([k,v])=>k+'='+v));
  const maximal=candidates.filter(a=>!candidates.some(b=>{const aa=req(a),bb=req(b);return bb.size>aa.size&&[...aa].every(x=>bb.has(x));}));const material=new Set(maximal.map(x=>hash(x.row.payload.answer)));
  return {variantId:maximal.length===1?maximal[0].row.variant_id:material.size===1?maximal[0]?.row.variant_id:specs.get(stage).entryId,specializationHeld:material.size!==1};
 }
 function eligible(s,q){return scopeReady(s,q.stageId)&&!known(s,q.fieldKey)&&!record(s,q.fieldKey)&&!s.caseState.served.some(r=>r.caseId===s.caseState.id&&r.episodeId===s.activeEpisodeId&&r.subjectId===subjectFor(s,q.fieldKey)&&r.fieldKey===q.fieldKey&&r.status==='answered');}
 function navigateToDebit(s,source){const e=currentEpisode(s),old=scopeFor(s,'money_writeoff');if(old)(e.baPreviousScopes||=[]).push({stage:'money_writeoff',scope:structuredClone(old),reason:'new_debit_navigation'});delete e.baScopes.money_writeoff;delete e.categorySubjects.money_writeoff;e.baNavigation={from:'account_arrest',to:'money_writeoff',source,active:true};e.stageId='money_writeoff';e.baTerminal={stage:e.stageId,scope:hash(null),target:'draft_ba3_money_writeoff_general'};}
 function plan(s){const e=currentEpisode(s),stage=e.stageId;if(!specs.has(stage))return {variantId:null,question:null,specializationHeld:true};if(stage==='money_writeoff'&&e.baNavigation?.active)return {variantId:'draft_ba3_money_writeoff_general',question:null,specializationHeld:true,facts:{}};const ready=scopeReady(s,stage),facts=ready?scopedFacts(s,stage):{},current=resolve(stage,facts),later=e.baLater.some(x=>x.stage===stage&&validLater(s,x)),conflict=s.factLedger.some(f=>f.episodeId===e.id&&f.subjectId===subjectFor(s,f.fieldKey)&&f.fieldKey.startsWith('bailiffs.'+stage+'.')&&f.status==='conflicted');
  if(later){if(stage==='property_arrest')delete facts.sale_scheduled;if(stage==='installment_suspension')delete facts.urgent_enforcement_scheduled;if(stage==='restrictions'){delete facts.travel_restricted;delete facts.driving_restricted;}Object.assign(current,resolve(stage,facts));}
  if(e.baScopeHeld||e.baCorrectionHeld)current.variantId=specs.get(stage).entryId;
  let q=questions.get(specs.get(stage).rootQuestionId),leaf=null;const visited=new Set();while(q){check(!visited.has(q.id),'BA_NEXT_CYCLE');visited.add(q.id);const k=known(s,q.fieldKey);if(!k)break;const b=q.branches.find(b=>b.value===k.value);if(b.go_to_variant){leaf=b.go_to_variant;q=null;break;}q=questions.get(b.ask_next_question.id);}
  const halted=e.baTerminal?.scope===hash(fieldScope(s,policy.fields.find(f=>f.stageId===stage).fieldKey));
  if(!ready||e.baScopeHeld||e.baCorrectionHeld||conflict||later||s.baDeclined||halted||(!s.pending&&caseQuestionsUsed(s)>=2))q=null;
  if(q&&!eligible(s,q))q=null;
  return {...current,question:q,leafTarget:leaf,facts,specializationHeld:current.specializationHeld||!ready||!!e.baScopeHeld||!!e.baCorrectionHeld||conflict||later};
 }
 function dispatch(s,input){let e=currentEpisode(s);const text=input.question||'',action=input.guided?.native,prior=s.pending,p=interpretBailiffs(s,text,input.turnId,policy);if(input.variantId)check(rows.has(input.variantId),'BA_UNKNOWN_ID');checkPending(s,prior);
  // Topic selection chooses an entry, never a business fact or a verified scope.
  const requestedCategories=[input.categoryId,input.launchHint?.categoryId].filter(Boolean);
  check(requestedCategories.every(c=>c==='bailiffs'),'BA_ENTRY_CATEGORY_MISMATCH');
  const requestedStages=[input.stageId,input.launchHint?.stageId,input.variantId?rows.get(input.variantId).stage.stage.id:null].filter(Boolean);
  check(requestedStages.every(st=>specs.has(st)),'BA_ENTRY_STAGE_UNAVAILABLE');
  check(new Set(requestedStages).size<=1,'BA_ENTRY_STAGE_CONFLICT');
  if(!action&&!p.stage&&!p.excluded&&!p.foreign&&!p.ambiguous&&requestedStages.length){
   const selected=requestedStages[0];if(selected!==e.stageId){retire(s,'explicit_topic_changed');newRound(s,'bailiffs-topic-entry');e.stageId=selected;e.baTerminal=null;}
  }
  if(action){const q=prior?.question;check(q&&action.kind==='answer'&&action.questionId===q.id&&action.receiptId===prior.receiptId&&action.fieldKey===q.fieldKey&&action.caseId===s.caseState.id&&action.subjectId===subjectFor(s,q.fieldKey)&&action.scopeDigest===hash(fieldScope(s,q.fieldKey))&&action.sourceSha256===SOURCE&&action.nextSha256===NEXT&&action.policyVersion===policy.version&&action.semanticRevision===q.semanticRevision&&eligible(s,q)&&plan(s).question?.id===q.id&&q.controls.some(c=>c.value===action.value&&c.label===text),'STALE_ACTION');}
  if(text)e.baTurns.push({turnId:input.turnId,message:text,recordedAt:new Date().toISOString(),admissions:[]});const reply=prior&&!p.excluded?choiceValue(text):null,control=reply?prior.question.controls.find(c=>c.value===reply.value):null;
  if(prior&&(action||control)){check(bindQuestion(s,prior)&&eligible(s,prior.question)&&plan(s).question?.id===prior.question.id,'STALE_ACTION');const value=action?action.value:control.value,src={...p.source,kind:action?'button':'question_reply',questionId:prior.question.id,receiptId:prior.receiptId},stored=admit(s,{fieldKey:prior.fieldKey,value,source:src});check(stored,'BA_ANSWER_NOT_ADMISSIBLE');answerQuestionReceipt(s,prior,value,stored.source);s.pending=null;const branch=prior.question.branches.find(b=>b.value===value);
   if(branch.go_to_variant){const target=rows.get(branch.go_to_variant),from=e.stageId;if(target.stage.stage.id!==from){check(from==='account_arrest'&&target.row.variant_id==='draft_ba3_money_writeoff_general'&&value===true,'BA_CROSS_STAGE');navigateToDebit(s,stored.source);}e.baTerminal={stage:e.stageId,scope:hash(fieldScope(s,policy.fields.find(f=>f.stageId===e.stageId).fieldKey)),target:target.row.variant_id};}
  }else if(!action){
   e.baRaw.push({source:p.source,stage:p.stage,proposals:p.facts,excluded:p.excluded,foreign:p.foreign,ambiguous:p.ambiguous});
   if(p.newCase&&p.stage&&!p.excluded&&!p.foreign&&!p.ambiguous){retire(s,'new_case');episode(s,'new-case');prepareState(s);newRound(s,'bailiffs-new-case');e=currentEpisode(s);e.baTurns.push({turnId:input.turnId,message:text,recordedAt:new Date().toISOString(),admissions:[]});s.baDeclined=false;}
   if(p.ambiguous){e.baScopeHeld=true;retire(s,'ambiguous_scope');}
   if(!p.excluded&&!p.foreign&&!p.ambiguous){if(p.stage&&p.stage!==e.stageId){retire(s,'stage_changed');newRound(s,'bailiffs-stage');e.stageId=p.stage;e.baTerminal=null;}
    if(e.stageId&&(p.stage||Object.keys(p.scope).length)){selectScope(s,e.stageId,p);if(scopeReady(s,e.stageId)&&Object.keys(p.scope).length){e.baScopeHeld=false;if(p.stage==='money_writeoff'&&e.baNavigation)e.baNavigation.active=false;}}
    if(p.stop){retire(s,'declined');s.baDeclined=true;}if(p.withdraw){e.baCorrectionHeld=true;retire(s,'ambiguous_withdrawal');}
    for(const f of p.facts){const stored=admit(s,f);if(stored&&(stored.status==='conflicted'||['correct','withdraw'].includes(f.operation))){retire(s,'facts_changed');e.baTerminal=null;}else if(!stored&&['correct','withdraw'].includes(f.operation)){e.baCorrectionHeld=true;retire(s,'unresolved_correction');}}
    if(p.later&&scopeReady(s,e.stageId)){e.baLater.push({...p.later,scope:structuredClone(scopeFor(s,e.stageId))});retire(s,'later_event');}
   }
  }
  let planned=plan(s);
  if(e.stageId==='account_arrest'&&planned.leafTarget==='draft_ba3_money_writeoff_general'&&known(s,'bailiffs.account_arrest.funds_debited_or_written_off')?.value===true){const source=known(s,'bailiffs.account_arrest.funds_debited_or_written_off').source;retire(s,'cross_stage_terminal');navigateToDebit(s,source);planned={variantId:'draft_ba3_money_writeoff_general',question:null,specializationHeld:true,facts:{}};}
  if(e.baNavigation?.active&&e.stageId==='money_writeoff')planned={variantId:'draft_ba3_money_writeoff_general',question:null,specializationHeld:true,facts:{}};
  if(s.pending&&planned.question?.id!==s.pending.question.id)retire(s,'no_longer_eligible');
  if(!s.pending&&planned.question){const q=planned.question,pending={kind:'next',key:q.id,fieldKey:q.fieldKey,stageId:q.stageId,question:q};if(canServeQuestion(s,pending,{}))s.pending=pending;}
  return {...planned,repeat:p.repeat};
 }
 function present(s,outcome,{turnId=null}={}){const e=currentEpisode(s),id=outcome.variantId,answer=id?rows.get(id)?.row.payload.answer:null,responseId=randomUUID(),fingerprint=answer?hash([id,answer,outcome.facts||{},e.baScopeHeld||false,e.baLater]):null,full=!!answer&&(fingerprint!==s.presentation.lastFull||outcome.repeat);let pending=s.pending;
  if(pending&&!serveQuestion(s,pending,responseId,turnId,{})){s.pending=null;pending=null;}if(pending){const r=s.caseState.served.find(r=>r.id===pending.receiptId);r.baEvidence||=receiptEvidence(s,pending.question);checkPending(s,pending,{turnId,responseId});}
  const content=[];if(full){content.push(answer.now,...answer.steps,...answer.dont,...answer.say);s.presentation.lastFull=fingerprint;s.presentation.lastFullResponseId=responseId;}else if(answer)content.push('Действия из памятки выше остаются доступны. Новые обстоятельства можно сообщить своими словами.');else content.push(policy.generalHelp);
  if(answer&&outcome.specializationHeld)content.push('Уточнённые действия доступны только по установленным обстоятельствам этого дела. Сообщённые сведения и документы ещё требуют проверки.');
  const native=pending?{kind:'answer',sessionId:s.id,revision:s.revision,nonce:s.nonce,episodeId:e.id,roundId:s.round?.id,caseId:s.caseState.id,subjectId:subjectFor(s,pending.fieldKey),fieldKey:pending.fieldKey,questionId:pending.question.id,receiptId:pending.receiptId,scopeDigest:hash(fieldScope(s,pending.fieldKey)),sourceSha256:SOURCE,nextSha256:NEXT,policyVersion:policy.version,semanticRevision:pending.question.semanticRevision}:null;
  const response={conversation:{sessionId:s.id,revision:s.revision,version:s.version,nonce:s.nonce},presentation:{responseId,mode:full?'full':answer?'continuation':'boundary',referencesResponseId:full?null:s.presentation.lastFullResponseId||null,questionsUsed:caseQuestionsUsed(s),policyVersion:policy.version},answer:{category:'bailiffs',variantId:id||undefined,content:content.map(escape).join('\n\n'),next:pending?[{type:'choice',questionText:pending.question.text,questionId:pending.question.id,view:pending.question.controls.map(c=>({title:c.label,question:c.label,guided:{native:{...native,value:c.value}}}))}]:[],sections:full?{laws:structuredClone(answer.laws),documents:structuredClone(answer.where_to),documentActionsUnavailable:true}:undefined},dialogue:{stageId:e.stageId||null,questionId:pending?.question.id||null,specializationHeld:!!outcome.specializationHeld,currentAnswerSha256:answer?hash(answer):null,sourceSha256:SOURCE,languageRevision:policy.sources.bindings.sha256,producerHolds:[...blocked],terminal:pending?null:answer?'variant':'boundary'}};
  if(pending){const r=s.caseState.served.find(r=>r.id===pending.receiptId);r.baOrigin||={turnId,responseId,questionSha256:hash(response.answer.next[0])};}
  return response;
 }
 freeze(policy);freeze(bundle);
 return Object.freeze({categoryId:'bailiffs',version:policy.version,sourceSha256:SOURCE,nextSha256:NEXT,policy,bundle,components,blockedVariantIds:[],validate(candidate,sha){check(sha===SOURCE&&eq(candidate,bundle),'BA_SOURCE_VERSION_UNAVAILABLE');},prepareState,scopeFor,fieldScope,scopeReady,scopedFacts,known,resolve,plan,dispatch,present,rowFor(id){check(rows.has(id),'BA_UNKNOWN_ID');return rows.get(id);}});
}


// The same opt-in, hash-bound local acceptance path used by accepted category profiles.
export async function loadBailiffsIntegration(contractPin){
 const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
 const pinned=p=>{check(p&&typeof p.path==='string'&&Number.isSafeInteger(p.bytes)&&/^[a-f0-9]{64}$/.test(p.sha256),'BA_INTEGRATION_PIN');const b=fs.readFileSync(p.path);check(b.length===p.bytes&&sha(b)===p.sha256,'BA_INTEGRATION_PIN');return {bytes:b,value:parse(b)};};
 const c=pinned(contractPin).value;
 check(c.schema==='bailiffs-acceptance-integration/v1'&&c.category_id==='bailiffs'&&c.production===false&&c.qdrant_url==='http://127.0.0.1:6333'&&c.ollama_url==='http://127.0.0.1:11435'&&/^aizashchita_acceptance_bailiffs_20261030_v1_bailiffs_[a-f0-9]{20}$/.test(c.collection),'BA_INTEGRATION_CONTRACT');
 const profile=createBailiffsProfile({policyBytes:pinned(c.policy).bytes});check(profile.sourceSha256===c.source.sha256&&pinned(c.source).bytes.equals(profile.components.category),'BA_INTEGRATION_SOURCE');
 const api=async(base,route,body)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});check(r.ok,'BA_INTEGRATION_HTTP_'+r.status);return r.json();};
 const filter={must:[{key:'category.id',match:{value:'bailiffs'}},{key:'source_sha256',match:{value:profile.sourceSha256}}]};
 const count=await api(c.qdrant_url,'/collections/'+c.collection+'/points/count',{filter,exact:true});check(count.result.count===30,'BA_INTEGRATION_COVERAGE');
 const model=(await api(c.ollama_url,'/api/tags')).models.find(x=>x.name==='bge-m3:latest');check(model?.digest===c.model_digest,'BA_INTEGRATION_MODEL');
 const general=new Map(profile.policy.stages.map(st=>[st.id,st.entryId]));
 async function search(text){const embedding=await api(c.ollama_url,'/api/embed',{model:'bge-m3',input:text,truncate:false,keep_alive:'10m'}),vector=embedding.embeddings?.[0];check(vector?.length===1024&&vector.every(Number.isFinite),'BA_INTEGRATION_VECTOR');
  const hits=(await api(c.qdrant_url,'/collections/'+c.collection+'/points/search',{filter,vector,limit:8,with_payload:true})).result;
  for(const hit of hits){const row=profile.rowFor(hit.payload?.variant_id).row,expected={...row.payload,variant_id:row.variant_id,context:row.context,question:row.question,source_sha256:profile.sourceSha256};check(JSON.stringify(stable(expected))===JSON.stringify(stable(hit.payload)),'BA_INTEGRATION_PAYLOAD');}return hits;
 }
 return {profile,contract:c,search,wrap(service){return {internal:(...a)=>service.internal(...a),async respond(input){
  let request=input,retrieval=null;
  if(!input.resume&&!input.conversation&&!input.guided&&!input.variantId&&!input.launchHint?.stageId&&!input.stageId&&typeof input.question==='string'&&input.question.trim()){
   const hits=await search(input.question),top=hits[0],inScope=/сч[её]т|карт|банк|арест|удерж|спис|рассроч|отсроч|приостанов|ограничен|выезд|вожд|возбуд|производств|бездейств|не выполняет|жалоб/iu.test(input.question);
   // Retrieval is only a topic candidate. The profile still verifies every non-null context condition.
   const stage=inScope&&top?.score>=0.5?top.payload.stage.id:null;if(stage&&general.has(stage))request={...input,variantId:general.get(stage)};
   retrieval={collection:c.collection,source_sha256:profile.sourceSha256,candidate:top?.payload.variant_id||null,score:top?.score??null,selected_general:request.variantId||null,context_from_search:false};
  }
  const result=await service.respond(request);return retrieval?{...result,retrieval}:result;
 }}}};
}
