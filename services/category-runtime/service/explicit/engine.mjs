import { randomUUID } from 'node:crypto';
import { blocked, validateExplicitBundle } from './contract.mjs';

const own = (o, k) => Object.hasOwn(o, k);
export function createExplicitEngine(bundle, options = {}) {
  validateExplicitBundle(bundle);
  const data = structuredClone(bundle);
  function freeze(o) { if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); } }
  freeze(data);
  const rows = new Map(data.subcategories.flatMap(stage => stage.variants.map(row => [row.variant_id, Object.freeze({ row, stage })])));
  const keyFor = (stage, field) => data.category.id + '.' + stage.stage.id + '.' + field;
  const rowFor = id => { const value = rows.get(id); if (!value) blocked('Неизвестный variant_id.'); return value; };
  const compatible = (id, facts) => {
    const { row, stage } = rowFor(id);
    return Object.entries(row.context).every(([k, v]) => v === null || (own(facts, keyFor(stage, k)) && facts[keyFor(stage, k)] === v));
  };
  const general = stage => {
    const entries = stage.variants.filter(v => Object.values(v.context).every(v => v === null));
    return entries.length === 1 ? entries[0].variant_id : null;
  };
  function finish(s, id) {
    s.attemptedTarget = id;
    s.pending = null;
    if (!compatible(id, s.facts)) {
      s.status = 'hold';
      s.reason = 'Для этого варианта не подтверждены нужные обстоятельства. Неизвестное не означает «Нет».';
      return;
    }
    const targetHold = options.targetHold?.({ id, state: s, row: rowFor(id).row, stage: rowFor(id).stage });
    if (targetHold) {
      s.status = 'hold'; s.reason = targetHold;
      return;
    }
    s.current = id;
    s.stageId = rowFor(id).stage.stage.id;
    s.status = 'answer';
    s.reason = null;
  }
  function offer(s, question, stage) {
    let q = question;
    const visited = new Set();
    while (q) {
      if (visited.has(q.id)) blocked('Цикл NEXT.');
      visited.add(q.id);
      const key = keyFor(stage, q.field_key);
      // A qualified question must not be bypassed by a legacy or caller-supplied fact.
      const questionHold = options.questionHold?.({ question: q, stage, state: s });
      if (questionHold) {
        s.pending = null; s.status = 'hold'; s.reason = questionHold;
        return;
      }
      if (own(s.facts, key)) {
        const a = q.data.find(a => a.value === s.facts[key]);
        if (!a) blocked('Недопустимый сохранённый факт.');
        if (a.go_to_variant) { finish(s, a.go_to_variant); return; }
        q = a.ask_next_question;
        continue;
      }
      const reason = data.metadata.next_policy?.third_question_reasons?.[q.id];
      const alreadyOffered = s.askedQuestionIds?.includes(q.id);
      if (!alreadyOffered && (s.presented >= (options.maxQuestions ?? 3) || (s.presented >= 2 && !(typeof reason === 'string' && reason.trim())))) {
        s.pending = null; s.status = 'hold'; s.reason = 'Лимит уточнений достигнут. Ниже доступный общий ответ.';
        return;
      }
      if (!alreadyOffered) { s.presented++; (s.askedQuestionIds ||= []).push(q.id); }
      s.pending = { question: structuredClone(q), stageId: stage.stage.id };
      s.status = 'question'; s.reason = null;
      return;
    }
  }
  return {
    bundle: data, rowFor, compatible,
    entryFor(stageId, preferred) {
      const stage = data.subcategories.find(s => s.stage.id === stageId);
      if (!stage) blocked('Ситуация отсутствует в активном наборе.');
      const ranked = preferred && rows.get(preferred);
      if (ranked?.stage.stage.id === stageId && compatible(preferred, {})) return preferred;
      return stage.variants.find(v => v.payload.next.length && compatible(v.variant_id, {}))?.variant_id ?? general(stage);
    },
    start(id, previous) {
      const { stage, row } = rowFor(id);
      const s = previous ? structuredClone(previous) : { id: randomUUID(), facts: {}, history: [], presented: 0, revision: 0 };
      s.entry = id; s.stageId = stage.stage.id; s.pending = null; s.attemptedTarget = null;
      s.current = compatible(id, s.facts) ? id : general(stage);
      s.status = 'answer'; s.reason = null;
      if (row.payload.next[0]) offer(s, row.payload.next[0], stage);
      else finish(s, id);
      return s;
    },
    continueNext(previous) {
      const s = structuredClone(previous);
      if (s.pending || !s.current || s.status !== 'answer') return s;
      const { row, stage } = rowFor(s.current);
      if (row.payload.next[0]) offer(s, row.payload.next[0], stage);
      return s;
    },
    answer(previous, value) {
      const s = structuredClone(previous);
      if (!s.pending || ![true, false, null].includes(value)) blocked('Недопустимый или повторный ответ.');
      const { question: q, stageId } = s.pending;
      const stage = data.subcategories.find(s => s.stage.id === stageId);
      const key = keyFor(stage, q.field_key);
      if (own(s.facts, key)) blocked('Этот факт уже был уточнён.');
      const a = q.data.find(a => a.value === value);
      if (!a) blocked('Недопустимый ответ.');
      s.facts[key] = value;
      s.history.push({ questionId: q.id, fieldKey: key, value, revision: s.revision + 1 });
      s.revision++;
      if (a.ask_next_question) offer(s, a.ask_next_question, stage);
      else finish(s, a.go_to_variant);
      return s;
    }
  };
}
