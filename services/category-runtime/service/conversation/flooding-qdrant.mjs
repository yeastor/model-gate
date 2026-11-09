import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createFloodingProfile} from './flooding-profile.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const stable=o=>Array.isArray(o)?o.map(stable):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,stable(o[k])])):o;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const fail=code=>{throw Object.assign(new Error(code),{status:409})};
async function pinned(pin){
 if(!pin||typeof pin.path!=='string'||!Number.isSafeInteger(pin.bytes)||!/^[a-f0-9]{64}$/.test(pin.sha256))fail('FLOOD_INTEGRATION_PIN_REQUIRED');
 const bytes=await fs.readFile(pin.path);if(bytes.length!==pin.bytes||digest(bytes)!==pin.sha256)fail('FLOOD_INTEGRATION_PIN_MISMATCH');
 return {bytes,value:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))};
}
async function api(base,route,body){
 const res=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
 if(!res.ok)fail('FLOOD_RETRIEVAL_HTTP_'+res.status);return res.json();
}
export async function loadFloodingIntegration(contractPin){
 const {value:c}=await pinned(contractPin);
 if(c.schema!=='flooding-qdrant-integration/v1'||c.category_id!=='flooding'||c.expected_rows!==19||c.production!==false||c.document_actions!==false||c.qdrant_url!=='http://127.0.0.1:6333'||c.ollama_url!=='http://127.0.0.1:11435'||c.alias!=='aizashchita_active_scenarios'||!/^aizashchita_[a-z0-9_]+$/.test(c.collection))fail('FLOOD_INTEGRATION_CONTRACT');
 const policy=await pinned(c.policy),source=await pinned(c.source);
 const profile=createFloodingProfile({policyBytes:policy.bytes,categoryBytes:source.bytes});
 if(profile.sourceSha256!==c.source.sha256||profile.blockedVariantIds.length)fail('FLOOD_INTEGRATION_SOURCE');
 const rows=new Map(profile.bundle.subcategories.flatMap(s=>s.variants.map(r=>[r.variant_id,r])));
 const filter={must:[{key:'category.id',match:{value:'flooding'}},{key:'source_sha256',match:{value:c.source.sha256}}]};
 async function liveBinding(){
  const alias=(await api(c.qdrant_url,'/aliases')).result.aliases.find(a=>a.alias_name===c.alias);
  if(alias?.collection_name!==c.collection)fail('FLOOD_RETRIEVAL_ALIAS_CHANGED');
  const model=(await api(c.ollama_url,'/api/tags')).models.find(m=>m.name==='bge-m3:latest');
  if(model?.digest!==c.model_digest)fail('FLOOD_RETRIEVAL_MODEL_CHANGED');
 }
 function verify(hit){
  const r=rows.get(hit.payload?.variant_id);
  if(!r||!same(hit.payload,{...r.payload,variant_id:r.variant_id,context:r.context,question:r.question,source_sha256:c.source.sha256}))fail('FLOOD_RETRIEVAL_POINT_MISMATCH');
 }
 await liveBinding();
 const inventory=(await api(c.qdrant_url,`/collections/${c.collection}/points/scroll`,{filter,limit:100,with_payload:true,with_vector:false})).result;
 if(inventory.next_page_offset||inventory.points.length!==19||new Set(inventory.points.map(p=>p.payload?.variant_id)).size!==19)fail('FLOOD_RETRIEVAL_COVERAGE');
 inventory.points.forEach(verify);
 async function search(text){
  if(typeof text!=='string'||!text.trim()||Array.from(text).length>12000)fail('FLOOD_RETRIEVAL_QUERY');
  await liveBinding();
  const vector=(await api(c.ollama_url,'/api/embed',{model:'bge-m3',input:text,truncate:false})).embeddings?.[0];
  if(!Array.isArray(vector)||vector.length!==1024||vector.some(n=>!Number.isFinite(n)))fail('FLOOD_RETRIEVAL_VECTOR');
  const hits=(await api(c.qdrant_url,`/collections/${c.collection}/points/search`,{vector,filter,limit:8,with_payload:true})).result;
  hits.forEach(verify);return hits;
 }
 return {profile,contract:c,search,wrap(service){return {internal:(...args)=>service.internal(...args),async respond(input){
  let retrieval=null;
  if(!input.resume&&!input.conversation&&!input.guided&&!input.variantId&&typeof input.question==='string'){
   if(!/^\d{1,12}$/.test(String(input.userId))||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.id||''))fail('INVALID_IDENTITY');
   const hits=await search(input.question);
   // Retrieval never supplies context facts or overrides the existing dialogue resolver.
   retrieval={kind:'VERIFIED_CANDIDATES_ONLY',collection:c.collection,source_sha256:c.source.sha256,candidates:hits.map(h=>({variant_id:h.payload.variant_id,stage:h.payload.stage.id,score:h.score})),search_facts_admitted:false};
  }
  const response=await service.respond(input);
  if(response.answer?.variantId&&!rows.has(response.answer.variantId))fail('FLOOD_RESPONSE_OUTSIDE_SOURCE');
  return retrieval?{...response,retrieval}:response;
 }}}};
}
