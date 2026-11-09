// Explicit local assembly: shared dispatch only; category policies remain separate.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createConversationService} from './service.mjs';
import {atomic,read,identityKey,removeAtomicTemps} from './state.mjs';
import {localTopic as baseLocalTopic,unavailableLocalTopic} from './local-topics.mjs';
function localTopic(category,text){
 if(category==='children_alimony'&&/(?:измен|уменьш|увелич|индексац).{0,80}алимент/iu.test(String(text||'')))return 'alimony_change';
 return baseLocalTopic(category,text);
}
const digest=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=(code,status=409)=>{throw Object.assign(Error(code),{status})};
const escape=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function renderGeneral(row){const a=row.payload.answer;return [escape(a.now),...(a.steps||[]).map(x=>'• '+escape(x)),...(a.dont||[]).map(x=>'Не следует: '+escape(x)),...(a.say||[]).map(x=>'Можно сказать: '+escape(x)),...(a.where_to||[]).map(x=>`<a href="/documents/link/${encodeURIComponent(x.document_link_id)}">${escape(x.title)}</a>`),...(a.laws||[]).map(x=>`<a href="${escape(x.url)}">${escape(x.ref)}</a>: ${escape(x.short)}`)].join('\n\n');}
async function pinnedBytes(p){const b=await fs.readFile(p.path);if(b.length!==p.bytes||createHash('sha256').update(b).digest('hex')!==p.sha256)fail('LOCAL_PIN_MISMATCH');return b;}
const pinned=async p=>JSON.parse(await pinnedBytes(p));
async function api(base,url,body){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});if(!r.ok)fail('LOCAL_RETRIEVAL_HTTP_'+r.status,503);return r.json();}
export async function createLocalMulti({registryPin,dataDir,searchOverride}={}){
 const registry=await pinned(registryPin);if(registry.schema!=='local-category-registry/v1'||registry.production!==false)fail('LOCAL_REGISTRY_REQUIRED');
 const entries=new Map(),byId=new Map(),locks=new Map();
 for(const spec of registry.categories){
  if(entries.has(spec.category))fail('LOCAL_DUPLICATE_CATEGORY');
  const e={...spec};entries.set(e.category,e);if(e.mode==='blocked')continue;
  e.bundle=await pinned(e.source);if(e.bundle.category.id!==e.category)fail('LOCAL_SOURCE_CATEGORY');
  e.general=e.bundle.subcategories.flatMap(s=>s.variants.filter(v=>Object.values(v.context).every(x=>x===null)&&Object.values(v.applicability||{}).every(x=>x!==true)).map(row=>({row,stage:s.stage})));
  if(e.general.length!==e.bundle.subcategories.length)fail('LOCAL_GENERAL_COVERAGE');
  e.rows=new Map(e.bundle.subcategories.flatMap(s=>s.variants.map(v=>[v.variant_id,{row:v,stage:s.stage}])));
  for(const id of e.rows.keys()){if(byId.has(id))fail('LOCAL_ID_COLLISION');byId.set(id,e.category);}
  const store=path.join(dataDir,e.category);
  if(e.mode==='profile'){
   await pinnedBytes(e.factory.module);const m=await import(pathToFileURL(e.factory.module.path));
   e.profile=await m[e.factory.export]({...(e.factory.policy?{policyBytes:await pinnedBytes(e.factory.policy)}:{}),...(e.documentBindings?{documentBindingsBytes:await pinnedBytes(e.documentBindings)}:{})});
   if(JSON.stringify(e.bundle)!==JSON.stringify(e.profile.bundle))fail('LOCAL_NATIVE_SOURCE_MISMATCH');
   e.bundle=e.profile.bundle;e.profile.validate(e.bundle,e.profile.sourceSha256);
   const runtimeProfile={...e.profile,dispatch(s,input){
    const topic=s.revision===0?(input.launchHint?.stageId||e.rows.get(input.variantId)?.stage.id):null;
    const outcome=e.profile.dispatch(s,input);
    if(topic)s.localGeneralTopic={stageId:topic,episodeId:s.activeEpisodeId};
    return outcome;
   },present(s,outcome,options){
    const response=e.profile.present(s,outcome,options);
    // A topic candidate with no admitted facts may display the exact general
    // answer. Do not alter the profile state, scope or selected specialized ID.
    const topic=s.localGeneralTopic?.episodeId===s.activeEpisodeId?s.localGeneralTopic.stageId:null,general=e.general.find(v=>v.stage.id===topic);
    if(general&&!s.factLedger.length&&!response.answer.variantId&&!response.answer.next?.some(q=>q.questionText)){
     response.answer={...response.answer,variantId:general.row.variant_id,content:[response.answer.content,renderGeneral(general.row)].filter(Boolean).join('\n\n'),next:[]};
     response.presentation={...response.presentation,kind:'full',generalTopicOnly:true,answerFingerprint:digest(general.row.payload.answer)};
    }
    return response;
   }};
   e.service=createConversationService({dataDir:store,categoryProfile:e.category==='dps'?null:runtimeProfile,dpsProfile:e.category==='dps'?runtimeProfile:null,getActive:async()=>({sha256:e.profile.sourceSha256}),getBundle:async()=>e.bundle});
  }else if(e.mode==='shared'){
   // MC is selected by the existing requestProfile path; PPS keeps its existing engine.
   const base=await pinned(e.baseSource);
   e.service=createConversationService({dataDir:store,getActive:async()=>({sha256:e.baseSource.sha256}),getBundle:async sha=>{if(sha!==e.baseSource.sha256)fail('LOCAL_PINNED_VERSION');return base},search:async(text,opts)=>search(text,opts?.categoryId||'pps')});
   }else if(e.mode==='children-site'){
   if(e.category!=='children_alimony')fail('CHILDREN_MODE_CATEGORY');
   for(const p of e.implementationPins||[])await pinnedBytes(p);
   const {loadQualifiedPackage}=await import('./qualified-package.mjs');
   e.qualifiedPackage=await loadQualifiedPackage(e.packagePin);
   if(JSON.stringify(e.bundle)!==JSON.stringify(e.qualifiedPackage.bundle))fail('CHILDREN_SOURCE_MISMATCH');
   const cfg=await pinned(e.sqliteLocator);
   process.env.CATEGORY_CHILDREN_SITE_MVP='1';process.env.CHILDREN_PRIVATE_SQLITE_STORE=JSON.stringify(cfg);
   const never=()=>fail('CHILDREN_UNSCOPED_ACCESS');
   e.scopedService=createConversationService({dataDir:cfg.root,qualifiedPackage:e.qualifiedPackage,privateOnly:true,getActive:never,getBundle:never,search:never});
  }else if(e.mode!=='general')fail('LOCAL_UNSUPPORTED_MODE');
 }
 function identity(input){if(!/^\d{1,12}$/.test(String(input.userId))||!uuid.test(input.id||''))fail('INVALID_IDENTITY',403);return identityKey(String(Number(input.userId)),input.id.toLowerCase());}
 async function locked(key,fn){const prev=locks.get(key)||Promise.resolve();let release;const next=new Promise(r=>release=r);locks.set(key,next);await prev;try{return await fn()}finally{release();if(locks.get(key)===next)locks.delete(key)}}
 const bindingFile=key=>path.join(dataDir,'bindings',key+'.json');
 async function search(text,category){
  if(searchOverride)return searchOverride(text,category);
  const targets=[...entries.values()].filter(e=>e.mode!=='blocked'&&(!category||e.category===category));
  const vector=(await api(registry.ollama,'/api/embed',{model:'bge-m3',input:text,truncate:false,keep_alive:'10m'})).embeddings?.[0];
  if(vector?.length!==1024||vector.some(v=>!Number.isFinite(v)))fail('LOCAL_EMBEDDING_SHAPE',503);
  const results=await Promise.all(targets.map(async e=>{
   const filter={must:[{key:'category.id',match:{value:e.category}},{key:'source_sha256',match:{value:e.searchSourceSha256}}]};
   // Only topic entries may route a fresh case; specialized contexts never become facts.
   if(!category||e.mode==='children-site')filter.must.push({key:'variant_id',match:{any:e.general.map(v=>v.row.variant_id)}});
   const hits=(await api(registry.qdrant,`/collections/${e.collection}/points/search`,{vector,filter,limit:4,with_payload:true})).result;
   return hits.filter(h=>{const found=e.rows.get(h.payload?.variant_id);return found&&found.stage.id===h.payload.stage?.id&&h.payload.category.id===e.category&&h.payload.source_sha256===e.searchSourceSha256}).map(h=>({...h,category:e.category}));
  }));return results.flat().sort((a,b)=>b.score-a.score);
 }
 async function binding(input){const key=identity(input);let b=await read(bindingFile(key));if(!b&&registry.legacyConflicts?.some(x=>x.key===key))fail('LOCAL_LEGACY_STATE_CONFLICT');if(!b&&registry.legacyBindings?.[key])b={category:registry.legacyBindings[key]};return {key,b};}
 async function internal(input,operation){return locked(identity(input),async()=>{const {key,b}=await binding(input);
   const removing=operation==='delete'||operation==='expire';
   if(b?.deleted&&!removing){if(operation==='pending')return{historyEnvelope:null};return{ok:true}}
   const e=entries.get(b?.category),internalService=b?.childrenScoped?e?.scopedService:e?.service;
   if(internalService){const r=await internalService.internal(input,operation);if(removing){if(!r?.ok)fail('STATE_REMOVAL_UNCONFIRMED');await atomic(bindingFile(key),{deleted:true});await removeAtomicTemps(bindingFile(key));}return r;}
   if(operation==='pending')return{historyEnvelope:b?.outbox||null};if(operation==='ack'){if(b?.outbox?.turnId===input.turnId){b.outbox=null;await atomic(bindingFile(key),b)}return{ok:true}}if(removing){await atomic(bindingFile(key),{deleted:true});await removeAtomicTemps(bindingFile(key));return{ok:true}}fail('INVALID_INTERNAL_ACTION');});}
 async function respond(input){return locked(identity(input),async()=>{
  if(input.protocolVersion!==2)fail('LOCAL_PROTOCOL_V2_REQUIRED');
  const {key,b:previous}=await binding(input);let b=previous;if(b?.deleted)fail('CHAT_DELETED',410);
  if(!input.resume&&(!uuid.test(input.turnId||'')||typeof input.question!=='string'||Array.from(input.question).length>10000))fail('INVALID_TURN');
  const explicit=[input.categoryId,input.guided?.categoryId,input.launchHint?.categoryId].filter(Boolean);if(new Set(explicit).size>1)fail('CATEGORY_SESSION_MISMATCH');
  const variantCategory=byId.get(input.variantId||input.guided?.entryVariantId);if(variantCategory&&explicit.length&&variantCategory!==explicit[0])fail('CATEGORY_ENTRY_MISMATCH');
  if(b?.category&&explicit.length&&explicit[0]!==b.category)fail('CATEGORY_SESSION_MISMATCH');
  let category=b?.category||variantCategory||explicit[0],hits=[],selected;
  // An unavailable topic gets a plain refusal with category="" and no variant,
  // laws or documents. No closed package is loaded or called by this guard.
  const unavailable=!category&&unavailableLocalTopic(input.question);
  if(!category&&!unavailable&&!input.resume&&!b?.turns?.[input.turnId]){hits=await search(input.question||'');if(hits[0]?.score>=registry.routingThreshold){category=hits[0].category;selected=hits[0].payload.stage.id;}}
  const e=entries.get(category);
  if(e&&e.mode!=='blocked'&&!b?.category){b={...b,category,sessionId:b?.sessionId||randomUUID(),revision:b?.revision||0,turns:b?.turns||{},outbox:b?.outbox||null};await atomic(bindingFile(key),b);}
  const suppliedScope=input.guided?.native?.privateDialogue;
  if(e?.scopedService && (b?.childrenScoped || (!previous && suppliedScope))){
   if(!b.childrenScoped){b.childrenScoped=structuredClone(suppliedScope);await atomic(bindingFile(key),b);}
   const pd=suppliedScope||b.childrenScoped;
   const request={...input,categoryId:category,guided:{...(input.guided||{}),native:{...(input.guided?.native||{}),privateDialogue:pd}}};
   const response=await e.scopedService.respond(request);
   response.answer.category=e.bundle.category;
   response.guided.context||={};response.guided.conversation=response.conversation;
   return response;
  }
  if(e?.scopedService && suppliedScope)fail('CHILDREN_SCOPE_REQUIRES_NEW_CHAT');
  if(e?.service){
   let request={...input,categoryId:category};
   if(b.initialTurn===input.turnId&&b.initialRequest)request={...input,...b.initialRequest};
   if(!previous&&!input.resume&&!input.variantId&&!input.guided){
    const hint=input.launchHint?.stageId||localTopic(category,input.question);
    if(hint&&!e.bundle.subcategories.some(s=>s.stage.id===hint))fail('INVALID_STAGE');
    if(!hint&&!selected){hits=await search(input.question,category);selected=hits[0]?.payload.stage.id;}
    if(hint||selected){const general=e.general.find(v=>v.stage.id===(hint||selected));request.variantId=general.row.variant_id;request.launchHint={categoryId:category,stageId:general.stage.id};}
   }
   if(!b.initialTurn&&!input.resume){b.initialTurn=input.turnId;b.initialRequest={categoryId:request.categoryId,variantId:request.variantId,launchHint:request.launchHint};await atomic(bindingFile(key),b);}
   const response=await e.service.respond(request);
   // Existing profiles use both string categories and compact control objects.
   // Normalize only the transport envelope expected by Go and the existing UI.
   const categoryObject=e.bundle.category;
   response.answer.category=categoryObject;
   response.answer.next=(response.answer.next||[]).map((group,gi)=>({...group,view:(group.view||[]).map((v,vi)=>({...v,type:v.type||'badge',id:v.id||digest([response.presentation?.responseId,gi,vi]).slice(0,24),value:v.value||v.title||v.question,categoryId:category,variantId:v.variantId||''}))}));
   response.guided||={categoryId:category,context:{}};
   response.guided.context||={};response.guided.categoryId||=category;
   response.guided.conversation=response.conversation;
   return response;
  }
  // Search-only categories have no category-specific facts, producers or question policy.
  b ||= {sessionId:randomUUID(),revision:0,turns:{},outbox:null};
  if(input.resume&&b.lastResponse)return{...b.lastResponse,_historyEnvelope:b.outbox};
  if(input.resume){
   if(!input.variantId&&!input.launchHint?.stageId)fail('LOCAL_NO_SAVED_RESPONSE');
   const h=digest(key+':initial:'+String(input.variantId||input.launchHint.stageId));
   input={...input,resume:false,question:input.question||'',turnId:`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`};
  }
  const requestHash=digest({question:input.question,variantId:input.variantId,category:category||null,conversation:input.conversation,...(e?.mode==='children-site'?{guided:input.guided,launchHint:input.launchHint}:{})});
  const turn=b.turns[input.turnId];if(turn){if(turn.hash!==requestHash)fail('TURN_ID_CONFLICT');return{...turn.response,turn:{...turn.response.turn,replayed:true},_historyEnvelope:b.outbox}}
  if(b.outbox)fail('HISTORY_DELIVERY_PENDING');
  if(b.revision&&(!input.conversation||input.conversation.sessionId!==b.sessionId||input.conversation.revision!==b.revision))fail('STALE_STATE');
  let row;
  if(e?.mode==='general'||e?.mode==='children-site'){
   if(input.guided?.native?.kind)fail('LOCAL_GENERAL_HAS_NO_ACTIONS');
   const id=input.variantId||input.guided?.entryVariantId;const stage=input.launchHint?.stageId||localTopic(category,input.question)||(e.mode==='children-site'?b.childrenGeneralStage:null);
   if(id){row=e.general.find(v=>v.row.variant_id===id)?.row;if(!row)fail('LOCAL_GENERAL_ONLY');}
   else if(stage){row=e.general.find(v=>v.stage.id===stage)?.row;if(!row)fail('INVALID_STAGE');}
   else{if(!hits.length)hits=await search(input.question,category);const h=hits.find(h=>e.general.some(v=>v.row.variant_id===h.payload.variant_id));if(h?.score>=registry.routingThreshold)row=e.rows.get(h.payload.variant_id).row;}
  }
  if(row&&e?.mode==='children-site')b.childrenGeneralStage=e.rows.get(row.variant_id).stage.id;
  const childrenMenu=e?.mode==='children-site'&&!row;
  const content=childrenMenu?'Выберите тему, по которой нужна памятка. Для этого выбора не требуется подтверждать обстоятельства дела.':row?renderGeneral(row):(unavailable||e?.mode==='blocked')?'Для этой категории локальное подключение пока остановлено: проверка исходных материалов ещё не завершена. Выберите другую категорию или опишите другую ситуацию.':'Пока не удалось уверенно выбрать категорию. Уточните, что произошло и кто участвует в ситуации.';
  b.revision++;const messageId=randomUUID(),responseId=randomUUID();
  const response={status:row?'answer':'navigation',conversation:{sessionId:b.sessionId,revision:b.revision},guided:{categoryId:category||'',context:{}},presentation:{kind:'full',responseId,answerFingerprint:row?digest(row.payload.answer):null,referencesResponseId:null,urgentPriority:false},answer:{category:e?.bundle?.category||{id:category||'',name:e?.name||''},content,variantId:row?.variant_id,next:[]},turn:{turnId:input.turnId,messageId,revision:b.revision,replayed:false}};
  if(e?.mode==='children-site'){
   response.documentDelivery={mode:'guidance_only',availableForms:[],automaticGeneration:false};
   response.presentation.build='children-site-mvp/20261029-v1';response.presentation.scopeMode='general_without_case_facts';
   if(childrenMenu)response.answer.next=[{type:'choice',questionText:'По какой теме нужна помощь?',view:e.general.map(g=>({type:'badge',id:digest(g.row.variant_id).slice(0,24),value:g.stage.name,question:g.stage.name,categoryId:category,variantId:g.row.variant_id,guided:{categoryId:category,entryVariantId:g.row.variant_id,context:{}}}))}];
   const danger=['Моего ребёнка сейчас бьют.','Моего ребенка сейчас бьют.'];
   if(danger.includes(input.question.trim())){response.answer.content=escape(e.qualifiedPackage.urgentHelp.text)+'\n\n'+response.answer.content;response.presentation.urgentPriority=true;}
  }
  b.outbox={turnId:input.turnId,messageId,createdAt:new Date().toISOString(),question:input.question,answer:content,category:category||'',responseId};b.lastResponse=response;b.turns[input.turnId]={hash:requestHash,response};await atomic(bindingFile(key),b);return{...response,_historyEnvelope:b.outbox};
 });}
 return{respond,internal,search,catalog:()=>[...entries.values()].map(e=>({category:e.category,name:e.name,mode:e.mode,stages:e.general?.map(v=>({id:v.stage.id,name:v.stage.name,variant_id:v.row.variant_id}))||[],reason:e.reason||null}))};
}
