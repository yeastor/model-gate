// Documentation example only. The live service does not import this file.
// Run: node docs/examples/pps-dialogue-next.example.mjs <pps.final.json>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createExplicitEngine } from '../../services/category-runtime/service/explicit/engine.mjs';

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Pass the sealed pps.final.json path.');
const bytes = fs.readFileSync(sourcePath);
const categorySha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(categorySha256, '1f3d30732d4c00d77bbb5c63b715bdddfe97e5ecaed92bb764706541c2bd26af');
const bundle = JSON.parse(bytes);
const before = JSON.stringify(bundle);
const engine = createExplicitEngine(bundle);

// Proposed external configuration, NOT a change to variant.payload.next.
// Targets are copied from the existing injuries question in the sealed category.
const question = {
  id: 'dm.pps.use_of_force.injuries.v1',
  purpose: 'context',
  categoryId: 'pps',
  stageId: 'use_of_force',
  categorySha256,
  requires: { force_actually_used: true },
  sourceQuestionId: 'pps_use_of_force_pps_use_of_force_v33_t_2_injuries_present',
  type: 'choice',
  question: 'После применения силы у вас есть травмы?',
  field_key: 'injuries_present',
  data: [
    { value: true, label: 'Да', go_to_variant: 'pps_use_of_force_v51' },
    { value: false, label: 'Нет', go_to_variant: 'pps_use_of_force_v34' },
    { value: null, label: 'Не знаю', go_to_variant: 'pps_use_of_force_v34' },
  ],
};

const stage = bundle.subcategories.find(s => s.stage.id === question.stageId);
assert.ok(stage.context_fields.some(f => f.id === question.field_key));
function findQuestion(questions, id) {
  for (const q of questions) {
    if (q.id === id) return q;
    const child = findQuestion(q.data.flatMap(a => a.ask_next_question ? [a.ask_next_question] : []), id);
    if (child) return child;
  }
}
const original = findQuestion(stage.variants.flatMap(v => v.payload.next), question.sourceQuestionId);
assert.ok(original);
assert.equal(original.field_key, question.field_key);
assert.deepEqual(question.data, original.data);

const key = field => 'pps.' + question.stageId + '.' + field;
const forceKey = key('force_actually_used');
const injuriesKey = key('injuries_present');

// Only demonstrates applying a bound question and checking its target.
// Production also needs the fact journal, actor/episode/subject checks,
// conflicts/corrections, question budget, revision/nonce checks and persistence.
function applyQuestion({ facts, value, lastVariantId = null }) {
  assert.ok([true, false, null].includes(value), 'Invalid choice value.');
  for (const [field, required] of Object.entries(question.requires)) {
    assert.equal(facts[key(field)], required, 'Question prerequisite is not confirmed.');
  }
  assert.ok(!Object.hasOwn(facts, injuriesKey), 'Known or already asked field: do not overwrite it.');
  const updatedFacts = { ...facts, [injuriesKey]: value };
  const branch = question.data.find(a => a.value === value);
  if (!engine.compatible(branch.go_to_variant, updatedFacts)) {
    return { kind: 'hold', reason: 'Target requires unconfirmed facts.', facts: updatedFacts };
  }
  return {
    kind: branch.go_to_variant === lastVariantId ? 'continuation' : 'full',
    variantId: branch.go_to_variant,
    facts: updatedFacts,
  };
}

// Existing NEXT automatically skips the force question when force is known.
const existing = engine.start(engine.entryFor('use_of_force'), {
  facts: { [forceKey]: true }, history: [], presented: 0, revision: 0, askedQuestionIds: [],
});
assert.equal(existing.pending.question.field_key, 'injuries_present');

const results = question.data.map(branch => {
  const result = applyQuestion({
    facts: { [forceKey]: true },
    value: branch.value,
    lastVariantId: 'pps_use_of_force_v34',
  });
  assert.equal(result.variantId, branch.go_to_variant);
  assert.equal(result.facts[injuriesKey], branch.value);
  return { answer: branch.label, value: branch.value, variantId: result.variantId, presentation: result.kind };
});
assert.equal(results[0].presentation, 'full');
assert.equal(results[1].presentation, 'continuation');
assert.equal(results[2].presentation, 'continuation');
// Unknown and No can lead to the same general answer but remain different facts.
assert.notEqual(results[1].value, results[2].value);
assert.throws(() => applyQuestion({ facts: {}, value: true }));
assert.throws(() => applyQuestion({ facts: { [forceKey]: false }, value: true }));
assert.throws(() => applyQuestion({ facts: { [forceKey]: true, [injuriesKey]: true }, value: null }));
assert.throws(() => applyQuestion({ facts: { [forceKey]: true }, value: 'yes' }));
assert.equal(engine.compatible('pps_use_of_force_v51', { [forceKey]: true }), false);
assert.equal(engine.compatible('pps_use_of_force_v51', { [forceKey]: true, [injuriesKey]: false }), false);
assert.equal(JSON.stringify(bundle), before, 'Source category must remain unchanged.');

console.log(JSON.stringify({
  status: 'PASS',
  mode: 'documentation-example-not-loaded-by-runtime',
  categorySha256,
  question,
  results,
}, null, 2));

