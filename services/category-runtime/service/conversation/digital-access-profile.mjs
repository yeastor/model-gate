import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {fail} from './errors.mjs';
import {episode,currentEpisode,newRound,recordFact,project,subjectFor,caseQuestionsUsed,canServeQuestion,serveQuestion,answerQuestionReceipt,bindQuestion} from './state.mjs';
import {validateQuestionDefinition} from './questions.mjs';
import {interpretDigitalAccess,normalizeDigitalAccess} from './digital-access-interpret.mjs';
const POLICY='b231fce9fe7a8a3d36efab2264c74fc57ec37cb7a903ac3bfdbeece1d8e19e91';
const digest=b=>createHash('sha256').update(b).digest('hex'),own=(o,k)=>Object.hasOwn(o,k);
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const stable=x=>JSON.stringify(canonical(x)),equal=(a,b)=>stable(a)===stable(b),assert=(v,c)=>{if(!v)fail(c,409)};
const parse=b=>JSON.parse(b.toString('utf8').replace(/^\uFEFF/,'')),tfu=x=>x===true||x===false||x===null;
const escape=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const composites=new Set(['recovery_contacts_verified','twofa_reset']);
const currentStates=new Set(['access_lost','number_recovered','sim_access_available','unauthorized_sessions_active','remote_access_active','device_isolated','sim_blocked']);
export async function createDigitalAccessProfile({policyBytes,sourceBytes={},componentBytes={}}={}){
 policyBytes||=fs.readFileSync(new URL('./policy/digital-access.v1.json',import.meta.url));
 assert(digest(policyBytes)===POLICY,'DA_POLICY_PIN_MISMATCH');const policy=parse(policyBytes);
 function bytes(p,override){const b=override||fs.readFileSync(p.path);assert(b.length===p.bytes&&digest(b)===p.sha256,'DA_SOURCE_PIN_MISMATCH');return b;}
 const stages=policy.stages.map(x=>parse(bytes(x.source,sourceBytes[x.stageId]))),components={};
 for(const [key,p]of Object.entries(policy.sources))components[key]=bytes(p,componentBytes[key]);
 // Import only the accepted pure fact/composition helpers after their exact-byte checks.
 const {normaliseFacts,nextSecureField}=await import(pathToFileURL(policy.sources.helper.path).href);
 const {displayAnswer}=await import(pathToFileURL(policy.sources.presentation.path).href);
 const next=parse(components.NEXT),qcatalog=parse(components.questions),decision=parse(components.decision);
 const bundle={category:stages[0].category,metadata:{private:true,sourceCount:8},subcategories:stages.map(x=>x.subcategories[0])};
 const sourceSha256=digest(stable({stages:policy.stages.map(x=>x.source),components:policy.sources,policySha256:POLICY})),nextSha256=policy.sources.NEXT.sha256;
 assert(policy.categoryId==='digital_access'&&policy.defaultActivation===false&&policy.maxQuestionsPerCase===2&&equal(policy.thirdQuestionReasons,{})&&next.model_fingerprint===policy.modelFingerprint&&qcatalog.model_fingerprint===policy.modelFingerprint,'DA_PRIVATE_POLICY');
 const fields=new Map(policy.fields.map(f=>[f.fieldKey,f])),questions=new Map(qcatalog.questions.map(q=>[q.key,q])),specs=new Map(policy.stages.map(s=>[s.stageId,s])),rows=new Map(),stageMap=new Map(bundle.subcategories.map(s=>[s.stage.id,s]));
 for(const stage of bundle.subcategories){
  assert(equal(stage.context_fields.map(f=>f.id),policy.fields.filter(f=>f.stageId===stage.stage.id).map(f=>f.fieldId)),'DA_FIELD_ORDER');
  for(const row of stage.variants){assert(!rows.has(row.variant_id)&&equal(Object.keys(row.context),stage.context_fields.map(f=>f.id))&&Object.values(row.context).every(tfu),'DA_ROW_CONTEXT');rows.set(row.variant_id,{row,stage});}
 }
 assert(rows.size===291&&fields.size===56&&questions.size===43&&stages.length===8,'DA_INVENTORY');
 const proof=parse(components.full_evidence);
 for(const e of proof.current291){const r=rows.get(e.variant_id)?.row;assert(r&&equal(e.full_context,r.context)&&e.retrieval_question===r.question&&equal(e.full_answer,r.payload.answer),'DA_CURRENT_STATIC_BINDING');}
 assert(proof.current291.length===291&&proof.current2529.length===2529,'DA_DISPLAY_COUNT');
 let nodes=0,branches=0;const engine={bundle,rowFor(id){assert(rows.has(id),'DA_UNKNOWN_ID');return rows.get(id);}};
 function check(q,stage){nodes++;const def=questions.get('digital_access.'+stage+'.'+q.field_key);assert(def&&def.question===q.question&&equal(def.buttons,q.data.map(b=>[b.value,b.label])),'DA_QUESTION_BINDING');validateQuestionDefinition({id:q.id,branches:q.data.map(b=>({value:b.value,kind:'stage',stageId:stage}))},engine);for(const b of q.data){branches++;if(b.ask_next_question)check(b.ask_next_question,stage);else assert(rows.get(b.go_to_variant)?.stage.stage.id===stage,'DA_TARGET_BINDING');}}
 for(const s of next.subcategories)for(const r of s.variants){assert(rows.get(r.variant_id)?.stage.stage.id===s.stage.id,'DA_NEXT_ROW');for(const q of r.next)check(q,s.stage.id);}
 assert(nodes===1038&&branches===3114,'DA_WIRE_INVENTORY');
 const acceptance=parse(components.accepted_bindings);assert(acceptance.current_target_bindings.length===3552&&acceptance.accepted_nodes===1184,'DA_ACCEPTED_DM_BINDINGS');
 const blocked=new Set(policy.fields.filter(f=>f.status==='HELD_QUALIFIED_PRODUCER'||f.status==='DERIVED_ONLY').map(f=>f.fieldKey));
 function selectFacts(stage,raw){
  const st=stageMap.get(stage);assert(st,'DA_UNKNOWN_STAGE');
  for(const[k,v]of Object.entries(raw))assert(st.context_fields.some(f=>f.id===k)&&tfu(v),'DA_INVALID_FACT');
  const semantic=normaliseFacts(stage,raw);let facts=semantic.facts,held=semantic.conflicts.length>0;
  if(held){facts={...facts};delete facts.backup_codes_supported;delete facts.backup_codes_reset;delete facts.twofa_reset;}
  if(stage==='email_compromised'){const n=facts.service_is_google!==true?1:(facts.access_lost===true||facts.recovery_contacts_changed===true||facts.twofa_lost===true)?3:2;return {variantId:st.variants[n-1].variant_id,specializationHeld:held,facts};}
  const candidates=st.variants.filter(v=>Object.entries(v.context).every(([k,x])=>x===null||(own(facts,k)&&facts[k]===x))),score=v=>Object.values(v.context).filter(x=>x!==null).length,max=Math.max(...candidates.map(score)),winners=candidates.filter(v=>score(v)===max);
  return {variantId:winners.length===1?winners[0].variant_id:specs.get(stage).generalId,specializationHeld:held||winners.length!==1,facts};
 }
 const model={stageMap,selectCurrent(_m,stage,facts){const r=selectFacts(stage,facts);return {status:'SAFE_EXISTING_ANSWER',answer_id:r.variantId};}};
 function currentDisplay(stage,raw){const r=selectFacts(stage,raw),shown=displayAnswer(model,stage,r.facts);return {...r,answer:shown.answer,display_changes:shown.display_changes||[],applicability:shown.applicability};}
 function init(s){const e=currentEpisode(s);e.daScopes||={};e.daScopeHistory||={};e.categorySubjects||={};e.daRaw||=[];e.daEvents||=[];e.daUserTurns||=[];e.daFlow||={};}
 function prepareState(s){assert(!s.categoryId||s.categoryId==='digital_access','DA_SAVED_CATEGORY_MISMATCH');assert(!s.daPolicyVersion||s.daPolicyVersion===policy.version,'DA_POLICY_VERSION_UNAVAILABLE');assert(!(s.revision>0&&!s.daPolicyVersion),'DA_POLICY_VERSION_UNAVAILABLE');s.categoryId='digital_access';s.categoryFieldKeys=[...fields.keys()];s.categoryBlockedFields=[...blocked];s.categoryScopeGroups=Object.fromEntries(policy.fields.map(f=>[f.fieldKey,f.group]));s.policyVersion=policy.version;s.daPolicyVersion=policy.version;init(s);}
 const scopeFor=(s,stage)=>currentEpisode(s).daScopes[stage]?.values||null;
 function fieldScope(s,key){const def=fields.get(key),sc=def&&scopeFor(s,def.stageId);if(!sc)return null;const keys=[...def.scopeKeys,'providerId'];if(def.fieldId.startsWith('recovery_email_'))keys.push('emailSettingId');if(def.fieldId.startsWith('recovery_phone_'))keys.push('phoneSettingId');if(def.stageId==='sim_swap'||def.fieldId==='sim_blocked'||def.fieldId==='sim_access_available')keys.push('SIMId','numberId','operatorId');return {caseId:s.caseState.id,episodeId:s.activeEpisodeId,ownerId:s.userId,...Object.fromEntries([...new Set(keys)].map(k=>[k,sc[k]??null]))};}
 function validSource(src){return src?.turnId&&typeof src.message==='string'&&src.quote&&Array.isArray(src.span)&&src.span.length===2&&src.span.every(Number.isInteger)&&src.span[0]>=0&&src.span[1]>=src.span[0]&&src.span[1]<=Array.from(src.message).length&&Array.from(src.message).slice(...src.span).join('')===src.quote&&src.sourceSha256===sourceSha256&&src.nextSha256===nextSha256&&src.policyVersion===policy.version&&src.modelFingerprint===policy.modelFingerprint&&src.freshness!=='stale'&&src.conflict!==true&&Number.isFinite(Date.parse(src.observationRecordedAt))&&Date.parse(src.observationRecordedAt)<=Date.now();}
 // Revalidate persisted evidence against the original user turn and finite grammar.
 function originalTurn(s,src){return src?.kind==='user_text'||['button','question_reply'].includes(src?.kind)?currentEpisode(s).daUserTurns.some(t=>t.turnId===src.turnId&&t.quote===src.message):false;}
 function quoted(src){return typeof src?.message==='string'&&typeof src.quote==='string'&&Array.isArray(src.span)&&src.span.length===2&&src.span.every(Number.isInteger)&&src.span[0]>=0&&src.span[1]>=src.span[0]&&src.span[1]<=Array.from(src.message).length&&Array.from(src.message).slice(...src.span).join('')===src.quote;}
 function parseAt(s,stage,src){return interpretDigitalAccess({...s,episodes:s.episodes.map(e=>e.id===s.activeEpisodeId?{...e,stageId:stage}:e)},src.message,src.turnId,policy);}
 function observedScope(s,stage){
  const e=currentEpisode(s),item=e.daScopes[stage];if(!item)return false;
  for(const [key,value]of Object.entries(item.values)){
   const src=item.evidence[key];if(!originalTurn(s,src)||src.kind!=='user_text'||!quoted(src))return false;
   const parsed=parseAt(s,stage,src);if(parsed.excluded||parsed.foreign||parsed.ambiguous)return false;
   const route=parsed.stage===stage&&parsed.routeSource&&equal(parsed.routeSource.span,src.span);
   const initial=route&&((key==='actorId'&&value==='self')||(key==='subjectId'&&value==='reported-current:'+stage)||(key==='eventId'&&value===e.id));
   const setting=(key==='emailSettingId'||key==='phoneSettingId')&&value===src.turnId&&parsed.rawEvents.some(x=>x.kind===(key==='emailSettingId'?'email_setting_changed':'phone_setting_changed')&&equal(x.source.span,src.span));
   if(!initial&&!setting&&!(parsed.scope[key]===value&&equal(parsed.scopeEvidence[key]?.span,src.span)))return false;
  }return true;
 }
 function observedAnswer(s,key,value,src){
  if(!originalTurn(s,src)||!validSource(src)||!quoted(src))return false;
  const r=s.caseState.served.find(r=>r.id===src.receiptId),q=questions.get(key);
  return !!r&&r.caseId===s.caseState.id&&r.episodeId===s.activeEpisodeId&&r.fieldKey===key&&r.subjectId===subjectFor(s,key)&&r.questionId===src.questionId&&r.status==='answered'&&!r.answer?.disposition&&r.answer?.value===value&&q?.buttons.some(([v,label])=>v===value&&normalizeDigitalAccess(label)===normalizeDigitalAccess(src.message))&&src.quote===src.message&&equal(src.span,[0,Array.from(src.message).length]);
 }
 function observedRecord(s,f,{conflicted=false}={}){
  const src=f.source;if(!originalTurn(s,src)||!validSource(src)||!quoted(src))return false;
  if(['button','question_reply'].includes(src.kind))return observedAnswer(s,f.fieldKey,f.value,src);
  if(src.kind!=='user_text')return false;
  const parsed=parseAt(s,fields.get(f.fieldKey)?.stageId,src);
  if(parsed.excluded||parsed.foreign||parsed.ambiguous)return false;
  if(f.operation==='withdraw'&&parsed.withdraw)return f.value===null&&f.supersedes?.length===1;
  return parsed.facts.some(x=>x.fieldKey===f.fieldKey&&(x.value===f.value||(conflicted&&f.status==='conflicted'))&&(x.operation===f.operation||(f.operation==='withdraw'&&x.operation==='correct'&&x.value===null))&&x.source.quote===src.quote&&equal(x.source.span,src.span));
 }
 function scopeReady(s,stage,key=null){const sc=scopeFor(s,stage),keys=key?fields.get(key)?.scopeKeys:['actorId','subjectId','eventId'];return !!sc&&observedScope(s,stage)&&sc.actorId==='self'&&!!keys&&keys.every(k=>typeof sc[k]==='string'&&sc[k].trim());}
 function retire(s,reason,src={}){if(!s.pending)return;answerQuestionReceipt(s,s.pending,null,{...src,kind:reason});const r=s.caseState.served.find(r=>r.id===s.pending.receiptId);if(r?.answer)r.answer.disposition=reason;s.pending=null;}
 function refreshSubjects(s,stage){const e=currentEpisode(s);for(const f of policy.fields.filter(f=>f.stageId===stage)){const value=stable(fieldScope(s,f.fieldKey)),history=e.daScopeHistory[f.group]||={};e.categorySubjects[f.group]={current:history[value]||=randomUUID()};}}
 function selectScope(s,stage,patch,src,{route=false}={}){
  assert(specs.has(stage)&&src?.kind==='user_text'&&src.message&&src.turnId,'DA_SCOPE_REQUIRED');
  const parsed=interpretDigitalAccess(s,src.message,src.turnId,policy);assert(!parsed.excluded&&!parsed.foreign&&!parsed.ambiguous,'DA_SCOPE_UNOBSERVED');
  if(!route)assert(Object.entries(patch).every(([k,v])=>own(parsed.scope,k)&&parsed.scope[k]===v),'DA_SCOPE_UNOBSERVED');
  else assert(parsed.stage===stage&&parsed.routeSource,'DA_SCOPE_UNOBSERVED');
  const e=currentEpisode(s),old=e.daScopes[stage]||{values:{},evidence:{}},values={...old.values,...patch},evidence={...old.evidence};
  if(route&&!old.values.subjectId){values.actorId='self';values.subjectId='reported-current:'+stage;values.eventId=e.id;for(const k of ['actorId','subjectId','eventId'])evidence[k]=parsed.routeSource;}
  if(patch.subjectId&&old.values.subjectId&&patch.subjectId!==old.values.subjectId){for(const k of Object.keys(values))if(!['actorId','eventId','subjectId'].includes(k)&&!own(patch,k)){delete values[k];delete evidence[k];}delete e.daFocus;}
  for(const[k]of Object.entries(patch))evidence[k]=parsed.scopeEvidence[k]||src;
  if(stable(values)!==stable(old.values)){retire(s,'scope_changed',src);e.daFlow[stage]=[];s.nonce=randomUUID();}
  e.daScopes[stage]={values,evidence};refreshSubjects(s,stage);return scopeReady(s,stage);
 }
 const currentRecord=(s,key)=>s.factLedger.findLast(f=>f.episodeId===s.activeEpisodeId&&f.fieldKey===key&&f.subjectId===subjectFor(s,key)&&['active','conflicted'].includes(f.status));
 function validRecord(s,f,seen=new Set()){if(!f||seen.has(f.id))return false;seen.add(f.id);const def=fields.get(f.fieldKey);return def&&!blocked.has(f.fieldKey)&&f.status==='active'&&tfu(f.value)&&f.caseId===s.caseState.id&&f.episodeId===s.activeEpisodeId&&f.subjectId===subjectFor(s,f.fieldKey)&&scopeReady(s,def.stageId,f.fieldKey)&&observedRecord(s,f)&&equal(f.source.scope,fieldScope(s,f.fieldKey))&&(!f.dependencies?.length||f.dependencies.every(id=>validRecord(s,s.factLedger.find(x=>x.id===id),new Set(seen))));}
 function invalidate(s,id){const invalid=new Set([id]);let changed=true;while(changed){changed=false;for(const r of s.factLedger)if(r.status==='active'&&r.dependencies?.some(k=>invalid.has(k))){r.status='invalidated';invalid.add(r.id);changed=true;}}}
 function receipt(s,key){return s.caseState.served.findLast(r=>r.caseId===s.caseState.id&&r.episodeId===s.activeEpisodeId&&r.fieldKey===key&&r.subjectId===subjectFor(s,key)&&r.status==='answered'&&!r.answer?.disposition&&own(r.answer||{},'value')&&tfu(r.answer.value)&&['button','question_reply'].includes(r.answer.source?.kind)&&r.answer.source.questionId===r.questionId&&r.answer.source.receiptId===r.id&&observedAnswer(s,key,r.answer.value,r.answer.source)&&equal(r.answer.source.scope,fieldScope(s,key)));}
 function known(s,key){const r=currentRecord(s,key);if(validRecord(s,r))return {value:r.value};const last=s.factLedger.findLast(f=>f.fieldKey===key&&f.episodeId===s.activeEpisodeId&&f.subjectId===subjectFor(s,key));if(r?.status==='conflicted'||last?.status==='invalidated')return null;const a=receipt(s,key);if(key.endsWith('_owned')&&known(s,key.replace(/_owned$/u,'_checked'))?.value!==true)return null;return a?{value:a.answer.value}:null;}
 function scopedFacts(s,stage){const out={};for(const f of policy.fields.filter(f=>f.stageId===stage&&!blocked.has(f.fieldKey))){const r=known(s,f.fieldKey);if(r)out[f.fieldId]=r.value;}return out;}
 function makeSource(s,key,src){return {...src,scope:fieldScope(s,key),caseId:s.caseState.id,episodeId:s.activeEpisodeId,sourceSha256,nextSha256,modelFingerprint:policy.modelFingerprint,policyVersion:policy.version,observationRecordedAt:new Date().toISOString(),eventTimeBasis:'reader_report_current_episode_not_calendar_certification'};}
 function admit(s,f){
  const def=fields.get(f.fieldKey),src=f.source;if(!def||blocked.has(f.fieldKey)||!own(f,'value')||!tfu(f.value)||!scopeReady(s,def.stageId,f.fieldKey)||!src?.turnId||!src.message||!src.quote)return null;
  if(!originalTurn(s,src))return null;
  if(f.operation==='later'&&!currentStates.has(def.fieldId))return null;
  if((src.caseId&&src.caseId!==s.caseState.id)||(src.episodeId&&src.episodeId!==s.activeEpisodeId)||(src.scope&&!equal(src.scope,fieldScope(s,f.fieldKey)))||(src.sourceSha256&&src.sourceSha256!==sourceSha256)||(src.nextSha256&&src.nextSha256!==nextSha256)||(src.policyVersion&&src.policyVersion!==policy.version))return null;
  if(src.kind==='user_text'){const parsed=interpretDigitalAccess(s,src.message,src.turnId,policy);if(!parsed.facts.some(x=>x.fieldKey===f.fieldKey&&x.value===f.value&&x.operation===(f.operation||'assert')&&x.source.quote===src.quote&&equal(x.source.span,src.span)))return null;}
  else if(['button','question_reply'].includes(src.kind)){const p=s.pending;if(!p||p.fieldKey!==f.fieldKey||p.question.id!==src.questionId||p.receiptId!==src.receiptId||!p.question.controls.some(c=>c.value===f.value&&normalizeDigitalAccess(c.label)===normalizeDigitalAccess(src.message)))return null;}
  else return null;
  const deps=[...(f.dependencies||[])];
  if(def.fieldId.endsWith('_owned')){const k=f.fieldKey.replace(/_owned$/u,'_checked'),checked=currentRecord(s,k);if(!validRecord(s,checked)||checked.value!==true)return null;deps.push(checked.id);}
  if(deps.some(id=>!validRecord(s,s.factLedger.find(x=>x.id===id))))return null;
  const old=currentRecord(s,f.fieldKey),source=makeSource(s,f.fieldKey,src);if(!validSource(source))return null;
  if(f.operation==='correct'&&(!old||!observedRecord(s,old,{conflicted:true})||!equal(old.source.scope,fieldScope(s,f.fieldKey))))return null;
  const operation=f.operation==='correct'&&f.value===null?'withdraw':f.operation||'assert';
  const stored=recordFact(s,f.fieldKey,f.value,source,operation,[...new Set(deps)]);
  if(old&&stored.id!==old.id)invalidate(s,old.id);
  if(['correct','withdraw','later'].includes(f.operation))for(const r of s.factLedger)if(r.id!==stored.id&&r.fieldKey===f.fieldKey&&r.subjectId===stored.subjectId&&r.status==='conflicted')r.status='superseded';
  if(!old||stored.id!==old.id)currentEpisode(s).daEvents.push({kind:'fact',id:stored.id,turnId:src.turnId});
  return stored;
 }
 function nextField(stage,facts,focus){
  const semantic=normaliseFacts(stage,facts).facts;
  if(stage==='secure_after')return nextSecureField(semantic,focus);
  if(stage==='email_compromised'){if(!own(facts,'service_is_google'))return 'service_is_google';if(facts.service_is_google!==true)return null;if(facts.access_lost===true||facts.recovery_contacts_changed===true||facts.twofa_lost===true)return null;return !own(facts,'access_lost')?'access_lost':null;}
  return policy.priority[stage].find(k=>!own(facts,k))||null;
 }
 function question(s,stage,field){const trail=currentEpisode(s).daFlow[stage]||[],q=questions.get('digital_access.'+stage+'.'+field);assert(q,'DA_QUESTION_UNAVAILABLE');return {id:'q_da_'+stage+'_'+[...trail,field].join('_then_'),fieldKey:q.key,stageId:stage,text:q.question,controls:q.buttons.map(([value,label])=>({value,label}))};}
 function eligible(s,q){if(!scopeReady(s,q.stageId,q.fieldKey)||blocked.has(q.fieldKey)||known(s,q.fieldKey)||currentRecord(s,q.fieldKey)?.status==='conflicted')return false;const f=scopedFacts(s,q.stageId);return nextField(q.stageId,f,currentEpisode(s).daFocus||null)===q.fieldKey.split('.').at(-1);}
 function plan(s){
  const e=currentEpisode(s),stage=e.stageId;if(!specs.has(stage))return {variantId:null,question:null,specializationHeld:true};
  const facts=scopedFacts(s,stage),chosen=selectFacts(stage,facts),conflict=s.factLedger.some(f=>f.episodeId===e.id&&f.fieldKey.startsWith('digital_access.'+stage+'.')&&f.subjectId===subjectFor(s,f.fieldKey)&&f.status==='conflicted');
  const safe=scopeReady(s,stage)?chosen:{variantId:specs.get(stage).generalId,facts:{},specializationHeld:true};
  const field=!s.daDeclined&&!conflict&&!e.daCorrectionHeld?.[stage]&&(s.pending||caseQuestionsUsed(s)<2)&&nextField(stage,facts,e.daFocus||null);
  const q=field?question(s,stage,field):null;
  return {...safe,specializationHeld:safe.specializationHeld||conflict||!!e.daCorrectionHeld?.[stage],question:q&&eligible(s,q)?q:null};
 }
 function setPending(s,q){const p={kind:'next',key:q.id,fieldKey:q.fieldKey,stageId:q.stageId,question:q};if(canServeQuestion(s,p,{})){p.scopeDigest=digest(stable(fieldScope(s,q.fieldKey)));s.pending=p;}}
 function withdraw(s,src){
  const e=currentEpisode(s),previous=e.daUserTurns.filter(t=>t.turnId!==src.turnId).at(-1),events=e.daEvents.filter(x=>x.turnId===previous?.turnId);if(events.length!==1)return false;
  const old=s.factLedger.find(x=>x.id===events[0].id);if(!old||!['active','conflicted'].includes(old.status)||old.subjectId!==subjectFor(s,old.fieldKey)||!observedRecord(s,old,{conflicted:true})||!equal(old.source.scope,fieldScope(s,old.fieldKey)))return false;
  const stored=recordFact(s,old.fieldKey,null,makeSource(s,old.fieldKey,src),'withdraw');invalidate(s,old.id);for(const r of s.factLedger)if(r.id!==stored.id&&r.fieldKey===old.fieldKey&&r.subjectId===old.subjectId&&r.status==='conflicted')r.status='superseded';e.daEvents.push({kind:'fact',id:stored.id,turnId:src.turnId});return true;
 }
 function dispatch(s,input){
  const text=input.question||'',action=input.guided?.native,prior=s.pending,p=interpretDigitalAccess(s,text,input.turnId,policy);let e=currentEpisode(s),notice=null;
  if(input.variantId)assert(rows.has(input.variantId),'DA_UNKNOWN_ID');
  if(input.turnId&&text)e.daUserTurns.push({turnId:input.turnId,quote:text});
  if(action){assert(prior&&action.kind==='answer'&&action.questionId===prior.question.id&&action.receiptId===prior.receiptId&&action.fieldKey===prior.fieldKey&&action.policyVersion===policy.version&&action.sourceSha256===sourceSha256&&action.nextSha256===nextSha256&&action.modelFingerprint===policy.modelFingerprint&&action.caseId===s.caseState.id&&action.subjectId===subjectFor(s,prior.fieldKey)&&action.scopeDigest===digest(stable(fieldScope(s,prior.fieldKey)))&&eligible(s,prior.question)&&plan(s).question?.id===prior.question.id,'STALE_ACTION');assert(prior.question.controls.some(c=>c.value===action.value&&c.label===text),'DA_UNOFFERED_ANSWER');}
  const control=prior?.question.controls.find(c=>normalizeDigitalAccess(c.label)===normalizeDigitalAccess(text));
  if(prior&&(action||control)){
   assert(bindQuestion(s,prior)&&eligible(s,prior.question)&&plan(s).question?.id===prior.question.id&&prior.scopeDigest===digest(stable(fieldScope(s,prior.fieldKey))),'STALE_ACTION');
   const value=action?action.value:control.value,src={...p.source,kind:action?'button':'question_reply',questionId:prior.question.id,receiptId:prior.receiptId},stored=admit(s,{fieldKey:prior.fieldKey,value,source:src});assert(stored,'DA_ANSWER_NOT_ADMISSIBLE');answerQuestionReceipt(s,prior,value,stored.source);s.pending=null;e.daFlow[e.stageId]=[...(e.daFlow[e.stageId]||[]),prior.fieldKey.split('.').at(-1)];
  }else if(!action){
   e.daRaw.push({...p.source,stage:p.stage,proposals:p.facts,excluded:p.excluded,foreign:p.foreign,ambiguous:p.ambiguous});
   if(p.newCase&&!p.excluded&&!p.foreign&&!p.ambiguous&&p.stage){retire(s,'new_case',p.source);episode(s,'new-case');prepareState(s);newRound(s,'da-new-case');e=currentEpisode(s);e.daUserTurns.push({turnId:input.turnId,quote:text});s.daDeclined=false;}
   if(p.unresolvedCorrection&&!p.foreign){(e.daCorrectionHeld||={})[e.stageId]=true;retire(s,'unresolved_correction',p.source);}
   if(!p.excluded&&!p.foreign&&!p.ambiguous){
    if(p.stage){if(p.stage!==e.stageId){retire(s,'stage_changed',p.source);newRound(s,'da-stage');e.stageId=p.stage;}selectScope(s,p.stage,{},p.source,{route:true});}
    if(e.stageId&&Object.keys(p.scope).length)selectScope(s,e.stageId,p.scope,p.source);
    if(p.focus&&e.stageId==='secure_after'&&p.focus!==e.daFocus){retire(s,'focus_changed',p.source);e.daFocus=p.focus;e.daFlow[e.stageId]=[];}
    if(p.stop){retire(s,'declined',p.source);s.daDeclined=true;}
    if(p.withdraw){notice=withdraw(s,p.source)?'withdrawn':'withdrawal_ambiguous';retire(s,'withdrawal',p.source);e.daFlow[e.stageId]=[];}
    for(const ev of p.rawEvents){e.daEvents.push({...ev,scope:structuredClone(scopeFor(s,e.stageId)),turnId:input.turnId});if(ev.kind.endsWith('_setting_changed')&&scopeReady(s,e.stageId)){const key=ev.kind.startsWith('email')?'emailSettingId':'phoneSettingId';e.daScopes[e.stageId].values[key]=input.turnId;e.daScopes[e.stageId].evidence[key]=ev.source;refreshSubjects(s,e.stageId);retire(s,'setting_changed',p.source);e.daFlow[e.stageId]=[];}}
    for(const fact of p.facts){const stored=admit(s,fact);if(stored&&stored.id!==currentRecord(s,fact.fieldKey)?.supersedes?.[0]){if(fact.operation==='correct'&&e.daCorrectionHeld)delete e.daCorrectionHeld[e.stageId];if(s.pending&&(s.pending.fieldKey===fact.fieldKey||fact.operation!=='assert'))retire(s,'observation_changed',p.source);e.daFlow[e.stageId]=[];}}
   }
  }
  const chosen=plan(s);if(s.pending&&(!eligible(s,s.pending.question)||chosen.question?.id!==s.pending.question.id))retire(s,'no_longer_eligible',p.source);
  if(!s.pending&&chosen.question&&!p.excluded&&!p.foreign&&!p.ambiguous)setPending(s,chosen.question);
  if(p.document)notice='document_unavailable';return {...chosen,notice,forceFull:p.repeat,confused:p.confused};
 }
 function present(s,outcome,{turnId=null}={}){
  const e=currentEpisode(s),stage=e.stageId,responseId=randomUUID(),parts=[];let pending=s.pending;
  if(pending&&(!eligible(s,pending.question)||plan(s).question?.id!==pending.question.id||!serveQuestion(s,pending,responseId,turnId||'resume-'+responseId,{}))){s.pending=null;pending=null;}
  const id=outcome.variantId&&rows.has(outcome.variantId)?outcome.variantId:null,display=id?currentDisplay(stage,scopeReady(s,stage)?scopedFacts(s,stage):{}):null;
  assert(!display||display.variantId===id,'DA_STALE_DISPLAY_BINDING');const a=display?.answer,fp=a&&digest(stable([a,s.caseState.id,e.id,scopeFor(s,stage)]));
  s.presentation.daShown||={};const previous=fp&&s.presentation.daShown[fp],full=!!a&&(!previous||outcome.forceFull);
  if(full){parts.push(a.now,...a.steps,...a.dont,...a.say,...a.laws.map(l=>l.ref+': '+l.short+' ('+l.url+')'));s.presentation.daShown[fp]=responseId;s.presentation.lastFullResponseId=responseId;}
  if(outcome.notice==='document_unavailable')parts.push('Открытие формы и выгрузка документа здесь пока недоступны. Доступные действия по вашей ситуации сохранены.');
  if(outcome.notice==='withdrawal_ambiguous')parts.push('Не удалось однозначно определить прежнее сообщение. История сохранена.');
  if(outcome.confused)parts.push('Можно описать происходящее своими словами или оставить ответ неизвестным.');
  if(!parts.length)parts.push(id?'Действия из памятки выше остаются доступны. Новые сведения можно добавить сообщением.':'Опишите, что произошло с вашим аккаунтом, номером или устройством.');
  if(outcome.specializationHeld)parts.push('Часть уточнённых действий требует дополнительных подтверждённых обстоятельств. Доступная помощь по известным фактам сохранена.');
  const native=pending&&{kind:'answer',sessionId:s.id,nonce:s.nonce,revision:s.revision,episodeId:e.id,roundId:s.round?.id,caseId:s.caseState.id,subjectId:subjectFor(s,pending.fieldKey),scopeDigest:digest(stable(fieldScope(s,pending.fieldKey))),fieldKey:pending.fieldKey,questionId:pending.question.id,receiptId:pending.receiptId,policyVersion:policy.version,sourceSha256,nextSha256,modelFingerprint:policy.modelFingerprint};
  const groups=pending?[{type:'choice',questionText:pending.question.text,questionId:pending.question.id,view:pending.question.controls.map(c=>({title:c.label,question:c.label,guided:{native:{...native,value:c.value}}}))}]:[];
  return {conversation:{sessionId:s.id,revision:s.revision,version:s.version,nonce:s.nonce},presentation:{responseId,mode:full?'full':id?'continuation':'boundary',referencesResponseId:full?null:previous||s.presentation.lastFullResponseId||null,questionsUsed:caseQuestionsUsed(s),policyVersion:policy.version},answer:{category:'digital_access',variantId:id||undefined,content:parts.map(escape).join('\n\n'),next:groups,sections:full?{laws:structuredClone(a.laws),documents:structuredClone(a.where_to),documentActionsUnavailable:true}:undefined},dialogue:{stageId:stage||null,questionId:pending?.question.id||null,terminal:pending?null:id?'variant':'boundary',specializationHeld:!!outcome.specializationHeld,displayChanges:display?.display_changes,applicability:display?.applicability}};
 }
 freeze(bundle);freeze(policy);freeze(next);
 return Object.freeze({categoryId:'digital_access',version:policy.version,sourceSha256,nextSha256,bundle,next,policy,decision,components,validate(candidate,sha){assert(sha===sourceSha256&&equal(candidate,bundle),'DA_SOURCE_VERSION_UNAVAILABLE');},prepareState,scopeFor,fieldScope,scopeReady,selectScope,scopedFacts,validRecord,admit,known,resolveFacts:selectFacts,currentDisplay,plan,dispatch,present,rowFor(id){assert(rows.has(id),'DA_UNKNOWN_ID');return rows.get(id);}});
}

