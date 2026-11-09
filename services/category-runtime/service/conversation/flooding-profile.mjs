import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {fail} from './errors.mjs';
import {episode,currentEpisode,newRound,recordFact,project,subjectFor,caseQuestionsUsed,canServeQuestion,serveQuestion,answerQuestionReceipt,bindQuestion} from './state.mjs';
import {validateQuestionDefinition} from './questions.mjs';
import {interpretFlooding,floodingPendingValue,normalizeFlooding} from './flooding-interpret.mjs';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const SOURCE='1992127e28dda36969b7ac9ea6750ed715634a607d31be1faf5381538d6b23ea',NEXT='ee7d03433c483fc08aba2c1fd6d03218e9c6f87c270be69764434f0d5667850f',POLICY='7a323db8c1aefb27c14c49198e2f9a81c1a0cc3c51cbafd3a7d6404209fdafb3';
const digest=x=>createHash('sha256').update(x).digest('hex'),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),assert=(x,c)=>{if(!x)fail(c,409)},own=(o,k)=>Object.hasOwn(o,k);
const stable=o=>JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a],[b])=>a.localeCompare(b))));
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o)}return o};
const parse=b=>JSON.parse(b.toString('utf8').replace(/^\uFEFF/,'')),escape=t=>String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function createFloodingProfile({categoryBytes,policyBytes,componentBytes={}}={}) {
 policyBytes ||= fs.readFileSync(new URL('./policy/flooding.v1.json',import.meta.url));assert(digest(policyBytes)===POLICY,'FLOOD_POLICY_PIN_MISMATCH');const policy=parse(policyBytes);
 function pinned(bytes,p){assert(bytes.length===p.bytes&&digest(bytes)===p.sha256,'FLOOD_SOURCE_PIN_MISMATCH');return parse(bytes)}
 categoryBytes ||= fs.readFileSync(path.join(root,policy.source.path));const bundle=pinned(categoryBytes,policy.source),components={};
 for(const [k,p]of Object.entries(policy.components))components[k]=pinned(componentBytes[k]||fs.readFileSync(path.join(root,p.path)),p);
 const next=components.NEXT,fields=new Map(policy.fields.map(f=>[f.fieldKey,f])),questions=new Map(policy.questions.map(q=>[q.id,q])),byField=new Map(policy.questions.map(q=>[q.fieldKey,q])),specs=new Map(policy.stages.map(st=>[st.stageId,st])),rows=new Map(),blocked=new Set(policy.fields.filter(f=>f.status==='HELD_QUALIFIED_PRODUCER').map(f=>f.fieldKey));
 assert(policy.source.sha256===SOURCE&&policy.components.NEXT.sha256===NEXT&&policy.categoryId==='flooding'&&equal(Object.keys(bundle),['category','metadata','subcategories'])&&bundle.category.id==='flooding','FLOOD_PRIVATE_SOURCE');
 const lookup=new Map(components.lookup.entries.map(x=>[x.variant_id,x]));
 for(const st of bundle.subcategories){assert(equal(Object.keys(st),['stage','context_fields','variants']),'FLOOD_STAGE_SHAPE');const keys=st.context_fields.map(f=>f.id);
  for(const f of st.context_fields)assert(fields.has('flooding.'+st.stage.id+'.'+f.id),'FLOOD_FIELD_UNKNOWN');
  for(const row of st.variants){assert(!rows.has(row.variant_id)&&equal(Object.keys(row),['variant_id','context','question','payload'])&&equal(Object.keys(row.context),keys)&&Object.values(row.context).every(v=>[true,false,null].includes(v))&&equal(row.payload.next,[]),'FLOOD_ROW_INVALID');assert(equal(row.payload.answer,lookup.get(row.variant_id)?.answer),'FLOOD_CURRENT_ANSWER_MISMATCH');rows.set(row.variant_id,{row,stage:st})}
 }
 assert(rows.size===19&&fields.size===48&&questions.size===35&&blocked.size===13&&policy.maxQuestionsPerCase===2&&equal(policy.thirdQuestionReasons,{})&&equal(policy.supplementalQuestions,[]),'FLOOD_INVENTORY');
 const engine={bundle,rowFor(id){assert(rows.has(id),'FLOOD_UNKNOWN_ID');return rows.get(id)}};
 for(const b of policy.bindings){const f=rows.get(b.variantId);assert(f&&f.stage.stage.id===b.stageId&&equal(f.row.context,b.context),'FLOOD_MASK_BINDING')}
 for(const st of next.stages)for(const original of st.questions){const q=byField.get(original.field_key);assert(q&&q.text===original.question_text&&equal(q.requires,original.requires||[])&&equal(q.controls.map(c=>c.value),original.answers),'FLOOD_NEXT_BINDING');if(original.answer_labels)assert(q.controls.every(c=>c.label===original.answer_labels[String(c.value)]),'FLOOD_LABEL_BINDING');validateQuestionDefinition({id:q.id,branches:q.controls.map(c=>({value:c.value,kind:'stage',stageId:q.stageId}))},engine)}
 let uses=0;for(const t of components.native.templates){assert(rows.has(t.variant_id)&&equal(t.request.facts,{})&&equal(t.request.history,[]),'FLOOD_NATIVE_FACTS');for(const q of t.request.questions){uses++;const original=next.stages.flatMap(s=>s.questions).find(x=>x.field_key===q.field_key);assert(equal(q,original),'FLOOD_NATIVE_MIRROR')}}
 assert(uses===74&&components.bindings.rows.length===19&&components.targets.rows.length===105,'FLOOD_NATIVE_COUNTS');
 for(const b of components.bindings.rows)assert(equal(b.full_current_C42_variant,rows.get(b.variant_id)?.row),'FLOOD_FULL_BINDING');
 let compositions=0;for(const b of components.targets.rows){assert(equal(b.candidate_full_question,next.stages.flatMap(s=>s.questions).find(x=>x.field_key===b.field_key)),'FLOOD_BRANCH_BINDING');for(const c of b.all_possible_current_full_target_compositions){compositions++;assert(equal(c.full_current_variant,rows.get(c.variant_id)?.row),'FLOOD_TARGET_BINDING')}}assert(compositions===206,'FLOOD_COMPOSITION_COUNT');
 const heldIds=new Set(policy.bindings.filter(b=>b.qualifiedDependencies.length).map(b=>b.variantId));assert(heldIds.size===0,'FLOOD_QUALIFIED_COUNT');freeze(bundle);freeze(policy);freeze(components);
 function init(s){const e=currentEpisode(s);e.floodScopes||={};e.floodScopeHistory||={};e.categorySubjects||={};e.floodRaw||=[];e.floodTouched||=[]}
 function prepareState(s){assert(!s.categoryId||s.categoryId==='flooding','FLOOD_SAVED_CATEGORY_MISMATCH');assert(!s.floodPolicyVersion||s.floodPolicyVersion===policy.version,'FLOOD_POLICY_VERSION_UNAVAILABLE');s.categoryId='flooding';s.categoryFieldKeys=[...fields.keys()];s.categoryBlockedFields=[...blocked];s.categoryScopeGroups=Object.fromEntries(policy.fields.map(f=>[f.fieldKey,f.group]));s.policyVersion=policy.version;s.floodPolicyVersion=policy.version;init(s)}
 const scopeFor=(s,stage)=>currentEpisode(s).floodScopes?.[stage]||null;
 function fieldScope(s,key){const f=fields.get(key),sc=f&&scopeFor(s,f.stageId);if(!sc)return null;const out={caseId:s.caseState.id,episodeId:s.activeEpisodeId};for(const k of f.scopeKeys)out[k]=sc[k]??null;return out}
 function scopeReady(s,stage,key=null){const sc=scopeFor(s,stage);if(!sc||!['injured','respondent'].includes(sc.role)||!sc.actorId||!sc.flatId)return false;return !key||fields.get(key)?.scopeKeys.every(k=>typeof sc[k]==='string'&&sc[k].length>0)}
 function retire(s,why,source={}){if(!s.pending)return;answerQuestionReceipt(s,s.pending,null,{...source,kind:why});const r=s.caseState.served.find(r=>r.id===s.pending.receiptId);if(r?.answer)r.answer.disposition=why;s.pending=null}
 function selectScope(s,stage,scope,source){assert(specs.has(stage)&&source?.turnId&&source.quote,'FLOOD_SCOPE_REQUIRED');init(s);const e=currentEpisode(s),old=scopeFor(s,stage);if(old&&stable(old)!==stable(scope)){retire(s,'scope_changed',source);newRound(s,'flood-scope');s.nonce=randomUUID()}e.floodScopes[stage]=structuredClone(scope);if(scope.role&&scope.actorId&&scope.flatId)e.floodBase={role:scope.role,actorId:scope.actorId,flatId:scope.flatId};for(const f of policy.fields.filter(f=>f.stageId===stage)){const binding=stable(fieldScope(s,f.fieldKey));const history=e.floodScopeHistory[f.group]||={};e.categorySubjects[f.group]={current:history[binding]||=randomUUID()}}return scopeReady(s,stage)}
 function currentRecord(s,key){return s.factLedger.findLast(f=>f.episodeId===s.activeEpisodeId&&f.fieldKey===key&&f.subjectId===subjectFor(s,key)&&['active','conflicted'].includes(f.status))}
 function validRecord(s,f,seen=new Set()){if(!f||seen.has(f.id))return false;seen.add(f.id);const def=fields.get(f.fieldKey);return def&&!blocked.has(f.fieldKey)&&f.status==='active'&&f.caseId===s.caseState.id&&f.episodeId===s.activeEpisodeId&&f.subjectId===subjectFor(s,f.fieldKey)&&scopeReady(s,def.stageId,f.fieldKey)&&f.source?.sourceSha256===SOURCE&&f.source?.nextSha256===NEXT&&f.source?.policyVersion===policy.version&&f.source?.freshness!=='stale'&&!f.source?.conflict&&stable(f.source.scope)===stable(fieldScope(s,f.fieldKey))&&(!f.dependencies?.length||f.dependencies.every(id=>validRecord(s,s.factLedger.find(x=>x.id===id),new Set(seen))))}
 function scopedFacts(s,stage){const facts={};for(const [key,value]of Object.entries(project(s,stage)))if(validRecord(s,currentRecord(s,key)))facts[key]=value;return facts}
 function invalidate(s,id){const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const f of s.factLedger)if(f.status==='active'&&f.dependencies?.some(id=>ids.has(id))){f.status='invalidated';ids.add(f.id);changed=true}}}
 function prerequisites(s,q){const f=scopedFacts(s,q.stageId);return q.requires.every(r=>f[r.field_key]===r.value)}
 function basisReady(s,key){const f=fields.get(key),sc=scopeFor(s,f?.stageId);return !['act_management.damage_incomplete','accused_of_flooding.act_names_responsible'].includes(key.replace('flooding.',''))||sc?.actTextAvailable===true}
 function admit(s,f){const def=fields.get(f.fieldKey),src=f.source;if(!def||blocked.has(f.fieldKey)||!scopeReady(s,def.stageId,f.fieldKey)||!basisReady(s,f.fieldKey))return null;assert([true,false,null].includes(f.value),'FLOOD_VALUE_INVALID');const q=byField.get(f.fieldKey);if(q&&!prerequisites(s,q))return null;
  if(!['user_text','button','synthetic_observation'].includes(src?.kind)||!src.turnId||!src.quote||!Array.isArray(src.span)||src.span.length!==2||src.span[0]<0||src.span[1]-src.span[0]!==Array.from(src.quote).length||src.freshness==='stale'||src.conflict===true||(src.caseId&&src.caseId!==s.caseState.id)||(src.episodeId&&src.episodeId!==s.activeEpisodeId)||(src.sourceSha256&&src.sourceSha256!==SOURCE)||(src.nextSha256&&src.nextSha256!==NEXT)||(src.policyVersion&&src.policyVersion!==policy.version)||(src.scope&&stable(src.scope)!==stable(fieldScope(s,f.fieldKey))))return null;
  if(f.dependencies?.some(id=>!validRecord(s,s.factLedger.find(x=>x.id===id))))return null;
  const deps=[...new Set([...(f.dependencies||[]),...(q?.requires||[]).map(r=>currentRecord(s,r.field_key)?.id).filter(Boolean)])],old=currentRecord(s,f.fieldKey),source={...src,scope:fieldScope(s,f.fieldKey),sourceSha256:SOURCE,nextSha256:NEXT,policyVersion:policy.version,observedAt:new Date().toISOString()};
  const stored=recordFact(s,f.fieldKey,f.value,source,f.operation||'assert',deps);if(old&&old.id!==stored.id)invalidate(s,old.id);if(['correct','withdraw','later'].includes(f.operation))for(const x of s.factLedger)if(x.id!==stored.id&&x.fieldKey===f.fieldKey&&x.episodeId===s.activeEpisodeId&&x.subjectId===stored.subjectId&&x.status==='conflicted')x.status='superseded';const e=currentEpisode(s);if(!e.floodTouched.includes(def.stageId))e.floodTouched.push(def.stageId);return stored;
 }
 const requirements = id => {const {row,stage}=rows.get(id);return Object.entries(row.context).filter(([,v])=>v!==null).map(([k,v])=>['flooding.'+stage.stage.id+'.'+k,v])};
 function compatible(id,facts){return rows.has(id)&&!heldIds.has(id)&&requirements(id).every(([k,v])=>own(facts,k)&&facts[k]===v)}
 function resolveFacts(stage,facts={}){const spec=specs.get(stage);if(!spec)return {variantId:null,specializationHeld:true};const candidates=[...rows].filter(([id,r])=>r.stage.stage.id===stage&&compatible(id,facts)).map(([id])=>id),set=id=>new Set(requirements(id).map(([k,v])=>k+'='+v)),maximal=candidates.filter(id=>!candidates.some(other=>{const a=set(id),b=set(other);return b.size>a.size&&[...a].every(k=>b.has(k))}));return {variantId:maximal.length===1?maximal[0]:spec.generalId,specializationHeld:maximal.length!==1||Object.entries(facts).some(([k,v])=>v!==null&&blocked.has(k)),candidateIds:maximal}}
 const resolve=(s,stage=currentEpisode(s).stageId)=>resolveFacts(stage,scopedFacts(s,stage));
 function answered(s,q){return s.caseState.served.some(r=>r.caseId===s.caseState.id&&r.episodeId===s.activeEpisodeId&&r.subjectId===subjectFor(s,q.fieldKey)&&r.fieldKey===q.fieldKey&&r.status==='answered')}
 function eligible(s,q){return scopeReady(s,q.stageId,q.fieldKey)&&basisReady(s,q.fieldKey)&&prerequisites(s,q)&&!own(scopedFacts(s,q.stageId),q.fieldKey)&&!answered(s,q)&&currentRecord(s,q.fieldKey)?.status!=='conflicted'&&q.materialActionRefs.length>0}
 function plan(s){const e=currentEpisode(s),stage=e.stageId;if(!specs.has(stage))return {variantId:null,question:null,specializationHeld:true,additional:[]};const selected=e.floodScopeHeld?{variantId:specs.get(stage).generalId,specializationHeld:true,candidateIds:[]}:resolve(s,stage),conflict=s.factLedger.some(f=>f.episodeId===e.id&&f.subjectId===subjectFor(s,f.fieldKey)&&f.status==='conflicted');let q=null;if(!s.floodDeclined&&!e.floodScopeHeld&&!conflict&&scopeReady(s,stage)&&caseQuestionsUsed(s)<2){const focus=byField.get(e.floodFocus?.[stage]);const choices=focus?[focus,...focus.requires.map(r=>byField.get(r.field_key)).filter(Boolean)]:specs.get(stage).questionIds.map(id=>questions.get(id));q=choices.find(q=>eligible(s,q))||null;}const additional=(e.floodScopeHeld?[]:e.floodTouched).filter(st=>st!==stage&&scopeReady(s,st)&&['role','actorId','flatId'].every(k=>scopeFor(s,st)?.[k]===scopeFor(s,stage)?.[k])).map(st=>({...resolve(s,st),stageId:st}));return {...selected,question:q,additional,specializationHeld:selected.specializationHeld||conflict||!!e.floodScopeHeld}}

 function setPending(s,q){const p={kind:'next',key:q.id,fieldKey:q.fieldKey,stageId:q.stageId,question:q};if(canServeQuestion(s,p,{})){p.scopeDigest=digest(stable(fieldScope(s,q.fieldKey)));s.pending=p}}
 function bindParsed(s,p){const e=currentEpisode(s);let stage=e.stageId;if(p.stage&&specs.has(p.stage)){stage=p.stage;if(e.stageId&&e.stageId!==stage){retire(s,'stage_changed',p.source);newRound(s,'flood-stage')}e.stageId=stage;e.floodStageConfirmed=true}if(!stage)return;
  e.floodBase||={};if(p.role){e.floodBase.role=p.role;e.floodBase.actorId='self'}if(p.scope.flatId)e.floodBase.flatId=p.scope.flatId;
  const old=scopeFor(s,stage),sameFlat=!p.scope.flatId||p.scope.flatId===old?.flatId;
  const sc={...(sameFlat?old:{}),...e.floodBase,...p.scope};
  if(old&&['role','actorId','flatId','actId'].some(k=>old[k]!==sc[k]))delete sc.actTextAvailable;
  if(/доступн[а-я ]*(?:копи|текст)[а-я ]*(?:этого )?акта/u.test(p.text.toLowerCase()))sc.actTextAvailable=true;
  if(/копи[яю][а-я ]*(?:этого )?акта[а-я ]*(?:потер|утрач|недоступ)|акт[а-я ]*недоступен/u.test(p.text.toLowerCase()))sc.actTextAvailable=false;
  selectScope(s,stage,sc,p.source);
  e.floodUnboundKeys||=[];const ambiguousTypes=[['другая квартира','flatId'],['другой акт','actId'],['новая редакция акта','actId'],['другая редакция акта','actId'],['исправленный акт','actId'],['другая выплата','paymentId'],['другой адресат','addresseeId'],['другой страховщик','insurerId']];
  for(const [text,key]of ambiguousTypes)if(normalizeFlooding(p.text).includes(text)&&!p.scope[key]){if(!e.floodUnboundKeys.includes(key))e.floodUnboundKeys.push(key);const changed={...scopeFor(s,stage)};delete changed[key];if(key==='actId')delete changed.actTextAvailable;selectScope(s,stage,changed,p.source)}
  e.floodUnboundKeys=e.floodUnboundKeys.filter(k=>!p.scope[k]);e.floodScopeHeld=e.floodUnboundKeys.length>0;
 }
 function dispatch(s,input){const prior=s.pending,action=input.guided?.native,text=input.question||'',p=interpretFlooding(s,text,input.turnId);let e=currentEpisode(s),notice=null;
  if(!action&&p.requestedStage){bindParsed(s,{...p,stage:p.requestedStage,scope:{},role:null});e=currentEpisode(s)}
  if(!action&&p.focus&&!p.foreign&&!p.ambiguous){const focus=byField.get(p.focus);if(focus&&focus.stageId===e.stageId){(e.floodFocus||={})[e.stageId]=p.focus;if(s.pending&&s.pending.fieldKey!==p.focus&&!focus.requires.some(r=>r.field_key===s.pending.fieldKey))retire(s,'user_issue_changed',p.source)}}
  if(input.variantId)assert(rows.has(input.variantId),'FLOOD_UNKNOWN_ID');
  if(action){assert(prior&&action.kind==='answer'&&action.questionId===prior.question.id&&action.receiptId===prior.receiptId&&action.policyVersion===policy.version&&action.sourceSha256===SOURCE&&action.nextSha256===NEXT&&action.caseId===s.caseState.id&&action.subjectId===subjectFor(s,prior.fieldKey)&&action.scopeDigest===digest(stable(fieldScope(s,prior.fieldKey)))&&eligible(s,prior.question),'STALE_ACTION');assert(prior.question.controls.some(c=>c.value===action.value&&normalizeFlooding(c.label)===normalizeFlooding(text)),'FLOOD_UNOFFERED_ANSWER')}
  if(!action&&(p.ack||p.confused)&&prior)return {...plan(s),confused:p.confused};
  const reply=action?{value:action.value}:floodingPendingValue(prior,text);
  if(reply&&prior){assert(bindQuestion(s,prior)&&prior.scopeDigest===digest(stable(fieldScope(s,prior.fieldKey)))&&eligible(s,prior.question),'STALE_ACTION');const stored=admit(s,{fieldKey:prior.fieldKey,value:reply.value,source:{...p.source,kind:action?'button':'user_text',questionId:prior.question.id,receiptId:prior.receiptId,basis:'exact_current_offered_predicate'}});assert(stored,'FLOOD_ANSWER_NOT_ADMISSIBLE');answerQuestionReceipt(s,prior,reply.value,p.source);s.pending=null}
  else {
   if(p.newCase&&!p.excluded&&!p.foreign){retire(s,'explicit_new_case',p.source);episode(s,'new-case');prepareState(s);newRound(s,'flood-new-case');e=currentEpisode(s);s.floodDeclined=false}
   e.floodRaw.push({...p.source,stageId:p.stage,proposals:structuredClone(p.facts),disposition:p.excluded?'NONASSERTED':p.foreign||p.ambiguous?'UNBOUND':'RAW_NOT_CONTEXT'});
   if(p.stop){retire(s,'declined',p.source);s.floodDeclined=true}
   if(p.excluded||p.foreign||p.ambiguous){if(p.foreign||p.ambiguous){retire(s,'scope_ambiguity',p.source);e.floodScopeHeld=true;e.floodUnboundKeys||=[];if(!e.floodUnboundKeys.includes('flatId'))e.floodUnboundKeys.push('flatId')}}
   else {
    bindParsed(s,p);e=currentEpisode(s);
    if(p.withdraw){const active=s.factLedger.filter(f=>f.episodeId===e.id&&f.subjectId===subjectFor(s,f.fieldKey)&&['active','conflicted'].includes(f.status)),last=active.at(-1),sameTurn=last?active.filter(f=>f.source.turnId===last.source.turnId):[];if(sameTurn.length===1)admit(s,{fieldKey:last.fieldKey,value:null,operation:'withdraw',source:{...p.source,basis:'explicit_unique_withdrawal'}});else notice='withdrawal_ambiguous';retire(s,'withdrawal',p.source)}
    if(!e.floodScopeHeld)for(const fact of p.facts){const st=fields.get(fact.fieldKey)?.stageId;if(st==='immediate_actions'&&st!==e.stageId){const base={...e.floodBase};selectScope(s,st,base,p.source)}admit(s,fact)}
    if(prior&&s.pending===prior&&p.facts.length)retire(s,'new_observation',p.source);
   }
  }
  let chosen=plan(s);if(s.pending&&!eligible(s,s.pending.question))retire(s,'no_longer_eligible',p.source);
  // A bare yes/no to the neutral access prompt is deliberately left unanswered.
  if(!s.pending&&chosen.question&&!p.excluded&&!p.foreign&&!p.ambiguous)setPending(s,chosen.question);
  if(p.document)notice='document_unavailable';return {...chosen,notice,forceFull:p.repeat,confused:p.confused};
 }
 function present(s,outcome,{turnId=null}={}){const e=currentEpisode(s),responseId=randomUUID();let p=s.pending;if(p&&!serveQuestion(s,p,responseId,turnId||'resume-'+responseId,{})){s.pending=null;p=null}
  const choices=[...(outcome.variantId?[{variantId:outcome.variantId,stageId:rows.get(outcome.variantId).stage.stage.id}]:[]),...(outcome.additional||[])],unique=[...new Map(choices.filter(x=>x.variantId).map(x=>[x.variantId,x])).values()];
  unique.sort((a,b)=>Number(b.stageId==='immediate_actions')-Number(a.stageId==='immediate_actions'));
  s.presentation.floodShown||={};const primary=outcome.variantId&&rows.get(outcome.variantId),primaryFingerprint=primary&&digest(JSON.stringify([primary.row.payload.answer,s.caseState.id,e.id,scopeFor(s,primary.stage.stage.id)])),primaryReference=!outcome.forceFull&&primaryFingerprint?s.presentation.floodShown[primaryFingerprint]:null;const parts=[],shown=[];
  for(const choice of unique){const r=rows.get(choice.variantId),a=r.row.payload.answer,fp=digest(JSON.stringify([a,s.caseState.id,e.id,scopeFor(s,choice.stageId)]));if(!s.presentation.floodShown[fp]||outcome.forceFull){parts.push(a.now,...a.steps,...a.dont,...a.say,...a.laws.map(l=>l.ref+': '+l.short+' ('+l.url+')'));shown.push(r.row);s.presentation.floodShown[fp]=responseId;s.presentation.lastFullResponseId=responseId}}
  if(outcome.notice==='document_unavailable')parts.push('Открытие формы и выгрузка документа здесь пока недоступны. Доступные действия по вашей ситуации остаются выше.');
  if(outcome.notice==='withdrawal_ambiguous')parts.push('Не удалось определить, какое прежнее сообщение вы отзываете. История сохранена.');
  if(outcome.confused)parts.push('Можно описать ситуацию своими словами или оставить ответ неизвестным.');
  if(!parts.length&&unique.length)parts.push('Действия из памятки выше остаются доступны. Новые сведения можно добавить сообщением.');
  if(outcome.specializationHeld)parts.push('Часть обстоятельств пока не подтверждена. Сохранил известные сведения и доступные действия.');
  if(!unique.length&&!parts.length)parts.push('Пока недостаточно сведений, чтобы выбрать памятку по этому заливу.');
  const native={kind:'answer',sessionId:s.id,nonce:s.nonce,revision:s.revision,episodeId:e.id,roundId:s.round?.id,caseId:s.caseState.id,subjectId:p?subjectFor(s,p.fieldKey):null,scopeDigest:p?digest(stable(fieldScope(s,p.fieldKey))):null,policyVersion:policy.version,sourceSha256:SOURCE,nextSha256:NEXT,questionId:p?.question.id,receiptId:p?.receiptId};
  const groups=p?[{type:'choice',questionText:p.question.text,questionId:p.question.id,view:p.question.controls.map(c=>({title:c.label,question:c.label,guided:{native:{...native,value:c.value}}}))}]:[];
  return {conversation:{sessionId:s.id,revision:s.revision,version:s.version,nonce:s.nonce},presentation:{responseId,mode:shown.length?'full':unique.length?'continuation':'boundary',referencesResponseId:primaryReference||(shown.length?null:s.presentation.lastFullResponseId||null),questionsUsed:caseQuestionsUsed(s),policyVersion:policy.version},answer:{category:'flooding',variantId:outcome.variantId||undefined,content:parts.map(escape).join('\n\n'),next:groups,sections:shown.length?{laws:structuredClone(shown.flatMap(r=>r.payload.answer.laws)),documents:structuredClone(shown.flatMap(r=>r.payload.answer.where_to)),documentActionsUnavailable:true}:undefined},dialogue:{stageId:e.stageId||null,questionId:p?.question.id||null,terminal:p?null:outcome.variantId?'variant':'boundary',specializationHeld:!!outcome.specializationHeld}};
 }
 return Object.freeze({categoryId:'flooding',version:policy.version,sourceSha256:SOURCE,nextSha256:NEXT,bundle,policy,next,components,blockedVariantIds:Object.freeze([...heldIds]),validate(candidate,sha){assert(sha===SOURCE&&equal(candidate,bundle),'FLOOD_SOURCE_VERSION_UNAVAILABLE')},prepareState,selectScope,scopeFor,fieldScope,scopeReady,scopedFacts,admit,compatible,resolveFacts,resolve,eligible,plan,dispatch,present,rowFor(id){assert(rows.has(id),'FLOOD_UNKNOWN_ID');return rows.get(id)}});
}
