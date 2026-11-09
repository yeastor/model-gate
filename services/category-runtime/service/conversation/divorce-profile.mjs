import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {fail} from './errors.mjs';
import {validateQuestionDefinition} from './questions.mjs';
import {currentEpisode,episode,newRound,recordFact,subjectFor,caseQuestionsUsed,canServeQuestion,serveQuestion,answerQuestionReceipt} from './state.mjs';
const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),own=(o,k)=>Object.hasOwn(o,k),ensure=(v,c)=>{if(!v)fail(c,409);};
export const normalizeDivorce=t=>String(t).trim().toLowerCase().replaceAll('ё','е').replace(/[.!?]+$/u,'').trim();
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const requestHash=i=>hash(stable({question:i.question,action:i.guided?.native?.kind?i.guided.native:null,variantId:i.variantId,launchHint:i.launchHint}));
const clone=x=>structuredClone(x),escape=t=>String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
export function divorceTopic(text){
 const t=normalizeDivorce(text);
 const named={'развод':'divorce_simple','развод со спором':'divorce_with_disputes','имущество':'property_division','жилье':'housing_after_divorce','долги':'common_debts_mortgage','брачный договор':'marriage_contract','соглашение':'agreement_mediation','безопасность':'domestic_violence'};if(named[t])return named[t];
 if(/(?:муж|жен[аы]|супруг|партнер).{0,50}(?:угрожа|бьет|бил|удар|насили|не выпуска|не дает.{0,12}(?:выйти|уйти))|домашн.{0,10}насили/u.test(t))return 'domestic_violence';
 if(/брачн.{0,12}договор/u.test(t))return 'marriage_contract';
 if(/медиац|проект соглашения|соглашени.{0,20}раздел/u.test(t))return 'agreement_mediation';
 if(/ипотек|общ.{0,12}(?:кредит|долг)|кредит.{0,25}(?:супруг|развод)/u.test(t))return 'common_debts_mortgage';
 if(/не пуска.{0,25}(?:квартир|жиль)|замк|доступ.{0,15}жиль|жиль.{0,20}после развода|социального найма/u.test(t))return 'housing_after_divorce';
 if(/раздел.{0,20}(?:имуществ|квартир)|(?:делить|дележ).{0,20}(?:имуществ|квартир)|имуществ.{0,20}(?:развод|развда|раздел|делить)/u.test(t))return 'property_division';
 if(/против развода|спор.{0,15}(?:развод|расторжен)|развод.{0,15}(?:суд|спор)/u.test(t))return 'divorce_with_disputes';
 if(/развод|развест|расторг.{0,15}брак|прекрат.{0,15}брак/u.test(t))return 'divorce_simple';
 return null;
}
export function createDivorceProfile({policyBytes,assessmentVerifier=null}={}){
 policyBytes ||= fs.readFileSync(new URL('./policy/divorce-property.v1.json',import.meta.url));
 ensure(hash(policyBytes)==='9b99b9e3f4057a88327d5ff45c674fe090f2280f0a494466351a2e7155c19e96','DV_POLICY_PIN_MISMATCH');
 const policy=JSON.parse(policyBytes),raw=fs.readFileSync(policy.source.path);
 ensure(raw.length===policy.source.bytes&&hash(raw)===policy.source.sha256,'DV_SOURCE_PIN_MISMATCH');
 const bundle=JSON.parse(raw),stages=new Map(bundle.subcategories.map(s=>[s.stage.id,s])),rows=new Map(bundle.subcategories.flatMap(s=>s.variants.map(r=>[r.variant_id,{row:r,stage:s}]))),specs=new Map(policy.stages.map(s=>[s.id,s])),fields=new Map(policy.fields.map(f=>[f.fieldKey,f])),qs=new Map(policy.questions.map(q=>[q.id,q]));
 ensure(rows.size===1540&&qs.size===43&&fields.size===62,'DV_INVENTORY_MISMATCH');
 const engine={bundle,rowFor:id=>rows.get(id),compatible:(id,f)=>compatible(id,f)};
 for(const q of qs.values())validateQuestionDefinition({id:q.id,branches:q.controls.map(c=>({value:c.value,kind:'stage',stageId:q.stageId}))},engine);
 const routing={id:'DV-ROUTING-01',text:'Какую тему вы хотите разобрать: развод, развод со спором, имущество, жильё, долги, брачный договор, соглашение или безопасность?',explanation:'Можно написать тему своими словами или ответить «Не знаю».',controls:[],fieldKey:null};
 validateQuestionDefinition({id:routing.id,inputMode:'text',operation:'free_text',fallback:{reason:'Retain existing compatible general answer; unknown stops clarification'}},engine);qs.set(routing.id,routing);
 freeze(policy);freeze(bundle);const dispatching=new WeakMap();
 const currentScope=s=>currentEpisode(s).dvScopes[currentEpisode(s).stageId];
 const scopeDigest=s=>hash([s.caseState.id,s.activeEpisodeId,currentEpisode(s).stageId,currentScope(s)]);
 function retire(s,reason){if(!s.pending)return;answerQuestionReceipt(s,s.pending,null,{kind:reason});s.pending=null;}
 function prepareState(s){
  ensure(!s.categoryId||s.categoryId===policy.categoryId,'DV_CATEGORY_MISMATCH');ensure(!s.dvVersion||s.dvVersion===policy.version,'DV_POLICY_VERSION_UNAVAILABLE');s.categoryId=policy.categoryId;s.policyVersion=policy.version;s.dvVersion=policy.version;s.categoryFieldKeys=[...fields.keys()];s.categoryBlockedFields=policy.fields.filter(f=>f.status==='TRUSTED_ASSESSMENT_ONLY').map(f=>f.fieldKey);s.categoryScopeGroups=Object.fromEntries(policy.fields.map(f=>[f.fieldKey,f.stageId]));
  const e=currentEpisode(s);e.dvScopes||={};e.categorySubjects||={};e.dvSubjects||={};e.dvProofs||={};e.dvTurns||={};e.dvRaw||=[];e.dvAssessments||={};
  for(const e of s.episodes)for(const t of Object.values(e.dvTurns||{}))t.inDispatch=false;
  for(const r of [...s.caseState.served,...(s.caseHistory||[]).flatMap(c=>c.served)])if(r.dvProof)r.dvProof.inDispatch=false;
  if(!e.stageId){selectStage(s,'divorce_simple');e.dvStageConfirmed=false;}
  if(s.pending)checkPending(s);
 }
 function selectStage(s,stage,object=null){
  ensure(stages.has(stage),'DV_STAGE_UNKNOWN');const e=currentEpisode(s);const changed=e.stageId!==stage||object&&e.dvScopes[stage]!==object;
  if(changed){retire(s,'scope_changed');newRound(s,'dv-scope-change');s.nonce=randomUUID();}e.stageId=stage;e.dvStageConfirmed=true;e.dvScopes[stage]=object||e.dvScopes[stage]||'current';const key=stage+':'+e.dvScopes[stage];e.dvSubjects[key]||=randomUUID();e.categorySubjects[stage]={current:e.dvSubjects[key]};
 }
 function receiptValid(s,r){
  const q=qs.get(r.questionId),t=s.turns[r.turnId],p=r.dvProof;if(!q||!p||p.policy!==policy.version||!same(p.question,q))return false;
  if(!t)return dispatching.get(s)===r.turnId;
  const group=t.response.answer.next.find(x=>x.questionId===q.id);return !!group&&group.questionText===q.text+(q.explanation?' '+q.explanation:'')&&same(group.view.map(c=>({label:c.title,value:c.guided.native.value})),q.controls)&&group.view.every(c=>c.guided.native.receiptId===r.id&&c.guided.native.scopeDigest===p.scope);
 }
 function checkPending(s){const p=s.pending,r=s.caseState.served.find(r=>r.id===p.receiptId);ensure(['next','service'].includes(p.kind)&&qs.has(p.question.id)&&same(p.question,qs.get(p.question.id))&&p.dvScope===scopeDigest(s)&&r&&r.status==='served'&&receiptValid(s,r),'DV_PENDING_INTEGRITY');}
 function literal(text,stage){
  const t=normalizeDivorce(text),matches=[];
  for(const f of policy.fields.filter(f=>f.stageId===stage&&f.status==='CURRENT_USER_REPORT')){
   if(f.positive.some(p=>normalizeDivorce(p)===t))matches.push({fieldKey:f.fieldKey,value:true});
   if(f.negative.some(p=>normalizeDivorce(p)===t))matches.push({fieldKey:f.fieldKey,value:false});
  }
  for(const q of policy.questions.filter(q=>q.stageId===stage))for(const c of q.controls)if(t===normalizeDivorce('На вопрос «'+q.text+'» мой ответ: '+c.label))matches.push({fieldKey:q.fieldKey,value:c.value});
  return matches.length===1?matches[0]:null;
 }
 function reply(q,text){if(q.id===routing.id)return {value:divorceTopic(text)};const t=normalizeDivorce(text),direct=q.controls.find(c=>normalizeDivorce(c.label)===t);if(direct)return {value:direct.value};if(q.id==='DV-Q16')return null;return /^(?:да|верно)$/u.test(t)?{value:true}:/^(?:нет|неверно)$/u.test(t)?{value:false}:/^(?:не знаю|не помню|не уверен|не уверена|не могу ответить)$/u.test(t)?{value:null}:null;}
 function validFact(s,f,seen=new Set()){
  if(!f||seen.has(f.id))return false;seen.add(f.id);const e=s.episodes.find(e=>e.id===f.episodeId),p=e?.dvProofs?.[f.id],t=e?.dvTurns?.[f.source?.turnId];
  if(!p||!t||!same(p.record,f)||p.source!==policy.source.sha256||p.policy!==policy.version||hash(t.text)!==p.textHash||(dispatching.get(s)!==f.source.turnId&&!s.turns[f.source.turnId])||s.turns[f.source.turnId]&&s.turns[f.source.turnId].requestHash!==t.requestHash)return false;
  if(f.source.kind==='button'||f.source.kind==='pending_text'){
   const r=[...s.caseState.served,...(s.caseHistory||[]).flatMap(c=>c.served)].find(r=>r.id===f.source.receiptId);if(!r||!receiptValid(s,r)||r.answer?.value!==p.proposedValue||r.answer?.source?.turnId!==f.source.turnId)return false;
  }else if(f.source.kind==='explicit_correction'){
   const m=/^исправляю последний ответ:\s*(да|нет|не знаю)[.!]?$/iu.exec(t.text.trim()),value=m?(m[1].toLowerCase()==='да'?true:m[1].toLowerCase()==='нет'?false:null):undefined;if(!m||value!==p.proposedValue||!f.supersedes.includes(f.source.targetFactId))return false;
  }else if(f.operation!=='withdraw'){
   const obs=literal(f.source.clause,f.fieldKey.split('.')[1]);if(!obs||obs.fieldKey!==f.fieldKey||obs.value!==p.proposedValue||!t.text.includes(f.source.clause))return false;
  }
  return f.supersedes.every(id=>validFact(s,s.factLedger.find(x=>x.id===id),new Set(seen)))&&f.dependencies.every(id=>{const parent=s.factLedger.find(x=>x.id===id);return parent?.status==='active'&&validFact(s,parent,new Set(seen));});
 }
 function sync(s,f){const e=s.episodes.find(e=>e.id===f.episodeId);if(e?.dvProofs?.[f.id])e.dvProofs[f.id].record=clone(f);}
 function facts(s){const e=currentEpisode(s),out={};for(const f of s.factLedger){if(f.episodeId!==e.id||f.caseId!==s.caseState.id||f.subjectId!==subjectFor(s,f.fieldKey)||!f.fieldKey.startsWith('divorce_property.'+e.stageId+'.')||f.source.scope!==scopeDigest(s)||f.status!=='active'||!validFact(s,f))continue;out[f.fieldKey]=f.value;}
  for(const [k,a]of Object.entries(e.dvAssessments))if(a.binding.scopeDigest===scopeDigest(s)&&a.binding.sourceSha256===policy.source.sha256&&a.binding.policyVersion===policy.version&&typeof assessmentVerifier==='function'&&assessmentVerifier(clone(a.binding))===true)out[k]=a.binding.value;
  return out;
 }
 function compatible(id,f){const r=rows.get(id);return !!r&&Object.entries(r.row.context).every(([k,v])=>v===null||own(f,'divorce_property.'+r.stage.stage.id+'.'+k)&&f['divorce_property.'+r.stage.stage.id+'.'+k]===v);}
 function resolveFacts(stage,f={}){ensure(stages.has(stage),'DV_STAGE_UNKNOWN');const candidates=stages.get(stage).variants.filter(r=>compatible(r.variant_id,f)),score=r=>Object.values(r.context).filter(v=>v!==null).length,max=Math.max(...candidates.map(score)),best=candidates.filter(r=>score(r)===max);ensure(best.length,'DV_MISSING_GENERAL');return {variantId:best.length===1?best[0].variant_id:specs.get(stage).generalId,ambiguous:best.length>1,candidateIds:best.map(r=>r.variant_id)};}
 function eligible(s,q){const e=currentEpisode(s),f=facts(s);if(q.id===routing.id)return e.dvStageConfirmed===false&&!s.dvStopped;return q.stageId===e.stageId&&!s.dvStopped&&!own(f,q.fieldKey)&&!s.factLedger.some(r=>r.fieldKey===q.fieldKey&&r.episodeId===e.id&&r.subjectId===subjectFor(s,q.fieldKey)&&['active','conflicted'].includes(r.status))&&!s.caseState.served.some(r=>r.fieldKey===q.fieldKey&&r.subjectId===subjectFor(s,q.fieldKey)&&r.status==='answered')&&q.requires.every(r=>f[r.fieldKey]===r.value)&&!(e.stageId==='divorce_with_disputes'&&!['DV-Q06','DV-Q07'].includes(q.id)&&!(f['divorce_property.divorce_with_disputes.husband_files_during_pregnancy_or_first_year']===false||f['divorce_property.divorce_with_disputes.husband_files_during_pregnancy_or_first_year']===true&&f['divorce_property.divorce_with_disputes.wife_consents_to_husband_filing']===true));}
 function plan(s){const stage=currentEpisode(s).stageId,result=resolveFacts(stage,facts(s));const question=currentEpisode(s).dvStageConfirmed===false&&!s.dvStopped&&canServeQuestion(s,{kind:'service',key:routing.id,question:routing}, {})?routing:currentEpisode(s).dvStageConfirmed===false?null:policy.questions.find(q=>eligible(s,q)&&canServeQuestion(s,{kind:'next',key:q.id,fieldKey:q.fieldKey,stageId:stage,question:q},{}))||null;return {...result,question};}
 function admit(s,obs,source,operation='assert'){
  const e=currentEpisode(s),def=fields.get(obs.fieldKey);if(!def||def.status!=='CURRENT_USER_REPORT'||def.stageId!==e.stageId)return null;
  const q=policy.questions.find(q=>q.fieldKey===obs.fieldKey),factual=facts(s);if(operation!=='withdraw'&&q&&!q.requires.every(r=>factual[r.fieldKey]===r.value))return null;
  const dependencies=(q?.requires||[]).map(r=>s.factLedger.findLast(f=>f.fieldKey===r.fieldKey&&f.status==='active'&&f.subjectId===subjectFor(s,r.fieldKey))?.id).filter(Boolean);
  const old=s.factLedger.findLast(f=>f.fieldKey===obs.fieldKey&&f.episodeId===e.id&&f.subjectId===subjectFor(s,obs.fieldKey)&&['active','conflicted'].includes(f.status));if(old&&!validFact(s,old))return null;
  const stored=recordFact(s,obs.fieldKey,obs.value,{...source,scope:scopeDigest(s),sourceSha256:policy.source.sha256},operation,dependencies);if(old)sync(s,old);if(stored===old)return stored;
  e.dvProofs[stored.id]={record:clone(stored),source:policy.source.sha256,policy:policy.version,textHash:hash(e.dvTurns[source.turnId].text),proposedValue:obs.value};
  if(old){const invalid=new Set([old.id]);for(const f of s.factLedger)if(f.status==='active'&&f.dependencies.some(id=>invalid.has(id))){f.status='invalidated';invalid.add(f.id);sync(s,f);}}
  return stored;
 }
 function admitAssessment(s,binding){const def=fields.get(binding.fieldKey);ensure(def?.status==='TRUSTED_ASSESSMENT_ONLY'&&binding.scopeDigest===scopeDigest(s)&&binding.sourceSha256===policy.source.sha256&&binding.policyVersion===policy.version&&binding.caseId===s.caseState.id&&typeof binding.value==='boolean'&&binding.evidencePin?.sha256&&binding.lawScopeSha256===def.source_contract.law_scope_sha256&&typeof assessmentVerifier==='function'&&assessmentVerifier(clone(binding))===true,'DV_ASSESSMENT_REQUIRED');currentEpisode(s).dvAssessments[binding.fieldKey]={binding:clone(binding)};}
 function dispatch(s,input){
  const text=input.question||'',t=normalizeDivorce(text),action=input.guided?.native,prior=s.pending;let e=currentEpisode(s);if(prior)checkPending(s);dispatching.set(s,input.turnId);
  if(input.categoryId)ensure(input.categoryId===policy.categoryId,'DV_CATEGORY_MISMATCH');
  if(input.variantId)ensure(rows.has(input.variantId),'DV_UNKNOWN_VARIANT');
  const analysisText=text.replace(/На вопрос «[^»]+» мой ответ: [^;]+/gu,'');
  const parsedTopic=divorceTopic(analysisText),outsideCategory=!parsedTopic&&/(?:пристав|коллектор|полицейск|трудовой спор)/iu.test(analysisText),hint=input.stageId||input.launchHint?.stageId||(input.variantId?rows.get(input.variantId).stage.stage.id:null);
  if(hint)ensure(stages.has(hint),'DV_STAGE_UNKNOWN');
  if(outsideCategory&&!prior){s.dvOutside=true;return {...plan(s),outside:true};}s.dvOutside=false;
  if(action){ensure(prior&&action.kind==='answer'&&action.questionId===prior.question.id&&action.receiptId===prior.receiptId&&action.scopeDigest===scopeDigest(s)&&action.sourceSha256===policy.source.sha256&&action.policyVersion===policy.version,'STALE_ACTION');ensure(prior.question.controls.some(c=>c.value===action.value&&normalizeDivorce(c.label)===t),'DV_UNOFFERED_ANSWER');}
  const short=prior?reply(prior.question,text):null;
  if(prior&&short){ensure(eligible(s,prior.question),'STALE_ACTION');e.dvTurns[input.turnId]={text,inDispatch:true,scope:scopeDigest(s),requestHash:requestHash(input)};const src={kind:action?'button':'pending_text',turnId:input.turnId,quote:text,span:[0,Array.from(text).length],receiptId:prior.receiptId,questionId:prior.question.id};answerQuestionReceipt(s,prior,short.value,src);s.pending=null;if(prior.question.id===routing.id){if(short.value)selectStage(s,short.value);else s.dvStopped=true;}else ensure(admit(s,{fieldKey:prior.fieldKey,value:short.value},src),'DV_ANSWER_REJECTED');}
  else if(!action){
   if(t==='это другой случай'){retire(s,'explicit_new_case');episode(s,'new-case');prepareState(s);newRound(s,'dv-new-case');s.dvStopped=false;e=currentEpisode(s);}
   const obj=/^обсуждаем (?:объект|событие|проект|кредитора):\s*(.{1,160})$/iu.exec(text.trim());
   const otherObject=/(?:другой договор|другое жиль[её]|другая квартира|другой кредитор|другой кредит|другой проект)/iu.test(analysisText);
   if(!parsedTopic&&!hint&&e.dvStageConfirmed===false&&/(?:квартир|жиль[её])/iu.test(analysisText)){selectStage(s,'housing_after_divorce');e.dvStageConfirmed=false;}
   if(parsedTopic||hint||obj||otherObject)selectStage(s,parsedTopic||hint||e.stageId,obj?.[1]||(otherObject?'explicit-new-object-'+randomUUID():null));
   if(/^(?:не хочу отвечать|пропустить|без вопросов)$/u.test(t)){retire(s,'declined');s.dvStopped=true;}
   if(t==='продолжить уточнения')s.dvStopped=false;
   e.dvTurns[input.turnId]={text,inDispatch:true,scope:scopeDigest(s),requestHash:requestHash(input)};
   const excluded=/(?:^|\s)(?:если|предположим|гипотетически|цитата|у подруги|у друга|у соседки|в фильме)(?:\s|:|,)/iu.test(analysisText);
   const correction=/^исправляю:\s*/iu.test(text),body=text.replace(/^исправляю:\s*/iu,'');
   const clauses=body.split(/;\s*/u);let changed=false;
   if(!excluded&&!obj){
    const correctionLast=/^исправляю последний ответ:\s*(да|нет|не знаю)[.!]?$/iu.exec(text.trim());
    if(correctionLast){
     const old=s.factLedger.findLast(f=>f.episodeId===e.id&&f.subjectId===subjectFor(s,f.fieldKey)&&f.status==='active'&&f.fieldKey.startsWith('divorce_property.'+e.stageId+'.'));
     if(old&&validFact(s,old)){const v=normalizeDivorce(correctionLast[1]),value=v==='да'?true:v==='нет'?false:null;admit(s,{fieldKey:old.fieldKey,value},{kind:'explicit_correction',turnId:input.turnId,quote:text,span:[0,Array.from(text).length],targetFactId:old.id},value===null?'withdraw':'correct');changed=true;}
    }else if(t==='отзываю последний ответ'){
     const old=s.factLedger.findLast(f=>f.episodeId===e.id&&f.subjectId===subjectFor(s,f.fieldKey)&&f.status==='active'&&f.fieldKey.startsWith('divorce_property.'+e.stageId+'.'));
     if(old&&validFact(s,old)){admit(s,{fieldKey:old.fieldKey,value:null},{kind:'user_text',turnId:input.turnId,quote:text,span:[0,Array.from(text).length],clause:text},'withdraw');changed=true;}
    }else for(const clause of clauses){const obs=literal(clause,e.stageId);if(obs){admit(s,obs,{kind:'user_text',turnId:input.turnId,quote:clause,span:[Array.from(text.slice(0,text.indexOf(clause))).length,Array.from(text.slice(0,text.indexOf(clause)+clause.length)).length],clause},correction?'correct':'assert');changed=true;}}
   }
   if(changed&&s.pending)retire(s,'explicit_observation');e.dvRaw.push({turnId:input.turnId,text,excluded,parsedTopic,factsFromRetrieval:false});
  }
  for(const r of s.caseState.served)if(r.dvProof)r.dvProof.inDispatch=!!r.dvProof.inDispatch&&!s.turns[r.turnId];
  if(s.pending&&!eligible(s,s.pending.question))retire(s,'no_longer_eligible');const outcome=plan(s);
  if(!s.pending&&outcome.question)s.pending={kind:outcome.question.id===routing.id?'service':'next',key:outcome.question.id,fieldKey:outcome.question.fieldKey,stageId:e.stageId,question:clone(outcome.question),dvScope:scopeDigest(s)};
  return {...outcome,rawUnrecognized:!short&&!parsedTopic,forceFull:true};
 }
 function present(s,outcome,{turnId=null}={}){
  const e=currentEpisode(s),responseId=randomUUID();let p=s.pending;if(p&&!serveQuestion(s,p,responseId,turnId||'resume-'+responseId,{})){s.pending=null;p=null;}
  if(outcome.outside||s.dvOutside){s.pending=null;dispatching.delete(s);return {conversation:{sessionId:s.id,revision:s.revision,nonce:s.nonce,version:s.version},presentation:{responseId,mode:'category_boundary',questionsUsed:caseQuestionsUsed(s),policyVersion:policy.version},answer:{category:policy.categoryId,content:'Вы открыли раздел о разводе, имуществе супругов и безопасности в семье. Этот запрос относится к другой теме. Выберите соответствующий раздел; сведения по текущему разбору сохранены.',next:[]},dialogue:{stageId:null,terminal:'outside_category',factsFromSearch:false}};}
  if(p){const r=s.caseState.served.find(r=>r.id===p.receiptId);r.dvProof||={question:clone(p.question),policy:policy.version,scope:scopeDigest(s),inDispatch:true};}
  const id=outcome.variantId||plan(s).variantId,row=rows.get(id)?.row;ensure(row&&compatible(id,facts(s)),'DV_INCOMPATIBLE_OUTPUT');const a=row.payload.answer;
  const native={kind:'answer',sessionId:s.id,revision:s.revision,nonce:s.nonce,episodeId:e.id,roundId:s.round?.id,caseId:s.caseState.id,scopeDigest:scopeDigest(s),sourceSha256:policy.source.sha256,policyVersion:policy.version,questionId:p?.question.id,receiptId:p?.receiptId};
  const response={conversation:{sessionId:s.id,revision:s.revision,nonce:s.nonce,version:s.version},presentation:{responseId,mode:'full',questionsUsed:caseQuestionsUsed(s),policyVersion:policy.version},answer:{category:policy.categoryId,variantId:id,content:[a.now,...a.steps,...a.dont,...a.say,...a.laws.map(l=>l.ref+': '+l.short+' ('+l.url+')')].map(escape).join('\n\n'),next:p?[{type:p.question.controls.length?'choice':'text',questionId:p.question.id,questionText:p.question.text+(p.question.explanation?' '+p.question.explanation:''),view:p.question.controls.map(c=>({title:c.label,question:c.label,guided:{native:{...native,value:c.value}}}))}]:[],sections:{laws:clone(a.laws),documents:clone(a.where_to),documentActionsUnavailable:true}},dialogue:{stageId:e.stageId,questionId:p?.question.id||null,terminal:p?null:'useful_variant_retained',factsVerified:false,languageCoverage:'FINITE_LITERAL_AND_CURRENT_QUESTION_TFU',sourceSelectorIsFact:false,legalAssessmentInferred:false}};dispatching.delete(s);return response;
 }
 return Object.freeze({categoryId:policy.categoryId,version:policy.version,sourceSha256:policy.source.sha256,bundle,policy,prepareState,dispatch,present,plan,scopedFacts:facts,resolveFacts,compatible,scopeDigest,admitAssessment,selectStage,validate(b,sha){ensure(b===bundle&&sha===policy.source.sha256,'DV_SOURCE_VERSION_UNAVAILABLE');}});
}
