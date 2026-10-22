import { dialoguePackage, assertDialogueVersion } from "./package.mjs";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createExplicitEngine } from "../explicit/engine.mjs";
import {
  hash,
  identityKey,
  read,
  atomic,
  fresh,
  episode,
  currentEpisode,
  newRound,
  recordFact,
  project,
  validateState,
  migrateLegacy,
} from "./state.mjs";
import { interpretTurn, policy, validatePolicy } from "./interpret.mjs";
import { fail, uuid } from "./errors.mjs";
const escape = (t) =>
  String(t)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const own = (o, k) => Object.hasOwn(o, k);
const stable = (x) =>
  Array.isArray(x)
    ? x.map(stable)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, stable(x[k])]),
        )
      : x;
const fingerprint = (x) => hash(stable(x));
function render(row) {
  const a = row.payload.answer;
  return [
    a.now,
    ...a.steps.map((x) => "• " + x),
    ...a.dont.map((x) => "Не следует: " + x),
    ...a.say.map((x) => "Можно сказать: " + x),
  ]
    .map(escape)
    .concat(
      a.where_to.map(
        (x) =>
          '<a href="/documents/link/' +
          encodeURIComponent(x.document_link_id) +
          '">' +
          escape(x.title) +
          "</a>",
      ),
      a.laws.map(
        (x) =>
          '<a href="' +
          escape(x.url) +
          '">' +
          escape(x.ref) +
          "</a>: " +
          escape(x.short),
      ),
    )
    .join("\n\n");
}
export function createConversationService({
  dataDir,
  getActive,
  getBundle,
  search = async () => [],
}) {
  const locks = new Map();
  async function locked(key, run) {
    const prev = locks.get(key) || Promise.resolve();
    let release;
    const tail = new Promise((r) => (release = r));
    locks.set(key, tail);
    await prev;
    try {
      return await run();
    } finally {
      release();
      if (locks.get(key) === tail) locks.delete(key);
    }
  }
  function identity(input) {
    if (!/^\d{1,12}$/.test(String(input.userId)) || !uuid.test(input.id || ""))
      fail("INVALID_IDENTITY", 403);
    return {
      userId: String(Number(input.userId)),
      chatId: input.id.toLowerCase(),
    };
  }
  const stateFile = (id) =>
    path.join(
      dataDir,
      "conversation-sessions-v2",
      identityKey(id.userId, id.chatId) + ".json",
    );
  async function load(input) {
    const id = identity(input),
      file = stateFile(id);
    let s = await read(file);
    if (s?.deleted) fail("CHAT_DELETED", 410);
    if (s) validateState(s, id.userId, id.chatId);
    const active = await getActive();
    if (!active) fail("CATEGORY_UNAVAILABLE", 503);
    const sha = s?.version || active.sha256;
    let bundle;
    try {
      bundle = await getBundle(sha);
    } catch {
      fail("PINNED_BUNDLE_UNAVAILABLE", 409);
    }
    assertDialogueVersion(sha);
    validatePolicy(bundle);
    const engine = createExplicitEngine(bundle);
    if (!s)
      s = await migrateLegacy(
        path.join(
          dataDir,
          "explicit-sessions",
          identityKey(id.userId, id.chatId) + ".json",
        ),
        id.userId,
        id.chatId,
        sha,
        engine,
      );
    if (s && s.version !== sha) {
      bundle = await getBundle(s.version);
    }
    s ||= fresh(id.userId, id.chatId, sha);
    if (!s.activeEpisodeId) episode(s);
    if (s.policyVersion !== policy.version) {
      s.policyVersion = policy.version;
      s.pending = null;
      s.engine = null;
      s.lastResponse = null;
      s.nonce = randomUUID();
    }
    if (s.round)
      s.round.questionsUsed ??= Math.min(
        2,
        (s.round.nextPresented || 0) + (s.round.clarifications || 0),
      );
    return { s, file, bundle, engine: createExplicitEngine(bundle), active };
  }
  function build(s, engine, stage, force = false) {
    const facts = project(s, stage),
      prev = s.engine;
    if (
      !force &&
      prev?.stageId === stage &&
      fingerprint(prev.facts) === fingerprint(facts)
    )
      return;
    const entry = engine.entryFor(stage);
    s.engine = engine.start(entry, {
      facts,
      history: prev?.history || [],
      presented: s.round?.questionsUsed || 0,
      revision: s.revision,
      askedQuestionIds: s.round?.askedQuestionIds || [],
    });
    if (!s.engine.pending && s.engine.status === "answer")
      s.engine = engine.continueNext(s.engine);
    const delta = Math.max(
      0,
      s.engine.presented - (s.round.questionsUsed || 0),
    );
    s.round.nextPresented = (s.round.nextPresented || 0) + delta;
    s.round.questionsUsed = (s.round.questionsUsed || 0) + delta;
    s.round.askedQuestionIds = s.engine.askedQuestionIds || [];
    s.pending = s.engine.pending
      ? { kind: "next", question: s.engine.pending.question, stageId: stage }
      : null;
    enhance(s, engine, stage);
  }
  function preserveAdvice(engine, id, stage, facts) {
    if (!id) return false;
    const row = engine.rowFor(id).row;
    return (
      engine.compatible(id, facts) &&
      Object.entries(facts).every(([k, v]) => {
        if (![true, false].includes(v)) return true;
        const field = k.split(".").at(-1);
        const used = engine.bundle.subcategories
          .find((x) => x.stage.id === stage)
          .variants.some((r) => r.context[field] === v);
        return !used || row.context[field] === v;
      })
    );
  }
  function enhance(s, engine, stage) {
    const e = currentEpisode(s),
      facts = project(s, stage);
    const candidates = engine.bundle.subcategories
      .find((x) => x.stage.id === stage)
      .variants.filter((r) =>
        preserveAdvice(engine, r.variant_id, stage, facts),
      );
    if (
      candidates.length &&
      !preserveAdvice(engine, s.engine.current, stage, facts)
    ) {
      candidates.sort(
        (a, b) =>
          Object.values(a.context).filter((v) => v !== null).length -
            Object.values(b.context).filter((v) => v !== null).length ||
          a.variant_id.localeCompare(b.variant_id),
      );
      s.engine.current = candidates[0].variant_id;
    }
    if (
      s.pending ||
      s.round.questionsUsed >= 2 ||
      e.actor !== "police" ||
      !e.stageConfirmedByUser ||
      e.presentationSignals?.length
    )
      return;
    const question = dialoguePackage.questions
      .filter((q) => q.purpose === "context" && q.stageId === stage)
      .sort((a, b) => a.priority - b.priority)
      .find((q) => {
        if (
          own(facts, q.fieldKey) ||
          Object.entries(q.showWhen.requiredFacts).some(
            ([k, v]) => facts[k] !== v,
          )
        )
          return false;
        return q.branches.every(
          (b) =>
            b.nextAction.kind === "variant" &&
            preserveAdvice(engine, b.nextAction.variantId, stage, {
              ...facts,
              [q.fieldKey]: b.value,
            }),
        );
      });
    if (!question) return;
    s.round.questionsUsed++;
    s.round.supplementalPresented = (s.round.supplementalPresented || 0) + 1;
    s.pending = {
      kind: "supplemental",
      stageId: stage,
      fieldKey: question.fieldKey,
      question: {
        id: question.id,
        question: question.question,
        data: question.branches.map((b) => ({
          value: b.value,
          label: b.label,
        })),
      },
    };
  }
  function clarification(s, text, key = "describe", conflictField = null) {
    s.pending = {
      kind: "clarification",
      question: {
        id:
          key === "police_actor"
            ? dialoguePackage.questions.find((q) => q.purpose === "routing").id
            : randomUUID(),
        question: text,
      },
      key,
      conflictField,
    };
    if ((s.round.questionsUsed || 0) >= policy.defaultClarificationLimit) {
      s.pending = null;
      return "Опишите своими словами, что происходит сейчас. Если захотите, можно вернуться к памятке.";
    }
    s.round.clarifications++;
    s.round.questionsUsed = (s.round.questionsUsed || 0) + 1;
    return text;
  }
  function present(
    s,
    bundle,
    engine,
    {
      text,
      forceFull = false,
      article = false,
      acknowledgeUnknown = false,
    } = {},
  ) {
    const row = s.engine?.current ? engine.rowFor(s.engine.current).row : null;
    const signals = currentEpisode(s).presentationSignals || [];
    const staleAdvice =
      row &&
      ((signals.includes("phone_returned") &&
        row.context.phone_taken === true) ||
        (signals.includes("document_returned") &&
          row.context.documents_taken_away === true) ||
        (signals.includes("consent_withdrawn") &&
          row.context.voluntary_trip_agreed !== undefined));
    if (staleAdvice) {
      text = "Учёл, что ситуация изменилась. Опишите, что происходит сейчас.";
      forceFull = false;
    }
    const fp = row
      ? fingerprint([s.version, row.variant_id, row.payload.answer])
      : null;
    let kind = "clarification",
      content = text,
      reference;
    if (!content && row && !(article && s.pending)) {
      if (
        forceFull ||
        s.presentation.lastFull?.fingerprint !== fp ||
        s.presentation.lastFull?.episodeId !== s.activeEpisodeId
      ) {
        content = render(row);
        kind = "full";
      } else {
        content = "Хорошо, учту это.";
        kind = "continuation";
        reference = s.presentation.lastFull.responseId;
      }
    }
    if (!content)
      content =
        s.pending?.question.question ||
        "Опишите, что сейчас происходит и кто участвует в ситуации.";
    if (kind === "continuation" && !s.pending)
      content = acknowledgeUnknown
        ? "Хорошо, пока оставим это неизвестным. Можете описать, что происходит сейчас."
        : "Спасибо, учту уточнение. Можете описать, что происходит сейчас.";
    const responseId = randomUUID();
    if (kind === "full")
      s.presentation.lastFull = {
        fingerprint: fp,
        episodeId: s.activeEpisodeId,
        responseId,
        variantId: row.variant_id,
      };
    const control = (action) => ({
      version: s.version,
      categoryId: bundle.category.id,
      stageId: s.engine?.stageId || "",
      entryVariantId: s.articleEntry || "",
      context: {},
      native: {
        sessionId: s.id,
        nonce: s.nonce,
        revision: s.revision,
        episodeId: s.activeEpisodeId,
        roundId: s.round?.id,
        ...action,
      },
    });
    const views = [];
    if (s.pending) {
      const p = s.pending;
      const data = ["next", "supplemental"].includes(p.kind)
        ? p.question.data
        : p.key === "police_actor"
          ? [
              { value: true, label: "Да" },
              { value: false, label: "Нет" },
              { value: null, label: "Не знаю" },
            ]
          : [];
      if (data.length)
        views.push({
          type: "choice",
          questionText: p.question.question,
          view: data.map((a) => ({
            type: "badge",
            id: randomUUID(),
            value: a.label,
            question: a.label,
            variantId: "",
            categoryId: bundle.category.id,
            guided: control({
              kind: ["next", "supplemental"].includes(p.kind)
                ? "answer"
                : "clarify",
              questionId: p.question.id,
              value: a.value,
            }),
          })),
        });
    }
    if (row && kind !== "full" && !staleAdvice)
      views.push({
        type: "actions",
        questionText: "",
        view: [
          {
            type: "badge",
            id: randomUUID(),
            value: "Показать памятку",
            question: "Показать памятку",
            variantId: "",
            categoryId: bundle.category.id,
            guided: control({ kind: "show_advice" }),
          },
        ],
      });

    return {
      status:
        s.pending && article
          ? "question"
          : s.pending
            ? "answer"
            : row
              ? "answer"
              : "navigation",
      guided: control({}),
      conversation: { sessionId: s.id, revision: s.revision },
      presentation: {
        kind,
        responseId,
        answerFingerprint: fp,
        referencesResponseId: reference,
      },
      answer: {
        category: bundle.category,
        content,
        variantId: article && s.pending ? undefined : row?.variant_id,
        next: views,
      },
    };
  }
  async function internal(input, operation) {
    const id = identity(input);
    return locked(identityKey(id.userId, id.chatId), async () => {
      const file = stateFile(id),
        s = await read(file);
      if (operation === "pending")
        return { historyEnvelope: s?.deleted ? null : s?.outbox || null };
      if (operation === "ack") {
        if (s?.outbox && s.outbox.turnId === input.turnId) {
          s.outbox = null;
          await atomic(file, s);
        }
        return { ok: true };
      }
      if (operation === "delete") {
        await atomic(file, {
          deleted: true,
          userId: id.userId,
          chatId: id.chatId,
          at: new Date().toISOString(),
        });
        const old = path.join(
          dataDir,
          "explicit-sessions",
          identityKey(id.userId, id.chatId) + ".json",
        );
        // Leave only an identity tombstone, never facts from a deleted conversation.
        await fs.rm(old, { force: true });
        await fs.rm(old + ".v2-backup.json", { force: true });
        return { ok: true };
      }
      fail("INVALID_INTERNAL_ACTION");
    });
  }
  async function respond(input) {
    const id = identity(input);
    return locked(identityKey(id.userId, id.chatId), async () => {
      const { s, file, bundle, engine, active } = await load(input);
      const action = input.guided?.native?.kind ? input.guided.native : null;
      if (input.resume) {
        if (!s.lastResponse) {
          if (currentEpisode(s).stageId) {
            s.round ||= {
              questionsUsed: 0,
              nextPresented: 0,
              clarifications: 0,
            };
            build(s, engine, currentEpisode(s).stageId, true);
          }
          if (input.variantId) {
            const stage = engine.rowFor(input.variantId).stage.stage.id;
            s.articleEntry = input.variantId;
            currentEpisode(s).stageId = stage;
            newRound(s, "article");
            build(s, engine, stage);
          }
          s.lastResponse = present(s, bundle, engine, {
            article: Boolean(s.articleEntry),
          });
          await atomic(file, s);
        }
        return {
          ...structuredClone(s.lastResponse),
          _historyEnvelope: s.outbox,
        };
      }
      if (!uuid.test(input.turnId || "")) fail("TURN_ID_REQUIRED");
      if (
        typeof input.question !== "string" ||
        Array.from(input.question).length > 10000
      )
        fail("INVALID_MESSAGE");
      const requestHash = fingerprint({
        question: input.question,
        action,
        variantId: input.variantId,
        launchHint: input.launchHint,
      });
      const receipt = s.turns[input.turnId];
      if (receipt) {
        if (receipt.requestHash !== requestHash) fail("TURN_ID_CONFLICT", 409);
        return {
          ...structuredClone(receipt.response),
          turn: { ...receipt.response.turn, replayed: true },
          _historyEnvelope: s.outbox,
        };
      }
      if (s.outbox) fail("HISTORY_DELIVERY_PENDING", 409);
      if (
        s.revision > 0 &&
        (!input.conversation ||
          input.conversation.sessionId !== s.id ||
          input.conversation.revision !== s.revision)
      )
        fail("STALE_STATE", 409);
      if (
        action &&
        (action.sessionId !== s.id ||
          action.nonce !== s.nonce ||
          action.revision !== s.revision ||
          action.episodeId !== s.activeEpisodeId ||
          action.roundId !== s.round?.id)
      )
        fail("STALE_ACTION", 409);
      let e = currentEpisode(s);
      s.round ||= {
        id: randomUUID(),
        triggerEventId: "initial",
        nextPresented: 0,
        clarifications: 0,
      };
      let text,
        forceFull = false;
      if (action?.kind === "stage") {
        const stage = input.guided?.stageId;
        if (!bundle.subcategories.some((x) => x.stage.id === stage))
          fail("INVALID_STAGE");
        s.articleEntry = engine.entryFor(stage);
        build(s, engine, stage, true);
        if (!s.pending)
          text =
            "Опишите, что происходит сейчас. Для этого разбора автоматические уточнения уже закончились.";
      } else if (action?.kind === "show_advice") forceFull = true;
      else if (action?.kind === "answer" || action?.kind === "clarify") {
        if (
          !s.pending ||
          action.questionId !== s.pending.question.id ||
          ![true, false, null].includes(action.value)
        )
          fail("STALE_ACTION", 409);
        if (["next", "supplemental"].includes(s.pending.kind)) {
          recordFact(
            s,
            s.pending.fieldKey ||
              "pps." + s.pending.stageId + "." + s.pending.question.field_key,
            action.value,
            {
              kind: "button",
              turnId: input.turnId,
              questionId: action.questionId,
            },
          );
          build(s, engine, s.engine.stageId, true);
        } else if (s.pending.key === "police_actor") {
          e.actor =
            action.value === true
              ? "police"
              : action.value === false
                ? "other"
                : null;
          if (e.actor === "police" && e.unresolvedForce) {
            recordFact(
              s,
              "pps.use_of_force.force_actually_used",
              true,
              e.unresolvedForce.source,
            );
            e.stageId = "use_of_force";
            e.stageConfirmedByUser = true;
            build(s, engine, "use_of_force", true);
            e.unresolvedForce = null;
          } else {
            s.pending = null;
            text = "Опишите, кто участвует в ситуации и что происходит сейчас.";
          }
        }
      } else if (action) fail("INVALID_ACTION");
      else {
        const parsed = interpretTurn(s, input.question, input.turnId);
        if (parsed.newEpisode) {
          e = episode(s);
          newRound(s, "new-episode");
        }
        if (parsed.actor === "other" && e.actor === "police") {
          e.personId = randomUUID();
          e.stageId = null;
          s.engine = null;
          s.pending = null;
        }
        e.actor = parsed.actor;
        e.ambiguousActor = parsed.ambiguousActor;
        if (parsed.stage || parsed.facts.length) e.stageConfirmedByUser = true;
        if (parsed.signals?.length)
          e.presentationSignals = [
            ...new Set([
              ...(e.presentationSignals || []),
              ...parsed.signals.map((x) => x.kind),
            ]),
          ];
        if (parsed.actorExplicit) e.actorEvidence = parsed.source;
        if (parsed.newDocument) {
          e.documentId = randomUUID();
          newRound(s, "new-document");
          s.engine = null;
        }
        s.recentUserTurns.push({
          turnId: input.turnId,
          episodeId: e.id,
          text: input.question,
        });
        s.recentUserTurns = s.recentUserTurns.slice(-12);
        while (
          s.recentUserTurns.reduce((n, x) => n + Array.from(x.text).length, 0) >
          16000
        )
          s.recentUserTurns.shift();
        if (
          parsed.choiceValue === null &&
          s.pending?.kind === "clarification" &&
          s.pending.key === "describe"
        ) {
          s.pending = null;
          text =
            "Хорошо, пока это неизвестно. Опишите, что сотрудник делает сейчас.";
        }
        if (
          s.pending?.key === "actor" &&
          parsed.actorExplicit &&
          e.unresolvedForce
        ) {
          parsed.stage = "use_of_force";
          parsed.facts.push({
            field: "use_of_force.force_actually_used",
            value: true,
            originalSource: e.unresolvedForce.source,
          });
          e.stageConfirmedByUser = true;
          e.unresolvedForce = null;
          s.pending = null;
        }
        // Bare replies apply only to the single current pending question.
        if (parsed.choice && s.pending?.key === "police_actor") {
          s.pending = null;
          e.actor =
            parsed.choiceValue === true
              ? "police"
              : parsed.choiceValue === false
                ? "other"
                : null;
          if (e.actor === "police" && e.unresolvedForce) {
            parsed.stage = "use_of_force";
            e.stageConfirmedByUser = true;
            parsed.facts.push({
              field: "use_of_force.force_actually_used",
              value: true,
              originalSource: e.unresolvedForce.source,
            });
            e.actorEvidence = parsed.source;
            e.unresolvedForce = null;
            parsed.clarification = null;
          }
        }
        if (
          parsed.choice &&
          ["next", "supplemental"].includes(s.pending?.kind)
        ) {
          recordFact(
            s,
            s.pending.fieldKey ||
              "pps." + s.pending.stageId + "." + s.pending.question.field_key,
            parsed.choiceValue,
            parsed.source,
          );
        }
        const material = parsed.events.find((x) =>
          ["force", "handcuffs"].includes(x.kind),
        );
        if (material && e.actor === "police") {
          const eventKey = hash([e.id, material.kind, e.personId]);
          if (
            !e.events.some((x) => x.eventKey === eventKey) ||
            (material.kind === "force" && e.dangerOngoing === false)
          ) {
            newRound(s, eventKey + ":" + input.turnId);
            forceFull = true;
          }
        }
        for (const ev of parsed.events) {
          const key = hash([e.id, ev.kind, e.personId]);
          if (!e.events.some((x) => x.eventKey === key))
            e.events.push({
              ...ev,
              eventKey: key,
              turnId: input.turnId,
              source: parsed.source,
            });
          if (ev.kind === "force_ended") e.dangerOngoing = false;
          if (ev.kind === "force") e.dangerOngoing = ev.ongoing;
        }
        if (parsed.intent === "show_advice") forceFull = true;
        if (e.actor === "police") {
          for (const f of parsed.facts) {
            const rule = policy.fields[f.field];
            if (!rule) continue;
            const dependencies = (rule.dependencies || []).map(
              (x) => "pps." + x,
            );
            if (
              dependencies.some(
                (dep) => project(s, dep.split(".")[1])[dep] !== true,
              )
            )
              continue;
            const rec = recordFact(
              s,
              "pps." + f.field,
              f.value,
              f.originalSource || parsed.source,
              f.operation || (parsed.correction ? "correct" : "assert"),
              dependencies,
            );
            if (rec.status === "conflicted") {
              s.engine = null;
              text = clarification(
                s,
                "Вы исправляете прежний ответ или ситуация изменилась?",
                "conflict",
                rec.fieldKey,
              );
            }
          }
        }
        if (parsed.deniedStage === e.stageId) {
          e.stageId = null;
          s.engine = null;
          s.pending = null;
        }
        if (parsed.ambiguousStage) {
          s.engine = null;
          s.pending = null;
          text = clarification(
            s,
            "Какие действия сотрудник выполняет сейчас? Опишите их по порядку.",
            "procedure",
          );
        }
        if (parsed.clarification) {
          s.engine = null;
          e.unresolvedForce =
            parsed.unresolvedForceValue === true
              ? { source: parsed.source }
              : null;
          text = clarification(
            s,
            parsed.clarification,
            parsed.ambiguousActor ? "actor" : "police_actor",
          );
        } else {
          let stage = parsed.stage || e.stageId;
          if (
            parsed.correction &&
            parsed.facts.some(
              (x) =>
                x.field === "use_of_force.force_actually_used" &&
                x.value === false,
            )
          ) {
            stage = null;
            e.dangerOngoing = false;
            e.stageId = null;
            s.engine = null;
            s.pending = null;
          }
          if (stage && e.actor === "police") {
            if (
              parsed.stage &&
              s.articleEntry &&
              engine.rowFor(s.articleEntry).stage.stage.id !== stage
            )
              s.articleEntry = null;
            if (e.stageId !== stage)
              e.stageHistory.push({ stageId: stage, turnId: input.turnId });
            e.stageId = stage;
            if (!text) build(s, engine, stage);
          } else if (
            s.articleEntry &&
            s.pending?.kind === "next" &&
            !parsed.stage
          ) {
            build(s, engine, s.engine.stageId);
          } else if (!text && !s.engine) {
            // Retrieval is a hint only. Never infer a procedure from its top score.
            if (input.question.trim() && active.sha256 === s.version)
              try {
                s.retrieval = (
                  await search(
                    s.recentUserTurns
                      .filter((x) => x.episodeId === s.activeEpisodeId)
                      .slice(-4)
                      .map((x) => x.text)
                      .join("; ")
                      .slice(-4000) || input.question,
                    {
                      categoryId: bundle.category.id,
                    },
                  )
                )
                  .filter((h) => h.payload.source_sha256 === s.version)
                  .map((h) => ({
                    variantId: h.payload.variant_id,
                    stageId: h.payload.stage.id,
                    score: h.score,
                  }));
              } catch {
                s.retrievalUnavailable = true;
              }
            text = clarification(
              s,
              e.actor === "police"
                ? "Что сотрудник говорит или требует от вас?"
                : "Опишите, кто участвует в ситуации и что происходит сейчас.",
            );
          }
        }
      }
      s.revision++;
      s.nonce = randomUUID();
      const response = present(s, bundle, engine, {
        text,
        forceFull,
        acknowledgeUnknown:
          action?.value === null ||
          /^(?:не знаю|не помню)[.!]?$/iu.test(input.question.trim()),
        article: Boolean(s.articleEntry) && !forceFull,
      });
      response.turn = {
        turnId: input.turnId,
        revision: s.revision,
        replayed: false,
      };
      const createdAt = new Date().toISOString(),
        hex = hash(s.chatId + ":" + input.turnId);
      const messageId =
        hex.slice(0, 8) +
        "-" +
        hex.slice(8, 12) +
        "-4" +
        hex.slice(13, 16) +
        "-8" +
        hex.slice(17, 20) +
        "-" +
        hex.slice(20, 32);
      response.turn.messageId = messageId;
      const questions = response.answer.next
        .filter(
          (x) =>
            x.type === "choice" &&
            x.questionText &&
            x.questionText !== response.answer.content,
        )
        .map((x) => "Вопрос: " + x.questionText);
      s.outbox = {
        turnId: input.turnId,
        messageId,
        createdAt,
        question: input.question || "Уточнение ситуации",
        answer: [response.answer.content, ...questions].join("\n\n"),
        category: bundle.category.id,
        responseId: response.presentation.responseId,
      };
      s.turns[input.turnId] = { requestHash, response };
      s.lastResponse = response;
      await atomic(file, s);
      return { ...structuredClone(response), _historyEnvelope: s.outbox };
    });
  }
  return { respond, internal };
}
