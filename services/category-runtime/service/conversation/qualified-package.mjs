import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createExplicitEngine } from '../explicit/engine.mjs';
import { validateQuestionDefinition } from './questions.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { status: 409 }); };
const loaded = new WeakSet();
export const isQualifiedPackage = value => loaded.has(value);
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export async function readPinned(pin) {
  if (!pin || !Number.isInteger(pin.bytes) || !/^[0-9a-f]{64}$/.test(pin.sha256 ?? '') || typeof pin.path !== 'string') fail('INVALID_PACKAGE_PIN');
  const bytes = await fs.readFile(pin.path);
  if (bytes.length !== pin.bytes || digest(bytes) !== pin.sha256) fail('PACKAGE_PIN_MISMATCH');
  return JSON.parse(bytes.toString('utf8'));
}
// Explicit file pins only. No active alias, dynamic require, remote producer or implicit deployment.
export async function loadQualifiedPackage(packagePin) {
  const policy = await readPinned(packagePin);
  if (policy.schemaVersion !== 'qualified-dialogue/v1' || policy.maxQuestions !== 2
    || policy.activationStatus !== 'PRIVATE_OPT_IN_ONLY' || policy.documentProducer !== 'NOT_SUPPORTED'
    || policy.publicContextExtensions?.length !== 0 || policy.supplementalEnabled?.length !== 0
    || policy.routingEnabled?.length !== 0 || policy.projectionVersion !== 'children-qualified/v1'
    || policy.categoryId !== 'children_alimony') fail('UNSUPPORTED_DIALOGUE_POLICY');
  const requiredGates = {
    'children_alimony.guardianship.child_removal_act_received':'official-removal-act/v1',
    'children_alimony.alimony_debt.debt_calculation_disputed':'official-bailiff-calculation/v1',
    'children_alimony.travel_consent.own_exit_objection_withdrawal_requested':'own-prior-filing-and-present-intent/v1',
  };
  if (!policy.qualified || Object.keys(policy.qualified).length!==Object.keys(requiredGates).length
    || Object.entries(requiredGates).some(([key,value])=>policy.qualified[key]!==value)
    || !Array.isArray(policy.intents) || new Set(policy.intents.map(i=>i.fieldKey)).size!==policy.intents.length
    || policy.intents.some(i=>(requiredGates[i.fieldKey]??null)!==i.gate)) fail('GATE_CONTRACT_MISMATCH');
  const bundle = await readPinned(policy.category), catalog = await readPinned(policy.catalog);
  const engine = createExplicitEngine(bundle);
  if (bundle.category.id !== policy.categoryId || !policy.dialoguePackageVersion) fail('CATEGORY_VERSION_MISMATCH');
  const fields = bundle.subcategories.flatMap(s => s.context_fields.map(f => `${policy.categoryId}.${s.stage.id}.${f.id}`));
  if (fields.length !== policy.fields.length || new Set(policy.fields.map(f=>f.key)).size !== fields.length
      || policy.fields.some(f=>!fields.includes(f.key))) fail('FIELD_COVERAGE_MISMATCH');
  const nodes = new Map();
  if (new Set(catalog.questions.map(q=>q.id)).size!==catalog.questions.length) fail('CATALOG_DUPLICATE_QUESTION');
  for(const stage of bundle.subcategories) {
    if(stage.variants.filter(r=>Object.values(r.context).every(v=>v===null)).length!==1) fail('UNIQUE_GENERAL_ENTRY_REQUIRED');
  }
  for (const s of bundle.subcategories) for (const r of s.variants) {
    const walk = q => {
      if (nodes.has(q.id)) fail('DUPLICATE_GLOBAL_QUESTION');
      nodes.set(q.id, q);
      const intent = policy.intents.find(i=>i.stageId===s.stage.id && i.fieldKey===`${policy.categoryId}.${s.stage.id}.${q.field_key}`);
      if (!intent || intent.question!==q.question) fail('QUESTION_POLICY_MISMATCH');
      const mirror = catalog.questions.find(n=>n.id===q.id);
      if (!mirror || mirror.question!==q.question || mirror.stage_id!==s.stage.id || mirror.field_key!==q.field_key
          || mirror.branches.length!==3) fail('CATALOG_MIRROR_MISMATCH');
      validateQuestionDefinition({id:q.id,operation:'fact',fieldKey:intent.fieldKey,
        branches:q.data.map(a=>({value:a.value,kind:a.go_to_variant?'variant':'stage',
          variantId:a.go_to_variant,stageId:s.stage.id,nextQuestionId:a.ask_next_question?.id}))},engine);
      for (const a of q.data) {
        const b=mirror.branches.find(b=>b.value===a.value);
        if (!b || b.label!==a.label || b.go_to_variant!==a.go_to_variant
          || b.ask_next_question_id!==a.ask_next_question?.id) fail('CATALOG_EDGE_MISMATCH');
        if (a.ask_next_question) walk(a.ask_next_question);
      }
    };
    r.payload.next.forEach(walk);
    if (!engine.entryFor(s.stage.id)) fail('GENERAL_ENTRY_REQUIRED');
  }
  if (catalog.questions.length!==nodes.size) fail('CATALOG_EXTRA_QUESTIONS');
  validateQuestionDefinition({id:'private-own-prior-filing-v1',operation:'private_observation',
    branches:[true,false,null].map(value=>({value,kind:'scope',reason:'Only prior self-filing observation; current intent and document validity are separate.'}))},engine);
  const urgentRow=bundle.subcategories.find(s=>s.stage.id==='child_residence')?.variants
    .find(r=>r.variant_id==='children_alimony_child_residence_private_g4_20261016_v06');
  const urgentText=urgentRow?.payload.answer.now.split(/(?<=\.)\s+/u).slice(0,4).join(' ');
  if (!urgentRow || urgentRow.context.immediate_child_safety_risk_present!==true
    || Object.entries(urgentRow.context).some(([k,v])=>k!=='immediate_child_safety_risk_present' && v!==null)
    || digest(urgentText)!=='490798be031a72890e00069ed48c0be2e650f9606ca1846d6ea800d2500aaf44') fail('URGENT_SOURCE_PIN_MISMATCH');
  const urgentHelp={text:urgentText,sourceVariantId:urgentRow.variant_id,
    sourcePointer:'/subcategories/0/variants/5/payload/answer/now',sha256:digest(urgentText),
    scope:'Exact first four sentences of approved current-danger answer; not a variant selection or new legal composition.'};
  const value = freeze({policy,bundle,urgentHelp,packagePin:structuredClone(packagePin),tuple:{
    categoryId:policy.categoryId,categorySha256:policy.category.sha256,
    dialoguePackageVersion:policy.dialoguePackageVersion,projectionVersion:policy.projectionVersion,
    packageSha256:packagePin.sha256,
  }});
  loaded.add(value);
  return value;
}
