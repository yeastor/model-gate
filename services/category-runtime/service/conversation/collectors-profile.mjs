import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {currentEpisode,episode,newRound,recordFact,subjectFor,hash,canServeQuestion,serveQuestion,answerQuestionReceipt,caseQuestionsUsed} from './state.mjs';
import {choiceValue,validateQuestionDefinition} from './questions.mjs';
import {createExplicitEngine} from '../explicit/engine.mjs';
import {interpretCollectors} from './collectors-interpret.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const parse=b=>JSON.parse(b.toString('utf8').replace(/^\uFEFF/,''));
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b),own=(o,k)=>Object.hasOwn(o,k);
const requireValue=(x,code)=>{if(!x)throw Object.assign(Error(code),{status:409});};
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const escape=x=>x.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function createCollectorsProfile({policyBytes,componentBytes={},documentBindingsBytes}={}) {
  policyBytes ||= fs.readFileSync(new URL('./policy/collectors.v1.json',import.meta.url));
  const policy=parse(policyBytes),policySha=sha(policyBytes);
  requireValue(policySha==='8466c33e0b82f574e0ae6bf455d399433546dd1827c0ede83e2e0d7d6effd481','COL_POLICY_PIN');
  requireValue(policy.categoryId==='collectors'&&policy.defaultActivation===false&&policy.maxQuestionsPerCase===2&&eq(policy.thirdQuestionReasons,{}),'COL_POLICY');
  function load(p){const b=componentBytes[p.path]||fs.readFileSync(p.path);requireValue(b.length===p.bytes&&sha(b)===p.sha256,'COL_COMPONENT_PIN');return parse(b);}
  const manifest=load(policy.sourceManifest);requireValue(policy.componentSnapshotId===policy.sourceManifest.sha256,'COL_SNAPSHOT');
  requireValue(eq(policy.components,manifest.components.map(x=>({id:x.component_id,...x.candidate}))),'COL_MANIFEST_BINDING');
  const components=new Map(policy.components.map(p=>[p.id,load(p)]));
  const stageFiles=policy.components.filter(p=>p.id.startsWith('candidate/stages/'));
  const first=components.get(stageFiles[0].id);
  const bundle={category:first.category,metadata:first.metadata,subcategories:stageFiles.flatMap(p=>components.get(p.id).subcategories)};
  const core=createExplicitEngine(bundle),rows=new Map(),fields=new Map(policy.fields.map(f=>[f.field_key,f]));
  const blocked=policy.fields.filter(f=>f.classification!=='EXISTING_NEXT_OBSERVATION').map(f=>f.field_key);
  const lookup=load(policy.lookup),separate=components.get('candidate/next/next-content.json'),questions=new Map();
  requireValue(bundle.subcategories.length===8&&fields.size===51&&blocked.length===42&&policy.components.length===13,'COL_INVENTORY');
  for(const s of bundle.subcategories)for(const row of s.variants){
    requireValue(eq(Object.keys(row.context),s.context_fields.map(f=>f.id)),'COL_CONTEXT_ORDER');
    const l=lookup.entries.find(x=>x.variant_id===row.variant_id);
    requireValue(l&&eq(l.answer,row.payload.answer)&&eq(l.context,row.context)&&eq(l.context_fields,s.context_fields)&&l.retrieval_question===row.question&&eq(l.next,row.payload.next),'COL_LOOKUP');
    requireValue(eq(separate.entries.find(x=>x.variant_id===row.variant_id)?.next,row.payload.next),'COL_NEXT_MIRROR');
    rows.set(row.variant_id,{row,stage:s});
  }
  function visit(q,stage){
    const key=`collectors.${stage}.${q.field_key}`,spec=policy.questions.find(x=>x.question_id===q.id);
    requireValue(spec&&spec.field_key===key&&spec.question===q.question&&eq(spec.branches.map(x=>[x.value,x.label,x.target,x.next_question_id]),q.data.map(x=>[x.value,x.label,x.go_to_variant||null,x.ask_next_question?.id||null])),'COL_QUESTION_BINDING');
    const normalized={...structuredClone(q),text:q.question,fieldKey:key,stageId:stage,semanticRevision:policy.version,controls:q.data.map(({value,label})=>({value,label}))};
    validateQuestionDefinition({id:q.id,branches:q.data.map(b=>({value:b.value,kind:b.go_to_variant?'variant':'stage',variantId:b.go_to_variant,stageId:stage}))},core);
    questions.set(q.id,normalized);for(const b of q.data)if(b.ask_next_question)visit(b.ask_next_question,stage);
  }
  for(const {row,stage}of rows.values())row.payload.next.forEach(q=>visit(q,stage.stage.id));
  requireValue(rows.size===23&&questions.size===31&&lookup.entries.length===23,'COL_COUNTS');
  const version={policy:policy.version,policySha,snapshot:policy.componentSnapshotId,runtime:'collectors-control/20261026-r33-v1'};
  const documentBindings=documentBindingsBytes?parse(documentBindingsBytes):null;
  if(documentBindings)requireValue(documentBindings.category==='collectors'&&documentBindings.entries.length===15&&documentBindings.entries.every(e=>/^collectors_[a-z_]+$/.test(e.document_link_id)),'COL_DOCUMENT_BINDINGS');
  const fieldKey=(stage,field)=>`collectors.${stage}.${field}`;
  const state=s=>s.collectors;
  function prepareState(s,explicitNewCase=false){
    requireValue(!s.categoryId||s.categoryId==='collectors','COL_CATEGORY');
    requireValue(s.collectors?eq(s.collectors.version,version):s.revision===0||explicitNewCase,'COL_STATE_VERSION');
    s.categoryId='collectors';s.policyVersion=policy.version;s.categoryFieldKeys=[...fields.keys()];s.categoryBlockedFields=[...blocked];
    s.categoryScopeGroups=Object.fromEntries(policy.fields.map(f=>[f.field_key,f.stage_id]));
    s.collectors ||= {version,caseId:s.caseState.id,incident:randomUUID(),subjects:{},turns:{},raw:[],terminals:{},families:{},stopped:false};
    requireValue(state(s).caseId===s.caseState.id,'COL_CASE');delete state(s).inflight;
    // A missing original turn or receipt must not silently restore an allowance.
    for(const [id,t] of Object.entries(state(s).turns))requireValue(s.turns[id]&&t.caseId===s.caseState.id,'COL_TURN_HISTORY');
    const offered=new Map();
    for(const [id,t] of Object.entries(s.turns))for(const q of t.response?.answer?.next||[])for(const c of q.view||[]){
      const a=c.guided?.native;if(a?.caseId===s.caseState.id){requireValue(state(s).turns[id],'COL_TURN_HISTORY');offered.set(a.receiptId,true);}
    }
    requireValue(s.caseState.served.every(r=>offered.has(r.id))&&[...offered.keys()].every(id=>s.caseState.served.some(r=>r.id===id)),'COL_RECEIPT_HISTORY');
    for(const f of s.factLedger.filter(f=>f.caseId===s.caseState.id))requireValue(state(s).turns[f.source?.turnId]&&s.turns[f.source?.turnId],'COL_TURN_HISTORY');
    currentEpisode(s).categorySubjects ||= {};
  }
  function scope(s,stage=currentEpisode(s).stageId){return {userId:s.userId,chatId:s.chatId,caseId:s.caseState.id,episodeId:s.activeEpisodeId,incident:state(s).incident,stage,subjectId:subjectFor(s,fieldKey(stage,stage==='home_visits'?'attempted_forced_entry':'immediate_danger'))};}
  function selectStage(s,stage){requireValue(bundle.subcategories.some(x=>x.stage.id===stage),'COL_STAGE');const e=currentEpisode(s),key=state(s).incident+':'+stage;e.categorySubjects[stage]={current:state(s).subjects[key] ||= randomUUID()};if(e.stageId!==stage){retire(s,'stage_changed');newRound(s,'collectors-stage');e.stageId=stage;}}
  const scopeKey=(s,stage=currentEpisode(s).stageId)=>hash(scope(s,stage));
  const familyKey=(s,field)=>`${state(s).incident}:${field}`;
  function turnValid(s,id){const t=state(s).turns[id];return !!t&&t.userId===s.userId&&t.chatId===s.chatId&&t.caseId===s.caseState.id&&t.episodeId===s.activeEpisodeId&&(state(s).inflight===id||s.turns[id]?.requestHash===hash(stable(t.request)));}
  function receiptValid(s,r){
    const q=questions.get(r?.questionId),p=r?.collectorsProof;
    if(!q||!p||!eq(p.version,version)||p.userId!==s.userId||p.chatId!==s.chatId||p.caseId!==s.caseState.id||p.questionHash!==hash(q))return false;
    const offered=s.turns[r.turnId]?.response.answer.next.find(x=>x.questionId===q.id);
    return !!offered&&offered.questionText===q.text&&eq(offered.view.map(x=>({value:x.guided.native.value,label:x.title})),q.controls)&&offered.view.every(x=>x.guided.native.receiptId===r.id&&x.guided.native.scopeDigest===p.scopeDigest&&x.guided.native.policySha===policySha);
  }
  function admissionFingerprint(f){const {status,supportingSources,...proof}=f;return hash(stable(proof));}
  function valid(s,f){
    if(!f||f.status!=='active'||f.operation==='withdraw'||blocked.includes(f.fieldKey))return false;
    const src=f.source,t=state(s).turns[src?.turnId];
    if(!t||t.admissions?.[f.id]!==admissionFingerprint(f)||src.kind!==(src.questionId?(t.request.action?'button':'question_reply'):'user_text'))return false;
    if(!turnValid(s,src?.turnId)||!t||!eq(src.version,version)||!eq(src.scope,scope(s,f.fieldKey.split('.')[1]))||src.message!==t.request.question||src.value!==f.value||src.operation!==f.operation||!Array.isArray(src.span)||src.span.length!==2||!src.span.every(Number.isInteger)||src.span[0]<0||src.span[1]>Array.from(src.message).length||src.span[1]<src.span[0]||Array.from(src.message).slice(...src.span).join('')!==src.quote)return false;
    if(src.questionId){const r=s.caseState.served.find(x=>x.id===src.receiptId);return !!r&&receiptValid(s,r)&&r.fieldKey===f.fieldKey&&r.subjectId===f.subjectId&&r.answer?.source?.turnId===src.turnId&&r.answer?.value===f.value&&choiceValue(t.request.question)?.value===f.value;}
    const p=interpretCollectors(t.request.question,src.turnId,policy,t.stage);
    return !p.held&&p.observations.some(x=>x.fieldKey===f.fieldKey&&x.value===f.value&&x.operation===f.operation&&eq(x.source.span,src.span)&&x.source.quote===src.quote);
  }
  function record(s,key){return s.factLedger.findLast(f=>f.episodeId===s.activeEpisodeId&&f.caseId===s.caseState.id&&f.subjectId===subjectFor(s,key)&&f.fieldKey===key&&['active','conflicted','invalidated'].includes(f.status));}
  function facts(s,stage=currentEpisode(s).stageId){const out={};for(const key of fields.keys())if(key.startsWith(`collectors.${stage}.`)){const f=record(s,key);if(valid(s,f))out[key]=f.value;}return out;}
  function retire(s,reason){if(s.pending){answerQuestionReceipt(s,s.pending,null,{kind:reason});s.pending=null;}}
  function admit(s,p){
    if(blocked.includes(p.fieldKey)||!fields.has(p.fieldKey))return null;
    const old=record(s,p.fieldKey);if(['correct','withdraw'].includes(p.operation)&&!old)return null;
    const src={...p.source,version,scope:scope(s,p.fieldKey.split('.')[1]),value:p.value,operation:p.operation};
    // Explicit correction/withdrawal is a new observation even at the same value.
    // Keep the common helper and preserve the predecessor without changing B51.
    const explicit=old&&['correct','withdraw'].includes(p.operation);
    if(explicit)old.status='superseded';
    const f=recordFact(s,p.fieldKey,p.value,src,p.operation,[]);
    if(explicit)f.supersedes=[old.id];
    if(f!==old)(state(s).turns[src.turnId].admissions ||= {})[f.id]=admissionFingerprint(f);
    if(f!==old){delete state(s).terminals[scopeKey(s)];delete state(s).families[familyKey(s,p.fieldKey.split('.').at(-1))];retire(s,'facts_changed');}
    if(f!==old&&f.status==='active'&&f.operation!=='withdraw'&&f.fieldKey.endsWith('.immediate_danger')&&f.value===null)
      state(s).families[familyKey(s,'immediate_danger')]={value:null,target:'collectors_threats_pressure_v01',factId:f.id};
    return f;
  }
  function compatible(s,id){const x=rows.get(id);return !!x&&!policy.withheldVariants.includes(id)&&core.compatible(id,facts(s,x.stage.stage.id));}
  function resolve(s,stage=currentEpisode(s).stageId){
    const candidates=bundle.subcategories.find(x=>x.stage.id===stage)?.variants.filter(v=>compatible(s,v.variant_id))||[];
    return candidates.sort((a,b)=>Object.values(b.context).filter(v=>v!==null).length-Object.values(a.context).filter(v=>v!==null).length)[0]?.variant_id||null;
  }
  function plan(s){
    const stage=currentEpisode(s).stageId;if(!stage)return {variantId:null,question:null};
    const value=facts(s),terminal=state(s).terminals[scopeKey(s)],base=resolve(s);
    if(terminal&&compatible(s,terminal))return {variantId:terminal,question:null};
    if(state(s).stopped)return {variantId:base,question:null};
    const savedFamily=state(s).families[familyKey(s,'immediate_danger')];
    const closed=savedFamily&&s.factLedger.some(f=>f.id===savedFamily.factId&&f.value===savedFamily.value&&valid(s,f))?savedFamily:null;
    const safety=record(s,fieldKey(stage,'immediate_danger'));
    if(safety?.status==='conflicted')return {variantId:'collectors_threats_pressure_v01',question:null};
    if(closed?.value===null)return {variantId:'collectors_threats_pressure_v01',question:null};
    if(closed?.value===true&&compatible(s,closed.target))return {variantId:closed.target,question:null};
    let q=rows.get(state(s).entry)?.stage.stage.id===stage?rows.get(state(s).entry).row.payload.next[0]:rows.get(base)?.row.payload.next[0];
    while(q){
      const key=fieldKey(stage,q.field_key),f=record(s,key);
      if(own(value,key)){
        const b=q.data.find(x=>x.value===value[key]);
        if(b.ask_next_question){q=b.ask_next_question;continue;}
        // Preserve any more specific supported effect already established.
        return {variantId:b.go_to_variant===`collectors_${stage}_v01`?base:compatible(s,b.go_to_variant)?b.go_to_variant:base,question:null};
      }
      const family=state(s).families[familyKey(s,q.field_key)];
      if(f||family&&s.factLedger.some(x=>x.id===family.factId&&valid(s,x)))return {variantId:base,question:null};
      if(q.field_key==='night_calls'&&value[fieldKey(stage,'immediate_danger')]!==false)return {variantId:base,question:null};
      const normalized=questions.get(q.id),pending={kind:'next',key:q.id,stageId:stage,fieldKey:key,question:normalized};
      return {variantId:base,question:canServeQuestion(s,pending,{})?normalized:null};
    }
    return {variantId:base,question:null};
  }
  function dispatch(s,input){
    // The shared non-neighbors initial-resume path has no committed turn binding.
    // Refuse it locally; repairing that shared path requires a separate grant.
    requireValue(!input.resume&&/^[a-f0-9-]{36}$/i.test(input.turnId||''),'COL_INITIAL_RESUME_UNSUPPORTED');
    const action=input.guided?.native?.kind?input.guided.native:null,text=input.question||'',n=state(s);
    const parseStage=rows.get(input.variantId)?.stage.stage.id||currentEpisode(s).stageId;
    const parsed=interpretCollectors(text,input.turnId,policy,parseStage);
    if(parsed.newCase){retire(s,'new_case');episode(s,'new-case');s.collectors=null;prepareState(s,true);newRound(s,'collectors-new-case');}
    const st=state(s);st.turns[input.turnId]={request:{question:text,action,...(own(input,'variantId')?{variantId:input.variantId}:{}),...(own(input,'launchHint')?{launchHint:input.launchHint}:{})},userId:s.userId,chatId:s.chatId,caseId:s.caseState.id,episodeId:s.activeEpisodeId,stage:parseStage};st.inflight=input.turnId;
    if(action||s.pending&&choiceValue(text)){
      const pending=s.pending,q=pending?.question,r=pending&&s.caseState.served.find(x=>x.id===pending.receiptId),reply=choiceValue(text);
      requireValue(q&&r&&receiptValid(s,r)&&reply&&['served'].includes(r.status),'COL_OFFER_INVALID');
      requireValue(plan(s).question?.id===q.id,'COL_QUESTION_NO_LONGER_APPLICABLE');
      if(action){requireValue(action.kind==='answer'&&action.questionId===q.id&&action.receiptId===r.id&&action.fieldKey===q.fieldKey&&action.caseId===s.caseState.id&&action.subjectId===subjectFor(s,q.fieldKey)&&action.scopeDigest===scopeKey(s)&&action.policySha===policySha&&action.value===reply.value,'COL_ACTION_BINDING');}
      requireValue(eq(r.collectorsProof.scopeDigest,scopeKey(s)),'COL_SCOPE');
      const value=reply.value,src={kind:action?'button':'question_reply',turnId:input.turnId,message:text,quote:text,span:[0,Array.from(text).length],questionId:q.id,receiptId:r.id};
      answerQuestionReceipt(s,pending,value,src);s.pending=null;
      const admitted=admit(s,{fieldKey:q.fieldKey,value,operation:'assert',source:src});
      const branch=q.data.find(x=>x.value===value);
      st.families[familyKey(s,q.field_key)]={value,target:branch.go_to_variant||null,receiptId:r.id,factId:admitted?.id};
      if(branch.go_to_variant)st.terminals[scopeKey(s)]=branch.go_to_variant;
    }else{
      st.raw.push({turnId:input.turnId,text,held:parsed.held,observations:parsed.observations});
      if(parsed.scopeChange){retire(s,'scope_changed');st.incident=randomUUID();st.entry=null;const stage=currentEpisode(s).stageId;if(stage)selectStage(s,stage);}
      if(parsed.held){st.scopeHeld=true;retire(s,'ambiguous_scope');return {variantId:resolve(s),question:null};}
      if(st.scopeHeld){if(!parsed.explicitStage&&!parsed.scopeChange)return {variantId:resolve(s),question:null};st.scopeHeld=false;st.incident=randomUUID();st.entry=null;}
      const entry=input.variantId&&rows.get(input.variantId);if(input.variantId)requireValue(entry,'COL_UNKNOWN_VARIANT');
      const stage=parsed.stage||entry?.stage.stage.id;
      if(stage)selectStage(s,stage);
      if(entry&&entry.stage.stage.id===currentEpisode(s).stageId)st.entry=input.variantId;
      if(parsed.stop){retire(s,'declined');st.stopped=true;}
      for(const p of parsed.observations){if(p.fieldKey.split('.')[1]===currentEpisode(s).stageId)admit(s,p);}
    }
    const out=plan(s);if(s.pending&&s.pending.question.id!==out.question?.id)retire(s,'no_longer_applicable');
    if(!s.pending&&out.question)s.pending={kind:'next',key:out.question.id,fieldKey:out.question.fieldKey,stageId:out.question.stageId,question:out.question};
    return {...out,repeat:parsed.repeat};
  }
  function present(s,out,{turnId=null}={}){
    const id=out.variantId,answer=rows.get(id)?.row.payload.answer,responseId=randomUUID();let pending=s.pending;
    if(pending&&!serveQuestion(s,pending,responseId,turnId,{})){s.pending=null;pending=null;}
    let native=null;
    if(pending){const r=s.caseState.served.find(x=>x.id===pending.receiptId);r.collectorsProof ||= {version,userId:s.userId,chatId:s.chatId,caseId:s.caseState.id,questionHash:hash(pending.question),scopeDigest:scopeKey(s)};native={kind:'answer',sessionId:s.id,revision:s.revision,nonce:s.nonce,episodeId:s.activeEpisodeId,roundId:s.round.id,caseId:s.caseState.id,subjectId:subjectFor(s,pending.fieldKey),fieldKey:pending.fieldKey,questionId:pending.question.id,receiptId:r.id,scopeDigest:scopeKey(s),policySha};}
    const fingerprint=answer?hash([id,answer]):null,full=!!answer&&(out.repeat||s.presentation.lastFull!==fingerprint);
    if(full){s.presentation.lastFull=fingerprint;s.presentation.lastFullResponseId=responseId;}
    const content=full?[answer.now,...answer.steps,...answer.dont,...answer.say].map(escape).join('\n\n'):answer?'Памятка выше остаётся доступна. Новые обстоятельства можно сообщить своими словами.':'Опишите, что происходит при взыскании долга.';
    const response={conversation:{sessionId:s.id,revision:s.revision,version:s.version,nonce:s.nonce},presentation:{responseId,mode:full?'full':answer?'continuation':'boundary',referencesResponseId:full?null:s.presentation.lastFullResponseId||null,questionsUsed:caseQuestionsUsed(s),policyVersion:policy.version},answer:{category:'collectors',variantId:id||undefined,content,next:pending?[{type:'choice',questionText:pending.question.text,questionId:pending.question.id,view:pending.question.controls.map(c=>({title:c.label,question:c.label,guided:{native:{...native,value:c.value}}}))}]:[],...(full?{sections:{laws:structuredClone(answer.laws),documents:structuredClone(answer.where_to),documentActionsUnavailable:true}}:{})},dialogue:{stageId:currentEpisode(s).stageId||null,questionId:pending?.question.id||null,sourceSnapshotId:policy.componentSnapshotId,policySha,producerHolds:blocked,specializationHeld:state(s).entry?policy.withheldVariants.includes(state(s).entry):false,terminal:pending?null:answer?'variant':'boundary'}};
    // Only an explicit supported observation admits this document offer.
    // A retrieval mask, variant ID or unknown safety never supplies the trigger.
    const known=facts(s,'calls_messages');
    if(documentBindings&&full&&id==='collectors_calls_messages_v02'&&known['collectors.calls_messages.immediate_danger']===false&&known['collectors.calls_messages.night_calls']===true){
      const document=documentBindings.entries.find(e=>e.candidate_key==='fssp.ordinary');
      requireValue(document,'COL_DOCUMENT_BINDING_MISSING');
      const destination={title:document.title,document_link_id:document.document_link_id};
      response.answer.sections.documents=[destination];response.answer.sections.documentActionsUnavailable=false;
      response.answer.content+='\n\n<a href="/documents/link/'+document.document_link_id+'">'+escape(document.title)+'</a>';
    }
    return response;
  }
  freeze(policy);freeze(bundle);
  return Object.freeze({categoryId:'collectors',version:policy.version,sourceSha256:policy.componentSnapshotId,policySha,policy,bundle,questions:new Map([...questions].map(([k,q])=>[k,freeze(structuredClone(q))])),prepareState,scope,facts,plan,dispatch,present,rowFor:id=>rows.get(id),validate(candidate,sha){requireValue(sha===policy.componentSnapshotId&&eq(candidate,bundle),'COL_SOURCE_VERSION');}});
}
