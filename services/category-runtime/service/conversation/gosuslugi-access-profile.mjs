import {naturalSourceRole} from './gosuslugi-access-natural.mjs';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {fail} from './errors.mjs';
import {episode,currentEpisode,newRound,recordFact,project,subjectFor,caseQuestionsUsed,canServeQuestion,serveQuestion,answerQuestionReceipt,bindQuestion} from './state.mjs';
import {validateQuestionDefinition} from './questions.mjs';
import {interpretGosuslugi,parseGosuslugiScope,normalizeGosuslugi,auxiliaryObservations} from './gosuslugi-access-interpret.mjs';
const SOURCE='c18a73b8e31b12361dc151918211a98728ddd4f7c5c1fe338aa2775e6b981622';
const NEXT='3b81dbe31b90f91907dcbfc4f8d9eab7afa953b9a635661bf7dc4c002e55793f';
const POLICY='10bf8f0d1595b01cc3b65870710d1a250c5574467580c7c1dc795811abcd0548';
const digest=v=>createHash('sha256').update(v).digest('hex'),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),own=(o,k)=>Object.hasOwn(o,k);
const stable=o=>JSON.stringify(Object.fromEntries(Object.entries(o||{}).sort(([a],[b])=>a.localeCompare(b))));
const assert=(v,c)=>{if(!v)fail(c,409)},parse=b=>JSON.parse(b.toString('utf8').replace(/^\uFEFF/,''));
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o)}return o};
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const valueHash=v=>digest(JSON.stringify(v));
const signature=c=>stable(Object.fromEntries(Object.entries(c).filter(([,v])=>v===true)));
const entryKeys={lost_access:['attemptId'],account_hacked:['securityEventId'],number_or_email_changed:['changeId'],unauthorized_services:['serviceId','recordId'],credit_or_loans:[],restore_mfc_bank:['recoveryId'],secure_account:['securityEventId'],temporary_block:['noticeId','functionId']};
const currentStateFields=new Set(['old_phone_unavailable','old_phone_available','old_email_available','access_lost','login_available','temporary_block_active','two_factor_enabled','unauthorized_action_pending','block_end_time_known']);

// Explicit local option only. The public bundle validator and server defaults stay intact.
export function createGosuslugiAccessProfile({categoryBytes,nextBytes,policyBytes,componentBytes={}}={}) {
  policyBytes ||=fs.readFileSync(new URL('./policy/gosuslugi-access.v1.json',import.meta.url));
  assert(digest(policyBytes)===POLICY,'GA_POLICY_PIN_MISMATCH');const policy=parse(policyBytes);
  function pinned(bytes,p){assert(bytes.length===p.bytes&&digest(bytes)===p.sha256,'GA_SOURCE_PIN_MISMATCH');return parse(bytes)}
  const bundle=pinned(categoryBytes||fs.readFileSync(policy.source.path),policy.source),next=pinned(nextBytes||fs.readFileSync(policy.NEXT.path),policy.NEXT),components={};
  for(const [name,p] of Object.entries(policy.components))components[name]=pinned(componentBytes[name]||fs.readFileSync(p.path),p);
  assert(policy.source.sha256===SOURCE&&policy.NEXT.sha256===NEXT&&policy.categoryId==='gosuslugi_access'&&policy.defaultActivation===false,'GA_PRIVATE_SOURCE');
  assert(equal(Object.keys(bundle),['artifact_kind','assembly_id','canonical_stage_order','category','metadata','readiness','schema_version','source','stage_count','subcategories','variant_count']),'GA_PRIVATE_ENVELOPE');
  const fields=new Map(policy.fields.map(f=>[f.fieldKey,f])),questions=new Map(policy.questions.map(q=>[q.id,q])),specs=new Map(policy.stages.map(s=>[s.stageId,s])),rows=new Map(),bindings=new Map(policy.bindings.map(b=>[b.variantId,b])),materials=new Map(),roots=new Map();
  for(const stage of bundle.subcategories){const keys=stage.context_fields.map(f=>f.id);for(const f of keys)assert(fields.has('gosuslugi_access.'+stage.stage.id+'.'+f),'GA_FIELD_BINDING');
    for(const row of stage.variants){const b=bindings.get(row.variant_id);assert(!rows.has(row.variant_id)&&equal(Object.keys(row.context).sort(),[...keys].sort())&&Object.values(row.context).every(v=>[true,false,null].includes(v))&&equal(row.payload.next,[])&&b&&equal(b.context,row.context)&&valueHash(row.payload.answer)===b.answerSha256,'GA_ROW_BINDING');rows.set(row.variant_id,{row,stage});const k=stage.stage.id+':'+signature(row.context);assert(!materials.has(k),'GA_MATERIAL_COLLISION');materials.set(k,row.variant_id);}
  }
  const engine={bundle,rowFor(id){assert(rows.has(id),'GA_UNKNOWN_ID');return rows.get(id)}};
  let nodes=0,branches=0,terminals=0;const unique=new Set();
  function checkQuestion(q,stage){nodes++;unique.add(q.id);const def=questions.get(q.id);assert(def&&def.stageId===stage&&def.text===q.question&&def.fieldKey==='gosuslugi_access.'+stage+'.'+q.field_key&&equal(def.controls,q.data.map(b=>({label:b.label,value:b.value}))),'GA_QUESTION_BINDING');validateQuestionDefinition({id:q.id,branches:q.data.map(b=>({value:b.value,kind:'stage',stageId:stage}))},engine);for(const b of q.data){branches++;if(b.ask_next_question)checkQuestion(b.ask_next_question,stage);else{terminals++;assert(rows.get(b.go_to_variant)?.stage.stage.id===stage,'GA_TARGET_BINDING')}}}
  for(const st of next.subcategories)for(const row of st.variants){const current=rows.get(row.variant_id)?.row;assert(current&&equal(row.context,current.context)&&equal(row.payload.answer,current.payload.answer),'GA_NEXT_CURRENT_MIRROR');if(row.payload.next.length){assert(!roots.has(st.stage.id),'GA_DUPLICATE_ROOT');roots.set(st.stage.id,row.payload.next[0]);checkQuestion(row.payload.next[0],st.stage.id)}}
  assert(bundle.category.id==='gosuslugi_access'&&bundle.subcategories.length===8&&rows.size===376&&fields.size===47&&questions.size===17&&unique.size===17&&nodes===33&&branches===99&&terminals===74&&equal(policy.thirdQuestionReasons,{})&&policy.maxQuestionsPerCase===2,'GA_INVENTORY');
  let fragmentCount=0;for(const st of policy.stages)for(const f of st.fragments){let v=bundle;for(const k of f.pointer.slice(1).split('/'))v=v[k];assert(v===f.exact_text&&digest(v)===f.sha256_utf8_text,'GA_GENERAL_FRAGMENT');fragmentCount++}assert(fragmentCount===policy.generalFragmentCount,'GA_FRAGMENT_COUNT');
  for(const t of components.matrix.targets)assert(equal(bindings.get(t.existing_target_id)?.fullBodyNeeds,t.full_body_prerequisites.map(x=>x.content_prerequisite)),'GA_FULLBODY_BINDING');
  assert(Object.keys(policy.implicitRequirements).length===12&&policy.bindings.filter(b=>b.fullBodyNeeds.length).length===policy.editorialSuccessor.rowsWithNeeds,'GA_IMPLICIT_COUNTS');freeze(bundle);freeze(next);freeze(policy);freeze(components);
  const blocked=new Set(policy.fields.filter(f=>f.status==='HELD_QUALIFIED_PRODUCER').map(f=>f.fieldKey));
  function init(s){const e=currentEpisode(s);e.gaScopes||={};e.gaScopeHistory||={};e.categorySubjects||={};e.gaRaw||=[];e.gaAuxiliary||=[];e.gaEvents||=[];e.gaUserTurns||=[];}
  function prepareState(s){assert(!s.categoryId||s.categoryId==='gosuslugi_access','GA_SAVED_CATEGORY_MISMATCH');assert(!s.gaPolicyVersion||s.gaPolicyVersion===policy.version,'GA_POLICY_VERSION_UNAVAILABLE');assert(!(s.revision>0&&!s.gaPolicyVersion),'GA_POLICY_VERSION_UNAVAILABLE');s.categoryId='gosuslugi_access';s.categoryFieldKeys=[...fields.keys()];s.categoryBlockedFields=[...blocked];s.categoryScopeGroups=Object.fromEntries(policy.fields.map(f=>[f.fieldKey,f.group]));s.policyVersion=policy.version;s.gaPolicyVersion=policy.version;init(s)}
  const scopeFor=(s,stage)=>currentEpisode(s).gaScopes?.[stage]?.values||null;
  const hasKeys=(sc,keys)=>!!sc&&keys.every(k=>typeof sc[k]==='string'&&sc[k].trim());
  function fieldScope(s,key){const f=fields.get(key),sc=f&&scopeFor(s,f.stageId);if(!sc)return null;return {caseId:s.caseState.id,episodeId:s.activeEpisodeId,...Object.fromEntries(f.scopeKeys.map(k=>[k,sc[k]??null]))};}
  function roleObserved(s,stage,key,value){const e=currentEpisode(s).gaScopes[stage]?.evidence[key];return !!e&&e.value===value&&e.caseId===s.caseState.id&&e.episodeId===s.activeEpisodeId&&validSource(e)&&(e.natural?naturalSourceRole(e,key,value,policy):parseGosuslugiScope(e.quote).scope[key]===value);}
  function scopeReady(s,stage,key=null){if(currentEpisode(s).gaScopeHolds?.[stage])return false;const sc=scopeFor(s,stage),keys=key?fields.get(key)?.scopeKeys:['actorId','accountId','sourceId','timeId',...(currentEpisode(s).gaScopes?.[stage]?.evidence?.accountId?.natural?[]:(entryKeys[stage]||[]))];return !!keys&&sc?.actorId==='self'&&hasKeys(sc,keys)&&keys.every(k=>roleObserved(s,stage,k,sc[k]));}
  function retire(s,why,source){if(!s.pending)return;answerQuestionReceipt(s,s.pending,null,{...source,kind:why});const r=s.caseState.served.find(x=>x.id===s.pending.receiptId);if(r?.answer)r.answer.disposition=why;s.pending=null;}
  function selectScope(s,stage,patch,source){assert(specs.has(stage)&&source?.kind==='user_text'&&source.turnId&&source.quote,'GA_SCOPE_REQUIRED');init(s);const parsed=parseGosuslugiScope(source.quote),natural=interpretGosuslugi(s,source.quote,source.turnId,policy);assert(!parsed.ambiguous&&!natural.ambiguous&&!natural.excluded&&Object.entries(patch).every(([k,v])=>own(parsed.scope,k)&&parsed.scope[k]===v||natural.naturalRoles?.[k]?.value===v&&naturalSourceRole(natural.naturalRoles[k],k,v,policy)),'GA_SCOPE_UNOBSERVED');const e=currentEpisode(s),old=e.gaScopes[stage]||{values:{},evidence:{}},values={...old.values,...patch},evidence={...old.evidence};for(const [k,v]of Object.entries(patch)){const naturalRole=natural.naturalRoles?.[k];evidence[k]={...(naturalRole||{quote:parsed.evidence[k],message:source.message||source.quote,span:parsed.spans[k],turnId:source.turnId,kind:'user_text'}),value:v,caseId:s.caseState.id,episodeId:s.activeEpisodeId,sourceSha256:SOURCE,nextSha256:NEXT,policyVersion:policy.version};}if(old.values.accountId&&patch.accountId&&old.values.accountId!==patch.accountId||old.values.focusId&&patch.focusId&&old.values.focusId!==patch.focusId){for(const k of Object.keys(values))if(!own(patch,k)){delete values[k];delete evidence[k]}}
    if(stable(old.values)!==stable(values)&&s.pending?.stageId===stage&&fields.get(s.pending.fieldKey)?.scopeKeys.some(k=>old.values[k]!==values[k])){retire(s,'scope_changed',source);newRound(s,'ga-scope');s.nonce=randomUUID()}
    e.gaScopes[stage]={values,evidence};for(const f of policy.fields.filter(f=>f.stageId===stage)){const id=stable(fieldScope(s,f.fieldKey)),history=e.gaScopeHistory[f.group]||={};e.categorySubjects[f.group]={current:history[id]||=randomUUID()}}return scopeReady(s,stage);
  }
  const currentRecord=(s,key)=>s.factLedger.findLast(f=>f.episodeId===s.activeEpisodeId&&f.fieldKey===key&&f.subjectId===subjectFor(s,key)&&['active','conflicted'].includes(f.status));
  function validSource(src){return src?.turnId&&src.quote&&src.freshness!=='stale'&&src.conflict!==true&&typeof src.message==='string'&&Array.isArray(src.span)&&src.span.length===2&&Number.isInteger(src.span[0])&&Number.isInteger(src.span[1])&&src.span[0]>=0&&src.span[1]>=src.span[0]&&src.span[1]<=Array.from(src.message).length&&Array.from(src.message).slice(...src.span).join('')===src.quote&&src.sourceSha256===SOURCE&&src.nextSha256===NEXT&&src.policyVersion===policy.version;}
  function validRecord(s,f,seen=new Set()){if(!f||seen.has(f.id))return false;seen.add(f.id);const def=fields.get(f.fieldKey);return def&&!blocked.has(f.fieldKey)&&f.status==='active'&&own(f,'value')&&[true,false,null].includes(f.value)&&f.caseId===s.caseState.id&&f.episodeId===s.activeEpisodeId&&f.subjectId===subjectFor(s,f.fieldKey)&&scopeReady(s,def.stageId,f.fieldKey)&&validSource(f.source)&&equal(f.source.scope,fieldScope(s,f.fieldKey))&&(!f.dependencies?.length||f.dependencies.every(id=>validRecord(s,s.factLedger.find(x=>x.id===id),new Set(seen))));}
  function scopedFacts(s,stage){const facts={};for(const [key]of Object.entries(project(s,stage))){const r=currentRecord(s,key);if(validRecord(s,r))facts[key]=r.value;}return facts;}
  function invalidate(s,id){const ids=new Set([id]);let change=true;while(change){change=false;for(const f of s.factLedger)if(f.status==='active'&&f.dependencies?.some(x=>ids.has(x))){f.status='invalidated';ids.add(f.id);change=true}}}
  function admit(s,f){const def=fields.get(f.fieldKey),src=f.source;if(!def||blocked.has(f.fieldKey)||!own(f,'value')||![true,false,null].includes(f.value)||!scopeReady(s,def.stageId,f.fieldKey)||!src?.turnId||!src.message||!src.quote)return null;
    if(f.operation==='later'&&!currentStateFields.has(def.fieldId))return null;
    if((src.caseId&&src.caseId!==s.caseState.id)||(src.episodeId&&src.episodeId!==s.activeEpisodeId)||(src.scope&&!equal(src.scope,fieldScope(s,f.fieldKey)))||(src.sourceSha256&&src.sourceSha256!==SOURCE)||(src.nextSha256&&src.nextSha256!==NEXT)||(src.policyVersion&&src.policyVersion!==policy.version))return null;
    const parsed=interpretGosuslugi(s,src.message,src.turnId,policy);
    if(src.kind==='user_text'){if(!parsed.facts.some(p=>p.fieldKey===f.fieldKey&&p.value===f.value&&p.operation===(f.operation||'assert')&&p.source.quote===src.quote&&equal(p.source.span,src.span)))return null;}
    else if(['button','question_reply'].includes(src.kind)){const p=s.pending;if(!p||p.fieldKey!==f.fieldKey||p.question.id!==src.questionId||p.receiptId!==src.receiptId||!p.question.controls.some(c=>c.value===f.value&&normalizeGosuslugi(c.label)===normalizeGosuslugi(src.message)))return null;}
    else return null;
    if(f.dependencies?.some(id=>!validRecord(s,s.factLedger.find(x=>x.id===id))))return null;
    const old=currentRecord(s,f.fieldKey),source={...src,scope:fieldScope(s,f.fieldKey),caseId:s.caseState.id,episodeId:s.activeEpisodeId,sourceSha256:SOURCE,nextSha256:NEXT,policyVersion:policy.version};if(!validSource(source))return null;
    if(f.operation==='correct'&&(!old||old.caseId!==s.caseState.id||!validSource(old.source)||!['user_text','button','question_reply'].includes(old.source.kind)||!equal(old.source.scope,fieldScope(s,f.fieldKey))))return null;
    const operation=f.operation==='correct'&&f.value===null?'withdraw':f.operation||'assert';
    const stored=recordFact(s,f.fieldKey,f.value,source,operation,f.dependencies||[]);
    if(old&&old.id!==stored.id)invalidate(s,old.id);
    if(['correct','withdraw','later'].includes(f.operation))for(const r of s.factLedger)if(r.id!==stored.id&&r.fieldKey===f.fieldKey&&r.episodeId===s.activeEpisodeId&&r.subjectId===stored.subjectId&&r.status==='conflicted')r.status='superseded';
    if(!old||old.id!==stored.id)currentEpisode(s).gaEvents.push({kind:'fact',id:stored.id,turnId:src.turnId});return stored;
  }
  function auxScope(s,stage,need){
    const sc=scopeFor(s,stage),def=auxiliaryObservations[need],keys=def&&['actorId','accountId','sourceId','timeId',...def.scopeKeys];
    if(!keys||!hasKeys(sc,keys)||!keys.every(k=>roleObserved(s,stage,k,sc[k])))return null;
    return {caseId:s.caseState.id,episodeId:s.activeEpisodeId,...Object.fromEntries(keys.map(k=>[k,sc[k]]))};
  }
  function admitAuxiliary(s,stage,a){
    const sc=auxScope(s,stage,a.need),operation=a.operation||'assert';
    if(!sc||!scopeReady(s,stage)||!own(a,'value')||![true,false,null].includes(a.value)||!a.source)return null;
    if(operation==='later'&&a.need!=='application_current_status_no_disbursement')return null;
    const parsed=interpretGosuslugi(s,a.source.message,a.source.turnId,policy);
    if(!parsed.auxiliary.some(x=>x.need===a.need&&x.value===a.value&&x.operation===operation&&x.source.quote===a.source.quote&&equal(x.source.span,a.source.span)))return null;
    if((a.source.caseId&&a.source.caseId!==s.caseState.id)||(a.source.episodeId&&a.source.episodeId!==s.activeEpisodeId)||(a.source.scope&&!equal(a.source.scope,sc))||(a.source.sourceSha256&&a.source.sourceSha256!==SOURCE)||(a.source.nextSha256&&a.source.nextSha256!==NEXT)||(a.source.policyVersion&&a.source.policyVersion!==policy.version))return null;
    const e=currentEpisode(s),matches=x=>x.need===a.need&&x.stage===stage&&equal(x.scope,sc),prior=e.gaAuxiliary.findLast(x=>matches(x)&&['active','conflicted'].includes(x.status));
    const source={...a.source,scope:sc,sourceSha256:SOURCE,nextSha256:NEXT,policyVersion:policy.version};
    if(!validSource(source))return null;
    if(operation==='correct'&&(!prior||!validSource(prior.source)||!equal(prior.source.scope,sc)))return null;
    if(prior&&operation==='assert'&&(a.value===null||prior.status==='active'&&prior.value===a.value))return prior;
    let status='active';
    if(prior&&operation==='assert'&&(prior.status==='conflicted'||prior.value!==null&&prior.value!==a.value)){
      prior.status='conflicted';status='conflicted';
    }else for(const old of e.gaAuxiliary.filter(x=>matches(x)&&['active','conflicted'].includes(x.status)))old.status='superseded';
    const record={id:randomUUID(),stage,need:a.need,value:a.value,status,scope:sc,source,operation:operation==='correct'&&a.value===null?'withdraw':operation,supersedes:prior?.id||null};
    e.gaAuxiliary.push(record);e.gaEvents.push({kind:'auxiliary',id:record.id,turnId:a.source.turnId});return record;
  }
  function hasAuxiliary(s,stage,need){
    const sc=auxScope(s,stage,need);if(!sc)return false;
    const last=currentEpisode(s).gaAuxiliary.findLast(x=>x.stage===stage&&x.need===need&&equal(sc,x.scope)&&['active','conflicted'].includes(x.status));
    return !!last&&last.status==='active'&&last.value===true&&equal(last.source.scope,sc)&&validSource(last.source);
  }
  function admission(s,id){const found=rows.get(id);if(!found)return false;const stage=found.stage.stage.id;if(!scopeReady(s,stage)||currentEpisode(s).gaCorrectionHolds?.[stage])return false;const facts=scopedFacts(s,stage),conflict=s.factLedger.some(f=>f.episodeId===s.activeEpisodeId&&f.fieldKey.startsWith('gosuslugi_access.'+stage+'.')&&f.subjectId===subjectFor(s,f.fieldKey)&&f.status==='conflicted');return !conflict&&Object.entries(found.row.context).every(([k,v])=>v===null||(own(facts,'gosuslugi_access.'+stage+'.'+k)&&facts['gosuslugi_access.'+stage+'.'+k]===v))&&bindings.get(id).fullBodyNeeds.every(need=>hasAuxiliary(s,stage,need));}
  function compatible(id,facts){const found=rows.get(id);return !!found&&Object.entries(found.row.context).every(([k,v])=>v===null||(own(facts,'gosuslugi_access.'+found.stage.stage.id+'.'+k)&&facts['gosuslugi_access.'+found.stage.stage.id+'.'+k]===v));}
  function resolve(s,stage=currentEpisode(s).stageId){if(!specs.has(stage)||currentEpisode(s).gaCorrectionHolds?.[stage])return {variantId:null,specializationHeld:true};const facts=scopedFacts(s,stage),c=Object.fromEntries(Object.entries(facts).map(([k,v])=>[k.split('.').at(-1),v])),id=materials.get(stage+':'+signature(c));return {variantId:id&&admission(s,id)?id:null,candidateId:id||null,specializationHeld:!id||!admission(s,id)};}
  function receipt(s,q){return s.caseState.served.findLast(r=>r.caseId===s.caseState.id&&r.episodeId===s.activeEpisodeId&&r.subjectId===subjectFor(s,q.fieldKey)&&r.fieldKey===q.fieldKey&&r.questionId===q.id&&r.status==='answered'&&!r.answer?.disposition&&own(r.answer||{},'value')&&q.controls.some(c=>c.value===r.answer.value)&&['button','question_reply'].includes(r.answer.source?.kind)&&r.answer.source?.questionId===q.id&&r.answer.source?.receiptId===r.id&&validSource(r.answer.source)&&equal(r.answer.source.scope,fieldScope(s,q.fieldKey)));}
  function known(s,q){const r=currentRecord(s,q.fieldKey);if(validRecord(s,r))return {value:r.value};const last=s.factLedger.findLast(f=>f.fieldKey===q.fieldKey&&f.episodeId===s.activeEpisodeId&&f.subjectId===subjectFor(s,q.fieldKey));if(r?.status==='conflicted'||last?.status==='invalidated')return null;const a=receipt(s,q);return a?{value:a.answer.value}:null;}
  function thirdReasons(s,q){if(q.id!==policy.acceptedThirdQuestionId)return {};const stage='restore_mfc_bank',bank=currentRecord(s,'gosuslugi_access.'+stage+'.bank_recovery_refused'),mfc=currentRecord(s,'gosuslugi_access.'+stage+'.mfc_recovery_refused');if(!validRecord(s,bank)||!validRecord(s,mfc)||bank.value!==true||mfc.value!==true)return {};return ['caseId','episodeId','actorId','accountId','recoveryId'].every(k=>bank.source.scope[k]&&bank.source.scope[k]===mfc.source.scope[k])?{[q.id]:'Две независимые неудачные попытки этого восстановления: выяснить явно указанное расхождение данных'}:{};}
  function eligible(s,q){return scopeReady(s,q.stageId,q.fieldKey)&&!blocked.has(q.fieldKey)&&!known(s,q)&&currentRecord(s,q.fieldKey)?.status!=='conflicted'&&(q.id!==policy.acceptedThirdQuestionId||!!thirdReasons(s,q)[q.id]);}
  function nextQuestion(s,stage){let q=roots.get(stage),target=null;const seen=new Set();while(q){assert(!seen.has(q),'GA_NEXT_CYCLE');seen.add(q);const def=questions.get(q.id),k=known(s,def);if(!k)return {question:eligible(s,def)?def:null,target};const branch=q.data.find(x=>x.value===k.value);if(!branch)return {question:null,target:null};target=branch.go_to_variant||null;q=branch.ask_next_question;}return {question:null,target};}
  function plan(s){const stage=currentEpisode(s).stageId,selected=resolve(s,stage);if(!specs.has(stage))return {...selected,question:null};const path=nextQuestion(s,stage);return {...selected,question:s.gaDeclined||currentEpisode(s).gaCorrectionHolds?.[stage]?null:path.question,terminalCandidate:path.target};}
  function setPending(s,q){const p={kind:'next',key:q.id,fieldKey:q.fieldKey,stageId:q.stageId,question:q};if(canServeQuestion(s,p,thirdReasons(s,q))){p.scopeDigest=digest(stable(fieldScope(s,q.fieldKey)));s.pending=p;}}
  function withdraw(s,src){const e=currentEpisode(s),previous=e.gaUserTurns.filter(t=>t.turnId!==src.turnId).at(-1),events=e.gaEvents.filter(x=>x.turnId===previous?.turnId);if(events.length!==1)return false;const event=events[0];if(event.kind==='auxiliary'){const old=e.gaAuxiliary.find(x=>x.id===event.id&&['active','conflicted'].includes(x.status));if(!old||!equal(old.scope,auxScope(s,old.stage,old.need)))return false;if(!validSource(old.source)||!equal(old.source.scope,old.scope))return false;for(const x of e.gaAuxiliary)if(x.stage===old.stage&&x.need===old.need&&equal(x.scope,old.scope)&&['active','conflicted'].includes(x.status))x.status='superseded';old.status='withdrawn';e.gaAuxiliary.push({...old,id:randomUUID(),value:null,status:'active',operation:'withdraw',source:{...src,scope:old.scope,sourceSha256:SOURCE,nextSha256:NEXT,policyVersion:policy.version},supersedes:old.id});return true;}const old=s.factLedger.find(x=>x.id===event.id);if(!old||!['active','conflicted'].includes(old.status)||old.subjectId!==subjectFor(s,old.fieldKey)||!equal(old.source.scope,fieldScope(s,old.fieldKey)))return false;const source={...src,scope:old.source.scope,caseId:s.caseState.id,episodeId:s.activeEpisodeId,sourceSha256:SOURCE,nextSha256:NEXT,policyVersion:policy.version};const stored=recordFact(s,old.fieldKey,null,source,'withdraw');invalidate(s,old.id);for(const r of s.factLedger)if(r.id!==stored.id&&r.fieldKey===old.fieldKey&&r.subjectId===old.subjectId&&r.status==='conflicted')r.status='superseded';e.gaEvents.push({kind:'fact',id:stored.id,turnId:src.turnId});return true;}
  function dispatch(s,input){const text=input.question||'',action=input.guided?.native,prior=s.pending,p=interpretGosuslugi(s,text,input.turnId,policy);let e=currentEpisode(s),notice=null,corrected=false;if(input.variantId)assert(rows.has(input.variantId),'GA_UNKNOWN_ID');if(input.turnId&&text)e.gaUserTurns.push({turnId:input.turnId,quote:text});
    if(action){assert(prior&&action.kind==='answer'&&action.questionId===prior.question.id&&action.receiptId===prior.receiptId&&action.policyVersion===policy.version&&action.sourceSha256===SOURCE&&action.nextSha256===NEXT&&action.caseId===s.caseState.id&&action.subjectId===subjectFor(s,prior.fieldKey)&&action.scopeDigest===digest(stable(fieldScope(s,prior.fieldKey)))&&eligible(s,prior.question)&&nextQuestion(s,prior.stageId).question?.id===prior.question.id,'STALE_ACTION');assert(prior.question.controls.some(c=>c.value===action.value&&c.label===text),'GA_UNOFFERED_ANSWER');}
    const control=prior?.question.controls.find(c=>normalizeGosuslugi(c.label)===normalizeGosuslugi(text));
    if(prior&&(action||control)){assert(bindQuestion(s,prior)&&eligible(s,prior.question)&&nextQuestion(s,prior.stageId).question?.id===prior.question.id&&prior.scopeDigest===digest(stable(fieldScope(s,prior.fieldKey))),'STALE_ACTION');const value=action?action.value:control.value,src={...p.source,kind:action?'button':'question_reply',questionId:prior.question.id,receiptId:prior.receiptId};const stored=admit(s,{fieldKey:prior.fieldKey,value,source:src});assert(stored,'GA_ANSWER_NOT_ADMISSIBLE');answerQuestionReceipt(s,prior,value,stored.source);s.pending=null;}
    else if(!action){
      if(p.scopeUnresolved&&!p.foreign){(e.gaScopeHolds||={})[e.stageId]=true;retire(s,'unresolved_scope',p.source);notice='scope_unresolved';}
      e.gaRaw.push({...p.source,stage:p.stage,proposals:p.facts,observations:p.observations,excluded:p.excluded,foreign:p.foreign,ambiguous:p.ambiguous});
      if(p.newCase&&!p.excluded&&!p.foreign&&!p.ambiguous&&p.stage&&p.scope.accountId){retire(s,'new_case',p.source);episode(s,'new-case');prepareState(s);newRound(s,'ga-new-case');e=currentEpisode(s);e.gaUserTurns.push({turnId:input.turnId,quote:text});s.gaDeclined=false;}
      if(p.unresolvedCorrection&&!p.foreign){(e.gaCorrectionHolds||={})[e.stageId]=true;retire(s,'unresolved_correction',p.source);}
      if(!p.excluded&&!p.foreign&&!p.ambiguous){
        if(p.stage&&p.stage!==e.stageId){retire(s,'stage_changed',p.source);newRound(s,'ga-stage');e.stageId=p.stage;}
        if(p.scopeExplicit&&e.gaScopeHolds)delete e.gaScopeHolds[e.stageId];
        if(e.stageId&&Object.keys(p.scope).length)selectScope(s,e.stageId,p.scope,p.source);
        if(e.stageId&&((normalizeGosuslugi(text).startsWith('исправляю:')&&!p.facts.length&&!p.auxiliary.length)||normalizeGosuslugi(text)==='сомневаюсь в предыдущем ответе')){(e.gaCorrectionHolds||={})[e.stageId]=true;retire(s,'unresolved_correction',p.source);}
        if(p.stop){retire(s,'declined',p.source);s.gaDeclined=true;}
        if(p.withdraw){notice=withdraw(s,p.source)?'withdrawn':'withdrawal_ambiguous';retire(s,'withdrawal',p.source);}
        for(const fact of p.facts){const stored=admit(s,fact);if(stored&&fact.operation==='correct')corrected=true;if(stored&&fact.operation==='correct'&&e.gaCorrectionHolds)delete e.gaCorrectionHolds[e.stageId];if(stored&&s.pending&&(s.pending.fieldKey===fact.fieldKey||fact.operation!=='assert'))retire(s,'observation_changed',p.source);}
        for(const aux of p.auxiliary){const stored=admitAuxiliary(s,e.stageId,aux);if(stored&&aux.operation==='correct'&&e.gaCorrectionHolds)delete e.gaCorrectionHolds[e.stageId];}
      }
    }
    const chosen=plan(s);if(s.pending&&(!eligible(s,s.pending.question)||chosen.question?.id!==s.pending.question.id))retire(s,'no_longer_eligible',p.source);
    if(!s.pending&&chosen.question&&!p.excluded&&!p.foreign&&!p.ambiguous)setPending(s,chosen.question);
    if(p.document)notice='document_unavailable';return {...chosen,notice,forceFull:p.repeat||corrected||notice==='withdrawn'||notice==='scope_unresolved',corrected,confused:p.confused};
  }
  function present(s,outcome,{turnId=null}={}){const e=currentEpisode(s),responseId=randomUUID(),parts=[],stage=e.stageId,spec=specs.get(stage);let pending=s.pending;
    if(pending&&(!eligible(s,pending.question)||nextQuestion(s,pending.stageId).question?.id!==pending.question.id||!serveQuestion(s,pending,responseId,turnId||'resume-'+responseId,thirdReasons(s,pending.question)))){s.pending=null;pending=null;}
    if(outcome.corrected)parts.push('Исправление учтено. Ниже — актуальные действия; прежние указания по исправленному факту больше не применяются.');
    s.presentation.gaShown||={};const scope=scopeFor(s,stage),fragmentKey=spec&&digest(JSON.stringify([stage,scope,s.caseState.id,e.id])),previous=fragmentKey&&s.presentation.gaShown[fragmentKey];
    if(spec&&(!previous||outcome.forceFull)){for(const f of spec.fragments)parts.push(f.exact_text);s.presentation.gaShown[fragmentKey]=responseId;}
    const id=outcome.variantId&&admission(s,outcome.variantId)?outcome.variantId:null,row=id&&rows.get(id).row,a=row?.payload.answer,fp=a&&digest(JSON.stringify([a,scope,s.caseState.id,e.id])),full=!!a&&(!s.presentation.gaShown[fp]||outcome.forceFull);
    if(full){for(const t of [a.now,...a.steps,...a.dont,...a.say,...a.laws.map(l=>l.ref+': '+l.short+' ('+l.url+')')])if(!parts.includes(t))parts.push(t);s.presentation.gaShown[fp]=responseId;s.presentation.lastFullResponseId=responseId;}
    if(outcome.notice==='scope_unresolved')parts.push('Сообщение о другом предмете пока не удалось связать с текущей записью. Прежние факты сохранены в истории и не используются для нового предмета.');
    if(outcome.notice==='document_unavailable')parts.push('Подготовка документа в этом диалоге пока недоступна. Доступные действия по вашей ситуации сохранены.');
    if(outcome.notice==='withdrawal_ambiguous')parts.push('Не удалось однозначно определить прежнее сообщение. История сохранена.');
    if(outcome.confused)parts.push('Можно описать происходящее своими словами или оставить ответ неизвестным.');
    if(!parts.length)parts.push(spec?'Доступные действия из памятки выше остаются в силе. Новые сведения можно добавить сообщением.':'Опишите, что сейчас происходит с вашей записью Госуслуг.');
    if(outcome.specializationHeld)parts.push('Для полного ответа пока не хватает подтвержденных сведений. Известные факты и доступные общие действия сохранены.');
    const native=pending&&{kind:'answer',sessionId:s.id,nonce:s.nonce,revision:s.revision,episodeId:e.id,roundId:s.round?.id,caseId:s.caseState.id,subjectId:subjectFor(s,pending.fieldKey),scopeDigest:digest(stable(fieldScope(s,pending.fieldKey))),questionId:pending.question.id,receiptId:pending.receiptId,policyVersion:policy.version,sourceSha256:SOURCE,nextSha256:NEXT};
    const control=action=>({version:s.version,categoryId:'gosuslugi_access',stageId:stage||'',context:{},native:{sessionId:s.id,nonce:s.nonce,revision:s.revision,episodeId:e.id,roundId:s.round?.id,...action}});
    const groups=pending?[{type:'choice',questionText:pending.question.text,questionId:pending.question.id,view:pending.question.controls.map(c=>({type:'badge',id:pending.receiptId+':'+String(c.value),value:c.label,title:c.label,question:c.label,categoryId:'gosuslugi_access',guided:control({...native,value:c.value})}))}]:[];
    return {status:'answer',guided:control({}),conversation:{sessionId:s.id,revision:s.revision,version:s.version,nonce:s.nonce},presentation:{responseId,kind:full?'full':spec?'continuation':'boundary',mode:full?'full':spec?'continuation':'boundary',referencesResponseId:full?null:previous||s.presentation.lastFullResponseId||null,questionsUsed:caseQuestionsUsed(s),policyVersion:policy.version},answer:{category:bundle.category,variantId:id||undefined,content:parts.map(escape).join('\n\n'),next:groups,sections:full?{laws:structuredClone(a.laws),documents:structuredClone(a.where_to),documentActionsUnavailable:true}:undefined},dialogue:{stageId:stage||null,questionId:pending?.question.id||null,terminal:pending?null:id?'variant':'boundary',specializationHeld:!id}};
  }
  return Object.freeze({categoryId:'gosuslugi_access',version:policy.version,sourceSha256:SOURCE,nextSha256:NEXT,bundle,next,policy,components,validate(candidate,sha){assert(sha===SOURCE&&equal(candidate,bundle),'GA_SOURCE_VERSION_UNAVAILABLE');},prepareState,selectScope,scopeFor,fieldScope,scopeReady,scopedFacts,admit,admitAuxiliary,admission,compatible,resolve,plan,dispatch,present,thirdReasons,rowFor(id){assert(rows.has(id),'GA_UNKNOWN_ID');return rows.get(id);}});
}
