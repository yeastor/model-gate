import { conversation } from './conversation/adapter.mjs';
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createBundleRuntime, bytesHash } from "./bundle/core.mjs";
import { active, root, jsonFile, atomic, search } from "./storage.mjs";
import { respondExplicit } from './explicit/runtime.mjs';
import { FORMAT } from './explicit/contract.mjs';

let loaded;
export async function catalog() {
  const current = await active();
  if (!current) throw new Error("Сначала загрузите пакет PPS.");
  if (loaded?.state.sha256 !== current.sha256) {
    const bundle = JSON.parse(
      await readFile(
        path.join(root, "versions", current.sha256, "bundle.json"),
        "utf8",
      ),
    );
    loaded = { state: current, bundle, runtime: createBundleRuntime(bundle) };
  }
  return loaded;
}
const fail = (message) => {
  const error = new Error(message);
  error.status = 409;
  throw error;
};
const escape = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
export function resolve(stage, facts) {
  const prefix = `pps.${stage.stage.id}.`;
  const supported = stage.variants.filter((v) =>
    Object.entries(v.context).every(
      ([k, value]) => value === null || facts[prefix + k] === value,
    ),
  );
  const rank = (v) => Object.values(v.context).filter((v) => v !== null).length;
  const max = Math.max(-1, ...supported.map(rank));
  const winners = supported.filter((v) => rank(v) === max);
  if (winners.length !== 1)
    return { row: null, candidates: winners.map((v) => v.variant_id) };
  return { row: winners[0], candidates: winners.map((v) => v.variant_id) };
}
function render(row) {
  if (!row)
    return "Для точного исхода пока недостаточно подтверждённых сведений. Не подписывайте непрочитанное; опишите обстоятельства юристу.";
  const a = row.payload.answer;
  return [
    a.now,
    ...a.steps.map((s) => `• ${s}`),
    ...a.dont.map((s) => `Не следует: ${s}`),
    ...a.say.map((s) => `Можно сказать: ${s}`),
    ...a.where_to.map(
      (d) =>
        `<a href="/documents/link/${encodeURIComponent(d.document_link_id)}">${escape(d.title)}</a>`,
    ),
    ...a.laws.map(
      (l) => `<a href="${escape(l.url)}">${escape(l.ref)}</a>: ${l.short}`,
    ),
  ].join("\n\n");
}
// Only explicit phrases in the person's own message are accepted here. Retrieval
// masks and article IDs are never evidence. Unrecognised prose stays unconfirmed.
function explicitFacts(stageId, text) {
  const facts = {};
  const set = (key, value) => {
    facts[`pps.${stageId}.${key}`] = value;
  };
  if (stageId === "explanation_request") {
    const rules = [
      [
        "signature_on_explanation_requested",
        /подписать (?:это )?объяснение не просят/iu,
        false,
      ],
      [
        "signature_on_explanation_requested",
        /просят подписать (?:это )?объяснение/iu,
        true,
      ],
      [
        "questions_about_self_or_relatives",
        /вопросы (?:не касаются|не обо) мне и (?:моих )?близких/iu,
        false,
      ],
      ["questions_about_self_or_relatives", /вопросы касаются меня/iu, true],
      ["refusal_pressure", /на меня не давят|давления нет/iu, false],
      [
        "procedural_status_explained",
        /мой процессуальный статус объяснили/iu,
        true,
      ],
      ["copy_requested", /я (?:уже )?попросил(?:а)? копию/iu, true],
    ];
    for (const [field, pattern, value] of rules)
      if (pattern.test(text)) set(field, value);
  }
  return facts;
}
function control(session, stageId, action) {
  return {
    version: session.version,
    categoryId: "pps",
    stageId,
    context: {},
    native: { sessionId: session.id, nonce: session.nonce, ...action },
  };
}
function view(session, stageId, label, action) {
  return {
    type: "badge",
    id: randomUUID(),
    value: label,
    question: label,
    variantId: "",
    categoryId: "pps",
    guided: control(session, stageId, action),
  };
}
export async function respond(input) {
  if (input.protocolVersion === 2) return conversation.respond(input);
  if ((await active())?.format_version === FORMAT) return respondExplicit(input);
  if (!input.userId || !/^[0-9a-f-]{36}$/i.test(input.id))
    throw new Error("Invalid trusted identity.");
  const { state, bundle, runtime } = await catalog();
  const file = path.join(
    root,
    "sessions",
    bytesHash(Buffer.from(`${input.userId}:${input.id}`)) + ".json",
  );
  let session = await jsonFile(file);
  if (!session)
    session = {
      id: randomUUID(),
      version: state.sha256,
      nonce: randomUUID(),
      stages: {},
      stageId: null,
    };
  if (session.version !== state.sha256)
    fail("Пакет обновился. Создайте новый диалог для проверки новой версии.");
  const incoming = input.guided?.native;
  if (
    incoming &&
    (incoming.sessionId !== session.id ||
      (!input.resume && incoming.nonce !== session.nonce))
  )
    fail("Устаревший ответ или ответ из другого диалога. Обновите страницу.");
  let stageId = session.stageId;
  if (!input.resume && incoming?.kind === "stage")
    stageId = input.guided.stageId;
  if (!stageId && input.variantId)
    stageId = bundle.subcategories.find((s) =>
      s.variants.some((v) => v.variant_id === input.variantId),
    )?.stage.id;
  if (!stageId && input.guided?.stageId && !incoming)
    stageId = input.guided.stageId;
  let hits;
  if (!input.resume && !incoming && input.question?.trim()) {
    hits = await search(input.question);
    if (hits.some(h => h.payload.source_sha256 !== state.sha256)) fail("Поисковый пакет обновился. Повторите запрос.");
    stageId = hits[0]?.payload.stage.id;
  }
  const stage = bundle.subcategories.find((s) => s.stage.id === stageId);
  if (stageId && !stage)
    fail("Эта ситуация отсутствует в активном пакете PPS.");
  if (!stage) {
    await atomic(file, session);
    return {
      status: "navigation",
      guided: control(session, "", {}),
      answer: {
        category: bundle.category,
        content: "Выберите ситуацию с полицией или опишите, что происходит.",
        next: [
          {
            type: "choice",
            questionText: "Ситуация",
            view: bundle.subcategories.map((s) =>
              view(session, s.stage.id, s.stage.name, { kind: "stage" }),
            ),
          },
        ],
      },
    };
  }
  session.stageId = stageId;
  let saved = session.stages[stageId];
  if (!saved) {
    if (!hits)
      hits = await search(input.question?.trim() || stage.stage.name, stageId);
    if (hits.some(h => h.payload.source_sha256 !== state.sha256)) fail("Поисковый пакет обновился. Повторите запрос.");
    const source =
      stage.variants.find(
        (v) => v.variant_id === hits[0]?.payload.variant_id,
      ) || stage.variants[0];
    saved = {
      entry: source.variant_id,
      facts: explicitFacts(stageId, input.question || ""),
      history: [],
      retrieval: hits.map((h) => ({
        id: h.payload.variant_id,
        stage: h.payload.stage.id,
        score: h.score,
      })),
    };
    session.stages[stageId] = saved;
  }
  let prepared = runtime.prepare({
    variant_id: saved.entry,
    facts: saved.facts,
    history: saved.history,
  });
  if (!input.resume && incoming?.kind === "answer")
    prepared = runtime.answer({
      request: prepared.request,
      block_id: incoming.blockId,
      field_key: incoming.fieldKey,
      value: incoming.value,
    });
  else if (!input.resume && incoming?.kind === "retry")
    prepared = runtime.retryUnknown({
      request: prepared.request,
      field_key: incoming.fieldKey,
    });
  else if (!input.resume && incoming?.kind && incoming.kind !== "stage")
    fail("Неизвестное действие.");
  if (prepared.request) {
    saved.facts = prepared.request.facts;
    saved.history = prepared.request.history;
  }
  if (!input.resume) session.nonce = randomUUID();
  const outcome = resolve(stage, saved.facts);
  const question = prepared.block?.questions[0];
  const next = [];
  if (question) {
    const controls = question.controls.map((a) =>
      view(session, stageId, a.label, {
        kind: "answer",
        blockId: prepared.block.block_id,
        fieldKey: question.field_key,
        value: a.value,
      }),
    );
    for (const [field, value] of Object.entries(saved.facts))
      if (value === null && saved.history.length < 2)
        controls.push(
          view(session, stageId, "Уточнить предыдущий ответ", {
            kind: "retry",
            fieldKey: field,
          }),
        );
    next.push({
      type: "choice",
      questionText: question.question_text,
      view: controls,
    });
  }
  // A null can leave no eligible question. Explicit reopening still consumes the
  // remaining pair when answered; history itself is never removed.
  if (!question && saved.history.length < 2) {
    const unknown = Object.keys(saved.facts).find(
      (k) => saved.facts[k] === null,
    );
    if (unknown)
      next.push({
        type: "choice",
        questionText: "Если обстоятельство стало известно",
        view: [
          view(session, stageId, "Уточнить предыдущий ответ", {
            kind: "retry",
            fieldKey: unknown,
          }),
        ],
      });
  }
  await atomic(file, session);
  return {
    status: question ? "question" : "answer",
    guided: control(session, stageId, {}),
    answer: {
      category: bundle.category,
      content: render(outcome.row),
      variantId: outcome.row?.variant_id,
      next,
    },
    diagnostics: {
      facts: saved.facts,
      history: saved.history,
      retrieval: saved.retrieval,
      candidates: outcome.candidates,
      source_sha256: state.sha256,
    },
  };
}
