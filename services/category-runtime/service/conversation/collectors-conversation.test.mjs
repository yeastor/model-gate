import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCollectorsProfile} from './collectors-profile.mjs';
import {createConversationService} from './service.mjs';
import {fresh,episode,newRound,atomic,identityKey,caseQuestionsUsed} from './state.mjs';
const p=createCollectorsProfile();
const root=process.env.COL_DM_TEST_ROOT,allowed='C:/Users/mujlo/Documents/Codex/2026-06-20/_work/collectors/dialogue-manager-implementation/20261026-bounded-private-v1/';
if(!root||!path.resolve(root).replaceAll('\\','/').startsWith(allowed))throw Error('COL_TEST_OUTPUT_REQUIRED');
await fs.mkdir(root,{recursive:true});const trace=path.join(root,'traces.jsonl');await fs.writeFile(trace,'');let records=0;
after(async()=>fs.writeFile(path.join(root,'trace-index.json'),JSON.stringify({records,trace,origin:'synthetic_dev_private_service_not_independent_holdout'})+'\n'));
function check(id,fn){test(id,async()=>{const tr={id,origin:'synthetic_dev',steps:[],status:'RUNNING'};try{await fn(tr);tr.status='PASS';}catch(e){tr.status='FAIL';tr.error=e.stack;throw e;}finally{records++;await fs.appendFile(trace,JSON.stringify(tr)+'\n');}});}
const phrase=s=>p.policy.stages.find(x=>x.id===s).phrase;
async function fixture(tr,{stage='calls_messages',entry,used=0,start=true,reports=[]}={}){
 const dir=await fs.mkdtemp(path.join(root,'case-')),s=fresh('19',randomUUID(),p.sourceSha256);episode(s);p.prepareState(s);newRound(s,'synthetic');s.caseState.baselineUsed=used;
 const file=path.join(dir,'conversation-sessions-v2',identityKey(s.userId,s.chatId)+'.json');await atomic(file,s);
 const options={dataDir:dir,categoryProfile:p,getActive:async()=>({sha256:p.sourceSha256}),getBundle:async()=>p.bundle};let service=createConversationService(options);
 const f={dir,file,id:s.chatId,userId:s.userId,options,state:async()=>JSON.parse(await fs.readFile(file,'utf8')),service:()=>service,restart(){service=createConversationService(options);},async mutate(fn){const state=await f.state();fn(state);await atomic(file,state);},async send(question,extra={},ack=true){const state=await f.state(),input={id:f.id,userId:f.userId,turnId:randomUUID(),question,conversation:{sessionId:state.id,revision:state.revision},...extra};f.lastInput=input;try{f.response=await service.respond(input);tr.steps.push({input,response:f.response,state:await f.state()});if(ack)await service.internal({id:f.id,userId:f.userId,turnId:f.response.turn.turnId},'ack');return f.response;}catch(e){tr.steps.push({input,error:e.message,state:await f.state()});throw e;}},async click(value){const button=f.response.answer.next[0]?.view.find(c=>c.guided.native.value===value);assert.ok(button,'missing button '+value);return f.send(button.title,{guided:button.guided});},async resume(){f.response=await service.respond({id:f.id,userId:f.userId,resume:true});tr.steps.push({resume:true,response:f.response,state:await f.state()});return f.response;}};
 if(start)await f.send([phrase(stage),...reports].join('; '),entry?{variantId:entry}:{});return f;
}
for(const node of p.policy.questions)for(const value of [true,false,null])check('TFU '+node.question_id+' '+value,async tr=>{
 const f=await fixture(tr,{stage:node.stage_id,entry:node.variant_id});
 if(node.prerequisites.length)await f.click(false);
 assert.equal(f.response.dialogue.questionId,node.question_id);assert.equal(f.response.answer.next[0].questionText,node.question);
 await f.click(value);const b=node.branches.find(x=>x.value===value),s=await f.state();
 const fact=s.factLedger.findLast(x=>x.fieldKey===node.field_key);assert.equal(fact.value,value);assert.equal(p.facts(s,node.stage_id)[node.field_key],value);
 if(b.target){assert.equal(f.response.answer.variantId,b.target);assert.equal(f.response.answer.next.length,0);f.restart();await f.resume();assert.equal(f.response.answer.next.length,0);await f.send('Спасибо');assert.equal(f.response.answer.next.length,0);assert.equal(f.response.presentation.mode,'continuation');}
 else assert.equal(f.response.dialogue.questionId,b.next_question_id);
 assert.ok(caseQuestionsUsed(await f.state())<=2);
});
for(const [value,text]of [[true,' Да! '],[false,'нет'],[null,'не знаю']])check('shared text reply '+value,async tr=>{const f=await fixture(tr);await f.send(text);assert.equal(p.facts(await f.state())['collectors.calls_messages.immediate_danger'],value);});
for(const stage of p.policy.stages)check('known help first '+stage.id,async tr=>{
 const field=stage.id==='home_visits'?'attempted_forced_entry':'immediate_danger',f=await fixture(tr,{stage:stage.id,reports:[p.policy.literals[field].positive[0]]});assert.equal(f.response.answer.next.length,0);assert.equal(f.response.presentation.questionsUsed,0);assert.ok(f.response.answer.content.includes('112'));assert.equal(p.facts(await f.state())[ `collectors.${stage.id}.${field}`],true);
});
check('known night and safety skip both; mask never becomes fact',async tr=>{
 const f=await fixture(tr,{reports:[p.policy.literals.immediate_danger.negative[0],p.policy.literals.night_calls.positive[0]]});assert.equal(f.response.answer.variantId,'collectors_calls_messages_v02');assert.equal(f.response.answer.next.length,0);assert.equal(f.response.presentation.questionsUsed,0);
 const g=await fixture(tr,{entry:'collectors_calls_messages_v08'});assert.deepEqual(p.facts(await g.state()),{});assert.equal(g.response.answer.variantId,'collectors_calls_messages_v01');assert.equal(g.response.dialogue.specializationHeld,true);
});
check('unknown safety stays terminal across navigation; no fabricated target context',async tr=>{
 const f=await fixture(tr);await f.click(null);const s=await f.state();assert.equal(s.factLedger.length,1);assert.equal(s.factLedger[0].value,null);assert.equal(f.response.answer.variantId,'collectors_threats_pressure_v01');await f.send(phrase('threats_pressure'));assert.equal(f.response.answer.next.length,0);assert.equal(f.response.presentation.questionsUsed,1);assert.deepEqual(p.facts(await f.state(),'threats_pressure'),{});
});
check('correction conflict unknown withdrawal preserve history and budget',async tr=>{
 const f=await fixture(tr,{reports:[p.policy.literals.immediate_danger.positive[0]]});await f.send(p.policy.literals.immediate_danger.unknown[0]);assert.equal(p.facts(await f.state())['collectors.calls_messages.immediate_danger'],true);
 await f.send(p.policy.literals.immediate_danger.negative[0]);assert.equal((await f.state()).factLedger.at(-1).status,'conflicted');assert.deepEqual(p.facts(await f.state()),{});assert.equal(f.response.answer.next.length,0);
 await f.send('Исправляю: '+p.policy.literals.immediate_danger.negative[0]);assert.equal(p.facts(await f.state())['collectors.calls_messages.immediate_danger'],false);
 const used=f.response.presentation.questionsUsed;await f.send('Отзываю: '+p.policy.literals.immediate_danger.negative[0]);assert.deepEqual(p.facts(await f.state()),{});assert.equal(f.response.presentation.questionsUsed,used);assert.ok((await f.state()).factLedger.length>=4);
});
check('changed debt/actor/channel/episode never reuses facts or resets budget',async tr=>{
 for(const change of p.policy.scopeChangePhrases){const f=await fixture(tr);await f.click(false);await f.click(true);assert.equal(f.response.presentation.questionsUsed,2);await f.send(change);assert.deepEqual(p.facts(await f.state()),{});assert.equal(f.response.answer.next.length,0);assert.equal(f.response.presentation.questionsUsed,2);await f.send(phrase('home_visits'));assert.equal(f.response.answer.next.length,0);assert.equal(f.response.presentation.questionsUsed,2);}
});
check('two served questions pending survives restart; no third fourth',async tr=>{
 const f=await fixture(tr);await f.click(false);const q=f.response.answer.next[0];f.restart();await f.resume();assert.deepEqual(f.response.answer.next[0],q);assert.equal(f.response.presentation.questionsUsed,2);await f.click(null);await f.send('Это другой долг');await f.send(phrase('home_visits'));assert.equal(f.response.answer.next.length,0);assert.equal(f.response.presentation.questionsUsed,2);
});
check('explicit new case only; no neighbor retry waiver',async tr=>{
 const f=await fixture(tr);await f.click(false);await f.click(false);await f.send('Попробовать ещё раз');assert.equal(f.response.presentation.questionsUsed,2);await f.send(p.policy.newCasePhrase);await f.send(phrase('calls_messages'));assert.equal(f.response.presentation.questionsUsed,1);assert.equal(f.response.answer.next.length,1);
});
check('untrusted text, names, logs and document statements do not create facts',async tr=>{
 const f=await fixture(tr,{used:2});for(const text of ['У друга '+p.policy.literals.immediate_danger.positive[0],'Если '+p.policy.literals.immediate_danger.positive[0],'Он '+p.policy.literals.immediate_danger.positive[0],'Вчера '+p.policy.literals.immediate_danger.positive[0],'Мне звонят 20 раз','Он назвал имя и код','Я отправил отказ вчера','Суд вынес решение','Номер только что куплен'])await f.send(text);assert.equal((await f.state()).factLedger.length,0);assert.equal(f.response.answer.next.length,0);
});
check('stale buttons, forged receipt/scope and foreign user rejected',async tr=>{
 const f=await fixture(tr),button=structuredClone(f.response.answer.next[0].view[0]);for(const [key,value]of [['receiptId',randomUUID()],['scopeDigest','0'.repeat(64)],['policySha','0'.repeat(64)],['value',false]]){const changed=structuredClone(button.guided);changed.native[key]=value;await assert.rejects(f.send(button.title,{guided:changed}),/COL_ACTION_BINDING/);}const before=await f.state();assert.equal(before.factLedger.length,0);await assert.rejects(f.service().respond({...f.lastInput,userId:'20'}),/STALE_STATE|STALE_ACTION|COL_OFFER_INVALID/);await f.click(true);await assert.rejects(f.send(button.title,{guided:button.guided}),/STALE_ACTION/);
});
check('turn replay exact; changed body rejects; outbox survives restart',async tr=>{
 const f=await fixture(tr,{start:false});await f.send(phrase('calls_messages'),{},false);const input=f.lastInput,response=structuredClone(f.response);f.restart();const replay=await f.service().respond(input);assert.equal(replay.turn.replayed,true);assert.equal(replay.presentation.questionsUsed,1);assert.equal(replay.turn.messageId,response.turn.messageId);await assert.rejects(f.service().respond({...input,question:'другая реплика'}),/TURN_ID_CONFLICT/);await assert.rejects(f.send('Спасибо'),/HISTORY_DELIVERY_PENDING/);await f.service().internal({id:f.id,userId:f.userId,turnId:input.turnId},'ack');await f.service().internal({id:f.id,userId:f.userId,turnId:input.turnId},'ack');await f.resume();assert.equal(f.response.presentation.questionsUsed,1);
});
check('parallel same-chat turns serialize and isolated chat has no inherited facts',async tr=>{
 const f=await fixture(tr),s=await f.state();const base={id:f.id,userId:f.userId,question:'Спасибо',conversation:{sessionId:s.id,revision:s.revision}};const res=await Promise.allSettled([f.service().respond({...base,turnId:randomUUID()}),f.service().respond({...base,turnId:randomUUID()})]);assert.equal(res.filter(x=>x.status==='fulfilled').length,1);assert.equal(res.filter(x=>x.status==='rejected').length,1);assert.equal((await f.state()).caseState.served.length,1);const g=await fixture(tr);assert.deepEqual(p.facts(await g.state()),{});
});
check('atomic save failure exposes no committed question budget or outbox',async tr=>{
 const f=await fixture(tr,{start:false}),before=await f.state(),rename=fs.rename;fs.rename=async()=>{throw Error('SYNTHETIC_RENAME_FAILURE');};try{await assert.rejects(f.send(phrase('calls_messages')),/SYNTHETIC_RENAME_FAILURE/);}finally{fs.rename=rename;}assert.deepEqual(await f.state(),before);const input=f.lastInput;f.restart();const response=await f.service().respond(input);assert.equal(response.presentation.questionsUsed,1);assert.equal((await f.state()).caseState.served.length,1);
});
check('persisted evidence tampering cannot promote true; changed policy state refuses',async tr=>{
 for(const mutation of [s=>s.factLedger[0].source.quote='invented',s=>s.factLedger[0].source.span=[0,1],s=>s.factLedger[0].source.scope.incident='foreign',s=>s.collectors.turns[s.factLedger[0].source.turnId].request.question='invented']){const f=await fixture(tr,{reports:[p.policy.literals.immediate_danger.positive[0]]});await f.mutate(mutation);assert.deepEqual(p.facts(await f.state()),{});await f.send('Спасибо');assert.equal(f.response.answer.variantId,'collectors_calls_messages_v01');}
 const g=await fixture(tr);await g.mutate(s=>s.collectors.version.policy='changed');await assert.rejects(g.send('Спасибо'),/COL_STATE_VERSION/);
});
check('no duplicate full answer; explicit repeat retains exact laws/documents',async tr=>{
 const f=await fixture(tr);await f.click(null);const sections=structuredClone(f.response.answer.sections);await f.send('Спасибо');assert.equal(f.response.presentation.mode,'continuation');assert.equal(f.response.answer.sections,undefined);await f.send(p.policy.repeatPhrase);assert.equal(f.response.presentation.mode,'full');assert.deepEqual(f.response.answer.sections,sections);assert.equal(f.response.answer.sections.documentActionsUnavailable,true);
});
check('offered caption and changed prerequisite revalidated before answer',async tr=>{
 const f=await fixture(tr);await f.mutate(s=>{s.turns[s.caseState.served[0].turnId].response.answer.next[0].questionText='Different question';});await assert.rejects(f.click(true),/COL_OFFER_INVALID/);assert.equal((await f.state()).factLedger.length,0);
 const g=await fixture(tr);await g.click(false);await g.mutate(s=>{s.factLedger[0].source.quote='invalidated safety basis';});await assert.rejects(g.click(true),/COL_QUESTION_NO_LONGER_APPLICABLE/);assert.equal((await g.state()).factLedger.some(x=>x.fieldKey.endsWith('.night_calls')),false);
});
check('real contradictory reply retires night offer without refund',async tr=>{
 const f=await fixture(tr);await f.click(false);const old=structuredClone(f.response.answer.next[0].view[0]);await f.send(p.policy.literals.immediate_danger.positive[0]);assert.equal(f.response.answer.next.length,0);assert.equal(f.response.presentation.questionsUsed,2);await assert.rejects(f.send(old.title,{guided:old.guided}),/STALE_ACTION/);assert.equal((await f.state()).factLedger.some(x=>x.fieldKey.endsWith('.night_calls')),false);
});
check('legacy incomplete allowance stays closed without assuming zero',async tr=>{
 const f=await fixture(tr,{used:2});await f.mutate(s=>{s.caseState.legacyHistoryComplete=false;s.caseState.migrationReason='synthetic_unknown_history';});await f.send('Это другой долг');assert.equal(f.response.presentation.questionsUsed,2);assert.equal(f.response.answer.next.length,0);assert.deepEqual(p.facts(await f.state()),{});
});
check('saved source unavailable fails closed without changing session',async tr=>{
 const f=await fixture(tr),before=await f.state();const service=createConversationService({...f.options,getBundle:async()=>{throw Error('source no longer available');}});await assert.rejects(service.respond({id:f.id,userId:f.userId,resume:true}),/PINNED_BUNDLE_UNAVAILABLE/);assert.deepEqual(await f.state(),before);
});
check('ambiguous episode remains raw until explicitly scoped current report',async tr=>{
 const f=await fixture(tr);await f.send('У друга '+p.policy.literals.immediate_danger.positive[0]);await f.send(p.policy.literals.immediate_danger.positive[0]);assert.equal((await f.state()).factLedger.length,0);assert.equal(f.response.answer.next.length,0);await f.send(phrase('calls_messages')+'; '+p.policy.literals.immediate_danger.positive[0]);assert.equal(p.facts(await f.state())['collectors.calls_messages.immediate_danger'],true);assert.equal(f.response.answer.next.length,0);
});
