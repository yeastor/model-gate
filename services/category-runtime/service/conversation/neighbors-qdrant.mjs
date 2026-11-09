import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createNeighborsProfile} from './neighbors-profile.mjs';
import {interpretNeighbors} from './neighbors-interpret.mjs';

const digest=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{status:409})};
const stable=o=>Array.isArray(o)?o.map(stable):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,stable(o[k])])):o;
// A literal topic hint narrows retrieval only; it never produces a context value.
export function neighborsSearchStageHint(text){
  return /музык/iu.test(text)&&!/(?:животн|собак|кошк|лает|лай|ремонт|сверл|дрел|перфоратор)/iu.test(text)?'noise':null;
}
async function pinned(p){
  if(!p||typeof p.path!=='string'||!Number.isSafeInteger(p.bytes)||!/^[a-f0-9]{64}$/.test(p.sha256))fail('NBR_INTEGRATION_PIN_REQUIRED');
  const b=await fs.readFile(p.path);if(b.length!==p.bytes||digest(b)!==p.sha256)fail('NBR_INTEGRATION_PIN_MISMATCH');return {bytes:b,value:JSON.parse(b)};
}
async function api(base,route,body){
  const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});
  if(!r.ok)fail('NBR_RETRIEVAL_HTTP_'+r.status);return r.json();
}
export async function loadNeighborsIntegration(contractPin){
  const {value:c}=await pinned(contractPin);
  if(c.schema!=='neighbors-private-qdrant-integration/v1'||c.category_id!=='neighbors'||c.production!==false||c.document_actions!==false||c.expected_rows!==400
    ||!/^aizashchita_private_neighbors_[a-f0-9]{20}$/.test(c.collection)||c.qdrant_url!=='http://127.0.0.1:6333'||c.ollama_url!=='http://127.0.0.1:11435'
    ||c.minimum_score!==0.5)fail('NBR_INTEGRATION_CONTRACT');
  const policy=await pinned(c.policy),projection=await pinned(c.projection);await pinned(c.source);
  const profile=await createNeighborsProfile({policyBytes:policy.bytes});
  if(profile.sourceSha256!==c.source.sha256||projection.value.metadata.source_sha256!==c.source.sha256)fail('NBR_INTEGRATION_SOURCE');
  const rows=new Map(projection.value.subcategories.flatMap(s=>s.variants.map(r=>[r.variant_id,r])));
  if(rows.size!==400)fail('NBR_INTEGRATION_ROWS');
  for(const s of profile.bundle.subcategories)for(const r of s.variants){const {applicability,...searchRow}=r;if(JSON.stringify(stable(searchRow))!==JSON.stringify(stable(rows.get(r.variant_id))))fail('NBR_PROJECTION_CONTENT_CHANGED')}
  const filter={must:[{key:'category.id',match:{value:'neighbors'}},{key:'source_sha256',match:{value:c.source.sha256}},{key:'projection_sha256',match:{value:c.projection.sha256}}]};
  const count=await api(c.qdrant_url,`/collections/${c.collection}/points/count`,{exact:true,filter});if(count.result.count!==400)fail('NBR_RETRIEVAL_COVERAGE');
  const model=(await api(c.ollama_url,'/api/tags')).models.find(m=>m.name==='bge-m3:latest');if(model?.digest!==c.model_digest)fail('NBR_RETRIEVAL_MODEL_CHANGED');
  const baseline=new Map(profile.bundle.subcategories.map(s=>{const rows=s.variants.filter(r=>Object.values(r.context).every(v=>v===null)&&Object.values(r.applicability||{}).every(v=>v!==true));if(rows.length!==1)fail('NBR_UNIQUE_GENERAL_REQUIRED');return [s.stage.id,rows[0].variant_id]}));
  async function search(text){
    const e=await api(c.ollama_url,'/api/embed',{model:'bge-m3',input:text,truncate:false,keep_alive:'10m'}),vector=e.embeddings?.[0];
    if(vector?.length!==1024||vector.some(n=>!Number.isFinite(n)))fail('NBR_RETRIEVAL_VECTOR');
    const stageHint=neighborsSearchStageHint(text);
    const queryFilter={must:[...filter.must,...(stageHint?[{key:'stage.id',match:{value:stageHint}}]:[])]};
    const result=await api(c.qdrant_url,`/collections/${c.collection}/points/search`,{vector,filter:queryFilter,limit:8,with_payload:true});
    for(const hit of result.result){const row=rows.get(hit.payload?.variant_id);const expected=row&&{...row.payload,variant_id:row.variant_id,context:row.context,question:row.question,source_sha256:c.source.sha256,projection_sha256:c.projection.sha256};if(!row||JSON.stringify(stable(hit.payload))!==JSON.stringify(stable(expected)))fail('NBR_RETRIEVAL_POINT_MISMATCH')}
    return result.result;
  }
  return {profile,contract:c,search,wrap(service){return {internal:(...args)=>service.internal(...args),async respond(input){
    let request=input,routing=null;
    // Retrieval selects only a topic. The general row has no asserted case facts.
    // Existing session turns and controls stay entirely within the accepted native engine.
    if(!input.resume&&!input.conversation&&!input.guided&&!input.variantId&&typeof input.question==='string'){
      if(!/^\d{1,12}$/.test(String(input.userId))||!/^[a-f0-9-]{36}$/i.test(input.id||''))fail('INVALID_IDENTITY');
      const interpreted=interpretNeighbors(input.question,input.turnId,policy.value);
      if(!interpreted.stage){
        const hits=await search(input.question),top=hits[0];
        // Finite category scope guard: an unrelated query cannot be forced into Neighbors by a category filter.
        const inScope=/(?:сосед|подъезд|общ(?:ая|ей|ую)\s+зон|шум|громк\w*\s+музык|дым|запах|перегород|камера|животн)/iu.test(input.question);
        if(inScope&&top?.score>=c.minimum_score)request={...input,variantId:baseline.get(top.payload.stage.id)};
        routing={kind:request===input?'UNRESOLVED_TOPIC':'RETRIEVAL_TOPIC_ONLY',collection:c.collection,source_sha256:c.source.sha256,explicit_stage_hint:neighborsSearchStageHint(input.question),candidate_variant_id:top?.payload.variant_id||null,selected_general_variant_id:request.variantId||null,score:top?.score??null,search_facts_admitted:false};
      }
    }
    const response=await service.respond(request);return routing?{...response,retrieval:routing}:response;
  }}}};
}
