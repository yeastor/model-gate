import { createHash } from 'node:crypto'
import schema from '../contracts/category-bundle.schema.json' with { type: 'json' }
import { compileSchema } from './schema-validation.mjs'
import { createNextBlock, applyNextAnswer, retryUnknownAnswer, NEXT_INTERACTION_POLICY } from '../native/interaction.mjs'

export const FORMAT_VERSION = 'category-bundle/v1'
export const validateBundleSchema = compileSchema(schema)
export const canonicalJson = x => JSON.stringify(sortKeys(x))
function sortKeys(x) {
  return Array.isArray(x) ? x.map(sortKeys) : x !== null && typeof x === 'object'
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sortKeys(x[k])])) : x
}
export const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex')
export const jsonHash = x => bytesHash(Buffer.from(canonicalJson(x), 'utf8'))
export const same = (a, b) => canonicalJson(a) === canonicalJson(b)
export const serialize = x => JSON.stringify(x, null, 2) + '\n'
const clone = structuredClone
export class BundleBlocked extends Error {
  constructor(issues) { super('CATEGORY_BUNDLE_BLOCK'); this.code = 'CATEGORY_BUNDLE_BLOCK'; this.report = { status: 'BLOCK', category_ready: false, issues } }
}
export const requireThat = (ok, code, detail = {}) => { if (!ok) throw new BundleBlocked([{ code, ...detail }]) }
const useful = request => request?.questions?.some(q => q.answers.length > 0)
const fieldsFor = (categoryId, stage) => stage.context_fields.map(f => `${categoryId}.${stage.stage.id}.${f.id}`)
const toQuestion = ({ field_key, question_text, answers, uncertainty_kind, requires }) => ({
  field_key, question_text, answers: clone(answers), ...(uncertainty_kind ? { uncertainty_kind } : {}), ...(requires ? { requires: clone(requires) } : {}),
})
export function bundleContentHash(bundle) {
  const content = clone(bundle)
  delete content.metadata.bundle.integrity.content_sha256
  return jsonHash(content)
}
export function sealBundle(bundle) {
  bundle.metadata.bundle.integrity = { algorithm: 'sha256/canonical-json-v1' }
  bundle.metadata.bundle.integrity.content_sha256 = bundleContentHash(bundle)
  return bundle
}

// Only after every canonical stage has an explicit, content-bound local closure
// does the same assembly call embed NEXT + documents and produce a ready bundle.
export function assembleCategoryBundle(input) {
  requireThat(input?.schema === 'category-bundle-assembly-input/v1', 'ASSEMBLY_INPUT_VERSION_REQUIRED')
  const source = input.category, issues = [], expected = input.canonical_stages.map(s => s.stage_id)
  const stages = source.subcategories, ids = stages.map(s => s.stage.id)
  const add = (code, detail = {}) => issues.push({ code, ...detail })
  if (new Set(expected).size !== expected.length || !expected.length) add('CANONICAL_STAGE_CONTRACT_INVALID')
  for (const id of expected) if (!ids.includes(id)) add('MISSING_STAGE', { stage_id: id })
  for (const id of ids) if (!expected.includes(id)) add('UNEXPECTED_STAGE', { stage_id: id })
  if (!same(ids, expected)) add('STAGE_ORDER_OR_SET_MISMATCH', { expected, actual: ids })
  if (input.stage_closures.length !== expected.length) add('CLOSURE_SET_MISMATCH')
  if (!same(input.stage_closures.map(c => c.stage_id), expected)) add('CLOSURE_ORDER_OR_SET_MISMATCH')
  const evidenceNames = new Set(input.evidence.map(p => p.name))
  const catalog = input.next_catalog.stages
  if (!same(catalog.map(s => s.stage_key), expected.map(id => `${source.category.id}.${id}`))) add('NEXT_CATALOG_STAGE_SET_MISMATCH')
  for (const canonical of input.canonical_stages) {
    const matches = stages.filter(s => s.stage.id === canonical.stage_id)
    if (matches.length !== 1) continue
    const stage = matches[0], closure = input.stage_closures.filter(c => c.stage_id === canonical.stage_id)
    if (closure.length !== 1 || closure[0].status !== 'CLOSED_LOCAL_WITH_LIMITS') { add('UNCLOSED_STAGE', { stage_id: canonical.stage_id }); continue }
    const c = closure[0]
    if (c.source_stage_sha256 !== jsonHash(stage)) add('CLOSURE_CONTENT_MISMATCH', { stage_id: c.stage_id })
    if (!same(c.variant_ids, stage.variants.map(v => v.variant_id)) || !c.variant_ids.length) add('CLOSURE_VARIANTS_MISMATCH', { stage_id: c.stage_id })
    if (!same(stage.context_fields, canonical.context_fields)) add('CANONICAL_CONTEXT_FIELDS_MISMATCH', { stage_id: c.stage_id })
    if (!same(c.required_module_ids, canonical.required_module_ids) || !c.required_module_ids.length) add('CLOSURE_MODULES_MISMATCH', { stage_id: c.stage_id })
    if (!c.evidence_names.length || c.evidence_names.some(name => !evidenceNames.has(name))) add('CLOSURE_EVIDENCE_MISSING', { stage_id: c.stage_id })
  }
  if (issues.length) throw new BundleBlocked(issues)
  requireThat(same(input.next_policy, NEXT_INTERACTION_POLICY), 'UNSUPPORTED_NEXT_POLICY')
  const bundle = clone(source)
  const closures = []
  for (const [si, stage] of bundle.subcategories.entries()) {
    const stageKey = `${bundle.category.id}.${stage.stage.id}`, authored = catalog[si]
    const included = authored.questions.map(q => q.field_key)
    const omitted = input.omitted_next_fields.filter(f => f.field_key.startsWith(stageKey + '.')).map(f => f.field_key)
    const canonicalFields = fieldsFor(bundle.category.id, stage)
    requireThat(new Set([...included, ...omitted]).size === included.length + omitted.length
      && same([...included, ...omitted].sort(), [...canonicalFields].sort()), 'NEXT_FIELD_COVERAGE_MISMATCH', { stage_id: stage.stage.id })
    for (const [ri, row] of stage.variants.entries()) {
      const questions = authored.questions.map(toQuestion)
      const previous = row.payload.next
      requireThat(previous === null || Array.isArray(previous) || previous?.schema === 'next-interaction-request/v1', 'LEGACY_NEXT_NEEDS_EXPLICIT_ADAPTER')
      requireThat(!Array.isArray(previous) || previous.length <= 1, 'LEGACY_NEXT_NEEDS_EXPLICIT_ADAPTER')
      const embedded = Array.isArray(previous) ? previous[0] : previous
      if (embedded) requireThat(embedded.schema === 'next-interaction-request/v1' && same(embedded.questions, questions), 'EXISTING_NEXT_CATALOG_MISMATCH', { variant_id: row.variant_id })
      const request = embedded ?? {
        schema: 'next-interaction-request/v1', stage_key: stageKey, questions, facts: {}, history: [],
        source_binding: { candidate_sha256: input.source_pin.sha256, source_pointer: `/subcategories/${si}/variants/${ri}`, source_key: row.variant_id },
      }
      row.payload.next = useful(request) ? clone(request) : null
    }
    closures.push({
      ...clone(input.stage_closures[si]), bundle_stage_sha256: jsonHash(stage),
      context_field_ids: stage.context_fields.map(f => f.id),
    })
  }
  // Include only referenced templates. Never resurrect a document removed by
  // editorial review merely because it is available on disk.
  const used = new Set(stages.flatMap(s => s.variants.flatMap(v => v.payload.answer.where_to.map(d => d.document_link_id))))
  const templates = new Map()
  for (const entry of input.document_templates) {
    const id = entry.template.link_id
    if (!used.has(id)) continue
    if (templates.has(id) && !same(templates.get(id), entry)) add('CONFLICTING_DOCUMENT_TEMPLATE', { link_id: id })
    else templates.set(id, entry)
  }
  for (const link_id of used) if (!templates.has(link_id)) add('MISSING_DOCUMENT_TEMPLATE', { link_id })
  if (issues.length) throw new BundleBlocked(issues)
  bundle.document_templates = [...used].map(id => clone(templates.get(id).template))
  bundle.metadata.format_version = FORMAT_VERSION
  bundle.metadata.bundle = {
    schema: 'category-bundle-assembly/v1', adapter_id: input.adapter_id, built_on: input.built_on,
    readiness: 'LOCAL_INTEGRATION_READY_WITH_LIMITS', source: clone(input.source_pin), canonical_stage_ids: expected,
    stage_closures: closures, evidence: clone(input.evidence), next_policy: clone(input.next_policy),
    category_max_pairs: input.category_max_pairs, omitted_next_fields: clone(input.omitted_next_fields),
    template_manifest: [...used].map(id => ({ link_id: id, content_sha256: jsonHash(templates.get(id).template), source: clone(templates.get(id).source) })),
    limitations: clone(input.limitations),
    gates: { final_lawyer_approval: false, production: false, publication: false, cms: false, registry_mutation: false, historical_source_mutation: false },
  }
  sealBundle(bundle)
  validateCategoryBundle(bundle)
  return bundle
}

export function validateCategoryBundle(bundle) {
  const structural = validateBundleSchema(bundle)
  requireThat(structural.valid, 'JSON_SCHEMA', { findings: structural.errors })
  const meta = bundle.metadata.bundle, issues = [], add = (code, detail = {}) => issues.push({ code, ...detail })
  if (meta.integrity.content_sha256 !== bundleContentHash(bundle)) add('BUNDLE_CONTENT_HASH_MISMATCH')
  if (!same(meta.next_policy, NEXT_INTERACTION_POLICY)) add('UNSUPPORTED_NEXT_POLICY')
  if (bundle.category.id === 'pps' && meta.category_max_pairs !== 2) add('PPS_MAX_TWO_PAIRS')
  if (!same(bundle.subcategories.map(s => s.stage.id), meta.canonical_stage_ids)
    || !same(meta.stage_closures.map(c => c.stage_id), meta.canonical_stage_ids)) add('CANONICAL_STAGE_SET_MISMATCH')
  const ids = new Set(), references = new Map(), evidenceNames = new Set(meta.evidence.map(e => e.name))
  let nextCount = 0, lawUses = 0
  const laws = new Set()
  for (const [si, stage] of bundle.subcategories.entries()) {
    const closure = meta.stage_closures[si], fields = stage.context_fields.map(f => f.id)
    if (!closure || closure.bundle_stage_sha256 !== jsonHash(stage)) add('STAGE_CONTENT_HASH_MISMATCH', { stage_id: stage.stage.id })
    if (!closure || !same(closure.variant_ids, stage.variants.map(v => v.variant_id)) || !same(closure.context_field_ids, fields)) add('STAGE_IDENTITY_MISMATCH', { stage_id: stage.stage.id })
    if (closure?.evidence_names.some(name => !evidenceNames.has(name))) add('CLOSURE_EVIDENCE_MISSING', { stage_id: stage.stage.id })
    if (new Set(fields).size !== fields.length) add('DUPLICATE_CONTEXT_FIELD', { stage_id: stage.stage.id })
    const masks = new Set()
    for (const [ri, row] of stage.variants.entries()) {
      if (ids.has(row.variant_id)) add('DUPLICATE_VARIANT_ID', { variant_id: row.variant_id }); ids.add(row.variant_id)
      if (!same(row.payload.category, bundle.category) || !same(row.payload.stage, stage.stage)) add('PAYLOAD_IDENTITY_MISMATCH', { variant_id: row.variant_id })
      if (!same(Object.keys(row.context), fields)) add('CONTEXT_ORDER_OR_FIELDS_MISMATCH', { variant_id: row.variant_id })
      const mask = canonicalJson(row.context)
      if (masks.has(mask)) add('DUPLICATE_CONTEXT', { variant_id: row.variant_id }); masks.add(mask)
      const rowDocs = new Set()
      for (const doc of row.payload.answer.where_to) {
        if (rowDocs.has(doc.document_link_id)) add('DUPLICATE_DOCUMENT_REF', { variant_id: row.variant_id, link_id: doc.document_link_id })
        rowDocs.add(doc.document_link_id)
        references.set(doc.document_link_id, (references.get(doc.document_link_id) ?? 0) + 1)
      }
      for (const law of row.payload.answer.laws) { lawUses++; laws.add(canonicalJson(law)) }
      const request = row.payload.next
      if (!request) continue
      nextCount++
      try {
        requireThat(request.stage_key === `${bundle.category.id}.${stage.stage.id}`
          && request.source_binding.source_key === row.variant_id
          && request.source_binding.source_pointer === `/subcategories/${si}/variants/${ri}`, 'NEXT_SOURCE_BINDING_MISMATCH')
        requireThat(useful(request), 'EMPTY_NEXT_MUST_BE_NULL')
        requireThat(!(meta.category_max_pairs === 2 && request.complexity), 'CATEGORY_MAX_TWO_PAIRS')
        const canonicalFields = fieldsFor(bundle.category.id, stage)
        requireThat(request.questions.every(q => canonicalFields.includes(q.field_key)
          && (q.requires ?? []).every(r => canonicalFields.includes(r.field_key))), 'NEXT_FIELD_OUT_OF_SCOPE')
        createNextBlock(request)
      } catch (error) { add('NEXT_INVALID', { variant_id: row.variant_id, detail: error.report?.issues ?? error.code ?? error.message }) }
    }
  }
  const templates = new Map(), templateIds = new Set()
  for (const template of bundle.document_templates) {
    if (templates.has(template.link_id) || templateIds.has(template.id)) add('DUPLICATE_DOCUMENT_TEMPLATE', { link_id: template.link_id })
    templates.set(template.link_id, template); templateIds.add(template.id)
    if (!references.has(template.link_id)) add('UNUSED_DOCUMENT_TEMPLATE', { link_id: template.link_id })
    if (template.category !== bundle.category.id || !template.body.trim()) add('DOCUMENT_TEMPLATE_SCOPE_OR_BODY', { link_id: template.link_id })
    if (new Set(template.fields.map(f => f.id)).size !== template.fields.length) add('DUPLICATE_TEMPLATE_FIELD', { link_id: template.link_id })
    const pins = meta.template_manifest.filter(p => p.link_id === template.link_id)
    if (pins.length !== 1 || pins[0].content_sha256 !== jsonHash(template)) add('DOCUMENT_TEMPLATE_HASH_MISMATCH', { link_id: template.link_id })
  }
  for (const link_id of references.keys()) if (!templates.has(link_id)) add('MISSING_DOCUMENT_TEMPLATE', { link_id })
  if (meta.template_manifest.length !== templates.size) add('TEMPLATE_MANIFEST_SET_MISMATCH')
  if (issues.length) throw new BundleBlocked(issues)
  return {
    status: 'PASS', format_version: FORMAT_VERSION, self_contained: true, stages: bundle.subcategories.length,
    variants: ids.size, next_requests: nextCount, document_templates: templates.size,
    document_uses: [...references.values()].reduce((a, b) => a + b, 0), document_refs: Object.fromEntries(references),
    law_uses: lawUses, unique_law_tuples: laws.size, content_sha256: meta.integrity.content_sha256,
  }
}

// Validate once on import. Runtime copies the verified data so subsequent caller
// mutation cannot change the trusted catalog. No filesystem or old PPS pins.
export function createBundleRuntime(bundle) {
  validateCategoryBundle(bundle)
  const data = clone(bundle), rows = new Map(data.subcategories.flatMap(s => s.variants.map(v => [v.variant_id, { stage: s, row: v }])))
  const rowFor = id => { requireThat(rows.has(id), 'BUNDLE_VARIANT_UNKNOWN'); return rows.get(id) }
  const validateRequest = request => {
    const { stage, row } = rowFor(request?.source_binding?.source_key), embedded = row.payload.next
    requireThat(embedded && same(request.questions, embedded.questions) && same(request.source_binding, embedded.source_binding)
      && request.stage_key === embedded.stage_key && same(request.complexity ?? null, embedded.complexity ?? null), 'BUNDLE_REQUEST_BINDING_MISMATCH')
    requireThat(request.facts && !Array.isArray(request.facts)
      && Object.keys(request.facts).every(key => fieldsFor(data.category.id, stage).includes(key)), 'BUNDLE_FACT_FIELD_UNKNOWN')
    if (data.category.id === 'pps') requireThat(!(request.facts['pps.explanation_request.copy_requested_and_refused'] === true
      && request.facts['pps.explanation_request.copy_requested'] !== true), 'PPS_COPY_REFUSAL_WITHOUT_REQUEST')
    return createNextBlock(request)
  }
  return {
    prepare({ variant_id, facts, history = [] }) {
      requireThat(facts !== undefined, 'RUNTIME_FACTS_REQUIRED')
      const { row } = rowFor(variant_id)
      if (!row.payload.next) return { request: null, block: null, display_next: false }
      const request = { ...clone(row.payload.next), facts: clone(facts), history: clone(history) }
      const block = validateRequest(request)
      return { request, block, display_next: block.questions.length > 0 }
    },
    answer(input) { validateRequest(input.request); const result = applyNextAnswer(input); return { ...result, display_next: result.block.questions.length > 0 } },
    retryUnknown(input) { validateRequest(input.request); const result = retryUnknownAnswer(input); return { ...result, display_next: result.block.questions.length > 0 } },
    document(link_id) { const template = data.document_templates.find(t => t.link_id === link_id); requireThat(template, 'BUNDLE_DOCUMENT_UNKNOWN'); return clone(template) },
  }
}
