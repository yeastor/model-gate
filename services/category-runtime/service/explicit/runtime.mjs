import { answerForDisplay } from "../conversation/answer-display.mjs";
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { active, root, search } from '../storage.mjs';
import { read as jsonFile, atomic } from '../conversation/state.mjs';
import { bytesHash } from '../bundle/core.mjs';
import { createExplicitEngine } from './engine.mjs';
import { blocked } from './contract.mjs';

let cached;
const locks = new Map();
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
async function locked(key, action) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const tail = new Promise(resolve => { release = resolve; });
  locks.set(key, tail);
  await previous;
  try { return await action(); }
  finally { release(); if (locks.get(key) === tail) locks.delete(key); }
}
function render(row, version) {
  if (!row) return 'Пока недостаточно подтверждённых обстоятельств. Уточните ситуацию, не угадывая неизвестные факты.';
  const a = answerForDisplay(row, version);
  return [a.now, ...a.steps.map(s => '• ' + s), ...a.dont.map(s => 'Не следует: ' + s), ...a.say.map(s => 'Можно сказать: ' + s)]
    .map(escape).concat(
      a.where_to.map(d => '<a href="/documents/link/' + encodeURIComponent(d.document_link_id) + '">' + escape(d.title) + '</a>'),
      a.laws.map(l => '<a href="' + escape(l.url) + '">' + escape(l.ref) + '</a>: ' + escape(l.short))
    ).join('\n\n');
}
// A compatible baseline is internal routing state until NEXT is complete.
export function presentExplicitAnswer(s, row, category, next) {
  const waiting = Boolean(s.pending) && s.mode !== 'chat';
  return { category,
    content: waiting ? s.pending.question.question
      : (s.reason ? escape(s.reason) + '\n\n' : '') + (s.entry ? render(row, s.version) : 'Выберите ситуацию или опишите, что происходит.'),
    variantId: waiting ? undefined : s.current || undefined, next };
}
async function load() {
  const state = await active();
  if (!state) blocked('Сначала загрузите набор.');
  if (cached?.state.sha256 !== state.sha256) {
    const bundle = JSON.parse(await readFile(path.join(root, 'versions', state.sha256, 'bundle.json'), 'utf8'));
    cached = { state, bundle, engine: createExplicitEngine(bundle) };
  }
  return cached;
}
export async function respondExplicit(input) {
  if (!/^\d{1,12}$/.test(String(input.userId)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) blocked('Invalid trusted identity.');
  if (input.question && (typeof input.question !== 'string' || Array.from(input.question).length > 10000)) blocked('Недопустимый запрос.');
  input = { ...input, id: input.id.toLowerCase(), userId: String(Number(input.userId)) };
  const key = bytesHash(Buffer.from(input.userId + ':' + input.id));
  return locked(key, async () => {
    const { state, bundle, engine } = await load();
    const file = path.join(root, 'explicit-sessions', key + '.json');
    let s = await jsonFile(file);
    const incoming = input.guided?.native;
    if (s && (s.userId !== String(input.userId) || s.chatId !== input.id)) blocked('Сессия другого пользователя.');
    if (s && s.version !== state.sha256) blocked('Набор обновился. Начните новый чат.');
    if (incoming && (!s || incoming.sessionId !== s.id || (!input.resume && incoming.nonce !== s.nonce))) blocked('Устаревший ответ или другой диалог. Обновите страницу.');
    if (incoming?.kind === 'stage' && s?.entry) blocked('Ситуация уже выбрана. Начните новый чат для другого разбора.');
    if (!s) s = { id: randomUUID(), userId: String(input.userId), chatId: input.id, version: state.sha256,
      nonce: randomUUID(), facts: {}, history: [], presented: 0, revision: 0, status: 'navigation', current: null, pending: null };
    s.mode ||= s.articleEntry ? 'guided' : 'chat';
    if (input.mode === 'chat' && !input.resume && !incoming) {
      let entry;
      if (input.variantId) { engine.rowFor(input.variantId); entry = input.variantId; }
      else if (input.question?.trim()) {
        const hits = await search(input.question, input.guided?.stageId);
        if (hits.some(h => h.payload.source_sha256 !== state.sha256)) blocked('Версия поиска изменилась.');
        s.retrieval = hits.map(h => ({ variantId: h.payload.variant_id, stageId: h.payload.stage.id, score: h.score }));
        if (hits[0]?.score >= 0.57) entry = engine.entryFor(hits[0].payload.stage.id, hits[0].payload.variant_id);
      }
      s.mode = 'chat';
      if (entry) s = engine.start(entry, { ...s, entry: undefined, pending: null });
      else { s.entry = null; s.current = null; s.pending = null; s.status = 'navigation'; s.reason = 'Не удалось найти подходящий ответ в подключённой базе. Уточните, кто участвует в ситуации и что произошло.'; }
      s.nonce = randomUUID();
    } else if (!input.resume || !s.entry) {
      if (incoming?.kind === 'answer' && !input.resume) {
        if (incoming.questionId !== s.pending?.question.id || incoming.revision !== s.revision) blocked('Ответ на устаревший вопрос.');
        s = engine.answer(s, incoming.value);
      } else if (incoming?.kind && incoming.kind !== 'stage') blocked('Неизвестное действие.');
      else if (!s.entry || incoming?.kind === 'stage' || (!incoming && input.variantId && input.variantId !== s.entry)) {
        let entry = input.variantId;
        if (entry) { engine.rowFor(entry); s.articleEntry = entry; s.mode = 'guided'; } // Route, never factual evidence.
        else {
          let stageId = incoming?.kind === 'stage' ? input.guided?.stageId : input.guided?.stageId;
          let preferred;
          if (!stageId && input.question?.trim()) {
            const hits = await search(input.question);
            if (hits.some(h => h.payload.source_sha256 !== state.sha256)) blocked('Версия поиска изменилась.');
            stageId = hits[0]?.payload.stage.id;
            preferred = hits[0]?.payload.variant_id;
          }
          if (stageId) entry = engine.entryFor(stageId, preferred);
        }
        if (entry) s = engine.start(entry, s);
      }
      if (!input.resume) s.nonce = randomUUID();
    }
    if (!s.pending && s.status === 'answer') {
      s.mode = 'chat';
      s = engine.continueNext(s);
    }
    await atomic(file, s);
    const control = action => ({ version: state.sha256, categoryId: bundle.category.id, stageId: s.stageId || '', context: {},
      entryVariantId: s.articleEntry || '', native: { sessionId: s.id, nonce: s.nonce, ...action } });
    const view = (label, action, stageId = s.stageId) => ({ type: 'badge', id: randomUUID(), value: label, question: label,
      variantId: '', categoryId: bundle.category.id, guided: { ...control(action), stageId: stageId || '' } });
    const next = [];
    if (s.pending) next.push({ type: 'choice', questionText: s.pending.question.question,
      view: s.pending.question.data.map(a => view(a.label, { kind: 'answer', questionId: s.pending.question.id, revision: s.revision, value: a.value })) });
    if (!s.entry) next.push({ type: 'choice', questionText: 'Ситуация',
      view: bundle.subcategories.map(stage => view(stage.stage.name, { kind: 'stage' }, stage.stage.id)) });
    const row = s.current ? engine.rowFor(s.current).row : null;
    return { status: s.mode === 'chat' && s.pending ? 'answer' : s.status, guided: control({}), answer: presentExplicitAnswer(s, row, bundle.category, next), diagnostics: { source_sha256: state.sha256,
        facts: s.facts, history: s.history, presented: s.presented, attempted_target: s.attemptedTarget } };
  });
}
