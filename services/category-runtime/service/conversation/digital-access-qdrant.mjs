import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createDigitalAccessProfile} from './digital-access-profile.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const fail=code=>{throw Object.assign(new Error(code),{status:409})};
async function pinned(p){
 if(!p||typeof p.path!=='string'||!Number.isSafeInteger(p.bytes)||!/^[a-f0-9]{64}$/.test(p.sha256))fail('DA_INTEGRATION_PIN_REQUIRED');
 const bytes=await fs.readFile(p.path);if(bytes.length!==p.bytes||digest(bytes)!==p.sha256)fail('DA_INTEGRATION_PIN_MISMATCH');return {bytes,value:JSON.parse(bytes)};
}
async function api(base,route,body){
 const r=await fetch(base+route,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
 if(!r.ok)fail('DA_RETRIEVAL_HTTP_'+r.status);return r.json();
}
// Local opt-in integration. Retrieval candidates never establish current-case facts.
export async function loadDigitalAccessIntegration(contractPin){
 const {value:c}=await pinned(contractPin);
 if(c.schema!=='digital-access-local-qdrant-integration/v1'||c.category_id!=='digital_access'||c.production!==false||c.expected_rows!==291||c.qdrant_url!=='http://127.0.0.1:6333'||c.ollama_url!=='http://127.0.0.1:11435'||c.alias!=='aizashchita_active_scenarios')fail('DA_INTEGRATION_CONTRACT');
 const {bytes:policyBytes}=await pinned(c.policy),{value:source}=await pinned(c.source),{value:binding}=await pinned(c.id_binding);
 const profile=await createDigitalAccessProfile({policyBytes});
 if(profile.sourceSha256!==c.profile_source_sha256||profile.version!==c.policy_version||!equal(source.category,profile.bundle.category)||!equal(source.subcategories,profile.bundle.subcategories))fail('DA_IMPORT_SEMANTIC_DRIFT');
 const rows=new Map(source.subcategories.flatMap(s=>s.variants.map(r=>[r.variant_id,r])));
 if(rows.size!==291||binding.rows.length!==291)fail('DA_INTEGRATION_ROWS');
 for(const b of binding.rows){const r=rows.get(b.variant_id);if(!r||digest(JSON.stringify(r))!==b.variant_sha256||b.reservation.variant_id!==r.variant_id||b.reservation.status!=='reserved')fail('DA_INTEGRATION_ID_BINDING');}
 const filter={must:[{key:'category.id',match:{value:c.category_id}},{key:'source_sha256',match:{value:c.source.sha256}}]};
 async function checkTarget(){const aliases=(await api(c.qdrant_url,'/aliases')).result.aliases;if(!aliases.some(a=>a.alias_name===c.alias&&a.collection_name===c.collection))fail('DA_RETRIEVAL_ALIAS_CHANGED');}
 await checkTarget();
 const count=await api(c.qdrant_url,`/collections/${c.collection}/points/count`,{exact:true,filter});if(count.result.count!==291)fail('DA_RETRIEVAL_COVERAGE');
 const model=(await api(c.ollama_url,'/api/tags')).models.find(m=>m.name==='bge-m3:latest');if(model?.digest!==c.model_digest)fail('DA_RETRIEVAL_MODEL_CHANGED');
 async function search(text){
  if(typeof text!=='string'||!text.trim()||Array.from(text).length>10000)fail('DA_RETRIEVAL_QUERY');
  await checkTarget();const e=await api(c.ollama_url,'/api/embed',{model:'bge-m3',input:text,truncate:false}),vector=e.embeddings?.[0];
  if(vector?.length!==1024||vector.some(n=>!Number.isFinite(n)))fail('DA_RETRIEVAL_VECTOR');
  const result=await api(c.qdrant_url,`/collections/${c.collection}/points/search`,{vector,filter,limit:8,with_payload:true});
  for(const hit of result.result){const r=rows.get(hit.payload?.variant_id),expected=r&&{...r.payload,variant_id:r.variant_id,context:r.context,question:r.question,source_sha256:c.source.sha256};if(!r||!equal(expected,hit.payload))fail('DA_RETRIEVAL_POINT_MISMATCH');}
  return result.result;
 }
 return {profile,contract:c,search,wrap(service){return {internal:(...args)=>service.internal(...args),async respond(input){
  let retrieval=null;
  if(!input.resume&&!input.conversation&&!input.guided&&typeof input.question==='string'&&input.question.trim()){
   if(!/^\d{1,12}$/.test(String(input.userId))||!/^[a-f0-9-]{36}$/i.test(input.id||'')||!/^[a-f0-9-]{36}$/i.test(input.turnId||''))fail('INVALID_IDENTITY');
   const hits=await search(input.question);
   retrieval={collection:c.collection,source_sha256:c.source.sha256,candidate_variant_id:hits[0]?.payload.variant_id||null,hit_ids:hits.map(h=>h.payload.variant_id),score:hits[0]?.score??null,search_facts_admitted:false,full_answer_selected_by_search:false};
  }
  const response=await service.respond(input);return retrieval?{...response,retrieval}:response;
 }}}};
}
