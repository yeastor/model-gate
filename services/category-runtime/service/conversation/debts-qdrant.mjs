import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {createDebtsProfile} from './debts-profile.mjs';import {debtsStageHint} from './debts-interpret.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const fail=x=>{throw Object.assign(Error(x),{status:409})};
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
async function pinned(p){const b=await fs.readFile(p.path);if(b.length!==p.bytes||digest(b)!==p.sha256)fail('DEB_INTEGRATION_PIN');return {bytes:b,value:JSON.parse(b)}}
async function api(base,route,body){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});if(!r.ok)fail('DEB_HTTP_'+r.status);return r.json()}
export async function loadDebtsIntegration(contractPin){
 const {value:c}=await pinned(contractPin);if(c.schema!=='debts-acceptance-integration/v1'||c.category_id!=='debts'||c.production!==false||c.qdrant_url!=='http://127.0.0.1:6333'||c.ollama_url!=='http://127.0.0.1:11435'||!/^aizashchita_acceptance_debts_20261028_v1_debts_[a-f0-9]{20}$/.test(c.collection))fail('DEB_INTEGRATION_CONTRACT');
 const p=await pinned(c.policy),profile=createDebtsProfile({policyBytes:p.bytes});if(profile.sourceSha256!==c.source.sha256)fail('DEB_SOURCE_MISMATCH');
 const filter={must:[{key:'category.id',match:{value:'debts'}},{key:'source_sha256',match:{value:c.source.sha256}}]};
 const count=await api(c.qdrant_url,`/collections/${c.collection}/points/count`,{filter,exact:true});if(count.result.count!==426)fail('DEB_COVERAGE');
 const model=(await api(c.ollama_url,'/api/tags')).models.find(x=>x.name==='bge-m3:latest');if(model?.digest!==c.model_digest)fail('DEB_EMBEDDING_MODEL');
 const general=new Map(profile.bundle.subcategories.map(s=>[s.stage.id,s.variants.find(r=>Object.values(r.context).every(v=>v===null)).variant_id]));
 async function search(text){const e=await api(c.ollama_url,'/api/embed',{model:'bge-m3',input:text,truncate:false,keep_alive:'10m'}),vector=e.embeddings?.[0];if(vector?.length!==1024||vector.some(x=>!Number.isFinite(x)))fail('DEB_VECTOR');
  const hits=(await api(c.qdrant_url,`/collections/${c.collection}/points/search`,{filter,vector,limit:8,with_payload:true})).result;
  for(const h of hits){const row=profile.rowFor(h.payload?.variant_id)?.row;const expected=row&&{...row.payload,variant_id:row.variant_id,context:row.context,question:row.question,source_sha256:c.source.sha256};if(!row||JSON.stringify(stable(expected))!==JSON.stringify(stable(h.payload)))fail('DEB_SEARCH_PAYLOAD');}return hits;
 }
 return {profile,contract:c,search,wrap(service){return {internal:(...a)=>service.internal(...a),async respond(input){
  let request=input,routing=null;
  if(!input.resume&&!input.conversation&&!input.guided&&!input.variantId&&typeof input.question==='string'){
   const hits=await search(input.question),top=hits[0],hint=debtsStageHint(input.question),inScope=/долг|кредит|кридит|займ|банк|ипотек|давност|судебн[а-я]* приказ|реструктур|каникул/iu.test(input.question),stage=hint||(inScope&&top?.score>=0.5?top.payload.stage.id:null);
   if(stage)request={...input,variantId:general.get(stage)};
   routing={collection:c.collection,source_sha256:c.source.sha256,candidate:top?.payload.variant_id||null,score:top?.score??null,selected_general:request.variantId||null,context_from_search:false};
  }
  const result=await service.respond(request);return routing?{...result,retrieval:routing}:result;
 }}}};
}
