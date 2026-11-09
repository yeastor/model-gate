import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createLaborProfile} from './labor-profile.mjs';
const p=createLaborProfile(),hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('AC01/02 all1664 current bodies/context/laws/where_to are exactly bound before selection',()=>{
 const bindings=JSON.parse(p.components.bindings),lookup=new Map(JSON.parse(p.components.lookup).rows.map(r=>[r.variant_id,r]));
 assert.equal(bindings.rows.length,1664);for(const b of bindings.rows){const v=p.rowFor(b.variant_id).row;assert.equal(hash(v.payload.answer),b.current_answer_sha256);assert.deepEqual(v.payload.answer,lookup.get(b.variant_id).current_answer);assert.equal(hash(v.context),b.context_sha256);assert.equal(hash(v.payload.answer.laws),b.law_tuple_sha256);assert.equal(hash(v.payload.answer.where_to),b.where_to_sha256);}
});
test('AC01/02 every source/current/catalog/semantics/policy component rejects tampered or foreign bytes',()=>{
 for(const [key,b]of Object.entries(p.components))assert.throws(()=>createLaborProfile({componentBytes:{[key]:Buffer.concat([b,Buffer.from(' ' )])}}),/LAB_COMPONENT_PIN_MISMATCH/);
 assert.throws(()=>createLaborProfile({policyBytes:Buffer.from('{}')}),/LAB_POLICY_PIN_MISMATCH/);
});
test('AC03 all5600 accepted uses/7728 targets point to current rows, external28TFU immutable',()=>{
 const uses=JSON.parse(p.components.accepted_uses);assert.equal(uses.current_uses.length,5600);let targets=0;for(const u of uses.current_uses)for(const t of u.targets){assert.ok(p.rowFor(t.target));targets++;}assert.equal(targets,7728);
 assert.equal(p.policy.questions.length,28);for(const q of p.policy.questions)assert.deepEqual(q.controls,[{value:true,label:'Да'},{value:false,label:'Нет'},{value:null,label:'Не знаю'}]);
});
test('AC06 29nonbridge guards block1550 existing rows,114 remains only static upper bound',()=>{
 assert.equal(p.policy.fields.length,57);assert.equal(p.policy.fields.filter(f=>f.status==='HELD_NONBRIDGE').length,29);assert.equal(p.blockedVariantIds.length,1550);assert.equal(1664-p.blockedVariantIds.length,114);
 for(const f of p.policy.fields.filter(f=>f.status==='HELD_NONBRIDGE'))for(const value of [true,false]){const r=p.resolve(f.stageId,{[f.fieldId]:value});assert.equal(r.qualifiedHeld,true);assert.equal(r.variantId,p.policy.stages.find(s=>s.id===f.stageId).entryId);assert.equal(r.facts[f.fieldId],undefined);}
});
test('AC21/24 no evaluator or new public fields/private10 prompts/third reason',()=>{assert.equal(p.policy.defaultActivation,false);assert.deepEqual(p.policy.thirdQuestionReasons,{});const private10=JSON.parse(p.components.private10).items;assert.equal(private10.length,10);for(const f of private10){assert.equal(f.canonical_next_prompt_allowed,false);assert.ok(!p.policy.questions.some(q=>q.fieldKey===f.historical_field_key));}});
