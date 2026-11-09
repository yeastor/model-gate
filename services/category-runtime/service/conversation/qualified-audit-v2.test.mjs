import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {loadQualifiedPackage} from './qualified-package.mjs';
import {createConversationService} from './service.mjs';
const inputPath=process.env.CHILDREN_QUALIFIED_TEST_INPUTS;
const pkg=inputPath?await loadQualifiedPackage(JSON.parse(await fs.readFile(inputPath,'utf8')).packagePin):null;
const it=inputPath?test:test.skip.bind(test);
const clean=r=>{const {_historyEnvelope,...rest}=r;return rest;};
async function fixture(t,stage='alimony_debt') {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'children-audit-v2-'));
  t.after(async()=>{assert(path.basename(dir).startsWith('children-audit-v2-'));await fs.rm(dir,{recursive:true,force:true});});
  const service=createConversationService({dataDir:dir,getActive:()=>{throw Error('NO_ALIAS');},getBundle:()=>{throw Error('NO_ALIAS');},qualifiedPackage:pkg});
  const initial={protocolVersion:2,userId:'555',id:randomUUID(),turnId:randomUUID(),question:'Помогите разобраться.',
    privateDialogue:{tuple:pkg.tuple,stageId:stage,scope:{caseId:randomUUID(),childId:'child',subjectId:'self',obligationId:'obligation',periodId:'period',objectId:'statement',objectVersion:'1'}}};
  const respond=async e=>{const r=await service.respond(e);if(r._historyEnvelope)await service.internal({...e,turnId:r._historyEnvelope.turnId},'ack');return clean(r);};
  const next=(r,text,action)=>({...initial,turnId:randomUUID(),question:text,
    conversation:structuredClone(r.conversation),privateDialogue:{...initial.privateDialogue,...(action?{action}:{})}});
  const short=(r,text,action)=>({...next(r,text,action),conversation:{sessionId:r.conversation.sessionId,revision:r.conversation.revision,nonce:r.conversation.nonce}});
  const answer=(r,value,full=true)=>(full?next:short)(r,'',{kind:'answer',value,binding:r.question.binding});
  const state=async()=>{const p=path.join(dir,'conversation-sessions-v2');return JSON.parse(await fs.readFile(path.join(p,(await fs.readdir(p)).find(n=>n.endsWith('.qualified.json'))),'utf8'));};
  return {dir,service,initial,respond,next,short,answer,state};
}
it('F01 client may echo exact returned conversation object without STALE_STATE',async t=>{
  const f=await fixture(t);const a=await f.respond(f.initial);const b=await f.respond(f.answer(a,true));
  assert.equal(b.questionsUsed,1);assert.equal(b.hold,'DOCUMENT_SOURCE_NOT_SUPPORTED');
});
it('F02 qualified-source HOLD is explained in user-visible answer.content, not only discarded metadata',async t=>{
  const f=await fixture(t);const a=await f.respond(f.initial);const b=await f.respond(f.answer(a,true,false));
  assert.match(b.answer.content,/расч[её]т.*пристав|пристав.*расч[её]т/iu);
  assert.match(b.answer.content,/не подтвержд[её]н|не проверен|пока не могу/iu);
});
it('F03 short acknowledgement preserves pending and never creates a new fact',async t=>{
  const f=await fixture(t,'child_residence');const a=await f.respond(f.initial);
  const b=await f.respond(f.short(a,'Спасибо!'));
  assert.equal(b.question?.id,a.question.id);assert.equal(b.questionsUsed,1);assert.equal((await f.state()).ledger.length,0);
});
it('F04 unchanged answer uses continuation and references earlier full help',async t=>{
  const f=await fixture(t);const a=await f.respond(f.initial);const b=await f.respond(f.answer(a,null,false));
  assert.equal(b.presentation.kind,'continuation');assert.equal(b.presentation.referencesResponseId,a.presentation.responseId);
  assert.notEqual(b.answer.content,a.answer.content);assert.equal(b.variantId,a.variantId);
});
it('F05 explicit request to repeat help renders it fully without spending a question',async t=>{
  const f=await fixture(t);const a=await f.respond(f.initial);const b=await f.respond(f.short(a,'Покажи полную памятку'));
  assert.equal(b.presentation.kind,'full');assert.equal(b.question?.id,a.question.id);assert.equal(b.questionsUsed,1);
});
it('F06 withdrawing private present intent cannot automatically ask N05 again',async t=>{
  const f=await fixture(t,'travel_consent');f.initial.question='Я лично подавал заявление о несогласии на выезд этого ребёнка.';
  let r=await f.respond(f.initial);r=await f.respond(f.answer(r,true,false));
  const intent=r.observations.find(x=>x.key==='private.present_withdrawal_intent');
  r=await f.respond(f.short(r,'Отзываю намерение.',{kind:'retract',observationId:intent.id}));
  assert.equal(r.question,null);assert.equal((await f.state()).projection,null);
});
it('F07 missing mandatory qualifier cannot be enabled by a repinned incomplete policy',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'children-audit-v2-policy-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const policy=structuredClone(pkg.policy);delete policy.qualified['children_alimony.alimony_debt.debt_calculation_disputed'];
  const bytes=Buffer.from(JSON.stringify(policy));const p=path.join(dir,'policy.json');await fs.writeFile(p,bytes,{flag:'wx'});
  await assert.rejects(loadQualifiedPackage({path:p,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}),/GATE_CONTRACT_MISMATCH/);
});
it('F08 source legal references survive the real Go Answer/content transport shape',async t=>{
  const f=await fixture(t);const r=await f.respond(f.initial);
  const stage=pkg.bundle.subcategories.find(s=>s.stage.id==='alimony_debt');
  const row=stage.variants.find(v=>v.variant_id===r.variantId);
  for(const law of row.payload.answer.laws)assert(r.answer.content.includes(law.url));
});
it('F09 a later independently reported own filing can progress the held N05 flow',async t=>{
  const f=await fixture(t,'travel_consent');let r=await f.respond(f.initial);assert.equal(r.question,null);
  r=await f.respond(f.short(r,'Я лично подавала заявление о несогласии на выезд этого ребёнка.'));
  assert.equal(r.question?.kind,'next');assert.equal(r.questionsUsed,1);
});
it('F10 explicit current danger gives pinned urgent help before questions in every stage',async t=>{
  for(const stage of pkg.bundle.subcategories)await t.test(stage.stage.id,async t=>{
    const f=await fixture(t,stage.stage.id);f.initial.question='Моего ребёнка сейчас бьют.';
    const r=await f.respond(f.initial);assert.match(r.answer.content,/112/u);assert.equal(r.questionsUsed,0);
    assert.equal(r.question,null);assert.equal(r.presentation.urgentPriority,true);
  });
});
it('Safety minimal pairs do not assert current danger from denial, quote, history or another child',async t=>{
  for(const text of ['Моего ребёнка сейчас не бьют.','Вчера моего ребёнка били.','Он написал: «Моего ребёнка сейчас бьют».',
    'Если моего ребёнка сейчас бьют, что делать?','Соседского ребёнка сейчас бьют.','Моего ребёнка сейчас бьют?'])await t.test(text,async t=>{
    const f=await fixture(t,'alimony_debt');f.initial.question=text;const r=await f.respond(f.initial);
    assert.equal(r.presentation.urgentPriority,false);assert.equal((await f.state()).ledger.length,0);
  });
});
it('Current safety event after global2 still shows help and does not start another question round',async t=>{
  const f=await fixture(t,'child_residence');let r=await f.respond(f.initial);
  while(r.question)r=await f.respond(f.answer(r,false));
  const used=r.questionsUsed;r=await f.respond(f.next(r,'Моего ребёнка сейчас бьют.'));
  assert.equal(r.questionsUsed,used);assert.equal(r.question,null);assert.match(r.answer.content,/112/u);
  assert.equal(r.presentation.urgentPriority,true);
});
it('Explicit correction or retraction invalidates current danger without a stale urgent response',async t=>{
  for(const kind of ['correct','retract'])await t.test(kind,async t=>{
    const f=await fixture(t);f.initial.question='Моего ребёнка сейчас бьют.';let r=await f.respond(f.initial);
    const observation=r.observations.find(o=>o.key==='private.current_child_danger');
    r=await f.respond(f.next(r,'Уточняю прежнее сообщение.',{kind,observationId:observation.id,...(kind==='correct'?{value:false}:{})}));
    assert.equal(r.presentation.urgentPriority,false);assert(!r.answer.content.startsWith(pkg.urgentHelp.text));
  });
});
it('Full conversation echo rejects tampered scope and tuple without state changes',async t=>{
  const f=await fixture(t);const r=await f.respond(f.initial);const before=await f.state();
  for(const key of ['scope','tuple']){
    const e=f.next(r,'Спасибо');e.conversation[key]={...e.conversation[key],unexpected:true};
    await assert.rejects(f.respond(e),/STALE_STATE/);assert.deepEqual(await f.state(),before);
  }
});
