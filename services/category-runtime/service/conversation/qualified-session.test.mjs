import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadQualifiedPackage } from './qualified-package.mjs';
import { projectOwnWithdrawal } from './qualified-session.mjs';
import { createConversationService } from './service.mjs';
import { createExplicitEngine } from '../explicit/engine.mjs';

const inputsPath=process.env.CHILDREN_QUALIFIED_TEST_INPUTS;
let pkg;
if(inputsPath) pkg=await loadQualifiedPackage(JSON.parse(await fs.readFile(inputsPath,'utf8')).packagePin);
const scoped=test.skip.bind(test);
const it=inputsPath?test:scoped;
const values=[true,false,null];
const noLegacy=()=>{throw Error('LEGACY_PPS_PATH_MUST_NOT_RUN');};
const clean=response=>{const {_historyEnvelope,...rest}=response;return rest;};
async function harness(t,stage='alimony_debt') {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'children-qualified-test-'));
  t.after(async()=>{assert(path.basename(dir).startsWith('children-qualified-test-'));await fs.rm(dir,{recursive:true,force:true});});
  const rawService=createConversationService({dataDir:dir,getActive:noLegacy,getBundle:noLegacy,qualifiedPackage:pkg});
  const service={respond:async input=>{
    const response=await rawService.respond(input);
    if(response._historyEnvelope)await rawService.internal({...input,turnId:response._historyEnvelope.turnId},'ack');
    return clean(response);
  }};
  const initial={protocolVersion:2,userId:'123456',id:randomUUID(),turnId:randomUUID(),question:'Помогите разобраться.',
    privateDialogue:{tuple:pkg.tuple,stageId:stage,scope:{caseId:randomUUID(),childId:'current-child',subjectId:'current-user',obligationId:'obligation-1',periodId:'period-1',objectId:'statement-1',objectVersion:'1'}}};
  const send=(previous,question,action)=>({...initial,turnId:randomUUID(),question,
    conversation:{sessionId:previous.conversation.sessionId,revision:previous.conversation.revision,nonce:previous.conversation.nonce},
    privateDialogue:{...initial.privateDialogue,action}});
  const answer=(previous,value)=>send(previous,'',{kind:'answer',value,binding:previous.question.binding});
  const files=async()=>{
    const folder=path.join(dir,'conversation-sessions-v2');
    const names=await fs.readdir(folder);return names.filter(n=>n.endsWith('.qualified.json')).map(n=>path.join(folder,n));
  };
  const state=async()=>JSON.parse(await fs.readFile((await files())[0],'utf8'));
  return {service,rawService,initial,send,answer,state,files,dir};
}

test('N05 complete AND truth table and missing are distinct',()=>{
  const expected=[true,false,null,false,false,false,null,false,null];let i=0;
  for(const a of values)for(const b of values)assert.equal(projectOwnWithdrawal(a,b),expected[i++]);
  for(const a of [undefined,...values]) {
    assert.equal(projectOwnWithdrawal(a,undefined),undefined);
    assert.equal(projectOwnWithdrawal(undefined,a),undefined);
  }
});

it('pilot alimony_debt: TFU persisted; no calculation is not agreement; source absent HOLD',async t=>{
  for(const v of values)await t.test(String(v),async t=>{
    const h=await harness(t);const a=await h.service.respond(h.initial);
    assert.equal(a.questionsUsed,1);assert.equal(a.question.kind,'next');assert(a.generalHelp.answer.now);
    const b=await h.service.respond(h.answer(a,v));assert.equal(b.hold,'DOCUMENT_SOURCE_NOT_SUPPORTED');
    assert.equal(b.question,null);assert.equal(b.questionsUsed,1);
    const state=await h.state();assert.equal(state.ledger.length,1);assert.equal(state.ledger[0].value,v);
    assert.equal(state.ledger[0].key,'children_alimony.alimony_debt.enforcement_proceedings_open');
    assert(!Object.hasOwn(state.engine.facts,'children_alimony.alimony_debt.debt_calculation_disputed'));
  });
});
it('all eight stages: all root TFU, remaining offered TFU, <=2 and compatible final answers',async t=>{
  const engine=createExplicitEngine(pkg.bundle);
  for(const stage of pkg.bundle.subcategories)for(const a of values)for(const b of values)
    await t.test(`${stage.stage.id}/${a}/${b}`,async t=>{
      const h=await harness(t,stage.stage.id);let result=await h.service.respond(h.initial);
      if(result.question)result=await h.service.respond(h.answer(result,a));
      if(result.question)result=await h.service.respond(h.answer(result,b));
      assert(result.questionsUsed<=2);assert.equal(result.question,null);
      const state=await h.state();assert(engine.compatible(result.variantId,state.engine.facts));
      assert.deepEqual(result.generalHelp.answer,stage.variants.find(r=>Object.values(r.context).every(v=>v===null)).payload.answer);
      const used=result.questionsUsed;
      for(let n=0;n<3;n++)result=await h.service.respond(h.send(result,'Продолжим.'));
      assert.equal(result.questionsUsed,used);assert.equal(result.question,null);
    });
});
it('guardianship danger help before act; no document requirement for urgent true branch',async t=>{
  const h=await harness(t,'guardianship');let r=await h.service.respond(h.initial);
  r=await h.service.respond(h.answer(r,true));assert.notEqual(r.hold,'DOCUMENT_SOURCE_NOT_SUPPORTED');
  assert.equal(r.questionsUsed,1);assert.equal(r.question,null);
  assert((await h.state()).engine.facts['children_alimony.guardianship.child_in_immediate_danger']);
});
it('N05 ambiguous object is never a caller-certified prior filing',async t=>{
  const h=await harness(t,'travel_consent');const r=await h.service.respond(h.initial);
  assert.equal(r.question,null);assert.equal(r.questionsUsed,0);assert.equal((await h.state()).ledger.length,0);
});
it('N05 private prior then intent shares global2, complete TFU table where question valid',async t=>{
  for(const prior of values)for(const intent of values)await t.test(`${prior}/${intent}`,async t=>{
    const h=await harness(t,'travel_consent');h.initial.question='Я хочу разобраться со своим заявлением о несогласии на выезд этого ребёнка.';
    let r=await h.service.respond(h.initial);assert.equal(r.question.kind,'private_prior');
    r=await h.service.respond(h.answer(r,prior));
    if(prior===true){assert.equal(r.question.kind,'next');r=await h.service.respond(h.answer(r,intent));assert.equal(r.questionsUsed,2);}
    else{assert.equal(r.question,null);assert.equal(r.questionsUsed,1);}
    assert.equal(r.question,null);
    const s=await h.state();
    if(prior===true){assert.equal(s.projection.value,intent);assert.equal(s.projection.dependencies.length,2);}
    else assert.equal(s.projection,null);
  });
});
it('N05 explicit prior self-report permits intent, but not third question or legal truth',async t=>{
  const h=await harness(t,'travel_consent');h.initial.question='Я лично подавала заявление о несогласии на выезд этого ребёнка.';
  let r=await h.service.respond(h.initial);assert.equal(r.question.kind,'next');assert.equal(r.questionsUsed,1);
  r=await h.service.respond(h.answer(r,false));
  if(r.question)r=await h.service.respond(h.answer(r,true));
  assert.equal(r.questionsUsed,2);assert.equal(r.question,null);assert.equal(r.generationReady,false);
});
it('quoted/hypothetical/third-party user prose and ambiguous yes do not project',async t=>{
  for(const question of ['Если я подам заявление о несогласии на выезд этого ребёнка.','Она сказала: «Я лично подавала заявление о несогласии на выезд этого ребёнка.»','Муж подавал заявление.','Да, но это по другому ребёнку.'])await t.test(question,async t=>{
    const h=await harness(t,'travel_consent');h.initial.question=question;
    const r=await h.service.respond(h.initial);assert.equal(r.question,null);assert.equal((await h.state()).ledger.length,0);
  });
});
it('exact short TFU preserves polarity',async t=>{
  for(const [text,value]of [['Да',true],['Нет',false],['Не знаю',null]])await t.test(text,async t=>{
    const h=await harness(t);let r=await h.service.respond(h.initial);
    r=await h.service.respond(h.send(r,text));assert.equal((await h.state()).ledger[0].value,value);
  });
});
it('unparsed subject/correction invalidates pending; later yes cannot silently answer old subject',async t=>{
  const h=await harness(t);let r=await h.service.respond(h.initial);
  r=await h.service.respond(h.send(r,'Другой ребёнок, другое производство.'));
  assert.equal(r.hold,'FREE_TEXT_NOT_PROJECTED');assert.equal(r.question,null);
  r=await h.service.respond(h.send(r,'Да'));assert.equal((await h.state()).ledger.length,0);
  assert.equal(r.questionsUsed,1);
});
it('retry and response loss after commit return exactly same response, reload/resume no new budget',async t=>{
  const h=await harness(t);const a=await h.service.respond(h.initial);
  assert.deepEqual(await h.service.respond(h.initial),a);
  const event=h.answer(a,true);const b=await h.service.respond(event);
  const reloaded=createConversationService({dataDir:h.dir,getActive:noLegacy,getBundle:noLegacy,qualifiedPackage:pkg});
  assert.deepEqual(clean(await reloaded.respond(event)),b);
  assert.deepEqual(clean(await reloaded.respond({...h.initial,resume:true})),b);
  assert.equal((await h.state()).ledger.length,1);
});
it('same event changed, stale state and stale button leave saved bytes unchanged',async t=>{
  const h=await harness(t);const a=await h.service.respond(h.initial);const bytes=await fs.readFile((await h.files())[0]);
  await assert.rejects(h.service.respond({...h.initial,question:'Другое'}),/TURN_ID_CONFLICT/);
  await assert.rejects(h.service.respond({...h.answer(a,true),conversation:{...a.conversation,revision:100}}),/STALE_STATE/);
  const bad=h.answer(a,true);bad.privateDialogue.action.binding={...bad.privateDialogue.action.binding,nonce:randomUUID()};
  await assert.rejects(h.service.respond(bad),/STALE_OR_FOREIGN_BUTTON/);
  assert.deepEqual(await fs.readFile((await h.files())[0]),bytes);
});
it('actor, chat, case, child, subject, obligation, period, object/version isolation',async t=>{
  const h=await harness(t);const a=await h.service.respond(h.initial);const bytes=await fs.readFile((await h.files())[0]);
  for(const key of Object.keys(h.initial.privateDialogue.scope)) {
    const e=h.answer(a,true);e.privateDialogue.scope={...e.privateDialogue.scope,[key]:'other'};
    await assert.rejects(h.service.respond(e),/CASE_SCOPE_MISMATCH/);
  }
  await assert.rejects(h.service.respond({...h.answer(a,true),userId:'999'}),/SESSION_NOT_FOUND/);
  await assert.rejects(h.service.respond({...h.answer(a,true),id:randomUUID()}),/SESSION_NOT_FOUND/);
  assert.deepEqual(await fs.readFile((await h.files())[0]),bytes);
});
it('tuple mismatch and caller facts fail closed before state write; default disabled',async t=>{
  const h=await harness(t);
  for(const key of Object.keys(pkg.tuple)) {
    const e=structuredClone(h.initial);e.privateDialogue.tuple[key]='other';
    await assert.rejects(h.service.respond(e),/DIALOGUE_VERSION_MISMATCH/);
  }
  await assert.rejects(h.service.respond({...h.initial,facts:{a:true}}),/CALLER_FACTS_NOT_AUTHORITY/);
  const disabled=createConversationService({dataDir:h.dir,getActive:noLegacy,getBundle:noLegacy});
  await assert.rejects(disabled.respond(h.initial),/PRIVATE_DIALOGUE_NOT_ENABLED/);
  await assert.rejects(loadQualifiedPackage({...pkg.packagePin,sha256:'0'.repeat(64)}),/PACKAGE_PIN_MISMATCH/);
});
it('another chat cannot restart the same case budget; same chat cannot swap case or stage',async t=>{
  const h=await harness(t);const a=await h.service.respond(h.initial);
  await assert.rejects(h.service.respond({...h.initial,id:randomUUID(),turnId:randomUUID()}),/CASE_ALREADY_BOUND/);
  const e=h.send(a,'Продолжим');e.privateDialogue.stageId='alimony_claim';
  await assert.rejects(h.service.respond(e),/STAGE_SWITCH_REQUIRES_EXPLICIT_SUPPORTED_ROUTING/);
});
it('concurrent windows serialize, replay idempotent and lock collision never auto-cleared',async t=>{
  const h=await harness(t);const a=await h.service.respond(h.initial);
  const event=h.answer(a,true);
  const responses=await Promise.all([h.service.respond(event),h.service.respond(event)]);assert.deepEqual(...responses);
  const file=(await h.files())[0];await fs.writeFile(file+'.lock','test-owned',{flag:'wx'});
  await assert.rejects(h.service.respond({...h.initial,resume:true}),/SESSION_BUSY/);
  assert.equal(await fs.readFile(file+'.lock','utf8'),'test-owned');
  await fs.unlink(file+'.lock');
});
it('correction/retraction preserves unrelated ledger and invalidates derived N05 only',async t=>{
  const h=await harness(t,'travel_consent');h.initial.question='Я лично подавал заявление о несогласии на выезд этого ребёнка.';
  let r=await h.service.respond(h.initial);r=await h.service.respond(h.answer(r,true));
  assert.equal((await h.state()).projection.value,true);
  const prior=r.observations.find(x=>x.key==='private.own_prior_filing');
  r=await h.service.respond(h.send(r,'Отзываю прежнее сообщение.',{kind:'retract',observationId:prior.id}));
  const s=await h.state();assert.equal(s.projection,null);assert.equal(s.ledger.find(e=>e.id===prior.id).status,'retracted');
  assert.equal(s.ledger.find(e=>e.key==='private.present_withdrawal_intent').status,'invalidated');
  assert(r.questionsUsed<=2);assert.equal(r.question,null);
});
it('engine strict limit, known true/false/unknown skip and help-preserving hold without first-match',()=>{
  const bundle=pkg.bundle;
  for(const stage of bundle.subcategories) {
    const engine=createExplicitEngine(bundle,{maxQuestions:2});const entry=engine.entryFor(stage.stage.id);
    for(const used of [0,1,2]) {
      const state=engine.start(entry,{facts:{},history:[],presented:used,revision:0});
      assert(state.presented<=2);if(used===2)assert.equal(state.pending,null);
    }
    const root=engine.rowFor(entry).row.payload.next[0];
    for(const value of values){
      const key=`children_alimony.${stage.stage.id}.${root.field_key}`;
      const state=engine.start(entry,{facts:{[key]:value},history:[],presented:0,revision:0});
      assert.notEqual(state.pending?.question.field_key,root.field_key);assert.equal(state.facts[key],value);
    }
  }
});
it('existing guided native transport carries TFU controls without Go schema changes',async t=>{
  const h=await harness(t);const input=structuredClone(h.initial);
  input.guided={context:{},native:{privateDialogue:input.privateDialogue}};delete input.privateDialogue;
  const a=await h.service.respond(input);assert(a.answer.content);assert.equal(a.answer.next.length,1);
  const b=await h.service.respond({protocolVersion:2,userId:h.initial.userId,id:h.initial.id,turnId:randomUUID(),
    question:'Да',conversation:{sessionId:a.conversation.sessionId,revision:a.conversation.revision,nonce:a.conversation.nonce},
    guided:a.answer.next[0].view[0].guided});
  assert.equal(b.hold,'DOCUMENT_SOURCE_NOT_SUPPORTED');assert.equal(b.questionsUsed,1);
});
it('persisted outbox survives response loss and gates next event until exact acknowledgement',async t=>{
  const h=await harness(t);const a=await h.rawService.respond(h.initial);
  assert(a._historyEnvelope);assert.equal(a._historyEnvelope.turnId,h.initial.turnId);
  await assert.rejects(h.rawService.respond(h.answer(a,true)),/HISTORY_DELIVERY_PENDING/);
  assert.deepEqual((await h.rawService.internal(h.initial,'pending')).historyEnvelope,a._historyEnvelope);
  await h.rawService.internal({...h.initial,turnId:randomUUID()},'ack');
  assert((await h.rawService.internal(h.initial,'pending')).historyEnvelope);
  await h.rawService.internal(h.initial,'ack');
  assert.equal((await h.rawService.internal(h.initial,'pending')).historyEnvelope,null);
  const b=await h.rawService.respond(h.answer(a,true));assert.equal(b.hold,'DOCUMENT_SOURCE_NOT_SUPPORTED');
  assert.equal((await h.state()).ledger.length,1);
});
