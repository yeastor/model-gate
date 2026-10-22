// Complete evaluation of the vocabulary used by our versioned local schema.
// This is not a general-purpose JSON Schema implementation. Unknown keywords
// and remote references fail closed instead of silently weakening validation.
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const stable = x => Array.isArray(x) ? x.map(stable) : object(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b))
const token = x => String(x).replaceAll('~', '~0').replaceAll('/', '~1')
const vocabulary = new Set(['$schema', '$id', '$defs', '$ref', 'title', 'description', 'type', 'properties',
  'propertyNames', 'additionalProperties', 'required', 'items', 'minItems', 'maxItems', 'uniqueItems',
  'minProperties', 'maxProperties', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'format', 'enum', 'const', 'oneOf'])
const types = {
  object, array: Array.isArray, null: x => x === null, string: x => typeof x === 'string',
  boolean: x => typeof x === 'boolean', number: x => typeof x === 'number' && Number.isFinite(x),
  integer: x => Number.isSafeInteger(x),
}
const date = value => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (!m) return false
  const year = +m[1], month = +m[2], day = +m[3]
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
}
export function compileSchema(schema) {
  const invalid = message => { throw new TypeError(`BUNDLE_SCHEMA_UNSUPPORTED: ${message}`) }
  const resolve = reference => {
    if (typeof reference !== 'string' || !reference.startsWith('#/')) invalid('only local pointer refs')
    let value = schema
    for (const part of reference.slice(2).split('/').map(x => x.replaceAll('~1', '/').replaceAll('~0', '~'))) {
      if (!object(value) || !Object.hasOwn(value, part)) invalid(reference)
      value = value[part]
    }
    return value
  }
  const inspect = s => {
    if (typeof s === 'boolean') return
    if (!object(s)) invalid('schema must be object or boolean')
    for (const k of Object.keys(s)) if (!vocabulary.has(k)) invalid(k)
    if (s.$ref) resolve(s.$ref)
    if (s.type && (Array.isArray(s.type) ? s.type : [s.type]).some(t => !Object.hasOwn(types, t))) invalid('type')
    if (s.format && s.format !== 'date') invalid('format')
    if (s.pattern) new RegExp(s.pattern, 'u')
    for (const k of ['minItems', 'maxItems', 'minProperties', 'maxProperties', 'minLength', 'maxLength']) {
      if (k in s && (!Number.isSafeInteger(s[k]) || s[k] < 0)) invalid(k)
    }
    for (const k of ['$defs', 'properties']) if (s[k]) Object.values(s[k]).forEach(inspect)
    for (const k of ['propertyNames', 'additionalProperties', 'items']) if (k in s) inspect(s[k])
    if (s.oneOf) s.oneOf.forEach(inspect)
  }
  inspect(schema)
  return value => {
    const walk = (s, x, path, errors, refs = new Set()) => {
      const error = keyword => errors.push({ instance_path: path, keyword })
      if (s === true) return
      if (s === false) { error('falseSchema'); return }
      if (s.$ref) {
        const key = `${s.$ref}:${path}`
        if (refs.has(key)) invalid('cyclic ref')
        const next = new Set(refs); next.add(key)
        walk(resolve(s.$ref), x, path, errors, next)
      }
      if (s.type && !(Array.isArray(s.type) ? s.type : [s.type]).some(t => types[t](x))) error('type')
      if ('const' in s && !equal(x, s.const)) error('const')
      if (s.enum && !s.enum.some(v => equal(v, x))) error('enum')
      if (s.oneOf && s.oneOf.filter(branch => { const e = []; walk(branch, x, path, e, refs); return !e.length }).length !== 1) error('oneOf')
      if (object(x)) {
        const keys = Object.keys(x)
        if (s.minProperties !== undefined && keys.length < s.minProperties) error('minProperties')
        if (s.maxProperties !== undefined && keys.length > s.maxProperties) error('maxProperties')
        for (const k of s.required ?? []) if (!Object.hasOwn(x, k)) error(`required:${k}`)
        for (const k of keys) {
          const p = `${path}/${token(k)}`
          if (s.propertyNames) walk(s.propertyNames, k, p, errors, refs)
          if (Object.hasOwn(s.properties ?? {}, k)) walk(s.properties[k], x[k], p, errors, refs)
          else if ('additionalProperties' in s) walk(s.additionalProperties, x[k], p, errors, refs)
        }
      }
      if (Array.isArray(x)) {
        if (s.minItems !== undefined && x.length < s.minItems) error('minItems')
        if (s.maxItems !== undefined && x.length > s.maxItems) error('maxItems')
        if (s.uniqueItems && new Set(x.map(v => JSON.stringify(stable(v)))).size !== x.length) error('uniqueItems')
        if ('items' in s) x.forEach((v, i) => walk(s.items, v, `${path}/${i}`, errors, refs))
      }
      if (typeof x === 'string') {
        if (s.minLength !== undefined && [...x].length < s.minLength) error('minLength')
        if (s.maxLength !== undefined && [...x].length > s.maxLength) error('maxLength')
        if (s.pattern && !new RegExp(s.pattern, 'u').test(x)) error('pattern')
        if (s.format === 'date' && !date(x)) error('format')
      }
      if (typeof x === 'number') {
        if (s.minimum !== undefined && x < s.minimum) error('minimum')
        if (s.maximum !== undefined && x > s.maximum) error('maximum')
      }
    }
    const errors = []; walk(schema, value, '', errors)
    return { valid: !errors.length, errors }
  }
}
