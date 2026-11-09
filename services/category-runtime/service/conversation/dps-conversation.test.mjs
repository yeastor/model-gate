import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createDpsProfile} from './dps-profile.mjs';
import {createConversationService} from './service.mjs';
import {interpretDps,observationLanguage} from './dps-interpret.mjs';
import {fresh,episode,newRound,recordFact,project,atomic,identityKey,serveQuestion,caseQuestionsUsed,subjectFor} from './state.mjs';
const p=createDpsProfile(),traces=[];
const testRoot=process.env.DPS_DM_TEST_ROOT;
if(!testRoot)throw Error('DPS_DM_TEST_ROOT must name isolated test output directory');
await fs.mkdir(testRoot,{recursive:true});
after(async()=>{if(process.env.DPS_DM_TRACE_FILE)await fs.writeFile(process.env.DPS_DM_TRACE_FILE,JSON.stringify(traces,null,2)+'\n')});
function criterion(id,title,run){test(id+' '+title,async()=>{const tr={id,title,origin:'synthetic_regression',steps:[],status:'RUNNING'};traces.push(tr);try{await run(tr);tr.status='PASS'}catch(e){tr.status='FAIL';tr.error=e.message;throw e}})}
function seed(stage='protocol'){
 const s=fresh('91',randomUUID(),p.sourceSha256);episode(s);p.prepareState(s);newRound(s,'fixture');
 const e=s.episodes[0];e.stageId=stage;e.dpsStageConfirmed=true;e.actor='traffic_police';if(stage==='accident_processing')e.dpsOwnAccident=true;
 p.selectSubject(s,stage);return s;
}
const snap=s=>({revision:s.revision,caseState:s.caseState,episodes:s.episodes,facts:s.factLedger,pending:s.pending,policy:s.dpsPolicyVersion});
criterion('N60-C01','negated or foreign actor cannot assert traffic-police facts',async tr=>{
 for(const text of ['Это не инспектор ДПС составляет мне протокол; Я подписал этот протокол','Это охранник; Я подписал этот протокол']){
  const f=await fixture(tr,{stage:'protocol',used:2});const r=await f.send(text);const s=await f.state();
  assert.equal(project(s,'protocol')['dps.protocol.document_signed'],undefined);
  assert.equal(r.answer.variantId,undefined);
 }
});
criterion('N60-C02','literal quotation and embedded hypothetical are not observations',async tr=>{
 for(const text of ['«Я подписал этот протокол»','Это цитата из статьи; Я подписал этот протокол','Это гипотеза; Я подписал этот протокол']){
  const f=await fixture(tr,{stage:'protocol',used:2});await f.send(text);
  assert.equal(project(await f.state(),'protocol')['dps.protocol.document_signed'],undefined);
 }
});
criterion('N60-C03','two document references do not select the first silently',async tr=>{
 const f=await fixture(tr,{stage:'protocol'});const before=await f.state();
 const r=await f.send('Мой первый протокол и второй протокол; Я подписал этот протокол');const s=await f.state();
 assert.equal(project(s,'protocol')['dps.protocol.document_signed'],undefined);
 assert.equal(subjectFor(s,'dps.protocol.document_signed'),subjectFor(before,'dps.protocol.document_signed'));
 assert.equal(r.dialogue.questionId,'dps.dm.subject');assert.equal(caseQuestionsUsed(s),1);
});
criterion('N60-C04','multiple explicit facts have exact separate Unicode source spans',async tr=>{
 const f=await fixture(tr,{stage:'protocol',used:2});
 const text='Инспектор ДПС составляет мне протокол 🧾; Я подписал этот протокол; Я не получил копию этого протокола';
 await f.send(text);const s=await f.state();
 for(const [key,quote] of [['document_signed','Я подписал этот протокол'],['copy_received','Я не получил копию этого протокола']]){
  const fact=s.factLedger.findLast(x=>x.fieldKey==='dps.protocol.'+key);assert.ok(fact);
  assert.equal(fact.source.quote,quote);
  assert.equal(Array.from(text).slice(...fact.source.span).join(''),quote);
  assert.equal(fact.source.subjectId,subjectFor(s,fact.fieldKey));
 }
});
criterion('N60-C05','new incident keeps original-message spans and resets only its allowance',async tr=>{
 const f=await fixture(tr,{stage:'protocol',used:2});const old=await f.state();
 const text='Это другой случай, Инспектор ДПС составляет мне протокол 🧾; Я подписал этот протокол';
 await f.send(text);const s=await f.state(),fact=s.factLedger.findLast(x=>x.fieldKey==='dps.protocol.document_signed');
 assert.notEqual(s.caseState.id,old.caseState.id);assert.equal(fact.value,true);
 assert.equal(Array.from(text).slice(...fact.source.span).join(''),fact.source.quote);
 assert.equal(fact.caseId,s.caseState.id);assert.ok(caseQuestionsUsed(s)<=1);
});
criterion('N60-C06','ambiguous actor does not donate an observation and replaces pending once',async tr=>{
 const q=p.policy.questions.find(q=>q.fieldKey==='dps.vehicle_detention.vehicle_movement_started');
 const f=await fixture(tr,{stage:'vehicle_detention',pending:q});
 await f.send('Инспектор и водитель эвакуатора, он забрал ключи; Эвакуатор уже поехал с моим автомобилем');
 const s=await f.state();assert.equal(project(s,'vehicle_detention')[q.fieldKey],undefined);
 assert.equal(s.pending?.question.id,'dps.dm.actor_reference');assert.equal(caseQuestionsUsed(s),2);
 assert.equal(s.caseState.served[0].status,'answered');
});
async function fixture(tr,{stage=null,facts={},used=0,pending=null,custom=null}={}){
 const dir=await fs.mkdtemp(path.join(testRoot,'session-'));
 const s=seed(stage||'protocol'),userId=s.userId,id=s.chatId;
 if(!stage){const e=s.episodes[0];e.stageId=null;e.actor=null;e.dpsStageConfirmed=false;e.dpsSubjects={};}
 for(const [fieldKey,value]of Object.entries(facts))recordFact(s,fieldKey,value,{kind:'accepted_fixture',turnId:'fixture',quote:'Synthetic previously reported circumstance',subjectId:subjectFor(s,fieldKey)});
 s.caseState.baselineUsed=used;
 if(pending){s.pending={kind:'next',key:pending.id,stageId:pending.stageId,fieldKey:pending.fieldKey,question:pending};assert.ok(serveQuestion(s,s.pending,'fixture-response','fixture-turn',{}));}
 if(custom)custom(s);
 const file=path.join(dir,'conversation-sessions-v2',identityKey(userId,id)+'.json');await atomic(file,s);
 const options={dataDir:dir,getActive:async()=>({sha256:p.sourceSha256}),getBundle:async()=>p.bundle,dpsProfile:p};
 let service=createConversationService(options),response=null;
 const f={
  file,id,userId,options,
  async state(){return JSON.parse(await fs.readFile(file,'utf8'))},
  async mutate(fn){const current=await f.state();fn(current);await atomic(file,current)},
  async send(question,extra={},ack=true){
   const current=await f.state();const input={userId,id,turnId:randomUUID(),question,conversation:{sessionId:current.id,revision:current.revision},...extra};f.lastInput=input;
   try{response=await service.respond(input);f.response=response;tr.steps.push({input,response,state:snap(await f.state())});if(ack)await service.internal({userId,id,turnId:response.turn.turnId},'ack');return response}
   catch(e){tr.steps.push({input,error:e.message,state:snap(await f.state())});throw e}
  },
  async button(value){const b=response.answer.next.flatMap(x=>x.view).find(v=>v.guided.native.value===value);assert.ok(b);return f.send(b.question,{guided:b.guided})},
  async pendingButton(value){const s=await f.state(),q=s.pending;const c=q.question.controls.find(c=>c.value===value);return f.send(c.label,{guided:{native:{kind:'answer',sessionId:s.id,nonce:s.nonce,revision:s.revision,episodeId:s.activeEpisodeId,roundId:s.round.id,policyVersion:p.version,sourceSha256:p.sourceSha256,questionId:q.question.id,receiptId:q.receiptId,value}}})},
  async retry(){const r=await service.respond(f.lastInput);tr.steps.push({replay:r,state:snap(await f.state())});return r},
  async resume(extra={},ack=true){response=await service.respond({userId,id,resume:true,...extra});f.response=response;tr.steps.push({resume:response,state:snap(await f.state())});if(ack&&response._historyEnvelope)await service.internal({userId,id,turnId:response._historyEnvelope.turnId},'ack');return response},
  async ack(){await service.internal({userId,id,turnId:f.response.turn.turnId},'ack')},
  restart(){service=createConversationService(options)},
  service:()=>service,
 };return f;
}
criterion('AC02','eight stage least-known help',async tr=>{
 for(const table of p.policy.tables){const stage=table.stageKey.slice(4);const f=await fixture(tr,{stage,used:2});const r=await f.send('Что делать дальше?');assert.equal(r.answer.variantId,table.entryVariantId);assert.equal(r.answer.next.length,0)}
 const f=await fixture(tr,{stage:'protocol',used:2,facts:{'dps.protocol.document_signed':false,'dps.protocol.blank_fields_present':true,'dps.protocol.copy_refused':true}});
 const r=await f.send('Что делать дальше?');assert.equal(r.answer.variantId,'dps_protocol_v77');assert.match(r.answer.content,/пуст|незаполн/u);assert.equal(r.answer.next.length,0);
});
for(const q of p.policy.questions)for(const value of [true,false,null])criterion('AC03',q.fieldKey+'='+value,async tr=>{
 const required=Object.fromEntries(q.requires.map(r=>[r.field_key,r.value]));
 const candidates=[required,...p.policy.bindings.filter(b=>b.stageId===q.stageId&&!p.blockedVariantIds.includes(b.variantId)).map(b=>({...Object.fromEntries(Object.entries(b.context).filter(([k,v])=>v!==null&&'dps.'+q.stageId+'.'+k!==q.fieldKey).map(([k,v])=>['dps.'+q.stageId+'.'+k,v])),...required}))];
 const facts=candidates.find(f=>p.useful(q.stageId,f,q,2))||required;const enabled=p.useful(q.stageId,facts,q,2);
 tr.enabledInMinimumPrerequisites=enabled;
 if(!enabled){const s=seed(q.stageId);for(const[k,v]of Object.entries(facts))recordFact(s,k,v,{kind:'accepted_fixture',turnId:'fixture'});assert.notEqual(p.plan(s).question?.id,q.id);tr.steps.push({status:'HIDDEN_NO_MATERIAL_CHANGE_WITHIN_TWO',plan:p.plan(s)});return}
 const f=await fixture(tr,{stage:q.stageId,facts,pending:q});const r=await f.pendingButton(value),s=await f.state();
 assert.equal(project(s,q.stageId)[q.fieldKey],value);assert.equal(s.caseState.served[0].status,'answered');assert.equal(s.caseState.served[0].answer.value,value);
 assert.ok(r.answer.variantId);assert.ok(caseQuestionsUsed(s)<=2);assert.notEqual(s.pending?.question.id,q.id);
 const row=p.rowFor(r.answer.variantId).row,known=project(s,q.stageId);assert.ok(Object.entries(row.context).every(([k,v])=>v===null||known['dps.'+q.stageId+'.'+k]===v));
 assert.equal(s.factLedger.at(-1).source.questionId,q.id);
});
criterion('AC04','all eight service question producers and null outcomes',async tr=>{
 for(const entry of p.policy.serviceEntries.filter(e=>e.kind==='question')){
  const key=entry.id.slice('dps.dm.'.length),s=seed('protocol');
  if(['start','article_entry','fresh_no_history','stage_unclear','subject','actor_reference'].includes(key)){s.episodes[0].stageId=null;s.episodes[0].actor=null;s.episodes[0].dpsStageConfirmed=false}
  const f=await fixture(tr,{custom:target=>{
   target.episodes=s.episodes;target.activeEpisodeId=s.activeEpisodeId;
   const q={id:entry.id,text:entry.text,controls:key==='actor'?[{label:'Да',value:true},{label:'Нет',value:false},{label:'Не знаю',value:null}]:[]};
   target.pending={kind:'service',key,stageId:target.episodes[0].stageId,question:q};
   assert.ok(serveQuestion(target,target.pending,'synthetic-service','synthetic-prior-turn',{}));
  }});
  const r=await f.send('Не знаю'),state=await f.state();assert.equal(state.caseState.served[0].status,'answered');assert.ok(caseQuestionsUsed(state)<=2);assert.ok(r.answer.variantId||r.answer.next.length||r.dialogue.terminal);
 }
});
criterion('AC04','free service description leads to current compatible help',async tr=>{
 const f=await fixture(tr);let r=await f.resume();assert.equal(r.dialogue.questionId,'dps.dm.start');
 r=await f.send('Инспектор ДПС составляет мне протокол.');assert.ok(r.answer.variantId);assert.ok(caseQuestionsUsed(await f.state())<=2);
});
criterion('AC04','service producer known, outside and unrecognized closures',async tr=>{
 for(const entry of p.policy.serviceEntries.filter(e=>e.kind==='question'&&e.id!=='dps.dm.conflict'))for(const outcome of ['known','outside','unknown']){
  const key=entry.id.slice(7),q={id:entry.id,text:entry.text,controls:key==='actor'?[{label:'Да',value:true},{label:'Нет',value:false},{label:'Не знаю',value:null}]:[]};
  const f=await fixture(tr,{stage:key==='actor'?'protocol':null,custom:s=>{
   if(key==='actor')s.episodes[0].actor=null;
   s.pending={kind:'service',key,question:q,stageId:s.episodes[0].stageId};assert.ok(serveQuestion(s,s.pending,'prior','prior',{}));
  }});
  const r=key==='actor'?await f.pendingButton(outcome==='known'?true:outcome==='outside'?false:null):await f.send(outcome==='known'?'Инспектор ДПС составляет мне протокол.':outcome==='outside'?'Документ забрал сотрудник частной парковки, не Госавтоинспекции':'Непонятное сообщение');
  const s=await f.state();assert.equal(s.caseState.served[0].status,'answered');assert.ok(caseQuestionsUsed(s)<=2);
  if(outcome==='known')assert.ok(r.answer.variantId);else assert.ok(r.answer.variantId||r.answer.next.length||r.dialogue.terminal);
 }
 for(const answer of ['Исправление','Ситуация изменилась','Не знаю']){
  const fieldKey='dps.protocol.copy_received';const f=await fixture(tr,{stage:'protocol',facts:{[fieldKey]:true},custom:s=>{
   const conflict=recordFact(s,fieldKey,false,{kind:'accepted_fixture',turnId:'contradiction'});conflict.proposedValue=false;
   s.pending={kind:'service',key:'conflict',fieldKey,stageId:'protocol',question:{id:'dps.dm.conflict',text:'Вы исправляете прежний ответ или ситуация изменилась?',controls:[]}};
   assert.ok(serveQuestion(s,s.pending,'conflict-prior','prior',{}));
  }});
  await f.send(answer);const s=await f.state();assert.equal(project(s,'protocol')[fieldKey],answer==='Исправление'?false:null);assert.ok(s.factLedger.some(f=>f.value===true));
 }
});
criterion('AC05','service and NEXT share2, same case subject/stage changes do not reset',async tr=>{
 const f=await fixture(tr);await f.resume();await f.send('Инспектор ДПС составляет мне протокол; Я получил копию этого протокола');let s=await f.state();assert.equal(caseQuestionsUsed(s),2);
 if(s.pending)await f.pendingButton(null);
 const caseId=(await f.state()).caseState.id;
 for(const text of ['Инспектор ДПС вынес мне постановление.','Инспектор ДПС досматривает мой автомобиль.','Инспектор ДПС досматривает второй мой автомобиль.','Инспектор ДПС составляет мне другой протокол.']){
  const r=await f.send(text);s=await f.state();assert.equal(caseQuestionsUsed(s),2);assert.equal(s.caseState.id,caseId);assert.equal(r.answer.next.length,0);assert.doesNotMatch(r.answer.content,/(?:Можете описать|Опишите другую проблему)/u);
 }
 f.restart();await f.resume();assert.equal(caseQuestionsUsed(await f.state()),2);
});
criterion('AC06','document subjects restore histories and do not borrow fields',async tr=>{
 const f=await fixture(tr,{stage:'protocol',used:2,facts:{'dps.protocol.copy_received':true}}),before=await f.state();
 const first=subjectFor(before,'dps.protocol.copy_received');
 await f.send('Инспектор ДПС составляет мне второй протокол.');let s=await f.state();assert.equal(project(s,'protocol')['dps.protocol.copy_received'],undefined);assert.notEqual(subjectFor(s,'dps.protocol.copy_received'),first);
 await f.send('Я получил копию этого протокола');await f.send('Инспектор ДПС составляет мне первый протокол.');s=await f.state();assert.equal(subjectFor(s,'dps.protocol.copy_received'),first);assert.equal(project(s,'protocol')['dps.protocol.copy_received'],true);
 await f.send('Инспектор ДПС вынес мне постановление.');s=await f.state();assert.equal(project(s,'fine_resolution')['dps.fine_resolution.copy_received'],undefined);assert.equal(caseQuestionsUsed(s),2);
});
criterion('AC07','seven held fields reject assertion; masks cannot fill facts',async tr=>{
 const s=seed();for(const key of p.policy.blockedFields)assert.throws(()=>recordFact(s,key,true,{kind:'user_text',turnId:'fake',quote:'да'}),/INVALID_FACT/);
 tr.steps.push({held:p.policy.blockedFields,blockedVariants:p.blockedVariantIds});
 const f=await fixture(tr,{stage:'protocol',used:2});await f.send('Я не знаю, есть ли правовое основание.');assert.equal((await f.state()).factLedger.length,0);
});
for(const [key,pair]of Object.entries(observationLanguage))criterion('AC08',key+' bounded extraction matrix',async tr=>{
 const stage=key.split('.')[0],s=seed(stage),fieldKey='dps.'+key;
 const cases=[['positive',pair[0],true],['whole_denial',pair[1],false],['hypothesis','Если '+pair[0],undefined],['plan','Инспектор угрожает: '+pair[0],undefined],['foreign','У моего друга: '+pair[0],undefined],['article','В статье: '+pair[0],undefined],['missing','Мне неудобно говорить.',undefined],['ambiguous_pronoun','Он так сделал.',undefined],['correction','Я ошибся: '+pair[0],true],['conflicting_assertion',pair[1],false],['colloquial_unrecognized','Ну типа что-то такое случилось.',undefined]];
 for(const[family,text,want]of cases){const actual=interpretDps(s,text,'synthetic-'+family);const found=actual.facts.filter(f=>f.fieldKey===fieldKey);assert.deepEqual(found.map(f=>f.value),want===undefined?[]:[want]);tr.steps.push({family,text,expected:want===undefined?[]:[want],actual:found});}
 tr.notSupported=['arbitrary unambiguous pronouns outside closed grammar','unlisted colloquial/typo paraphrases'];
});
criterion('AC09','current document reports do not become other legal claims',async tr=>{
 for(const [stage,key,text]of [['fine_resolution','camera_fine',observationLanguage['fine_resolution.camera_fine'][0]],['alcohol_test','medical_exam_refused',observationLanguage['alcohol_test.medical_exam_refused'][0]]]){
  const s=seed(stage);const actual=interpretDps(s,text,'report');assert.deepEqual(actual.facts.map(f=>f.fieldKey),['dps.'+stage+'.'+key]);
  assert.deepEqual(interpretDps(s,'В статье: '+text,'quote').facts,[]);assert.deepEqual(interpretDps(s,'У моего друга: '+text,'foreign').facts,[]);tr.steps.push({text,actual});
 }
 assert.equal(interpretDps(seed('alcohol_test'),'Я отказался от медицинского освидетельствования','not-record').facts.length,0);
});
criterion('AC10','correction, conflict, later receipt and null preserve provenance',async tr=>{
 const f=await fixture(tr,{stage:'protocol',used:2,facts:{'dps.protocol.copy_refused':true,'dps.protocol.copy_received':false}});
 let r=await f.send('Позже я получил копию этого протокола');let s=await f.state();assert.equal(r.answer.variantId,'dps_protocol_v81');assert.equal(project(s,'protocol')['dps.protocol.copy_refused'],true);assert.ok(s.factLedger.some(f=>f.value===false&&f.status==='superseded'));
 await f.send('Я не получил копию этого протокола');s=await f.state();assert.equal(project(s,'protocol')['dps.protocol.copy_received'],null);assert.ok(s.factLedger.some(f=>f.status==='conflicted'));
 await f.send('Я ошибся: Я получил копию этого протокола');s=await f.state();assert.equal(project(s,'protocol')['dps.protocol.copy_received'],true);
 await f.send('Не знаю');assert.equal(project(await f.state(),'protocol')['dps.protocol.copy_received'],true);
});
criterion('AC11','specific OR and timing boundaries',async tr=>{
 const s=seed('vehicle_search');assert.deepEqual(interpretDps(s,'Инспектор не открывал отделения моего автомобиля','partial').facts,[]);
 assert.equal(interpretDps(s,'Инспектор сам передвигал вещи в моем автомобиле','or').facts[0].value,true);
 const t=seed('vehicle_detention');assert.deepEqual(interpretDps(t,'Мой автомобиль погрузили на эвакуатор','not-motion').facts,[]);
 tr.steps.push({partialOR:'no aggregate false',loading:'no movement fact'});
});
criterion('AC12','own ДТП needs no inspector; article is no fact source',async tr=>{
 const f=await fixture(tr);const r=await f.send('Я попал в ДТП, это мое ДТП.');assert.ok(r.answer.variantId?.startsWith('dps_accident_processing_'));assert.notEqual((await f.state()).pending?.key,'actor');
 const g=await fixture(tr);await g.resume({variantId:'dps_protocol_v83'});const s=await g.state();assert.equal(s.factLedger.length,0);assert.equal(s.pending.question.id,'dps.dm.article_entry');
});
criterion('AC13','known unknown no reask, decline and exact labels',async tr=>{
 const q=p.policy.questions.find(q=>q.fieldKey==='dps.protocol.copy_received');const f=await fixture(tr,{stage:'protocol',pending:q});await f.send(q.controls.find(c=>c.value===null).label);
 let s=await f.state();assert.equal(project(s,'protocol')[q.fieldKey],null);assert.notEqual(s.pending?.fieldKey,q.fieldKey);f.restart();await f.resume();s=await f.state();assert.notEqual(s.pending?.fieldKey,q.fieldKey);
 await f.send('Не задавайте вопросы');assert.equal((await f.state()).pending,null);
});
criterion('AC13','unparsed reply is absent; document and repeat are not answers',async tr=>{
 const q=p.policy.questions.find(q=>q.fieldKey==='dps.protocol.copy_received');
 const f=await fixture(tr,{stage:'protocol',pending:q});await f.send('Совсем непонятная деталь');let s=await f.state();
 assert.equal(Object.hasOwn(project(s,'protocol'),q.fieldKey),false);assert.equal(s.caseState.served[0].answer.disposition,'UNPARSED_NOT_A_FACT');assert.notEqual(s.pending?.question.id,q.id);
 const g=await fixture(tr,{stage:'protocol',pending:q});await g.send('Открой документ');s=await g.state();assert.equal(Object.hasOwn(project(s,'protocol'),q.fieldKey),false);assert.equal(s.pending?.question.id,q.id);
 await g.send('Покажи полную памятку');assert.equal((await g.state()).pending?.question.id,q.id);
});
criterion('AC14','outbox, replay, stale, foreign state, restart and ack',async tr=>{
 const f=await fixture(tr,{stage:'protocol'});await f.send('Что делать?',{},false);const old=await f.state();
 const replay=await f.retry();assert.equal(replay.turn.replayed,true);assert.equal(caseQuestionsUsed(await f.state()),caseQuestionsUsed(old));
 await assert.rejects(()=>f.send('Продолжим?'),/HISTORY_DELIVERY_PENDING/);await f.ack();
 await assert.rejects(()=>f.service().respond({...f.lastInput,turnId:Object.keys(old.turns)[0],question:'Changed replay'}),/TURN_ID_CONFLICT/);
 await assert.rejects(()=>f.send('Что делать?',{conversation:{sessionId:old.id,revision:0}}),/STALE_STATE/);
 const state=await f.state(),q=state.pending;
 if(q){await assert.rejects(()=>f.send('Да',{guided:{native:{kind:'answer',sessionId:state.id,nonce:'stale',revision:state.revision,episodeId:state.activeEpisodeId,roundId:state.round.id,questionId:q.question.id}}}),/STALE_ACTION/)}
 f.restart();const resumed=await f.resume();assert.equal(resumed.conversation.revision,state.revision);
 await f.mutate(s=>{s.userId='92'});await assert.rejects(()=>f.resume(),/INVALID_SAVED_STATE/);
});
criterion('AC14','legacy history cannot reopen budget or import document facts',async tr=>{
 const dir=await fs.mkdtemp(path.join(testRoot,'legacy-')),id=randomUUID(),userId='91';
 await atomic(path.join(dir,'explicit-sessions',identityKey(userId,id)+'.json'),{userId,chatId:id,history:[{fieldKey:'dps.protocol.copy_received',value:true,questionId:'old',revision:1}],presented:0});
 const options={dataDir:dir,getActive:async()=>({sha256:p.sourceSha256}),getBundle:async()=>p.bundle,dpsProfile:p};
 assert.throws(()=>createConversationService({...options,privateOnly:true}),/AMBIGUOUS_DPS_CONFIGURATION/);
 const service=createConversationService(options),r=await service.respond({id,userId,turnId:randomUUID(),question:'Инспектор ДПС составляет мне протокол.'});
 const s=JSON.parse(await fs.readFile(path.join(dir,'conversation-sessions-v2',identityKey(userId,id)+'.json'),'utf8'));
 assert.equal(caseQuestionsUsed(s),2);assert.equal(s.caseState.legacyHistoryComplete,false);assert.equal(s.factLedger.length,0);assert.equal(r.answer.next.length,0);assert.equal(r.answer.variantId,'dps_protocol_v77');tr.steps.push({response:r,state:snap(s)});
});
criterion('AC15','stop, no repeated help, no document actions or fake sends',async tr=>{
 const f=await fixture(tr,{stage:'protocol',used:2});await f.send('Что делать?');const r=await f.send('Что делать?');assert.equal(r.presentation.mode,'continuation');assert.ok(r.answer.content.length<500);assert.equal(r.answer.next.length,0);assert.deepEqual(r.answer.sections,undefined);
 const stopped=await f.send('Стоп');assert.equal(stopped.dialogue.terminal,'stop');assert.equal(stopped.answer.next.length,0);assert.doesNotMatch(stopped.answer.content,/\?/u);
});
const originalCases=JSON.parse(await fs.readFile(new URL('../../../../dialogue-generator/output/dps/phrases-20261023-v1/dialogue-cases.json',import.meta.url),'utf8'));
for(const original of originalCases.cases)criterion('AC17',original.id+' adapted existing expectation',async tr=>{
 tr.original=original;tr.originalSourceCategorySha256=originalCases.categorySha256;tr.currentSourceSha256=p.sourceSha256;
 const q=p.policy.questions.find(q=>q.fieldKey==='dps.protocol.copy_received');
 if(['D02','D03','D04'].includes(original.id)){
  const value=original.id==='D02'?true:original.id==='D03'?false:null;
  const target=original.id==='D04'?p.policy.questions.find(q=>q.fieldKey==='dps.protocol.copy_refused'):q;
  const f=await fixture(tr,{stage:'protocol',pending:target});await f.pendingButton(value);const facts=project(await f.state(),'protocol');
  assert.equal(facts[target.fieldKey],value);if(original.id==='D03')assert.notEqual(facts['dps.protocol.copy_refused'],true);return;
 }
 if(original.id==='D01'){const f=await fixture(tr);await f.resume({variantId:'dps_protocol_v83'});assert.equal((await f.state()).factLedger.length,0);assert.equal((await f.state()).pending.question.id,'dps.dm.article_entry');return}
 if(original.id==='D05'){const f=await fixture(tr,{stage:'protocol',used:2,facts:{'dps.protocol.copy_received':true}});await f.send(original.user);assert.equal(project(await f.state(),'protocol')['dps.protocol.copy_received'],false);return}
 if(original.id==='D06'){const f=await fixture(tr,{stage:'protocol',used:2,facts:{'dps.protocol.document_signed':true}});await f.send(original.user);const s=await f.state();assert.equal(project(s,'protocol')['dps.protocol.document_signed'],null);assert.equal(s.factLedger.at(-1).operation,'withdraw');return}
 if(original.id==='D07'){const f=await fixture(tr,{stage:'protocol',facts:{'dps.protocol.copy_received':true}});await f.send('Я не получил копию этого протокола');const s=await f.state();assert.equal(project(s,'protocol')['dps.protocol.copy_received'],null);assert.equal(s.pending?.key,'conflict');return}
 if(original.id==='D08'){const f=await fixture(tr,{stage:'protocol',used:2});await f.send(original.user);const facts=project(await f.state(),'protocol');assert.equal(facts['dps.protocol.copy_received'],true);assert.equal(facts['dps.protocol.copy_refused'],true);return}
 if(original.id==='D09'){const f=await fixture(tr,{stage:'protocol',used:2,facts:{'dps.protocol.document_signed':true}});await f.send(original.user);assert.equal(project(await f.state(),'protocol')['dps.protocol.document_signed'],undefined);return}
 if(original.id==='D10'){const f=await fixture(tr,{stage:'stop_reason',used:2,facts:{'dps.stop_reason.reason_initially_not_explained':true}}),before=await f.state();await f.send(original.user);const after=await f.state();assert.notEqual(after.caseState.id,before.caseState.id);assert.equal(Object.keys(project(after,'stop_reason')).length,0);return}
 if(original.id==='D11'){const f=await fixture(tr,{stage:'document_check'});await f.send(original.user);assert.equal((await f.state()).pending?.key,'actor_reference');return}
 if(['D12','D13','D14','D15'].includes(original.id)){const stage=original.id==='D13'?'stop_reason':original.id==='D14'?'alcohol_test':original.id==='D12'?'document_check':'protocol';const f=await fixture(tr,{stage,used:2});await f.send(original.user);const facts=project(await f.state(),stage);assert.notEqual(facts['dps.'+stage+'.'+(original.id==='D12'?'documents_later_returned':original.id==='D13'?'exit_demanded':original.id==='D14'?'medical_exam_requested':'copy_refused')],true);return}
 if(original.id==='D16'){const f=await fixture(tr,{stage:'document_check'});const r=await f.send(original.user);assert.equal(r.answer.variantId,undefined);return}
 if(['D17','D30','D31'].includes(original.id)){const f=await fixture(tr,{stage:'protocol',used:2});const r=await f.send('Что дальше?');assert.equal(r.answer.next.length,0);assert.equal(caseQuestionsUsed(await f.state()),2);return}
 if(original.id==='D18'){const f=await fixture(tr,{stage:'protocol',pending:q});await f.send('Я подписал этот протокол');const facts=project(await f.state(),'protocol');assert.equal(facts['dps.protocol.document_signed'],true);assert.equal(facts['dps.protocol.copy_received'],undefined);return}
 if(original.id==='D19'){const f=await fixture(tr,{stage:'protocol',pending:q}),s=await f.state();await assert.rejects(()=>f.send('Да',{guided:{native:{kind:'answer',sessionId:s.id,revision:s.revision,nonce:'old',episodeId:s.activeEpisodeId,roundId:s.round.id,questionId:q.id}}}),/STALE_ACTION/);assert.deepEqual((await f.state()).factLedger,s.factLedger);return}
 if(original.id==='D20'){const f=await fixture(tr,{stage:'protocol',used:2});await f.send('Что дальше?');const s=await f.state();await f.retry();assert.equal((await f.state()).revision,s.revision);return}
 if(original.id==='D21'){const f=await fixture(tr,{stage:'protocol'});await f.send('Что дальше?');const stale=f.response.conversation;await f.send('Не знаю');await assert.rejects(()=>f.send('Да',{conversation:stale}),/STALE_STATE/);return}
 if(original.id==='D22'){const f=await fixture(tr,{stage:'protocol',used:2});const r=await f.send('Что дальше?',{variantId:'dps_protocol_v83'});assert.equal(r.answer.variantId,'dps_protocol_v77');return}
 if(original.id==='D23'){const f=await fixture(tr,{stage:'protocol',used:2});const r=await f.send('Стоп');assert.equal(r.answer.next.length,0);assert.equal((await f.state()).factLedger.length,0);return}
 if(original.id==='D24'){const f=await fixture(tr,{stage:'protocol',used:2});const r=await f.send('Открой документ');assert.match(r.answer.content,/недоступ|не удалось/iu);assert.equal(r.answer.next.length,0);return}
 if(['D25','D26','D27'].includes(original.id)){tr.disposition='UNAVAILABLE_CAPABILITY_GUARD_TESTED_ORIGINAL_EXTERNAL_SUCCESS_NOT_RUN';for(const id of ['dps.dm.consent_offer','dps.dm.sent','dps.dm.withdrawn_consent'])assert.equal(p.serviceEvent(id,{confirmed:true,kind:'external_success'}),null);tr.steps.push({externalServices:'NOT_RUN',egress:false});return}
 if(original.id==='D28'){const f=await fixture(tr,{stage:'protocol'});await f.mutate(s=>{s.userId='92'});await assert.rejects(()=>f.resume(),/INVALID_SAVED_STATE/);await assert.rejects(()=>f.service().internal({id:f.id,userId:f.userId},'pending'),/INVALID_SAVED_STATE/);return}
 if(original.id==='D29'){const f=await fixture(tr,{stage:'protocol',pending:q});const before=await f.state();f.restart();await f.resume();assert.deepEqual((await f.state()).caseState.served,before.caseState.served);return}
 if(original.id==='D32'){const f=await fixture(tr,{stage:'protocol',used:2,facts:{'dps.protocol.copy_received':true}});await f.send('Не знаю');assert.equal(project(await f.state(),'protocol')['dps.protocol.copy_received'],true);return}
 throw Error('Unclassified seed '+original.id);
});
