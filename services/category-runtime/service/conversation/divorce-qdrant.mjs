import fs from 'node:fs/promises';import {createHash}from'node:crypto';
import {createDivorceProfile,divorceTopic}from'./divorce-profile.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex'),fail=c=>{throw Object.assign(Error(c),{status:409});};
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
async function pinned(p){if(!p||typeof p.path!=='string'||!Number.isSafeInteger(p.bytes)||!/^[a-f0-9]{64}$/.test(p.sha256))fail('DV_INTEGRATION_PIN_REQUIRED');const b=await fs.readFile(p.path);if(b.length!==p.bytes||digest(b)!==p.sha256)fail('DV_INTEGRATION_PIN_MISMATCH');return b;}
async function api(base,route,body){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});if(!r.ok)fail('DV_RETRIEVAL_HTTP_'+r.status);return r.json();}
export async function loadDivorceIntegration(contractPin){
 const c=JSON.parse(await pinned(contractPin));if(c.schema!=='divorce-local-qdrant-integration/v1'||c.category_id!=='divorce_property'||c.production!==false||c.expected_rows!==1540||c.qdrant_url!=='http://127.0.0.1:6333'||c.ollama_url!=='http://127.0.0.1:11435'||c.collection!=='aizashchita_divorce_property_review_'+c.source.sha256.slice(0,20))fail('DV_INTEGRATION_CONTRACT');
 await pinned(c.profile);const policyBytes=await pinned(c.policy);await pinned(c.source);await pinned(c.accepted_limits);const profile=createDivorceProfile({policyBytes});if(c.source.sha256!==profile.sourceSha256)fail('DV_SOURCE_MISMATCH');
 const rows=new Map(profile.bundle.subcategories.flatMap(s=>s.variants.map(v=>[v.variant_id,v]))),general=new Map(profile.policy.stages.map(s=>[s.id,s.generalId]));
 const filter={must:[{key:'category.id',match:{value:'divorce_property'}},{key:'source_sha256',match:{value:profile.sourceSha256}}]};
 const count=await api(c.qdrant_url,`/collections/${c.collection}/points/count`,{filter,exact:true});if(count.result.count!==1540)fail('DV_QDRANT_COVERAGE');
 const model=(await api(c.ollama_url,'/api/tags')).models.find(m=>m.name==='bge-m3:latest');if(model?.digest!==c.model_digest)fail('DV_MODEL_VERSION');
 async function search(text){const e=await api(c.ollama_url,'/api/embed',{model:'bge-m3',input:text,truncate:false,keep_alive:'10m'}),vector=e.embeddings?.[0];if(vector?.length!==1024||vector.some(n=>!Number.isFinite(n)))fail('DV_VECTOR_INVALID');const r=await api(c.qdrant_url,`/collections/${c.collection}/points/search`,{vector,filter,limit:5,with_payload:true});for(const h of r.result){const row=rows.get(h.payload?.variant_id),expected=row&&{...row.payload,variant_id:row.variant_id,context:row.context,question:row.question,source_sha256:profile.sourceSha256};if(!row||JSON.stringify(stable(h.payload))!==JSON.stringify(stable(expected)))fail('DV_QDRANT_POINT_MISMATCH');}return r.result;}
 return {profile,contract:c,search,wrap(service){return {internal:(...a)=>service.internal(...a),async respond(input){let request=input,evidence=null;
  if(!input.resume&&!input.conversation&&!input.guided&&typeof input.question==='string'){
   if(!/^\d{1,12}$/.test(String(input.userId))||!/^[a-f0-9-]{36}$/i.test(input.id||''))fail('INVALID_IDENTITY');
   let hits=[],error=null;try{hits=await search(input.question);}catch(e){error=e.message;}
   const topic=divorceTopic(input.question),inScope=/(?:развод|развд|развест|брак|супруг|муж|жена|партн[её]р|раздел.{0,12}имуществ|брачн|медиац)/iu.test(input.question),top=hits[0];
   if(!topic&&inScope&&top?.score>=0.7&&!input.variantId&&!input.stageId)request={...input,variantId:general.get(top.payload.stage.id)};
   evidence={collection:c.collection,source_sha256:profile.sourceSha256,hits:hits.map(h=>({id:h.payload.variant_id,stage:h.payload.stage.id,score:h.score})),route:topic?'EXPLICIT_TOPIC':request!==input?'RETRIEVAL_GENERAL_TOPIC_ONLY':inScope?'CATEGORY_GENERAL':'OUTSIDE_OR_UNCLEAR',factsFromSearch:false,error};
  }
  const r=await service.respond(request);return evidence?{...r,retrieval:evidence}:r;
 }}}};
}
