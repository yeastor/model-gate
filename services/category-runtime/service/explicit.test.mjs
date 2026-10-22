import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateExplicitBundle, checkDocumentLinks, FORMAT } from './explicit/contract.mjs';
import { createExplicitEngine } from './explicit/engine.mjs';
import { validateSource } from './validate.mjs';
import { assertImportPolicy } from './storage.mjs';
import { checkCategory } from './check-category.mjs';

function fixture(category = 'test_category') {
  const b = { category: { id: category, name: 'Test' }, metadata: { format_version: FORMAT,
    status: 'test', example_only: true, coverage: 'selected_variants', assembled_on: '2026-10-20' }, subcategories: [] };
  const fullAnswer = { now: 'Useful current answer', steps: [], dont: [], say: [], where_to: [], laws: [] };
  for (let i = 0; i < 8; i++) {
    const stage = { id: 'stage_' + i, name: 'Stage ' + i };
    b.subcategories.push({ stage, context_fields: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }], variants: [{
      variant_id: 'base_' + i, context: { x: null, y: null }, question: 'Question ' + i,
      payload: { category: b.category, stage, answer: structuredClone(fullAnswer), next: [] } }] });
  }
  const s = b.subcategories[0];
  for (const [id, context] of [['yes_0', { x: true, y: null }], ['done_0', { x: true, y: true }]])
    s.variants.push({ ...structuredClone(s.variants[0]), variant_id: id, context });
  const answer = (value, label, target) => ({ value, label, go_to_variant: target });
  s.variants[0].payload.next = [{ id: 'q_x', question: 'X?', type: 'choice', field_key: 'x', data: [
    { value: true, label: 'Да', ask_next_question: { id: 'q_y', question: 'Y?', type: 'choice', field_key: 'y', data: [answer(true, 'Да', 'done_0'), answer(false, 'Нет', 'yes_0'), answer(null, 'Не знаю', 'yes_0')] } },
    answer(false, 'Нет', 'base_0'), answer(null, 'Не знаю', 'base_0')
  ] }];
  return b;
}
test('generic schema supports categories independently, no PPS/count assumptions', () => {
  for (const id of ['test_category', 'another_category']) assert.equal(validateExplicitBundle(fixture(id)).variants, 10);
});
test('five paths keep explicit targets and typed unknown', () => {
  for (const values of [[true,true], [true,false], [true,null], [false], [null]]) {
    const e = createExplicitEngine(fixture()); let s = e.start('base_0');
    for (const value of values) s = e.answer(s, value);
    assert.equal(s.current, values.length === 1 ? 'base_0' : values[1] === true ? 'done_0' : 'yes_0');
    assert.equal(s.pending, null); assert.equal(s.history.length, values.length);
    assert.equal(s.presented, values.length);
    assert.equal(s.facts['test_category.stage_0.x'], values[0]);
    if (values.length === 2) assert.equal(s.facts['test_category.stage_0.y'], values[1]);
    assert.throws(() => e.answer(s, true));
  }
});
test('missing is distinct from null and known values are never reasked', () => {
  const e=createExplicitEngine(fixture());
  for(const v of [true,false,null]) {
    let s=e.start('base_0');s=e.answer(s,v);const before=s.presented;
    if(v===true)s=e.answer(s,null);
    s=e.start('base_0',s);
    assert.equal(s.pending,null);assert.equal(s.facts['test_category.stage_0.x'],v);
    assert.equal(s.presented,v===true?2:before);
  }
  assert.equal(e.start('base_0').pending.question.id,'q_x');
});
test('unconfirmed target requirements HOLD, useful general answer remains', () => {
  const b=fixture(); const a=b.subcategories[0].variants[0].payload.next[0].data[0];
  delete a.ask_next_question; a.go_to_variant='done_0';
  const e=createExplicitEngine(b), s=e.answer(e.start('base_0'),true);
  assert.equal(s.status,'hold');assert.equal(s.attemptedTarget,'done_0');assert.equal(s.current,'base_0');
  assert.equal(Object.hasOwn(s.facts,'test_category.stage_0.y'),false);
});
test('article entry is not evidence for its context mask', () => {
  const e=createExplicitEngine(fixture()), s=e.start('done_0');
  assert.equal(s.status,'hold');assert.equal(s.current,'base_0');assert.deepEqual(s.facts,{});
});
test('question budget is checked before presentation across stage changes', () => {
  const b=fixture();
  for(const i of [1,2]) b.subcategories[i].variants[0].payload.next=[{id:'q_stage_'+i,question:'X?',type:'choice',field_key:'x',data:[true,false,null].map((v,j)=>({value:v,label:['Да','Нет','Не знаю'][j],go_to_variant:'base_'+i}))}];
  let e=createExplicitEngine(b), s=e.answer(e.answer(e.start('base_0'),true),true);
  s=e.start('base_1',s);assert.equal(s.pending,null);assert.equal(s.presented,2);assert.equal(s.status,'hold');
  b.metadata.next_policy={third_question_reasons:{q_stage_1:'Material missing circumstance',q_stage_2:'Another reason'}};
  e=createExplicitEngine(b);s=e.answer(e.answer(e.start('base_0'),true),true);
  s=e.start('base_1',s);assert.equal(s.presented,3);assert.ok(s.pending);
  s=e.answer(s,false);s=e.start('base_2',s);assert.equal(s.pending,null);assert.equal(s.presented,3);
});
test('caller mutations cannot change the verified graph', () => {
  const b=fixture(), e=createExplicitEngine(b);b.subcategories[0].variants[0].payload.next=[];
  assert.ok(e.start('base_0').pending);assert.throws(()=>{e.rowFor('base_0').row.context.x=true;});
});
test('malformed values, skipped targets, enum and embedded templates rejected', () => {
  const mutations=[
    b=>{b.document_templates=[];},b=>{b.metadata.document_fields=[];},b=>{b.metadata.hidden={body:'Template text'};},
    b=>{b.subcategories[0].variants[0].payload.next[0].data[0].value='passport';},
    b=>{b.subcategories[0].variants[0].payload.next[0].field_key=null;},
    b=>{b.subcategories[0].variants[0].payload.next[0].data[0].go_to_variant='done_0';},
    b=>{b.subcategories[0].variants[0].payload.next[0].data[1].go_to_variant='missing';},
    b=>{b.subcategories[0].variants[0].payload.next[0].data[1].go_to_variant='done_0';}
  ];
  for(const mutate of mutations){const b=fixture();mutate(b);assert.throws(()=>validateExplicitBundle(b));}
});
test('law fragments preserved while unsafe URLs rejected', () => {
  const b=fixture(), laws=b.subcategories[0].variants[0].payload.answer.laws;
  const law={ref:'Source',title:'Title',short:'Text',url:'/laws/koap-rf/st-27-7.html#ch-7'};
  laws.push(law);validateExplicitBundle(b);assert.equal(laws[0].url,law.url);
  for(const url of ['https://other.test/law.html','javascript:alert(1)','/laws/a.html#bad value','/laws/a.html\n']){laws[0].url=url;assert.throws(()=>validateExplicitBundle(b));}
});
test('document IDs resolve only in the external configured catalog', async () => {
  const b=fixture();b.subcategories[0].variants[0].payload.answer.where_to=[{title:'Doc',document_link_id:'link_one'}];
  const fetcher=async()=>({ok:true,json:async()=>({templates:[{id:'template_one',link_id:'link_one',name:'Doc'}],profile:{not_exported:true}})});
  assert.deepEqual(await checkDocumentLinks(b,fetcher),[{document_link_id:'link_one',generator_template_id:'template_one',title:'Doc'}]);
  await assert.rejects(checkDocumentLinks(b,async()=>({ok:true,json:async()=>({templates:[]})})));
});
test('examples cannot replace the default active collection', () => {
  assert.throws(()=>assertImportPolicy(fixture()));
  assert.throws(()=>assertImportPolicy(fixture(),{category:{id:'test_category'},variants:100}));
});
test('shared checker separates structure from active admin/form closure evidence', () => {
  const b=fixture();b.subcategories[0].variants[0].payload.answer.where_to=[{title:'Doc',document_link_id:'link_one'}];
  const staticOnly=checkCategory(b);assert.equal(staticOnly.structure.status,'PASS');assert.equal(staticOnly.document_evidence.status,'NOT_VERIFIED');
  const supplied=checkCategory(b,{catalog:[{document_link_id:'link_one',generator_template_id:'template_one',status:'active'}],forms:[{link_id:'link_one',template_id:'template_one',status:200}]});
  assert.equal(supplied.document_evidence.status,'PROVIDED_EVIDENCE_MATCHES');assert.equal(supplied.category_closed,false);
});
test('real approved file regression', {skip:!process.env.CATEGORY_V2_FIXTURE}, async () => {
  const text=await readFile(process.env.CATEGORY_V2_FIXTURE,'utf8');
  const {bundle,report}=validateSource(text);assert.equal(report.variants,13);assert.equal(report.document_templates,0);
  const e=createExplicitEngine(bundle);let s=e.start('pps_explanation_request_v49');
  s=e.answer(s,true);s=e.answer(s,null);assert.equal(s.current,'pps_explanation_request_v52');
  assert.equal(s.facts['pps.explanation_request.copy_requested_and_refused'],null);
});
