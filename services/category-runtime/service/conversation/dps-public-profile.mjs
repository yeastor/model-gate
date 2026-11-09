import fs from 'node:fs';import {createHash} from 'node:crypto';
import {createDpsProfile} from './dps-profile.mjs';
import {validateExplicitBundle} from '../explicit/contract.mjs';
import {createDpsDocumentActions} from './dps-document-actions.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const stable=o=>Array.isArray(o)?o.map(stable):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,stable(o[k])])):o;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
function pinned(p){const b=fs.readFileSync(p.path);if(b.length!==p.bytes||hash(b)!==p.sha256)throw Error('DPS_PUBLIC_PIN');return JSON.parse(b);}
export function createDpsPublicProfile({descriptor,verifyReview,reviewedEvidenceProvider,documentActions,documentServices}={}){
 if(descriptor?.schema!=='dps-public-adapter/v1')throw Error('DPS_PUBLIC_DESCRIPTOR');
 const bundle=pinned(descriptor.public),original=pinned(descriptor.privateSource);pinned(descriptor.next);
 const privateProfile=createDpsProfile({verifyReview,reviewedEvidenceProvider});privateProfile.validate(original,descriptor.privateSource.sha256);validateExplicitBundle(bundle);
 if(documentActions&&documentServices)throw Error('DPS_DUPLICATE_DOCUMENT_ADAPTER');
 const documents=documentActions||(documentServices?createDpsDocumentActions({...documentServices,profile:privateProfile}):null);
 if(bundle.category.id!=='dps'||bundle.subcategories.length!==original.subcategories.length)throw Error('DPS_PUBLIC_LOSSY');
 for(let i=0;i<original.subcategories.length;i++){const a=original.subcategories[i],b=bundle.subcategories[i];if(!same(a.stage,b.stage)||b.variants.length!==a.variants.length||!same(a.context_fields.map(f=>f.id),b.context_fields.map(f=>f.id)))throw Error('DPS_PUBLIC_ORDER');for(let n=0;n<a.variants.length;n++){const x=a.variants[n],y=b.variants[n];if(x.variant_id!==y.variant_id||x.question!==y.question||!same(x.payload,y.payload)||!same(Object.fromEntries(a.context_fields.map(f=>[f.id,x.context[f.id]??null])),y.context))throw Error('DPS_PUBLIC_LOSSY');}}
 const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o)}};freeze(bundle);
 return Object.freeze({...privateProfile,bundle,sourceSha256:descriptor.public.sha256,
  validate(candidate,sha){if(sha!==descriptor.public.sha256||!same(candidate,bundle))throw Error('DPS_PUBLIC_VERSION');},
  present(s,outcome,options){const response=privateProfile.present(s,outcome,options);if(documents&&outcome.variantId){response.answer.sections ||= {};response.answer.sections.documentOffers=documents.offers(s,outcome.variantId);response.answer.sections.documentActionsStatus='CATALOG_VERIFICATION_REQUIRED';}return response;},
  async openDocument(s,request){if(!documents)throw Error('DPS_DOCUMENT_ADAPTER_UNAVAILABLE');return documents.open(s,request);},
  sourceBinding:{public:descriptor.public,private:descriptor.privateSource,next:descriptor.next}
 });
}
