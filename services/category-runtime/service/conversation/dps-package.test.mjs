import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDpsProfile} from './dps-profile.mjs';
import {createExplicitEngine} from '../explicit/engine.mjs';
const p=createDpsProfile();
test('AC01 exact private83/51/43/73 package; strict public engine unchanged',()=>{
 assert.equal(p.policy.bindings.length,83);assert.equal(p.policy.fields.length,51);
 assert.equal(p.policy.questions.length,43);assert.equal(p.policy.serviceEntries.length,73);
 assert.equal(p.blockedVariantIds.length,31);assert.equal(p.policy.blockedFields.length,7);
 assert.throws(()=>createExplicitEngine(p.bundle));
 assert.throws(()=>p.validate(p.bundle,'stale'),/DPS_SOURCE_VERSION/);
 const mutated=structuredClone(p.bundle);mutated.subcategories[0].variants[0].context.unknown_field=true;
 assert.throws(()=>p.validate(mutated,p.sourceSha256),/DPS_SOURCE_VERSION/);
});
test('AC01 changed raw bytes and policy fail closed',()=>{
 const original=fs.readFileSync(new URL('./policy/dps.v1.json',import.meta.url));
 assert.throws(()=>createDpsProfile({policyBytes:Buffer.concat([original,Buffer.from(' ')])}),/POLICY_PIN/);
 for(const bytes of [Buffer.from('{}'),Buffer.from(JSON.stringify(p.bundle))])assert.throws(()=>createDpsProfile({categoryBytes:bytes}),/SOURCE_PIN/);
 assert.throws(()=>createDpsProfile({nextBytes:Buffer.from('{}')}),/SOURCE_PIN/);
});
test('AC02 sparse protocol counterexample retains v77',()=>{
 assert.equal(p.resolve('protocol',{'dps.protocol.document_signed':false,'dps.protocol.blank_fields_present':true,'dps.protocol.copy_refused':true}),'dps_protocol_v77');
});
test('AC07 held fields and phase never select specialized rows',()=>{
 for(const b of p.policy.bindings){const supplied=Object.fromEntries(Object.entries(b.context).map(([k,v])=>['dps.'+b.stageId+'.'+k,v]));
  assert.ok(!p.blockedVariantIds.includes(p.resolve(b.stageId,supplied)));
 }
 assert.notEqual(p.resolve('alcohol_test',{'dps.alcohol_test.on_site_test_offered':true,'dps.alcohol_test.on_site_test_completed':false}),'dps_alcohol_test_v71');
});
test('AC11 accepted history guards and mask compatibility',()=>{
 assert.equal(p.resolve('protocol',{'dps.protocol.copy_received':true,'dps.protocol.copy_refused':true}),'dps_protocol_v81');
 for(const t of p.policy.tables)assert.equal(p.resolve(t.stageKey.slice(4),{}),t.entryVariantId);
 const proposed={'dps.stop_reason.reason_initially_not_explained':true,'dps.stop_reason.exit_proposed':true};
 const id=p.resolve('stop_reason',proposed);assert.equal(id,'dps_stop_reason_v190');
 assert.ok(!p.blockedVariantIds.includes(p.resolve('stop_reason',{...proposed,'dps.stop_reason.exit_demanded':false})));
});
test('AC15 all73 service entries have actual guarded dispositions',()=>{
 for(const e of p.policy.serviceEntries){
  assert.equal(p.serviceEvent(e.id,{}),null);
  if(e.kind==='silent')assert.equal(p.serviceEvent(e.id,{confirmed:true}),null);
  if(e.kind==='label')assert.deepEqual(p.serviceEvent(e.id,{kind:'render_section'}),{label:e.text});
  if(/(?:document|consent|sent|send_|withdraw_failed)/u.test(e.id))assert.equal(p.serviceEvent(e.id,{confirmed:true}),null);
 }
});
