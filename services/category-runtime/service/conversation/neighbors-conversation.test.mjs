import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createNeighborsProfile} from './neighbors-profile.mjs';
import {createConversationService} from './service.mjs';
import {identityKey,caseQuestionsUsed} from './state.mjs';
import {interpretNeighbors} from './neighbors-interpret.mjs';
const root=process.env.NBR_DM_TEST_ROOT;
assert(root&&path.isAbsolute(root),'NBR_DM_TEST_ROOT must be the assigned isolated output');
const trace=process.env.NBR_DM_TRACE_FILE;
const profile=await createNeighborsProfile();
const request='neighbors.sanitary_conditions.inspection_requested',blocked='neighbors.sanitary_conditions.inspection_blocked';
const selector=profile.bundle.subcategories.find(s=>s.stage.id==='sanitary_conditions').variants
  .find(r=>r.context.inspection_blocked===true&&Object.values(r.context).filter(v=>v===true).length===1).variant_id;
async function fixture(label){
  const dir=path.join(root,label+'-'+randomUUID());await fs.mkdir(dir,{recursive:true});
  const id=randomUUID(),userId='81',file=path.join(dir,'conversation-sessions-v2',identityKey(userId,id)+'.json');
  const create=()=>createConversationService({dataDir:dir,categoryProfile:profile,
    getActive:async()=>({sha256:profile.sourceSha256}),getBundle:async()=>profile.bundle,
    search:async()=>{throw Error('RETRIEVAL_NOT_ALLOWED')}});
  let service=create(),response;
  const send=async(question,extra={})=>{
    const input={id,userId,protocolVersion:2,turnId:randomUUID(),question,
      ...(response?{conversation:response.conversation}:{}),...extra};
    response=await service.respond(input);
    if(trace)await fs.appendFile(trace,JSON.stringify({label,input,response})+'\n');
    await service.internal({id,userId,turnId:response.turn.turnId},'ack');
    return response;
  };
  return {id,userId,file,dir,send,get response(){return response},get service(){return service},
    async state(){return JSON.parse(await fs.readFile(file,'utf8'))},
    restart(){service=create()},
    async start(focus=true,text='тема: санитарные условия; помещение: квартира А'){
      return send(text,focus?{variantId:selector}:{});
    },
    async button(value){const v=response.answer.next[0]?.view.find(v=>v.guided.native.value===value);assert(v,'offered control');return send(v.question,{guided:v.guided});},
    async resume(){const x=await service.respond({id,userId,resume:true});response=x;return x;},
  };
}
const question=x=>x.answer.next[0]?.questionId||null;
const facts=x=>x.dialogue.facts;
const hashFile=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');

test('exact private factory, inventory and policy integrity',async()=>{
  assert.equal(profile.policy.defaultActivation,false);
  assert.equal(profile.bundle.subcategories.flatMap(s=>s.variants).length,400);
  assert.equal(profile.policy.canonicalFields.length,46);
  assert.equal(profile.policy.questions.filter(q=>q.answers.length).length,31);
  assert.equal(profile.policy.blockedFields.length,12);
  await assert.rejects(createNeighborsProfile({policyBytes:Buffer.from('{}')}),/NBR_POLICY_PIN_MISMATCH/);
});
for(const value of [true,false,null])test('F02 causal response '+value+' at occupied ordinary limit',async()=>{
  const f=await fixture('causal-'+value);let x=await f.start();assert.equal(question(x),request);
  assert.equal(Object.keys(facts(x)).length,0); // Retrieved selector mask is never a fact.
  x=await f.button(true);assert.equal(question(x),blocked);assert.equal(x.presentation.questionsUsed,2);
  f.restart();x=await f.resume();assert.equal(question(x),blocked);assert.equal(x.presentation.questionsUsed,2);
  x=await f.button(value);assert.equal(facts(x)[blocked],value);assert.equal(question(x),null);
  assert.equal((await f.state()).caseState.served.length,2);
});
for(const value of [false,null])test('F02 prerequisite '+value+' never writes negative dependent',async()=>{
  const f=await fixture('prerequisite-'+value);await f.start();const x=await f.button(value);
  assert.equal(question(x),null);assert.equal(facts(x)[request],value);assert.equal(Object.hasOwn(facts(x),blocked),false);
  const before=await f.state();f.restart();await f.resume();assert.equal((await f.state()).caseState.served.length,before.caseState.served.length);
});
test('known request is reused and current B45 dependent body is shown',async()=>{
  const f=await fixture('known');let x=await f.start(false,'тема: санитарные условия; помещение: квартира А; обследование этого помещения уже запрашивали');
  assert.equal(question(x),blocked);assert.equal(x.presentation.questionsUsed,1);
  x=await f.button(true);assert.equal(question(x),null);
  const row=profile.bundle.subcategories.flatMap(s=>s.variants).find(r=>r.variant_id===x.answer.variantId);
  assert.deepEqual(x.answer.sections.body,row.payload.answer);
  assert.equal(row.context.inspection_blocked,true);
});
test('decline/resume charges each actual presentation, never refund',async()=>{
  const f=await fixture('decline');let x=await f.start(false);assert.equal(x.presentation.questionsUsed,1);
  await f.send('не хочу отвечать');x=await f.send('продолжить');assert.equal(x.presentation.questionsUsed,2);
  await f.send('не хочу отвечать');x=await f.send('продолжить');assert.equal(question(x),null);
  assert.equal(caseQuestionsUsed(await f.state()),2);
});
test('F02 focus after two spent slots allows one justified third but no fourth',async()=>{
  const f=await fixture('third');await f.start(false);await f.button(null);
  let x=await f.send('тема: санитарные условия',{variantId:selector});
  assert.equal(question(x),request);assert.equal(x.presentation.questionsUsed,3);
  assert((await f.state()).caseState.served.at(-1).thirdReason);
  x=await f.button(true);assert.equal(question(x),null);assert.equal(facts(x)[request],true);
  assert.equal(Object.hasOwn(facts(x),blocked),false);assert.equal(x.presentation.questionsUsed,3);
});
test('explicit retry uses same question ID and a new ordinary attempt; unknown alone cannot justify third',async()=>{
  const f=await fixture('retry');let x=await f.start();const first=x.answer.next[0].view[0].guided.native;
  x=await f.button(null);assert.equal(question(x),null);
  x=await f.send('повторить вопрос об обследовании');const second=x.answer.next[0].view[0].guided.native;
  assert.equal(first.questionId,second.questionId);assert.notEqual(first.attemptId,second.attemptId);
  assert.notEqual(first.receiptId,second.receiptId);assert.equal(x.presentation.questionsUsed,2);
  await f.button(null);await assert.rejects(f.send('повторить вопрос об обследовании'),/NBR_RETRY_LIMIT/);
  assert.equal(caseQuestionsUsed(await f.state()),2);
});
test('pending return across stages reuses receipt and can answer at full budget',async()=>{
  const f=await fixture('return');let x=await f.start();const receipt=x.answer.next[0].view[0].guided.native.receiptId;
  x=await f.send('тема: общие зоны');assert.equal(x.presentation.questionsUsed,2);
  x=await f.send('вернуться к предыдущей теме');assert.equal(question(x),request);
  assert.equal(x.answer.next[0].view[0].guided.native.receiptId,receipt);
  assert.equal(x.presentation.questionsUsed,2);
  x=await f.button(true);assert.equal(question(x),blocked);assert.equal(x.presentation.questionsUsed,3);
  x=await f.button(false);assert.equal(facts(x)[blocked],false);assert.equal(x.presentation.questionsUsed,3);
});
test('different premises never receive earlier facts, returning restores exact object',async()=>{
  const f=await fixture('premises');await f.start(false,'тема: санитарные условия; помещение: квартира А; обследование этого помещения уже запрашивали');
  await f.button(true);
  let x=await f.send('тема: санитарные условия; помещение: квартира Б');
  assert.equal(Object.hasOwn(facts(x),request),false);assert.equal(Object.hasOwn(facts(x),blocked),false);
  assert.equal(question(x),request);await f.button(false);
  x=await f.send('тема: санитарные условия; помещение: квартира А');
  assert.equal(facts(x)[request],true);assert.equal(facts(x)[blocked],true);assert.equal(question(x),null);
  assert.equal(x.presentation.questionsUsed,2);
});
for(const operation of ['исправляю:','отзываю:',''])test('lineage/prerequisite invalidation '+operation,async()=>{
  const f=await fixture('lineage');await f.start();await f.button(true);await f.button(true);
  const text=(operation?operation+' ':'')+'обследование этого помещения еще не запрашивали';
  const x=await f.send(text),s=await f.state();
  assert.equal(Object.hasOwn(facts(x),blocked),false);assert.equal(question(x),null);
  assert(s.factLedger.some(f=>f.fieldKey===blocked&&f.value===true));
  assert.equal(x.presentation.questionsUsed,2);
  if(!operation)assert(s.factLedger.some(f=>f.fieldKey===request&&f.status==='conflicted'));
});
test('actual raw OR operands do not create diagnosis, source or welfare claims',async()=>{
  const f=await fixture('raw');const x=await f.start(false,'тема: санитарные условия; помещение: квартира А; я вижу огонь в этом помещении; в этом помещении живет ребенок');
  const row=profile.bundle.subcategories.flatMap(s=>s.variants).find(r=>r.variant_id===x.answer.variantId);
  assert.equal(row.context.health_or_fire_risk,true);assert.equal(row.context.child_or_vulnerable_person_present,true);
  assert.equal(row.context.source_confirmed,null);assert(x.answer.content.startsWith('Сначала безопасное место'));
  assert.equal(profile.port.facts(await f.state())['neighbors.sanitary_conditions.specific_welfare_danger'],undefined);
});
test('unsupported/foreign/hypothetical text stays raw and client proof is rejected',async()=>{
  const f=await fixture('raw-only');await f.start();
  for(const text of ['если обследование этого помещения уже запрашивали','в чужом случае; обследование этого помещения уже запрашивали','«обследование этого помещения уже запрашивали»','непонятный ввод; обследование этого помещения уже запрашивали','обследование этого помещения уже запрашивали?']){
    const x=await f.send(text);assert.equal(Object.hasOwn(facts(x),request),false);
  }
  const before=await hashFile(f.file);await assert.rejects(f.send('Да',{facts:{[request]:true}}),/NBR_CLIENT_STATE_FORBIDDEN/);
  assert.equal(await hashFile(f.file),before);
});
test('unresolved correction withholds specialization and preserves original history',async()=>{
  const f=await fixture('unresolved-correction');await f.start();await f.button(true);await f.button(true);
  const before=(await f.state()).factLedger;
  let x=await f.send('исправляю: я перепутал обследование');
  assert.deepEqual((await f.state()).factLedger,before);assert.deepEqual(facts(x),{});
  assert.equal(question(x),null);assert(x.answer.content);
  x=await f.send('исправляю: обследование этого помещения еще не запрашивали');
  assert.equal(facts(x)[request],false);assert.equal(Object.hasOwn(facts(x),blocked),false);
});
test('altered saved provenance cannot become an active fact',async()=>{
  const f=await fixture('altered-source');await f.start();await f.button(true);await f.button(true);
  const original=await f.state();
  for(const change of [r=>r.source.kind='assistant',r=>r.source.message='not the original message',r=>r.source.span=[0,999999],r=>r.source.scope.premises='other apartment']){
    const s=structuredClone(original);change(s.factLedger.findLast(r=>r.fieldKey===blocked));
    await fs.writeFile(f.file,JSON.stringify(s));f.restart();
    const x=await f.send('повторить памятку',{conversation:{sessionId:original.id,revision:original.revision}});assert.equal(Object.hasOwn(facts(x),blocked),false);
    assert.equal(x.presentation.questionsUsed,2);
  }
});
test('stale/foreign controls and bad source ID fail before persistence',async()=>{
  const f=await fixture('stale');let x=await f.start();const old=x.answer.next[0].view[0];await f.button(true);
  let before=await hashFile(f.file);await assert.rejects(f.send(old.question,{guided:old.guided}),/STALE_ACTION/);assert.equal(await hashFile(f.file),before);
  const current=f.response.answer.next[0].view[0];const altered=structuredClone(current.guided);altered.native.sourceSha256='0'.repeat(64);
  await assert.rejects(f.send(current.question,{guided:altered}),/NBR_STALE_ACTION/);
  before=await hashFile(f.file);await assert.rejects(f.service.respond({id:f.id,userId:'82',turnId:randomUUID(),question:old.question,guided:old.guided}),/STALE_ACTION/);assert.equal(await hashFile(f.file),before);
  await assert.rejects(f.send('тема: санитарные условия',{variantId:'made-up'}),/NBR_SOURCE_ID_UNAVAILABLE/);
});
test('unknown policy predecessor fails before write, without rebasing/resetting',async()=>{
  const f=await fixture('version');await f.start();const s=await f.state();s.neighbors.version.policy='unknown-old-version';await fs.writeFile(f.file,JSON.stringify(s));
  const before=await hashFile(f.file);f.restart();await assert.rejects(f.send('Да'),/NBR_PREDECESSOR_STATE_UNAVAILABLE/);assert.equal(await hashFile(f.file),before);
});
test('duplicate turns replay once and outbox blocks a new turn until ack',async()=>{
  const f=await fixture('replay');const input={id:f.id,userId:f.userId,turnId:randomUUID(),question:'тема: санитарные условия',variantId:selector};
  const first=await f.service.respond(input),again=await f.service.respond(input);assert.equal(again.turn.replayed,true);
  assert.equal(first.turn.messageId,again.turn.messageId);assert.equal(caseQuestionsUsed(await f.state()),1);
  await assert.rejects(f.service.respond({...input,turnId:randomUUID(),question:'Да',conversation:first.conversation}),/HISTORY_DELIVERY_PENDING/);
  await f.service.internal({id:f.id,userId:f.userId,turnId:input.turnId},'ack');
});
test('two simultaneous turns use one shared persistence lock',async()=>{
  const f=await fixture('concurrent');const x=await f.start();
  const results=await Promise.allSettled([true,false].map(value=>f.service.respond({id:f.id,userId:f.userId,turnId:randomUUID(),question:value?'Да':'Нет',conversation:x.conversation})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal((await f.state()).revision,2);assert(caseQuestionsUsed(await f.state())<=2);
});
test('atomic rename failure cannot commit or retain a Map-side state',async()=>{
  const f=await fixture('atomic');const x=await f.start(),before=await hashFile(f.file),turnId=randomUUID();
  const rename=fs.rename;fs.rename=async(from,to)=>{if(to===f.file)throw Object.assign(Error('synthetic atomic failure'),{code:'EIO'});return rename(from,to)};
  try{await assert.rejects(f.service.respond({id:f.id,userId:f.userId,turnId,question:'Да',conversation:x.conversation}),/synthetic atomic failure/);}finally{fs.rename=rename;}
  assert.equal(await hashFile(f.file),before);f.restart();
  const result=await f.service.respond({id:f.id,userId:f.userId,turnId,question:'Да',conversation:x.conversation});
  assert.equal(result.presentation.questionsUsed,2);assert.equal((await f.state()).revision,2);
});
for(const [stage,topic] of [['noise','шум'],['repairs','ремонт'],['smells_smoking','дым и запах'],['pets','животное'],['threats_conflict','угрозы'],['common_areas','общие зоны'],['cameras_access','камеры']])
  for(const value of [true,false,null])test('existing first NEXT TFU '+stage+' '+value,async()=>{
    const f=await fixture(stage);let x=await f.send('тема: '+topic);const key=question(x);assert(key);
    x=await f.button(value);assert.equal(x.dialogue.stageId,stage);assert.equal(facts(x)[key],value);
    assert.equal(profile.bundle.subcategories.find(s=>s.stage.id===stage).variants.some(v=>v.variant_id===x.answer.variantId),true);
  });
