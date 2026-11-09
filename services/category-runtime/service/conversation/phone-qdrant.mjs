import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createPhoneProfile} from './phone-profile.mjs';
import {interpretPhone} from './phone-interpret.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{status:409})};
const stable=o=>Array.isArray(o)?o.map(stable):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,stable(o[k])])):o;
async function pinned(p){
 if(!p||typeof p.path!=='string'||!Number.isSafeInteger(p.bytes)||!/^[a-f0-9]{64}$/.test(p.sha256))fail('PH_INTEGRATION_PIN_REQUIRED');
 const bytes=await fs.readFile(p.path);if(bytes.length!==p.bytes||digest(bytes)!==p.sha256)fail('PH_INTEGRATION_PIN_MISMATCH');return {bytes,value:JSON.parse(bytes)};
}
async function api(base,route,body){
 const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});
 if(!r.ok)fail('PH_RETRIEVAL_HTTP_'+r.status);return r.json();
}
export async function loadPhoneIntegration(contractPin){
 const {value:c}=await pinned(contractPin);
 if(c.schema!=='phone-private-qdrant-integration/v1'||c.category_id!=='phone_police'||c.production!==false||c.document_actions!==false||c.expected_rows!==216||c.available_rows!==103||c.minimum_score!==0.7||c.qdrant_url!=='http://127.0.0.1:6333'||c.ollama_url!=='http://127.0.0.1:11435'||c.collection!=='aizashchita_phone_police_review_'+c.source?.sha256?.slice(0,20))fail('PH_INTEGRATION_CONTRACT');
 const policy=await pinned(c.policy),source=await pinned(c.source);await pinned(c.accepted_limits);
 const profile=createPhoneProfile({policyBytes:policy.bytes,categoryBytes:source.bytes});
 if(profile.sourceSha256!==c.source.sha256)fail('PH_INTEGRATION_SOURCE');
 const rows=new Map(profile.bundle.subcategories.flatMap(s=>s.variants.map(r=>[r.variant_id,r])));
 if(rows.size!==216)fail('PH_INTEGRATION_ROWS');
 const excluded=new Set([...profile.blockedVariantIds,...[...rows.values()].filter(r=>r.payload.stage.id==='copying_data'&&r.context.copying_recorded_in_protocol===false).map(r=>r.variant_id)]);
 if(excluded.size!==113)fail('PH_INTEGRATION_ACCEPTED_LIMITS');
 const filter={must:[{key:'category.id',match:{value:'phone_police'}},{key:'source_sha256',match:{value:c.source.sha256}}]};
 const count=await api(c.qdrant_url,`/collections/${c.collection}/points/count`,{exact:true,filter});if(count.result.count!==216)fail('PH_RETRIEVAL_COVERAGE');
 const model=(await api(c.ollama_url,'/api/tags')).models.find(m=>m.name==='bge-m3:latest');if(model?.digest!==c.model_digest)fail('PH_RETRIEVAL_MODEL_CHANGED');
 const general=new Map(profile.policy.stages.map(s=>[s.stageId,s.generalId]));
 async function search(text){
  const e=await api(c.ollama_url,'/api/embed',{model:'bge-m3',input:text,truncate:false,keep_alive:'10m'}),vector=e.embeddings?.[0];
  if(vector?.length!==1024||vector.some(n=>!Number.isFinite(n)))fail('PH_RETRIEVAL_VECTOR');
  const result=await api(c.qdrant_url,`/collections/${c.collection}/points/search`,{vector,filter:{...filter,must_not:[{key:'variant_id',match:{any:[...excluded]}}]},limit:8,with_payload:true});
  for(const hit of result.result){const r=rows.get(hit.payload?.variant_id),expected=r&&{...r.payload,variant_id:r.variant_id,context:r.context,question:r.question,source_sha256:c.source.sha256};if(!r||excluded.has(r.variant_id)||JSON.stringify(stable(hit.payload))!==JSON.stringify(stable(expected)))fail('PH_RETRIEVAL_POINT_MISMATCH')}
  return result.result;
 }
 return {profile,contract:c,search,wrap(service){return {internal:(...a)=>service.internal(...a),async respond(input){
  let request=input,routing=null;
  if(!input.resume&&!input.conversation&&!input.guided&&!input.variantId&&typeof input.question==='string'){
   if(!/^\d{1,12}$/.test(String(input.userId))||!/^[a-f0-9-]{36}$/i.test(input.id||''))fail('INVALID_IDENTITY');
   const parsed=interpretPhone({},input.question,input.turnId),hits=await search(input.question),top=hits[0];
   const inScope=/(?:телефон|телфон|смартфон|разблок|блокировк|мобильн)/iu.test(input.question)&&parsed.actor!=='other'&&!parsed.ambiguousActor&&!parsed.excluded&&!parsed.foreign&&!parsed.ambiguousSubject;
   // Only a general topic is proposed. The profile keeps it unconfirmed until user text establishes it.
   if(!parsed.stage&&inScope&&top?.score>=c.minimum_score)request={...input,variantId:general.get(top.payload.stage.id)};
   routing={kind:parsed.stage&&inScope?'EXPLICIT_USER_TOPIC':request!==input?'RETRIEVAL_TOPIC_ONLY':'UNRESOLVED_OR_OUTSIDE_SCOPE',collection:c.collection,source_sha256:c.source.sha256,candidate_variant_id:top?.payload.variant_id||null,selected_general_variant_id:request.variantId||null,score:top?.score??null,search_facts_admitted:false};
  }
  const response=await service.respond(request);return routing?{...response,retrieval:routing}:response;
 }}}};
}