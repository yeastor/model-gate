import {randomUUID,createHash} from 'node:crypto';
import {dpsEvidenceScope} from './dps-qualifications.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const sameScope=(a,b)=>['caseId','episodeId','actorId','subjectId','stage'].every(k=>a?.[k]===b?.[k]);
export function createDpsDocumentActions({profile,bindings,templates,fetchCatalog,fetchTemplate,openForm}={}){
 if(!profile||!Array.isArray(bindings)||typeof fetchCatalog!=='function'||typeof fetchTemplate!=='function'||typeof openForm!=='function')throw Error('DPS_DOCUMENT_CAPABILITY_REQUIRED');
 const byDraft=new Map(templates.map(t=>[t.draft_key,t]));
 function offers(s,variantId){const plan=profile.plan(s);if(plan.variantId!==variantId)return[];return bindings.filter(b=>b.variant_id===variantId).map(b=>{const d=byDraft.get(b.draft_key);if(!d||d.proposed_link_id!==b.proposed_link_id)throw Error('DPS_DOCUMENT_BINDING');const scope=dpsEvidenceScope(s,b.stage);s.dpsDocumentOffers ||= [];let offer=s.dpsDocumentOffers.find(o=>o.variantId===variantId&&o.draftKey===b.draft_key&&sameScope(o.scope,scope));if(!offer){offer={token:randomUUID(),scope,variantId,draftKey:b.draft_key};s.dpsDocumentOffers.push(offer);s.dpsDocumentOffers=s.dpsDocumentOffers.slice(-64);}return{token:offer.token,variantId,draftKey:b.draft_key,document_link_id:d.proposed_link_id,title:d.title,state:'DRAFT_ONLY',condition:b.condition,requiredFields:d.fields.filter(f=>f.required_for_paper_draft).map(f=>f.id)};});}
 async function execute(s,{token,fields={}}={}){
  const offer=s.dpsDocumentOffers?.find(o=>o.token===token);if(!offer||!sameScope(offer.scope,dpsEvidenceScope(s,offer.scope.stage))||profile.plan(s).variantId!==offer.variantId)return{status:'STALE_DOCUMENT_ACTION',opened:false};
  const d=byDraft.get(offer.draftKey),catalog=await fetchCatalog(),matches=catalog.filter(t=>t.link_id===d.proposed_link_id);
  if(matches.length!==1)return{status:matches.length?'AMBIGUOUS_DOCUMENT_LINK':'DOCUMENT_TEMPLATE_MISSING',opened:false,document_link_id:d.proposed_link_id};
  const summary=matches[0],template=await fetchTemplate(summary.id);
  // Local accepted bodies may not be replaced by a similarly named legacy form.
  if(template.accepted_body_sha256!==hash(d.body)||template.accepted_fields_sha256!==hash(JSON.stringify(d.fields)))return{status:'DOCUMENT_VERSION_MISMATCH',opened:false,template_id:summary.id};
  const draft=Object.fromEntries(d.fields.map(f=>[f.id,fields[f.id]??{status:'unknown',value:null}]));
  if(Object.keys(fields).some(k=>!d.fields.some(f=>f.id===k)))return{status:'UNKNOWN_DOCUMENT_FIELD',opened:false};
  const states=new Set(['filled','unknown','skip','fill_later','raw','confirmed_absent','not_applicable','unreported']);
  if(Object.values(draft).some(f=>!f||typeof f!=='object'||!states.has(f.status)))return{status:'INVALID_DOCUMENT_FIELD_STATE',opened:false};
  const result=await openForm({template_id:summary.id,document_link_id:d.proposed_link_id,scope:offer.scope,fields:draft,mode:'draft',accepted_body_sha256:hash(d.body)});
  if(!result||result.status!=='opened'||!result.formId)return{status:'DOCUMENT_OPEN_FAILED',opened:false};
  return{status:'FORM_OPENED_DRAFT',opened:true,formId:result.formId,template_id:summary.id,document_link_id:d.proposed_link_id,fields:draft,filingReady:false};
 }
 async function open(s,request){try{return await execute(s,request)}catch{return{status:'DOCUMENT_SERVICE_UNAVAILABLE',opened:false}}}
 return{offers,open};
}
