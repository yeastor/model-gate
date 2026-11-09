import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createBailiffsProfile} from './bailiffs-profile.mjs';
import {createExplicitEngine} from '../explicit/engine.mjs';
const p=createBailiffsProfile(),hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('BA package exact private30/59/59/31 and existing schema reader without production admission',()=>{
 assert.equal(p.policy.fields.length,59);assert.equal(p.policy.predicates.length,59);assert.equal(p.policy.questions.length,31);assert.equal(p.policy.fields.filter(f=>f.status==='RAW_HOLD').length,0);assert.equal(p.bundle.subcategories.length,8);assert.deepEqual(p.policy.thirdQuestionReasons,{});assert.equal(p.policy.defaultActivation,false);assert.equal(createExplicitEngine(p.bundle).bundle.category.id,'bailiffs');
});
test('BA package source/policy/component tamper fail closed',()=>{
 const bad=Buffer.from(p.components.category);bad[bad.length-3]^=1;assert.throws(()=>createBailiffsProfile({componentBytes:{category:bad}}),/BA_COMPONENT_PIN_MISMATCH/);assert.throws(()=>createBailiffsProfile({policyBytes:Buffer.from('{}')}),/BA_POLICY_PIN_MISMATCH/);
});
for(const s of p.bundle.subcategories)for(const v of s.variants)test('BA current full binding '+v.variant_id,()=>{
 const d=JSON.parse(p.components.bindings).bindings.find(x=>x.draft_key===v.variant_id);assert.equal(hash(v),d.current_object_sha256);assert.equal(hash(v.payload.answer),d.answer_sha256);assert.equal(hash(v.payload.next),d.NEXT_sha256);assert.deepEqual(v.payload.answer,d.current_full_answer);assert.deepEqual(Object.keys(v.context),s.context_fields.map(f=>f.id));
});
const next=JSON.parse(p.components.NEXT);
for(const n of next.all31nodes)test('BA node original TFU '+n.id,()=>{const q=p.policy.questions.find(q=>q.id===n.id);assert.equal(q.text,n.question);assert.deepEqual(q.branches,n.original.data);assert.deepEqual(q.controls.map(x=>x.value),[true,false,null]);});
for(const t of next.all70paths)test('BA structural path '+t.pointer,()=>{
 const row=p.rowFor(t.target).row;assert.equal(hash(row),t.target_object_sha256);const f=Object.fromEntries(t.history.map(h=>[h.field_key,h.value]));for(const[k,v]of Object.entries(row.context))if(v!==null)assert.equal(f['bailiffs.'+t.target_stage+'.'+k],v);assert.equal(t.terminal_do_not_restart_target_NEXT,true);
});
test('BA all constructor reads preserve components',()=>{for(const[k,e]of Object.entries(p.policy.sources)){const b=fs.readFileSync(e.path);assert.equal(b.length,e.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),e.sha256);}});

