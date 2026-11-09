import {p,prefix,fixture,check,assert,fs,currentEpisode} from './bailiffs-test-fixture.mjs';
const scopePhrases={document:'Обсуждаем документ по этому делу',territory:'Обсуждаем территорию моего проживания',payment:'Обсуждаем мою выплату по этому делу',delivery:'Обсуждаем получение этого извещения',request:'Обсуждаем моё заявление по этому делу',order:'Обсуждаем постановление по этому делу',act:'Обсуждаем судебный акт по этому долгу'};
const patterns={payment:'Обсуждаем мою выплату',request:'Обсуждаем моё заявление',order:'Обсуждаем постановление',act:'Обсуждаем судебный акт'};
const scoped=q=>[prefix(q.stageId),...(q.requiredScope||[]).filter(k=>!patterns[k]||!prefix(q.stageId).includes(patterns[k])).map(k=>scopePhrases[k])].join('; ');
for(const q of p.policy.predicates.filter(x=>!x.existingNext)){
 for(const[value,text]of[[true,q.positive],[false,q.negative],[null,q.unknown]])check('OWNER43-TFU-'+q.fieldKey+'-'+value,'existing field observation semantics, full provenance and no new NEXT',async tr=>{
  const f=await fixture(tr,{stage:q.stageId,used:2,start:false});await f.send(scoped(q)+'; '+text);
  const s=await f.state(),fact=p.known(s,q.fieldKey);assert.ok(fact,q.fieldKey);assert.equal(fact.value,value);assert.equal(f.response.answer.next.length,0);assert.equal(s.factLedger.at(-1).source.verified,false);assert.equal(s.factLedger.at(-1).source.quote,text);
  assert.equal(Array.from(s.factLedger.at(-1).source.message).slice(...s.factLedger.at(-1).source.span).join(''),text);
 });
 check('OWNER43-SPEECH-'+q.fieldKey,'gender, ordinary word order, sentence boundaries and help request',async tr=>{
  for(const text of q.positiveAliases){const f=await fixture(tr,{stage:q.stageId,used:2,start:false});await f.send(scoped(q)+'. '+text+'. Помогите пожалуйста.');assert.equal(p.known(await f.state(),q.fieldKey)?.value,true,text);}
  const f=await fixture(tr,{stage:q.stageId,used:2,start:false});await f.send(scoped(q)+'; '+q.positive.replace('Я получил','Я получила').replace('Я подал','Я подала'));assert.equal(p.known(await f.state(),q.fieldKey)?.value,true);
 });
 check('OWNER43-NEGATIVE-'+q.fieldKey,'nonasserted, foreign and partial meanings do not become facts',async tr=>{
  const f=await fixture(tr,{stage:q.stageId,used:2,start:false});await f.send(scoped(q));
  for(const text of ['Если '+q.positive,'Планирую; '+q.positive,'У друга '+q.positive,'«'+q.positive+'»',q.positive+'?','Это было в другом деле; '+q.positive,q.positive.slice(0,Math.floor(q.positive.length/2)),'Возможно; '+q.positive]){
   await f.send(text);assert.equal(p.known(await f.state(),q.fieldKey),null,text);assert.equal((await f.state()).factLedger.filter(x=>x.fieldKey===q.fieldKey).length,0);
  }
 });
 check('OWNER43-LIFE-'+q.fieldKey,'conflict, correction, unknown, withdrawal and changed entity preserve history',async tr=>{
  const f=await fixture(tr,{stage:q.stageId,used:2,start:false});await f.send(scoped(q)+'; '+q.positive);await f.send(q.negative);
  assert.equal((await f.state()).factLedger.at(-1).status,'conflicted');assert.equal(p.known(await f.state(),q.fieldKey),null);
  await f.send('Исправляю: '+q.negative);assert.equal(p.known(await f.state(),q.fieldKey).value,false);
  await f.send(q.unknown);assert.equal(p.known(await f.state(),q.fieldKey).value,false);
  await f.send('Отзываю: '+q.negative);assert.equal(p.known(await f.state(),q.fieldKey).value,null);
  await f.send('Это исполнительное производство Бета');assert.equal(p.known(await f.state(),q.fieldKey),null);assert.equal(f.response.presentation.questionsUsed,2);
 });
 if(q.requiredScope.some(k=>!patterns[k]||!prefix(q.stageId).includes(patterns[k])))check('OWNER43-SCOPE-'+q.fieldKey,'missing specifically referenced document/payment/event is not guessed',async tr=>{
  const f=await fixture(tr,{stage:q.stageId,used:2,reports:[q.positive]});assert.equal(p.known(await f.state(),q.fieldKey),null);
 });
}
check('OWNER43-PARTIAL-OR','negative one alternative does not negate the whole existing disjunction',async tr=>{
 for(const[stage,field,text]of[
  ['account_arrest','salary_or_pension_received_on_account','На этот счёт не поступает зарплата'],
  ['property_arrest','mortgage_record_available','У меня нет сведений о залоге этой вещи'],
  ['restrictions','installment_order_received','Я не получил акт об отсрочке исполнения по этому долгу'],
  ['wage_garnishment','disability_or_veteran_travel_compensation_reported','Это не компенсация проезда инвалида']
 ]){const q=p.policy.predicates.find(q=>q.stageId===stage&&q.fieldId===field),f=await fixture(tr,{stage,used:2,start:false});await f.send(scoped(q)+'; '+text);assert.equal(p.known(await f.state(),q.fieldKey),null);}
});

