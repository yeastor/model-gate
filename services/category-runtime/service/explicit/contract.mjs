import Ajv from 'ajv/dist/2020.js';
import schema from '../contracts/links-only.schema.json' with { type: 'json' };

export const FORMAT = 'category-bundle/v2-links-only';
const check = new Ajv({ strict: true, allErrors: true }).compile(schema);
const own = (o, k) => Object.hasOwn(o, k);
export function blocked(message, issues = []) {
  const e = new Error(message);
  e.status = 409;
  e.report = { issues };
  throw e;
}
export function validateExplicitBundle(bundle) {
  if (!check(bundle)) blocked('Файл не соответствует утверждённой схеме.', check.errors);
  const variants = new Map(), stageIds = new Set(), links = new Map();
  const forbidden = new Set(['document_templates', 'document_fields', 'profile_fields', 'body']);
  function scan(o) {
    if (!o || typeof o !== 'object') return;
    for (const [key, value] of Object.entries(o)) {
      if (forbidden.has(key)) blocked('Шаблоны и поля документов должны оставаться в генераторе.');
      scan(value);
    }
  }
  scan(bundle);
  let nextCount = 0, documentUses = 0, lawUses = 0, branchCount = 0;
  for (const stage of bundle.subcategories) {
    if (stageIds.has(stage.stage.id)) blocked('Повтор stage.');
    stageIds.add(stage.stage.id);
    const fields = stage.context_fields.map(f => f.id);
    if (new Set(fields).size !== fields.length) blocked('Повтор context_fields.');
    for (const row of stage.variants) {
      if (variants.has(row.variant_id)) blocked('Повтор variant_id: ' + row.variant_id);
      if (JSON.stringify(row.payload.category) !== JSON.stringify(bundle.category)
        || JSON.stringify(row.payload.stage) !== JSON.stringify(stage.stage)) blocked('Несогласованные category/stage.');
      if (JSON.stringify(Object.keys(row.context).sort()) !== JSON.stringify([...fields].sort())) blocked('Поля context не совпадают с context_fields.');
      variants.set(row.variant_id, { row, stage });
      for (const d of row.payload.answer.where_to) { links.set(d.document_link_id, d.title); documentUses++; }
      lawUses += row.payload.answer.laws.length;
    }
  }
  for (const { row, stage } of variants.values()) {
    const seen = new Set();
    function walk(q, facts, depth) {
      if (depth > 32) blocked('Слишком глубокий каталог NEXT.');
      if (seen.has(q.id)) blocked('Повтор id вопроса в одном NEXT.');
      seen.add(q.id);
      if (!stage.context_fields.some(f => f.id === q.field_key)) blocked('Неизвестное поле вопроса.');
      const key = bundle.category.id + '.' + stage.stage.id + '.' + q.field_key;
      if (own(facts, key)) blocked('Повторное уточнение одного факта в цепочке.');
      for (const a of q.data) {
        branchCount++;
        const known = { ...facts, [key]: a.value };
        if (a.ask_next_question) walk(a.ask_next_question, known, depth + 1);
        else {
          const target = variants.get(a.go_to_variant);
          if (!target) blocked('Цель NEXT отсутствует: ' + a.go_to_variant);
          const prefix = bundle.category.id + '.' + target.stage.stage.id + '.';
          for (const [field, value] of Object.entries(target.row.context))
            if (value !== null && own(known, prefix + field) && known[prefix + field] !== value)
              blocked('Переход противоречит ответу пользователя: ' + a.go_to_variant);
        }
      }
    }
    if (row.payload.next.length) { nextCount++; walk(row.payload.next[0], {}, 1); }
  }
  return { status: 'PASS', format_version: FORMAT, stages: stageIds.size, variants: variants.size,
    next_requests: nextCount, next_branches: branchCount, document_templates: 0,
    document_uses: documentUses, document_refs: Object.fromEntries(links), law_uses: lawUses,
    example_only: bundle.metadata.example_only, coverage: bundle.metadata.coverage,
    document_storage: 'external_generator_admin_sync' };
}

export async function checkDocumentLinks(bundle, fetcher = fetch) {
  const refs = [...new Set(bundle.subcategories.flatMap(s => s.variants.flatMap(v => v.payload.answer.where_to.map(d => d.document_link_id))))];
  if (!refs.length) return [];
  const base = process.env.CATEGORY_DOCUMENT_GENERATOR_URL || 'http://127.0.0.1:4177';
  const response = await fetcher(base.replace(/\/$/, '') + '/api/document-templates', { signal: AbortSignal.timeout(15000) });
  if (!response.ok) blocked('Каталог генератора документов недоступен.');
  const data = await response.json();
  const templates = data.templates ?? [];
  const byLink = new Map();
  for (const t of templates) {
    if (!t.link_id) continue;
    if (byLink.has(t.link_id)) blocked('Неоднозначный link_id генератора: ' + t.link_id);
    byLink.set(t.link_id, t);
  }
  return refs.map(id => {
    const t = byLink.get(id);
    if (!t?.id) blocked('Генератор не содержит шаблон для ссылки: ' + id);
    return { document_link_id: id, generator_template_id: t.id, title: t.name };
  });
}
