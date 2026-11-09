import {randomUUID} from 'node:crypto';
import {currentEpisode,subjectFor} from './state.mjs';

const own=(o,k)=>Object.hasOwn(o,k);
const stable=o=>Array.isArray(o)?o.map(stable):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,stable(o[k])])):o;
const supported=new Set(['stop_reason.exit_basis_explained','document_check.seizure_record_created','fine_resolution.deadline_restoration_reason_present','alcohol_test.result_disputed','vehicle_search.seizure_record_created','alcohol_test.on_site_phase']);
export function dpsEvidenceScope(s,stage){
 const e=currentEpisode(s);e.dpsActorId ||= randomUUID();
 return {caseId:s.caseState.id,episodeId:e.id,actorId:e.dpsActorId,subjectId:subjectFor(s,'dps.'+stage+'.x'),stage};
}
const same=(a,b)=>['caseId','episodeId','actorId','subjectId','stage'].every(k=>a?.[k]===b?.[k]);
// This API is for an authenticated review adapter, never input.question,
// input.context, search payload or caller-supplied "verified" flags.
export function createDpsQualifications({sourceSha256,policySha256,verifyReview=()=>false}={}){
 function record(s,r){
  if(!r||!supported.has(r.predicate)||r.sourceSha256!==sourceSha256||r.policySha256!==policySha256||!same(r.scope,dpsEvidenceScope(s,r.scope?.stage)))throw Error('DPS_EVIDENCE_SCOPE');
  if(!r.reviewId||!r.reviewer||!r.eventId||!r.evidenceSha256?.match(/^[a-f0-9]{64}$/)||!r.evidenceLocator||!r.literalSource||verifyReview(r)!==true)throw Error('DPS_REVIEW_REQUIRED');
  if(!['assert','withdraw'].includes(r.operation)||(![true,false,null].includes(r.value)&&r.predicate!=='alcohol_test.on_site_phase'))throw Error('DPS_EVIDENCE_VALUE');
  if(r.operation==='assert'){
   if(r.predicate.endsWith('seizure_record_created')&&(r.completeRecordReviewed!==true||r.recordBoundToSeizure!==true))throw Error('DPS_COMPLETE_RECORD_REQUIRED');
   if(r.predicate==='fine_resolution.deadline_restoration_reason_present'&&(r.circumstanceEvidenceReviewed!==true||r.causalLinkReviewed!==true))throw Error('DPS_CIRCUMSTANCE_REVIEW_REQUIRED');
   if(r.predicate==='stop_reason.exit_basis_explained'&&!['proposal','demand'].includes(r.eventKind))throw Error('DPS_EXIT_EVENT_REQUIRED');
   if(r.predicate==='alcohol_test.result_disputed'&&(!['on_site','medical'].includes(r.resultKind)||r.completedResult!==true||!r.resultId))throw Error('DPS_COMPLETED_RESULT_REQUIRED');
   if(r.predicate==='alcohol_test.on_site_phase'&&(r.procedureKind!=='on_site'||!['not_started','in_progress','completed','unknown'].includes(r.value)))throw Error('DPS_PHASE_REQUIRED');
  }
  const prior=s.dpsQualifiedEvidence?.find(old=>old.reviewId===r.reviewId);
  if(prior){const {sequence,...value}=prior;if(JSON.stringify(stable(value))!==JSON.stringify(stable(r)))throw Error('DPS_REVIEW_ID_REUSED');return prior;}
  const stored={...structuredClone(r),sequence:(s.dpsQualifiedEvidence?.length||0)+1};(s.dpsQualifiedEvidence ||= []).push(stored);return stored;
 }
 function current(s,stage){const scope=dpsEvidenceScope(s,stage),latest=new Map();for(const r of s.dpsQualifiedEvidence||[])if(r.sourceSha256===sourceSha256&&r.policySha256===policySha256&&same(r.scope,scope))latest.set([r.predicate,r.eventId,r.resultId||''].join(':'),r);return [...latest.values()].sort((a,b)=>a.sequence-b.sequence).map(r=>r.operation==='withdraw'?{...r,value:null}:r);}
 function facts(records){const f={};for(const r of records){if(r.predicate==='alcohol_test.on_site_phase')continue;const key='dps.'+r.predicate;if(r.value===null)continue;if(!own(f,key))f[key]=r.value;else if(f[key]!==r.value)f[key]=null;}return f;}
 function allows(row,records,f){
  const c=row.context,id=row.variant_id,has=(predicate,match)=>records.some(r=>r.predicate===predicate&&match(r));
  if(c.exit_basis_explained===true){for(const[k,kind]of [['exit_proposed','proposal'],['exit_demanded','demand']])if(c[k]===true&&!has('stop_reason.exit_basis_explained',r=>r.value===true&&r.eventKind===kind))return false;}
  if(c.result_disputed===true){for(const[k,kind]of [['on_site_test_completed','on_site'],['medical_exam_completed','medical']])if(c[k]===true&&!has('alcohol_test.result_disputed',r=>r.value===true&&r.resultKind===kind&&r.completedResult===true))return false;}
  for(const stage of ['document_check','vehicle_search'])if(id.startsWith('dps_'+stage+'_')&&c.seizure_record_created!==null&&c.seizure_record_created!==undefined&&!has(stage+'.seizure_record_created',r=>r.value===c.seizure_record_created))return false;
  if(c.deadline_restoration_reason_present===true&&!has('fine_resolution.deadline_restoration_reason_present',r=>r.value===true))return false;
  if(id==='dps_alcohol_test_v71'){
   const phase=records.filter(r=>r.predicate==='alcohol_test.on_site_phase').at(-1);
   if(phase?.value!=='not_started'||f.on_site_test_offered!==true||f.on_site_test_completed!==false||f.witnesses_or_video_present!==false)return false;
  }
  return true;
 }
 return {record,current,facts,allows};
}
