import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createGosuslugiAccessProfile} from './gosuslugi-access-profile.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const stable=o=>Array.isArray(o)?o.map(stable):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,stable(o[k])])):o;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const fail=code=>{throw Object.assign(new Error(code),{status:409})};
const escape=t=>String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
async function pinned(p){
 if(!p||typeof p.path!=='string'||!Number.isSafeInteger(p.bytes)||!/^[a-f0-9]{64}$/.test(p.sha256))fail('GA_INTEGRATION_PIN_REQUIRED');
 const bytes=await fs.readFile(p.path);if(bytes.length!==p.bytes||hash(bytes)!==p.sha256)fail('GA_INTEGRATION_PIN_MISMATCH');return {bytes,value:JSON.parse(bytes)};
}
async function api(base,route,body){
 const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});
 if(!r.ok)fail('GA_RETRIEVAL_HTTP_'+r.status);return r.json();
}
export function gosuslugiSearchScope(text,categoryId){
 const t=String(text).normalize('NFC').toLowerCase().replaceAll('ё','е');
 // Topic permission only; this does not establish ownership, an incident, or any context fact.
 return categoryId==='gosuslugi_access'||/госуслуг|госулсуг|госуслг|(?<![а-я])есиа(?![а-я])/u.test(t);
}
export async function loadGosuslugiIntegration(contractPin){
 const {value:c}=await pinned(contractPin);
 if(c.schema!=='gosuslugi-qdrant-integration/v1'||c.category_id!=='gosuslugi_access'||c.expected_rows!==376||c.qdrant_url!=='http://127.0.0.1:6333'||c.ollama_url!=='http://127.0.0.1:11435'||c.alias!=='aizashchita_active_scenarios'||c.minimum_score!==0.7)fail('GA_INTEGRATION_CONTRACT');
 const {bytes:policyBytes}=await pinned(c.policy),{value:upload}=await pinned(c.source);const base=createGosuslugiAccessProfile({policyBytes});
 if(c.original_source_sha256!==base.sourceSha256||c.original_next_sha256!==base.nextSha256)fail('GA_INTEGRATION_VERSION');
 const rows=new Map(upload.subcategories.flatMap(s=>s.variants.map(r=>[r.variant_id,r]))),originals=new Map(base.next.subcategories.flatMap(s=>s.variants.map(r=>[r.variant_id,r])));
 if(upload.category.id!==base.categoryId||rows.size!==376||!equal(upload,base.next))fail('GA_IMPORT_SEMANTIC_DRIFT');
 for(const [id,row]of rows)if(!equal(row,originals.get(id)))fail('GA_IMPORT_ROW_DRIFT');
 const filter={must:[{key:'category.id',match:{value:c.category_id}},{key:'source_sha256',match:{value:c.source.sha256}}]};
 async function checkTarget(){const aliases=(await api(c.qdrant_url,'/aliases')).result.aliases;if(!aliases.some(a=>a.alias_name===c.alias&&a.collection_name===c.collection))fail('GA_RETRIEVAL_ALIAS_CHANGED')}
 await checkTarget();
 const count=await api(c.qdrant_url,`/collections/${c.collection}/points/count`,{exact:true,filter});if(count.result.count!==376)fail('GA_RETRIEVAL_COVERAGE');
 const model=(await api(c.ollama_url,'/api/tags')).models.find(m=>m.name==='bge-m3:latest');if(model?.digest!==c.model_digest)fail('GA_RETRIEVAL_MODEL_CHANGED');
 async function search(text){
  await checkTarget();
  const e=await api(c.ollama_url,'/api/embed',{model:'bge-m3',input:text,truncate:false,keep_alive:'10m'}),vector=e.embeddings?.[0];
  if(vector?.length!==1024||vector.some(x=>!Number.isFinite(x)))fail('GA_RETRIEVAL_VECTOR');
  const result=await api(c.qdrant_url,`/collections/${c.collection}/points/search`,{vector,filter,limit:8,with_payload:true});
  for(const h of result.result){const row=rows.get(h.payload?.variant_id),expected=row&&{...row.payload,variant_id:row.variant_id,context:row.context,question:row.question,source_sha256:c.source.sha256};if(!row||!equal(expected,h.payload))fail('GA_RETRIEVAL_POINT_MISMATCH')}
  return result.result;
 }
 const hints=new WeakMap();
 const profile=Object.freeze({...base,dispatch(s,input){
  const outcome=base.dispatch(s,input),hint=hints.get(input);hints.delete(input);
  return hint?{...outcome,retrieval:hint}:outcome;
 },present(s,outcome,options){
  const response=base.present(s,outcome,options),r=outcome.retrieval;
  if(!r)return response;
  // Search cannot select a full answer or add facts. Only already-approved general fragments
  // can supplement a cold unresolved message; these fragments remain explicitly conditional.
  if(!response.dialogue.stageId&&r.in_scope&&r.score>=c.minimum_score){
   const stage=base.policy.stages.find(x=>x.stageId===r.candidate_stage_id),name=base.bundle.subcategories.find(x=>x.stage.id===stage?.stageId)?.stage.name;
   if(stage){
    const key=s.caseState.id+':'+stage.stageId,previous=s.gaRetrievalHelp?.[key];
    if(!previous){response.answer.content=['Если вопрос по теме «'+name+'», могут пригодиться следующие действия.',...stage.fragments.map(f=>f.exact_text),response.answer.content].map((t,i)=>i===stage.fragments.length+1?t:escape(t)).join('\n\n');(s.gaRetrievalHelp||={})[key]=response.presentation.responseId;}
    else response.presentation.referencesResponseId=previous;
    r.general_help_stage=stage.stageId;r.general_help_source_pointers=stage.fragments.map(f=>f.pointer);r.full_answer_selected_by_search=false;
   }
  }
  return {...response,retrieval:r};
 }});
 return {profile,contract:c,search,wrap(service){return {internal:(...args)=>service.internal(...args),async respond(input){
  if(!input.resume&&!input.conversation&&!input.guided&&typeof input.question==='string'&&input.question.trim()){
   if(!/^\d{1,12}$/.test(String(input.userId))||!/^[a-f0-9-]{36}$/i.test(input.id||''))fail('INVALID_IDENTITY');
   const hits=await search(input.question),top=hits[0];
   hints.set(input,{collection:c.collection,source_sha256:c.source.sha256,candidate_variant_id:top?.payload.variant_id||null,candidate_stage_id:top?.payload.stage.id||null,score:top?.score??null,in_scope:gosuslugiSearchScope(input.question,input.categoryId),search_facts_admitted:false,hit_ids:hits.map(h=>h.payload.variant_id)});
  }
  try{return await service.respond(input)}finally{hints.delete(input)}
 }}}};
}