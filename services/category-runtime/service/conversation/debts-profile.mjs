import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createExplicitEngine} from '../explicit/engine.mjs';
import {currentEpisode,caseQuestionsUsed,canServeQuestion,serveQuestion,answerQuestionReceipt,subjectFor,hash,newRound} from './state.mjs';
import {choiceValue} from './questions.mjs';
import {interpretDebts,debtsStageHint} from './debts-interpret.mjs';
const own=(o,k)=>Object.hasOwn(o,k),eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const digest=b=>createHash('sha256').update(b).digest('hex');
const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{status:409})};
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const escape=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function createDebtsProfile({policyBytes}={}){
 check(policyBytes,'DEB_POLICY_REQUIRED');const policy=JSON.parse(policyBytes.toString('utf8')),policySha=digest(policyBytes);
 check(policy.schemaVersion==='debts-dialogue/v1'&&policy.categoryId==='debts'&&policy.maxQuestionsPerCase===3&&policy.defaultQuestionBudget===2&&!policy.defaultActivation,'DEB_POLICY');
 const raw=fs.readFileSync(policy.source.path);check(raw.length===policy.source.bytes&&digest(raw)===policy.source.sha256,'DEB_SOURCE_PIN');
 const bundle=JSON.parse(raw),core=createExplicitEngine(bundle),rows=new Map(),stages=new Map(),questions=new Map(),fields=[];
 const admission=fs.readFileSync(policy.acceptance.path);check(admission.length===policy.acceptance.bytes&&digest(admission)===policy.acceptance.sha256,'DEB_ADMISSION_PIN');
 const accepted=JSON.parse(admission);check(accepted.assembled_source.sha256===policy.source.sha256&&accepted.production===false,'DEB_SOURCE_ADMISSION');
 for(const s of bundle.subcategories){stages.set(s.stage.id,s);for(const f of s.context_fields)fields.push('debts.'+s.stage.id+'.'+f.id);for(const row of s.variants)rows.set(row.variant_id,{row,stage:s});}
 check(rows.size===426&&stages.size===8&&eq([...rows.keys()],accepted.IDs)&&eq(policy.thirdQuestionReasons,bundle.metadata.next_policy.third_question_reasons),'DEB_INVENTORY');
 function visit(q,stage){const normalized={...q,fieldKey:`debts.${stage}.${q.field_key}`,stageId:stage,text:q.question};if(questions.has(q.id))check(eq(questions.get(q.id),normalized),'DEB_DUPLICATE_QUESTION');questions.set(q.id,normalized);for(const b of q.data)if(b.ask_next_question)visit(b.ask_next_question,stage);}
 for(const s of stages.values())for(const r of s.variants)r.payload.next.forEach(q=>visit(q,s.stage.id));
 const third=policy.thirdQuestionReasons;
 function prepareState(s){
  check(!s.categoryId||s.categoryId==='debts','DEB_CATEGORY');
  check(!s.debts?s.revision===0:s.debts.policySha===policySha&&s.debts.sourceSha===policy.source.sha256,'DEB_STATE_VERSION');
  s.categoryId='debts';s.categoryFieldKeys=fields;s.categoryBlockedFields=[];s.policyVersion=policy.version;
  s.debts||={policySha,sourceSha:policy.source.sha256,caseId:s.caseState.id,log:[],requests:{},stopped:false,scope:randomUUID(),last:null};
  check(s.debts.caseId===s.caseState.id,'DEB_CASE');
  for(const [id,r]of Object.entries(s.debts.requests))check(s.turns[id]?.requestHash===hash(stable(r)),'DEB_TURN_PROVENANCE');
  for(const l of s.debts.log){check(fields.includes(l.key)&&s.debts.requests[l.turnId]?.question===l.text&&l.proof===hash([l.key,l.value,l.operation,l.turnId,l.text,l.scope,l.questionId,l.receiptId]),'DEB_FACT_PROVENANCE');
   if(l.questionId){const q=questions.get(l.questionId),r=s.caseState.served.find(r=>r.id===l.receiptId);check(q?.fieldKey===l.key&&choiceValue(l.text)?.value===l.value&&r?.answer?.source?.turnId===l.turnId&&r?.answer?.value===l.value,'DEB_REPLY_PROVENANCE');}
   else check(interpretDebts(l.text,l.stage).observations.some(o=>o.key===l.key&&o.value===l.value&&o.operation===l.operation),'DEB_TEXT_PROVENANCE');
  }
  for(const r of s.caseState.served){const offered=s.turns[r.turnId]?.response?.answer?.next?.find(q=>q.questionId===r.questionId);check(offered&&offered.questionText===questions.get(r.questionId)?.question&&offered.view.every(c=>c.guided.native.receiptId===r.id),'DEB_OFFER_PROVENANCE');}
 }
 function facts(s,stage=currentEpisode(s).stageId){const f={},conflicted=new Set();if(s.debts.correctionHeld)return f;for(const l of s.debts.log)if(l.scope===s.debts.scope&&l.stage===stage){if(l.operation==='withdraw'||l.operation==='correct'){f[l.key]=l.operation==='withdraw'?null:l.value;conflicted.delete(l.key);}else if(conflicted.has(l.key))continue;else if(!own(f,l.key)||f[l.key]===null)f[l.key]=l.value;else if(l.value!==null&&f[l.key]!==l.value){f[l.key]=null;conflicted.add(l.key);}}return f;}

 function retire(s,why){if(s.pending){answerQuestionReceipt(s,s.pending,null,{kind:why});s.pending=null;}}
 function selectStage(s,stage){if(stage!==currentEpisode(s).stageId){retire(s,'stage_changed');newRound(s,'debts-stage');currentEpisode(s).stageId=stage;}}
 function choose(s){const stage=currentEpisode(s).stageId||'overdue_first_days',f=facts(s,stage),available=stages.get(stage).variants.filter(r=>core.compatible(r.variant_id,f));
  available.sort((a,b)=>Object.values(b.context).filter(v=>v!==null).length-Object.values(a.context).filter(v=>v!==null).length);
  return available[0].variant_id;
 }
 function plan(s){const stage=currentEpisode(s).stageId||'overdue_first_days',f=facts(s,stage),id=choose(s);let q=stages.get(stage).variants.find(r=>Object.values(r.context).every(v=>v===null)).payload.next[0];
  const seen=new Set();while(q){check(!seen.has(q.id),'DEB_NEXT_CYCLE');seen.add(q.id);const key=`debts.${stage}.${q.field_key}`;
   if(own(f,key)){const b=q.data.find(b=>b.value===f[key]);if(b.ask_next_question){q=b.ask_next_question;continue;}return {variantId:id,question:null};}
   const normalized=questions.get(q.id),p={kind:'next',key:q.id,fieldKey:key,stageId:stage,question:normalized};
   return {variantId:id,question:!s.debts.stopped&&canServeQuestion(s,p,third)?normalized:null};
  }return {variantId:id,question:null};
 }
 function admit(s,o,input,extra={}){check(fields.includes(o.key),'DEB_FIELD');const l={...o,stage:o.key.split('.')[1],turnId:input.turnId,text:input.question,scope:s.debts.scope,questionId:null,receiptId:null,...extra};l.proof=hash([l.key,l.value,l.operation,l.turnId,l.text,l.scope,l.questionId,l.receiptId]);s.debts.log.push(l);}
 function dispatch(s,input){
  for(const key of ['facts','context','snapshot','state','caseState','history','proof'])check(!own(input,key),'DEB_CLIENT_FACTS_FORBIDDEN');
  const text=input.question||'',action=input.guided?.native,p=s.pending,reply=p&&choiceValue(text),entry=rows.get(input.variantId);
  if(input.variantId)check(entry,'DEB_UNKNOWN_VARIANT');
  s.debts.requests[input.turnId]={question:text,action:action||null,...(own(input,'variantId')?{variantId:input.variantId}:{}),...(own(input,'launchHint')?{launchHint:input.launchHint}:{})};
  if(!action&&!entry&&!currentEpisode(s).stageId&&text.trim()&&!debtsStageHint(text)&&!/долг|кредит|кридит|за[йе]м|банк|давност|ипотек/iu.test(text)){retire(s,'outside_debts');return {variantId:null,question:null,boundary:true};}
  if(action||reply){check(p&&reply&&plan(s).question?.id===p.question.id,'DEB_REPLY_WITHOUT_PENDING');const receipt=s.caseState.served.find(r=>r.id===p.receiptId);check(receipt?.status==='served','DEB_STALE_RECEIPT');
   if(action)check(action.kind==='answer'&&action.questionId===p.question.id&&action.receiptId===p.receiptId&&action.value===reply.value&&action.sourceSha256===policy.source.sha256&&action.policySha===policySha&&action.caseId===s.caseState.id,'DEB_STALE_ACTION');
   answerQuestionReceipt(s,p,reply.value,{kind:action?'button':'question_reply',turnId:input.turnId});admit(s,{key:p.fieldKey,value:reply.value,operation:'assert'},input,{questionId:p.question.id,receiptId:p.receiptId});s.pending=null;
  }else{
   const parsed=interpretDebts(text,currentEpisode(s).stageId||entry?.stage.stage.id);
   if(parsed.scopeChange){retire(s,'different_obligation');s.debts.scope=randomUUID();s.debts.last=null;}
   const stage=parsed.stage||entry?.stage.stage.id||currentEpisode(s).stageId||'overdue_first_days';selectStage(s,stage);
   if(parsed.stop){retire(s,'declined');s.debts.stopped=true;}
   if(parsed.resume)s.debts.stopped=false;
   for(const o of parsed.observations)if(o.key.split('.')[1]===stage){admit(s,o,input);if(['correct','withdraw'].includes(o.operation))s.debts.correctionHeld=false;}
   if(/^(?:исправляю:|отзываю:)/iu.test(text.trim())&&!parsed.observations.length)s.debts.correctionHeld=true;
   if(parsed.held){retire(s,'unresolved_scope');s.debts.stopped=true;}
  }
  const out=plan(s);if(s.pending&&s.pending.question.id!==out.question?.id)retire(s,'fact_supplied');
  if(!s.pending&&out.question)s.pending={kind:'next',key:out.question.id,fieldKey:out.question.fieldKey,stageId:out.question.stageId,question:out.question};
  s.debts.last=out.variantId;return {...out,repeat:/повтори|покажи.*полностью/iu.test(text)};
 }
 function present(s,out,{turnId=null}={}){if(out.boundary)return {conversation:{sessionId:s.id,revision:s.revision,version:s.version,nonce:s.nonce},presentation:{responseId:randomUUID(),mode:'boundary',questionsUsed:caseQuestionsUsed(s),policyVersion:policy.version},answer:{category:'debts',content:'Этот раздел помогает с кредитами и долгами. Если вопрос о другой ситуации, выберите соответствующую тему. Если речь о долге, опишите, кто и что требует от вас.',next:[]},dialogue:{stageId:null,sourceSha256:policy.source.sha256,terminal:'category_boundary'}};const id=out.variantId||choose(s),a=rows.get(id).row.payload.answer,responseId=randomUUID();let p=s.pending;if(p&&!serveQuestion(s,p,responseId,turnId,third)){p=null;s.pending=null;}
  const fingerprint=hash([id,a]),full=out.repeat||s.presentation.lastFull!==fingerprint;if(full){s.presentation.lastFull=fingerprint;s.presentation.lastFullResponseId=responseId;}
  const native=p?{kind:'answer',sessionId:s.id,revision:s.revision,nonce:s.nonce,episodeId:s.activeEpisodeId,roundId:s.round.id,questionId:p.question.id,receiptId:p.receiptId,caseId:s.caseState.id,sourceSha256:policy.source.sha256,policySha}:null;
  return {conversation:{sessionId:s.id,revision:s.revision,version:s.version,nonce:s.nonce},presentation:{responseId,mode:full?'full':'continuation',referencesResponseId:full?null:s.presentation.lastFullResponseId,questionsUsed:caseQuestionsUsed(s),policyVersion:policy.version},answer:{category:'debts',variantId:id,content:full?[a.now,...a.steps,...a.dont,...a.say].map(escape).join('\n\n'):'Рекомендации выше остаются доступны. Новые обстоятельства можно сообщить своими словами.',next:p?[{type:'choice',questionText:p.question.question,questionId:p.question.id,view:p.question.data.map(b=>({title:b.label,question:b.label,guided:{native:{...native,value:b.value}}}))}]:[],sections:{laws:structuredClone(a.laws),documents:structuredClone(a.where_to),documentActionsUnavailable:true}},dialogue:{stageId:currentEpisode(s).stageId,sourceSha256:policy.source.sha256,policySha,questionId:p?.question.id||null,terminal:p?null:'variant'}};
 }
 return {categoryId:'debts',version:policy.version,policySha,sourceSha256:policy.source.sha256,policy,bundle,questions,prepareState,facts,plan,dispatch,present,rowFor:id=>rows.get(id),validate(b,sha){check(sha===policy.source.sha256&&eq(b,bundle),'DEB_SOURCE_VERSION');}};
}
