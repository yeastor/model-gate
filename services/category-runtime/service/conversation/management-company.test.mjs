import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {randomUUID}from'node:crypto';
import{createConversationService}from'./service.mjs';import{identityKey}from'./state.mjs';import{requestProfile}from'./request-profile.mjs';import{requestFacts}from'./focused-request.mjs';import{mcBundle}from'./management-company.mjs';
const root=new URL('../../../../../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u,'$1');
const output=process.env.MC_TEST_OUTPUT||root+'work/mc-category-integration-20261028-v1';
async function fixture(stage='reports'){const id=randomUUID(),dir=output+'/'+id,userId='81';await fs.mkdir(dir,{recursive:true});let service,response;const restart=()=>service=createConversationService({dataDir:dir,getActive:async()=>{throw Error('MC_MUST_NOT_FALL_THROUGH_TO_PPS')},getBundle:async()=>{throw Error('MC_MUST_NOT_LOAD_PPS')}});restart();const state=async()=>JSON.parse(await fs.readFile(dir+'/conversation-sessions-v2/'+identityKey(userId,id)+'.json','utf8'));return{id,userId,state,restart,get response(){return response},async send(question,extra={}){stage=extra.stageId||stage;response=await service.respond({id,userId,categoryId:'management_company',stageId:stage,turnId:randomUUID(),question,conversation:response?.conversation,...extra});if(response.turn)await service.internal({id,userId,turnId:response.turn.turnId},'ack');return response},async button(value){const b=response.answer.next.flatMap(q=>q.view).find(b=>b.guided.native.value===value);assert(b);return this.send(b.question,{guided:b.guided})},async resume(){response=await service.respond({id,userId,categoryId:'management_company',stageId:stage,resume:true});if(response._historyEnvelope)await service.internal({id,userId,turnId:response._historyEnvelope.turnId},'ack');return response},async facts(){return requestFacts(await state(),await requestProfile({categoryId:'management_company',stageId:stage},null))},async raw(input){return service.respond({id,userId,categoryId:'management_company',stageId:stage,...input})}}}
const current=s=>s.requestDialogue.cases.find(c=>c.id===s.requestDialogue.caseId);
const useful=(r,stage)=>{assert.equal(r.status,'answer');assert(r.answer.content.trim());assert(mcBundle.subcategories.find(s=>s.stage.id===stage).variants.some(v=>v.variant_id===r.answer.variantId));assert(r.answer.next.length<=1)};
test('mixed fact plus independent question preserves sent; interrogative sending does not',async()=>{for(const[text,want]of[['Я отправил запрос актов в УК. Что делать дальше?',true],['Я отправил запрос актов в УК?',undefined],['Если я отправил запрос актов, что делать?',undefined],['Сосед сказал: «Я отправил запрос актов». Что мне делать?',undefined]]){const f=await fixture();await f.send(text);assert.equal((await f.facts()).written_document_request_sent,want,text);if(want)assert.equal(f.response.answer.variantId,'management_company_reports_v08')}});
test('negated report is not a second positive request; acts specificity retained',async()=>{const f=await fixture();await f.send('Годовой отчёт мне не нужен, нужны акты ремонта за сентябрь');const facts=await f.facts();assert.equal(facts.management_or_work_documents_requested,true);assert.notEqual(facts.annual_report_requested,true);assert.equal(f.response.answer.variantId,'management_company_reports_v03');assert.match(f.response.answer.next[0].questionText,/Вы уже отправили/u)});
test('every stage: all three direct choices, bounded terminal help, disk resume',async()=>{for(const s of mcBundle.subcategories)for(const value of[true,false,null]){const stage=s.stage.id,f=await fixture(stage);await f.send(stage==='reports'?'Я просил акты ремонта за сентябрь в УК.':'Нужна помощь');useful(f.response,stage);for(let i=0;i<3;i++){if(f.response.answer.next.length)await f.button(value);else if((await f.state()).pending?.purpose==='manager_selection')await f.send('Не знаю');else break;useful(f.response,stage)}const before=await f.state();assert(current(before).used<=2);const facts=await f.facts();f.restart();await f.resume();assert.deepEqual(await f.facts(),facts);assert.equal(current(await f.state()).used,current(before).used);useful(f.response,stage);assert.equal(f.response.answer.next.length,0)}});
test('B03 licence is asked only for explicitly selected same named UK; TFU does not invent choice',async()=>{for(const value of[true,false,null]){const f=await fixture('change_uk');await f.send('В решении собственников указан выбор новой УК. Мы выбрали новую УК «Альфа».');assert.match(f.response.answer.next[0].questionText,/есть лицензия/u);await f.button(value);assert.equal((await f.facts()).licensed_new_uk_selected,value)}const f=await fixture('change_uk');await f.send('В решении собственников указан выбор новой УК.');assert.equal(f.response.answer.next.length,0);assert.match(f.response.answer.content,/Какую конкретную/u);await f.send('Новую УК не выбрали');assert.equal((await f.facts()).licensed_new_uk_selected,false);assert(!f.response.answer.next.some(q=>/лицензия/.test(q.questionText)))});
test('B03 licence for a different named manager cannot establish combined fact',async()=>{const f=await fixture('change_uk');await f.send('В решении собственников указан выбор новой УК. Мы выбрали новую УК «Альфа».');await f.send('УК «Бета» есть лицензия.');assert.equal((await f.facts()).licensed_new_uk_selected,undefined)});
test('urgent current safety is returned first without waiting for documents',async()=>{const f=await fixture('emergency_house_condition');await f.send('Сейчас есть непосредственная угроза жизни. Есть пострадавшие.');assert.equal((await f.facts()).immediate_danger_present,true);assert.equal((await f.facts()).people_injured_or_trapped,true);assert.equal(f.response.presentation.urgentPriority,true);assert.match(f.response.answer.content,/112/u);assert.equal(f.response.answer.next.length,0)});
test('stage switches share budget, segregate facts, and restore reports facts',async()=>{const f=await fixture();await f.send('Я отправил запрос актов.');const reportsFacts=await f.facts();const used=current(await f.state()).used;await f.send('Нужна помощь с дефектом',{stageId:'common_property'});assert.equal((await f.facts()).written_document_request_sent,undefined);assert(current(await f.state()).used>=used);await f.send('Вернёмся к запросу',{stageId:'reports'});assert.deepEqual(await f.facts(),reportsFacts);assert(current(await f.state()).used<=2)});
test('current stage correction/conflict and unknown preserve unrelated facts',async()=>{const f=await fixture('common_property');await f.send('Дефект зафиксирован. Сейчас есть непосредственная угроза жизни.');assert.equal((await f.facts()).defect_documented,true);await f.send('Исправляю: угрозы жизни нет.');assert.equal((await f.facts()).immediate_danger_present,false);assert.equal((await f.facts()).defect_documented,true);await f.send('Сейчас есть непосредственная угроза жизни.');assert.equal((await f.facts()).immediate_danger_present,undefined);assert.equal((await f.facts()).defect_documented,true)});
test('other stage controls reject stale concurrent and cross-user replies',async()=>{const f=await fixture('common_property');await f.send('Нужна помощь');const r=f.response,button=r.answer.next[0].view[0];const mk=()=>({turnId:randomUUID(),question:button.question,guided:button.guided,conversation:r.conversation});const pair=await Promise.allSettled([f.raw(mk()),f.raw(mk())]);assert.equal(pair.filter(x=>x.status==='fulfilled').length,1);assert.equal(pair.filter(x=>x.status==='rejected').length,1);await assert.rejects(()=>f.raw({...mk(),userId:'82'}),/STALE_ACTION/)});
test('source masks and guided context never seed generic facts',async()=>{const f=await fixture('change_uk');await f.send('Нужна помощь',{variantId:'management_company_change_uk_v64',guided:{categoryId:'management_company',stageId:'change_uk',context:{licensed_new_uk_selected:true}}});assert.deepEqual(await f.facts(),{});assert.equal(f.response.answer.variantId,'management_company_change_uk_v01')});

test('uncertain and past current-state assertions never become current facts',async()=>{
 for(const text of ['Не знаю, есть непосредственная угроза жизни.','Вчера была угроза жизни.','Наверное, есть пострадавшие.']){
 const f=await fixture('emergency_house_condition');await f.send(text);const facts=await f.facts();assert.notEqual(facts.immediate_danger_present,true);assert.notEqual(facts.people_injured_or_trapped,true);}
});
test('free category routing does not use neighbor or ambiguous retrieval as facts',async()=>{
 const {inferMCStage}=await import('./management-company.mjs');
 assert.equal(inferMCStage('УК отказывается дать акты ремонта за сентябрь'),'reports');
 assert.equal(inferMCStage('за сентяборь акты римонта от ук нужны'),'reports');
 assert.equal(inferMCStage('Сосед сверху затопил мою квартиру'),null);
 const p=await requestProfile({question:'Я отправил запрос актов в УК. Что делать дальше?'},null);assert.equal(p.stage.stage.id,'reports');
});
test('document offers use existing stable links and keep urgent ADS guards',async()=>{
 const f=await fixture();await f.send('Мне нужны акты ремонта за сентябрь');assert.match(f.response.answer.content,/\/documents\/link\/mc-/u);
 const urgent=await fixture('emergency_house_condition');await urgent.send('Сейчас есть непосредственная угроза жизни. Есть пострадавшие.');assert.doesNotMatch(urgent.response.answer.content,/\/documents\/link/u);
 const called112=await fixture('emergency_house_condition');await called112.send('Я уже позвонил в 112.');assert.doesNotMatch(called112.response.answer.content,/\/documents\/link/u);
});
test('resume into another stage cannot overwrite an undelivered history outbox',async()=>{
 const f=await fixture();const r=await f.raw({question:'Мне нужны акты ремонта',turnId:randomUUID()});assert(r.turn);
 await assert.rejects(()=>f.raw({stageId:'common_property',resume:true}),/HISTORY_DELIVERY_PENDING/);
 assert.equal((await f.state()).outbox.turnId,r.turn.turnId);
});

test('compound material fact cannot be disproved by denying only one component',async()=>{
 const f=await fixture('meetings_protocol');await f.send('Я не получил протокол собрания.');assert.notEqual((await f.facts()).protocol_or_vote_register_received,false);
 await f.send('Я не получил ни протокол, ни реестр голосов этого собрания.');assert.equal((await f.facts()).protocol_or_vote_register_received,false);
});
test('denied assertions do not become positive safety facts',async()=>{
 for(const text of ['Неправда, что есть пострадавшие.','Непосредственная угроза жизни не возникла.']){
 const f=await fixture('emergency_house_condition');await f.send(text);const facts=await f.facts();assert.notEqual(facts.immediate_danger_present,true);assert.notEqual(facts.people_injured_or_trapped,true);}
});

const extractionCases=JSON.parse(await fs.readFile(new URL('./policy/management-company-extraction-cases.json',import.meta.url),'utf8')).cases;
for(const c of extractionCases)test(c.id+' full factual meaning, complete negation, unknown and hypothesis',async()=>{
 for(const[text,expected]of[[c.yes,true],[c.no,false],['Не знаю, '+c.yes,undefined],['Если '+c.yes,undefined]]){
 const f=await fixture(c.stage);await f.send(text);assert.equal((await f.facts())[c.field],expected,text);}
});
test('no call to112 alone does not deny contacting all emergency services',async()=>{
 const f=await fixture('emergency_house_condition');await f.send('Я не звонил в112.');assert.notEqual((await f.facts()).emergency_service_contacted,false);
});

test('short explicit focus answer identifies document kind without inventing sending',async()=>{
 const f=await fixture();await f.send('Нужны годовой отчёт и акты ремонта.');await f.send('Акты ремонта за сентябрь в УК');
 assert.equal((await f.facts()).management_or_work_documents_requested,true);
 assert.equal((await f.facts()).written_document_request_sent,undefined);
 assert.equal(f.response.answer.variantId,'management_company_reports_v03');
 assert.equal(current(await f.state()).used,2);
});
