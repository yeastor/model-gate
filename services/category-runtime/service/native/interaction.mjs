import { createHash } from 'node:crypto'
import policyDocument from './policy.json' with { type: 'json' }

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
export const NEXT_INTERACTION_POLICY = freeze(structuredClone(policyDocument))
const policy = NEXT_INTERACTION_POLICY
const own = (object, key) => Object.hasOwn(object, key)
const stagePattern = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u
const fieldPattern = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u
const fail = (code, details = {}) => {
  const error = new TypeError(code)
  error.code = code
  error.details = details
  throw error
}
const record = (value, code) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code)
}
const exactKeys = (value, required, optional, code) => {
  record(value, code)
  if (required.some(key => !own(value, key))
    || Object.keys(value).some(key => ![...required, ...optional].includes(key))) fail(code)
}
const text = (value, code) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) fail(code)
}
const stable = value => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  }
  return value
}
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const scopeField = (key, stage) => typeof key === 'string'
  && fieldPattern.test(key) && key.startsWith(stage + '.')

// Interaction contracts never select an accepted row or legal outcome.
function validateRequest(request) {
  exactKeys(request, ['schema', 'stage_key', 'questions', 'facts'], ['complexity', 'source_binding', 'history'], 'NEXT_REQUEST_INVALID')
  if (request.schema !== 'next-interaction-request/v1' || typeof request.stage_key !== 'string'
    || !stagePattern.test(request.stage_key)) fail('NEXT_REQUEST_INVALID')
  if (!Array.isArray(request.questions) || request.questions.length > 128) fail('NEXT_QUESTIONS_INVALID')
  const seen = new Set()
  for (const question of request.questions) {
    exactKeys(question, ['field_key', 'question_text', 'answers'], ['uncertainty_kind', 'requires'], 'NEXT_QUESTION_INVALID')
    if (!scopeField(question.field_key, request.stage_key) || seen.has(question.field_key)) fail('NEXT_FIELD_DUPLICATE_OR_OUT_OF_SCOPE')
    seen.add(question.field_key)
    text(question.question_text, 'NEXT_QUESTION_TEXT_REQUIRED')
    if (!Array.isArray(question.answers) || question.answers.length > 3
      || new Set(question.answers).size !== question.answers.length
      || question.answers.some(value => !(typeof value === 'boolean' || value === null))) fail('NEXT_ANSWERS_INVALID')
    if (question.uncertainty_kind !== undefined && (typeof question.uncertainty_kind !== 'string'
      || !own(policy.unknown_labels, question.uncertainty_kind))) fail('NEXT_UNCERTAINTY_KIND_INVALID')
    if (question.requires !== undefined && (!Array.isArray(question.requires) || question.requires.length > 128)) fail('NEXT_DEPENDENCY_INVALID')
    const dependencies = new Set()
    for (const dependency of question.requires ?? []) {
      exactKeys(dependency, ['field_key', 'value'], [], 'NEXT_DEPENDENCY_INVALID')
      if (!scopeField(dependency.field_key, request.stage_key) || dependency.field_key === question.field_key
        || typeof dependency.value !== 'boolean' || dependencies.has(dependency.field_key)) fail('NEXT_DEPENDENCY_INVALID')
      dependencies.add(dependency.field_key)
    }
  }
  record(request.facts, 'NEXT_FACTS_INVALID')
  if (Object.keys(request.facts).length > 256) fail('NEXT_FACTS_INVALID')
  for (const [key, value] of Object.entries(request.facts)) {
    if (!scopeField(key, request.stage_key) || !(value === null || typeof value === 'boolean')) fail('NEXT_FACT_INVALID')
  }
  const byKey = new Map(request.questions.map(question => [question.field_key, question]))
  const active = new Set(), visited = new Set()
  const visit = key => {
    if (active.has(key)) fail('NEXT_DEPENDENCY_CYCLE')
    if (visited.has(key)) return
    active.add(key)
    for (const dependency of byKey.get(key)?.requires ?? []) {
      if (byKey.has(dependency.field_key)) visit(dependency.field_key)
    }
    active.delete(key)
    visited.add(key)
  }
  for (const key of byKey.keys()) visit(key)
  if (request.complexity !== undefined) {
    exactKeys(request.complexity, ['level', 'reason', 'third_question_reason'], [], 'NEXT_COMPLEXITY_JUSTIFICATION_REQUIRED')
    if (request.complexity.level !== policy.complexity_level) fail('NEXT_COMPLEXITY_JUSTIFICATION_REQUIRED')
    text(request.complexity.reason, 'NEXT_COMPLEXITY_JUSTIFICATION_REQUIRED')
    text(request.complexity.third_question_reason, 'NEXT_COMPLEXITY_JUSTIFICATION_REQUIRED')
  }
  if (request.history !== undefined && (!Array.isArray(request.history)
    || request.history.length > (request.complexity ? policy.complex_pair_limit : policy.default_pair_limit))) fail('NEXT_HISTORY_INVALID')
  const lastAnswers = new Map()
  for (const answer of request.history ?? []) {
    exactKeys(answer, ['field_key', 'value'], [], 'NEXT_HISTORY_INVALID')
    if (!byKey.has(answer.field_key) || !byKey.get(answer.field_key).answers.includes(answer.value)
      || (lastAnswers.has(answer.field_key) && lastAnswers.get(answer.field_key) !== null)) fail('NEXT_HISTORY_INVALID')
    lastAnswers.set(answer.field_key, answer.value)
  }
  for (const [key, value] of lastAnswers) {
    // A null may be explicitly reopened; a Boolean history entry must be retained.
    if (!(value === null && !own(request.facts, key)) && request.facts[key] !== value) fail('NEXT_HISTORY_FACT_MISMATCH')
  }
  if (request.source_binding !== undefined) {
    exactKeys(request.source_binding, ['candidate_sha256', 'source_pointer', 'source_key'], [], 'NEXT_SOURCE_BINDING_INVALID')
    if (typeof request.source_binding.candidate_sha256 !== 'string'
      || typeof request.source_binding.source_pointer !== 'string'
      || !/^[a-f0-9]{64}$/u.test(request.source_binding.candidate_sha256)
      || !/^\/subcategories\/\d+\/variants\/\d+$/u.test(request.source_binding.source_pointer)) fail('NEXT_SOURCE_BINDING_INVALID')
    text(request.source_binding.source_key, 'NEXT_SOURCE_BINDING_INVALID')
  }
}

export function createNextBlock(request) {
  validateRequest(request)
  const limit = request.complexity ? policy.complex_pair_limit : policy.default_pair_limit
  const completed = (request.history ?? []).length
  const useful = request.questions.filter(question => question.answers.length > 0)
  const available = useful.filter(question => !own(request.facts, question.field_key))
  // Prerequisites must be known BEFORE this block; never speculate about answers
  // to make another question eligible in the same block.
  const eligible = available.filter(question => (question.requires ?? []).every(
    dependency => own(request.facts, dependency.field_key) && request.facts[dependency.field_key] === dependency.value,
  ))
  const questions = eligible.slice(0, completed < limit ? 1 : 0).map(question => ({
    field_key: question.field_key,
    question_text: question.question_text,
    uncertainty_kind: question.uncertainty_kind ?? 'fact',
    controls: question.answers.map(value => ({
      value,
      label: value === null ? policy.unknown_labels[question.uncertainty_kind ?? 'fact'] : value ? 'Да' : 'Нет',
      transition: value === null ? 'answer_unknown' : value ? 'answer_true' : 'answer_false',
    })),
  }))
  const possible = question => !(question.requires ?? []).some(dependency =>
    typeof request.facts[dependency.field_key] === 'boolean' && request.facts[dependency.field_key] !== dependency.value)
  const relevantFields = new Set(useful.filter(possible).flatMap(question =>
    [question.field_key, ...(question.requires ?? []).map(dependency => dependency.field_key)]))
  const unknown = Object.keys(request.facts).filter(key => relevantFields.has(key) && request.facts[key] === null)
  const pendingDependencies = available.filter(possible).filter(question => (question.requires ?? []).some(
    dependency => !own(request.facts, dependency.field_key) || request.facts[dependency.field_key] === null,
  )).map(question => question.field_key)
  return {
    schema: 'next-interaction-block/v1',
    policy_version: policy.version,
    stage_key: request.stage_key,
    block_id: hash({ policy, request }),
    status: questions.length ? 'needs_answer' : completed >= limit && eligible.length ? 'limit_reached'
      : unknown.length || pendingDependencies.length ? 'unresolved' : 'no_more_questions',
    max_question_answer_pairs: limit,
    completed_pair_count: completed,
    remaining_pair_count: limit - completed,
    questions,
    unknown_field_keys: unknown,
    pending_dependency_field_keys: pendingDependencies,
    deferred_question_count: Math.max(0, eligible.length - questions.length),
    selects_legal_outcome: false,
    production: false,
  }
}

export function applyNextAnswer({ request, block_id, field_key, value }) {
  if (!(typeof value === 'boolean' || value === null)) fail('NEXT_ANSWER_INVALID')
  const block = createNextBlock(request)
  if (block.block_id !== block_id) fail('NEXT_STALE_BLOCK')
  const presented = block.questions.find(question => question.field_key === field_key)
  if (!presented) fail('NEXT_ANSWER_NOT_PRESENTED')
  if (!presented.controls.some(control => control.value === value)) fail('NEXT_ANSWER_NOT_OFFERED')
  const nextRequest = structuredClone(request)
  nextRequest.facts[field_key] = value
  nextRequest.history = [...(nextRequest.history ?? []), { field_key, value }]
  return {
    transition: value === null ? 'answer_unknown' : value ? 'answer_true' : 'answer_false',
    request: nextRequest,
    block: createNextBlock(nextRequest),
  }
}

// Explicit retry only: an already known fact cannot be erased by 'unknown'.
export function retryUnknownAnswer({ request, field_key }) {
  validateRequest(request)
  if ((request.history ?? []).length >= (request.complexity ? policy.complex_pair_limit : policy.default_pair_limit)) fail('NEXT_CHAIN_LIMIT_REACHED')
  if (!own(request.facts, field_key) || request.facts[field_key] !== null
    || !request.questions.some(question => question.field_key === field_key)) fail('NEXT_NOT_UNKNOWN')
  const nextRequest = structuredClone(request)
  delete nextRequest.facts[field_key]
  return { request: nextRequest, block: createNextBlock(nextRequest) }
}

// Existing node-candidate adapter: source selectors are never user facts, and
// different variant rows never become one multi-question block.
export function prepareCandidateNext(candidate, options) {
  record(candidate, 'NEXT_CANDIDATE_INVALID')
  exactKeys(options, ['stage_key', 'source_pointer', 'facts'], ['question_metadata', 'complexity'], 'NEXT_CANDIDATE_OPTIONS_INVALID')
  if (typeof options.stage_key !== 'string' || typeof options.source_pointer !== 'string'
    || !stagePattern.test(options.stage_key) || !/^\/subcategories\/\d+\/variants\/\d+$/u.test(options.source_pointer)
    || !Array.isArray(candidate.nodes)) fail('NEXT_CANDIDATE_INVALID')
  const [category, stage] = options.stage_key.split('.')
  if (candidate.category !== category || candidate.stage_id !== stage) fail('NEXT_CANDIDATE_SCOPE_UNBOUND')
  const nodes = candidate.nodes.filter(node => node?.source_pointer === options.source_pointer)
  if (!nodes.length || nodes.length > 128) fail('NEXT_SOURCE_ROW_NOT_FOUND')
  const first = nodes[0]
  text(first.key, 'NEXT_SOURCE_KEY_REQUIRED')
  record(first.source_context, 'NEXT_SOURCE_CONTEXT_INVALID')
  if (typeof first.accepted_stage_artifact_sha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(first.accepted_stage_artifact_sha256)) fail('NEXT_SOURCE_PIN_REQUIRED')
  const metadata = options.question_metadata ?? {}
  record(metadata, 'NEXT_QUESTION_METADATA_INVALID')
  const availableFields = nodes.map(node => options.stage_key + '.' + node.next_context_field)
  if (Object.keys(metadata).some(key => !availableFields.includes(key))) fail('NEXT_QUESTION_METADATA_OUT_OF_SCOPE')
  const questions = nodes.map(node => {
    if (node.key !== first.key || hash(node.source_context) !== hash(first.source_context)
      || node.accepted_stage_artifact_sha256 !== first.accepted_stage_artifact_sha256
      || node.source_row_key !== first.source_row_key
      || node.source_variant_sha256 !== first.source_variant_sha256) fail('NEXT_MIXED_SOURCE_ROWS')
    if (typeof node.next_context_field !== 'string' || !own(node.source_context, node.next_context_field)) fail('NEXT_FIELD_OUT_OF_SOURCE')
    const field_key = options.stage_key + '.' + node.next_context_field
    const extra = metadata[field_key] ?? {}
    exactKeys(extra, [], ['uncertainty_kind', 'requires', 'answers'], 'NEXT_QUESTION_METADATA_INVALID')
    // Legacy two-choice schemas do not establish which choices are useful now.
    // No reviewed choices supplied means nothing is offered for this question.
    return { field_key, question_text: node.question_text, answers: [], ...structuredClone(extra) }
  })
  const request = {
    schema: 'next-interaction-request/v1', stage_key: options.stage_key,
    source_binding: { candidate_sha256: hash(candidate), source_pointer: options.source_pointer, source_key: first.key },
    questions, facts: structuredClone(options.facts),
    ...(options.complexity ? { complexity: structuredClone(options.complexity) } : {}),
  }
  return { request, block: createNextBlock(request) }
}
