import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createFloodingProfile} from './flooding-profile.mjs';
import {fresh,episode,newRound,currentEpisode,caseQuestionsUsed} from './state.mjs';
const p=createFloodingProfile();
const src=()=>({kind:'synthetic_observation',turnId:'independent-test-observation',quote:'Independently scoped synthetic observation',span:[0,Array.from('Independently scoped synthetic observation').length]});
function seed(stage){const s=fresh('49','package-'+stage,p.sourceSha256);episode(s);p.prepareState(s);newRound(s,'unit');currentEpisode(s).stageId=stage;p.selectScope(s,stage,{role:'injured',actorId:'self',flatId:'A',actId:'act-A',recipientId:'self',organizationId:'org-A',inspectionRequestId:'request-A',actTextAvailable:true},src());return s}
test('AC01 exact native inventory and all current bodies',()=>{assert.equal(p.policy.bindings.length,19);assert.equal(p.policy.fields.length,48);assert.equal(p.policy.questions.length,35);assert.equal(p.blockedVariantIds.length,0);assert.deepEqual(p.policy.thirdQuestionReasons,{});assert.deepEqual(p.policy.supplementalQuestions,[]);for(const b of p.components.bindings.rows)assert.deepEqual(p.rowFor(b.variant_id).row,b.full_current_C42_variant)});
for(const component of ['NEXT','lookup','native','bindings','targets'])test('AC01 corrupt '+component+' raw pin rejects',()=>{assert.throws(()=>createFloodingProfile({componentBytes:{[component]:Buffer.from('{}')}}),/FLOOD_SOURCE_PIN_MISMATCH/)});
test('AC01 corrupt category/policy rejected',()=>{assert.throws(()=>createFloodingProfile({categoryBytes:Buffer.from('{}')}),/FLOOD_SOURCE_PIN_MISMATCH/);assert.throws(()=>createFloodingProfile({policyBytes:Buffer.from('{}')}),/FLOOD_POLICY_PIN_MISMATCH/)});
for(const b of p.policy.bindings)test('AC08 retained guard boundary '+b.variantId,()=>{
 // Predicate-level unit input, never an observation producer or a user ledger.
 const facts=Object.fromEntries(b.required.map(x=>[x.field_key,x.value]));
 if(p.blockedVariantIds.includes(b.variantId)){assert.equal(p.compatible(b.variantId,facts),false);return}
 assert.equal(p.compatible(b.variantId,facts),true);
 for(const r of b.required){for(const value of [undefined,null,!r.value]){const changed={...facts};if(value===undefined)delete changed[r.field_key];else changed[r.field_key]=value;assert.equal(p.compatible(b.variantId,changed),false)}}
 assert.equal(p.resolveFacts(b.stageId,facts).variantId,b.variantId);
});
for(const field of p.policy.fields.filter(f=>f.status==='HELD_QUALIFIED_PRODUCER'))test('AC03 qualified HOLD '+field.fieldKey,()=>{const s=seed(field.stageId);for(const value of [true,false,null])assert.equal(p.admit(s,{fieldKey:field.fieldKey,value,source:src()}),null);assert.equal(s.factLedger.length,0)});
for(const stage of p.policy.stages)test('AC09 general '+stage.stageId,()=>{const s=seed(stage.stageId);assert.equal(p.resolve(s).variantId,stage.generalId);assert.equal(caseQuestionsUsed(s),0)});
test('AC01 no public NEXT synthesis, laws or stable links changed',()=>{for(const st of p.bundle.subcategories)for(const v of st.variants){assert.deepEqual(v.payload.next,[]);assert.deepEqual(v.payload.answer,p.components.lookup.entries.find(x=>x.variant_id===v.variant_id).answer)}});
test('AC04 partial cause/source remains unresolved',()=>{const f=p.policy.fields.find(f=>f.fieldKey==='flooding.act_management.cause_missing_in_act');assert.equal(f.status,'HELD_QUALIFIED_PRODUCER');assert.equal(f.omission.predicate_clarification_needed,true);assert.ok(!p.policy.questions.some(q=>q.fieldKey===f.fieldKey))});
test('AC23 two category hooks retain prior code paths',()=>{assert.equal(p.categoryId,'flooding');assert.equal(p.policy.maxQuestionsPerCase,2)});
