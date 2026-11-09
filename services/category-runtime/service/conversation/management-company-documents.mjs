
import fs from 'node:fs';import {createHash}from'node:crypto';
const read=p=>{const b=fs.readFileSync(p.path);if(b.length!==p.bytes||createHash('sha256').update(b).digest('hex')!==p.sha256)throw Error('MC_DOCUMENT_PIN');return JSON.parse(b)};
export function createDocumentOffers(pins){
 const accepted=read(pins.acceptance),bindings=read(pins.bindings),activation=read(pins.activation);
 if(activation.status!=='PASS'||activation.approved.length!==8)throw Error('MC_DOCUMENT_ACTIVATION');
 const active=new Set(activation.approved.filter(x=>x.status==='active').map(x=>x.link_id));
 return(s,row)=>{
  const c=s.requestDialogue.cases.find(c=>c.id===s.requestDialogue.caseId),r=c.requests.find(r=>r.id===c.selectedId);
  const facts=s.factLedger.filter(f=>f.caseId===c.id&&f.subjectId===r?.id&&f.status==='active');
  if(facts.some(f=>['immediate_danger_present','people_injured_or_trapped'].includes(f.field)&&f.value===true))return [];
  return bindings.proposals.filter(p=>p.variant_id===row.variant_id).flatMap(p=>{
   const d=p.proposed_document;if(!active.has(d.candidate_link_id))return [];
   if(d.template_id==='MC-D07'&&!r?.qualifications?.adsWrittenFollowup)return [];
   return [{title:d.title,documentLinkId:d.candidate_link_id,href:'/documents/link/'+encodeURIComponent(d.candidate_link_id),condition:p.retained_conditions.availability}];
  });
 };
}
