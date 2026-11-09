import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDigitalAccessProfile} from './digital-access-profile.mjs';
const p=await createDigitalAccessProfile(),proof=JSON.parse(p.components.full_evidence),accepted=JSON.parse(p.components.accepted_bindings);
test('AC01 exact8 source private reader/291/56/43 rejects diagnostic bundle and pin drift',async()=>{
 assert.equal(p.bundle.subcategories.length,8);assert.equal(p.policy.fields.length,56);assert.equal(p.policy.questions.length,43);
 assert.throws(()=>p.validate({index:true},p.sourceSha256),/DA_SOURCE_VERSION/);
 const s=p.policy.stages[0];await assert.rejects(()=>createDigitalAccessProfile({sourceBytes:{[s.stageId]:Buffer.from('{}')}}),/DA_SOURCE_PIN/);
 await assert.rejects(()=>createDigitalAccessProfile({policyBytes:Buffer.from('{}')}),/DA_POLICY_PIN/);
 assert.equal(p.policy.defaultActivation,false);assert.deepEqual(p.policy.thirdQuestionReasons,{});
});
function independentPremises(raw){
 const f={...raw};
 // Stipulated independent new observations in a synthetic fixture, never a legacy-event migration.
 if(f.recovery_contacts_verified===true)for(const k of ['recovery_email_checked','recovery_email_owned','recovery_phone_checked','recovery_phone_owned'])f[k]=true;
 if(f.twofa_reset===true)for(const k of ['additional_factor_reset','backup_codes_supported','backup_codes_reset'])f[k]=true;
 delete f.recovery_contacts_verified;delete f.twofa_reset;return f;
}
for(const e of proof.current291)test('AC04-static '+e.variant_id,()=>{
 const r=p.rowFor(e.variant_id);assert.deepEqual(r.row.context,e.full_context);assert.equal(r.row.question,e.retrieval_question);assert.deepEqual(r.row.payload.answer,e.full_answer);
 const facts=Object.fromEntries(Object.entries(e.full_context).filter(([,v])=>v!==null)),display=p.currentDisplay(e.stage,independentPremises(facts));
 assert.equal(display.variantId,e.variant_id);if(e.stage!=='secure_after')assert.deepEqual(display.answer,e.full_answer);else{assert.deepEqual(display.answer.laws,e.full_answer.laws);assert.deepEqual(display.answer.where_to,e.full_answer.where_to);}
});
for(const e of proof.current2529)test('AC04-dynamic '+e.case_id,()=>{
 const d=p.currentDisplay('secure_after',e.trusted_current_case_fixture_facts);assert.equal(d.variantId,e.variant_id);assert.deepEqual(d.answer,e.full_current_display_answer);
});
for(const [i,b]of accepted.current_target_bindings.entries())test('AC02/03-saved-binding '+i,()=>{
 const stage=p.rowFor(b.selected_id).stage.stage.id,d=p.currentDisplay(stage,independentPremises(b.full_after_facts));
 assert.equal(d.variantId,b.selected_id);assert.deepEqual(p.rowFor(b.selected_id).row.context,b.current_full_target_context);
 assert.ok(p.policy.questions.some(q=>q.key==='digital_access.'+stage+'.'+b.field_update.field));
});
test('AC08/09/10 human criteria & legacyaggregate nofanout / N/A / conflict',()=>{
 const legacy=p.currentDisplay('secure_after',{recovery_contacts_verified:true,twofa_reset:true});assert.equal(legacy.variantId,'digital_access_secure_after_v33');
 const na=p.currentDisplay('secure_after',{additional_factor_reset:true,backup_codes_supported:false});assert.equal(na.applicability.backup_codes,'NOT_APPLICABLE');assert.match(na.answer.steps[3],/не требуются/);
 const conflict=p.resolveFacts('secure_after',{backup_codes_supported:false,backup_codes_reset:true});assert.equal(conflict.specializationHeld,true);
 assert.equal(p.decision.screen.button_to_fact['Да'],true);
});
