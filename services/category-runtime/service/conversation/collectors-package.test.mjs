import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createCollectorsProfile} from './collectors-profile.mjs';
import {interpretCollectors} from './collectors-interpret.mjs';
const p=createCollectorsProfile();
test('S01/S02 exact 13 components,23 rows,51 ordered fields,31 NEXT/93 branches',()=>{
 assert.equal(p.policy.components.length,13);assert.equal(p.bundle.subcategories.flatMap(s=>s.variants).length,23);assert.equal(p.policy.fields.length,51);assert.equal(p.questions.size,31);
 assert.equal([...p.questions.values()].reduce((n,q)=>n+q.data.length,0),93);
 const keys=p.bundle.subcategories.flatMap(s=>s.context_fields.map(f=>'collectors.'+s.stage.id+'.'+f.id));assert.deepEqual(p.policy.fields.map(f=>f.field_key),keys);
 for(const s of p.bundle.subcategories)for(const v of s.variants)assert.deepEqual(Object.keys(v.context),s.context_fields.map(f=>f.id));
});
test('S03 exact policy pin, source pin and no default activation',()=>{
 assert.equal(p.policy.defaultActivation,false);assert.equal(p.policy.maxQuestionsPerCase,2);assert.deepEqual(p.policy.thirdQuestionReasons,{});
 const b=fs.readFileSync(new URL('./policy/collectors.v1.json',import.meta.url));const altered=JSON.parse(b);altered.maxQuestionsPerCase=3;assert.throws(()=>createCollectorsProfile({policyBytes:Buffer.from(JSON.stringify(altered))}),/COL_POLICY_PIN/);
 const q=p.policy.components[0];assert.throws(()=>createCollectorsProfile({componentBytes:{[q.path]:Buffer.from('{}')}}),/COL_COMPONENT_PIN/);assert.throws(()=>p.validate(p.bundle,'0'.repeat(64)),/COL_SOURCE_VERSION/);
});
for(const f of p.policy.fields.filter(f=>f.classification==='EXISTING_NEXT_OBSERVATION')){
 const literals=p.policy.literals[f.field_id];
 for(const [name,value]of [['positive',true],['negative',false],['unknown',null]])test('extract '+f.field_key+' '+name,()=>{
  const text=literals[name][0],x=interpretCollectors(text,'synthetic',p.policy,f.stage_id);assert.equal(x.observations.length,1);assert.equal(x.observations[0].value,value);assert.equal(x.observations[0].fieldKey,f.field_key);assert.equal(Array.from(text).slice(...x.observations[0].source.span).join(''),x.observations[0].source.quote);
 });
 test('minimal pairs and ambiguity '+f.field_key,()=>{
  for(const text of ['Это было в кино; '+literals.positive[0],'Не знаю; '+literals.positive[0],'Сосед говорит; '+literals.positive[0],'Если '+literals.positive[0],'У друга '+literals.positive[0],'Возможно, '+literals.positive[0],'Он '+literals.positive[0],'Вчера '+literals.positive[0],'«'+literals.positive[0]+'»',literals.positive[0]+'?','x'+literals.positive[0],literals.positive[0]+'x','Мне нужен совет'])assert.deepEqual(interpretCollectors(text,'synthetic',p.policy,f.stage_id).observations,[],text);
  assert.equal(interpretCollectors('Исправляю: '+literals.negative[0],'synthetic',p.policy,f.stage_id).observations[0].operation,'correct');
  assert.equal(interpretCollectors('Отзываю: '+literals.positive[0],'synthetic',p.policy,f.stage_id).observations[0].operation,'withdraw');
 });
}
test('F09/F10/F12 all42 fields withheld; masks/names/log counts are not facts',()=>{
 assert.equal(p.policy.fields.filter(f=>f.classification!=='EXISTING_NEXT_OBSERVATION').length,42);assert.equal(p.policy.withheldVariants.length,6);
 for(const text of ['Мне звонят 20 раз, значит лимит превышен','Он назвал имя и код, значит личность установлена','Я недавно получил этот номер','Мой собственный долг погашен','Займ могли оформить на мои данные','Да','Не знаю'])assert.deepEqual(interpretCollectors(text,'synthetic',p.policy,'calls_messages').observations,[]);
});
