import { requestProfile } from "./request-profile.mjs";
import { respondQualified, internalQualified } from "./qualified-session.mjs";
import { respondFocusedRequest } from "./focused-request.mjs";
import { answerForDisplay } from "./answer-display.mjs";
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
  ensureCaseState,
  caseQuestionsUsed,
  bindQuestion,
  canServeQuestion,
  serveQuestion,
  answerQuestionReceipt,
  rememberDismissals,
  selectBag,
} from "./state.mjs";
import { interpretTurn, policy, validatePolicy } from "./interpret.mjs";
import { fail, uuid } from "./errors.mjs";
import {
  routingQuestions,
  routingCandidates,
  routingEligible,
  partialContact,
  topicHints,
} from "./routing.mjs";
import { retrieveTurn, supportedTopicHits } from "./retrieval.mjs";
import {
  questionText,
  questionExplanation,
  suppressQuestion,
} from "./question-display.mjs";
import { conversationalIntent } from "./evidence.mjs";
import {
  createQuestionCatalog,
  pendingReply,
  preservesFacts,
  selectAnswer,
  questionCatalogVersion,
} from "./questions.mjs";
import { reportedIssue, unknownMessage, behaviourVersion } from "./issues.mjs";
import {
  offerFeedback,
  submitFeedback,
  withdrawFeedback,
  deleteFeedback,
  consentVersion,
  consentText,
} from "./feedback.mjs";
const escape = (t) =>
  String(t)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const own = (o, k) => Object.hasOwn(o, k);
const actualForceEvent = (parsed) =>
  parsed.events.some((x) => ["force", "handcuffs"].includes(x.kind));
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
function render(row, version) {
  const a = answerForDisplay(row, version);
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
  qualifiedPackage = null,
  privateOnly = false,
  dpsProfile = null,
  categoryProfile = null,
}) {
  if (dpsProfile && dpsProfile.categoryId !== "dps") fail("INVALID_DPS_PROFILE", 409);
  if (dpsProfile && categoryProfile) fail("AMBIGUOUS_CATEGORY_PROFILE", 409);
  if (categoryProfile && !["detention_guide", "phone_police", "flooding", "gosuslugi_access", "digital_access", "labor_disputes", "bailiffs", "digital_threats", "neighbors", "collectors", "divorce_property", "debts"].includes(categoryProfile.categoryId)) fail("INVALID_CATEGORY_PROFILE", 409);
  const runtimeProfile = categoryProfile || dpsProfile;
  if (runtimeProfile && (qualifiedPackage || privateOnly))
    fail("AMBIGUOUS_DPS_CONFIGURATION", 409);
  const locks = new Map();
  const catalogs = new WeakMap();
  function catalogFor(engine) {
    if (!catalogs.has(engine))
      catalogs.set(engine, createQuestionCatalog(engine));
    return catalogs.get(engine);
  }
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
    if (runtimeProfile) {
      if (!["dps", "detention_guide", "phone_police", "flooding", "gosuslugi_access", "digital_access", "labor_disputes", "bailiffs", "digital_threats", "neighbors", "collectors", "divorce_property", "debts"].includes(runtimeProfile.categoryId)) fail("INVALID_DPS_PROFILE", 409);
      runtimeProfile.validate(bundle, sha);
      if (!s) {
        const legacy = await read(path.join(dataDir, "explicit-sessions",
          identityKey(id.userId, id.chatId) + ".json"));
        if (legacy && (legacy.userId !== id.userId || legacy.chatId !== id.chatId))
          fail("INVALID_SAVED_STATE", 409);
        s = fresh(id.userId, id.chatId, sha);
        if (legacy) {
          // Legacy counters cannot prove the remaining whole-case allowance.
          // Preserve the closed gate without importing old document facts.
          s.caseState.baselineUsed = 2;
          s.caseState.legacyHistoryComplete = false;
          s.caseState.migrationReason = "dps_legacy_history_incomplete";
        }
      }
      if (!s.activeEpisodeId) episode(s);
      ensureCaseState(s);
      runtimeProfile.prepareState(s);
      if (!s.round) newRound(s, "dps-initial");
      return { s, file, bundle, engine: runtimeProfile, active };
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
    ensureCaseState(s);
    if (s.policyVersion !== policy.version) {
      s.policyVersion = policy.version;
      s.pending = null;
      s.engine = null;
      s.lastResponse = null;
      s.nonce = randomUUID();
    }
    if (s.behaviourVersion !== behaviourVersion) {
      s.behaviourVersion = behaviourVersion;
      s.lastResponse = null;
      if (s.pending?.kind === "issue") {
        s.pending = null;
        s.nonce = randomUUID();
      }
    }
    if (s.round) s.round.questionsUsed = caseQuestionsUsed(s);
    return { s, file, bundle, engine: createExplicitEngine(bundle), active };
  }
  function build(s, engine, stage, force = false) {
    const facts = project(s, stage),
      prev = s.engine;
    if (
      !force &&
      prev?.stageId === stage &&
      fingerprint(prev.facts) === fingerprint(facts)
    ) {
      enhance(s, engine, stage);
      return;
    }
    const entry = engine.entryFor(stage);
    s.engine = engine.start(entry, {
      facts,
      history: prev?.history || [],
      presented: caseQuestionsUsed(s),
      revision: s.revision,
      askedQuestionIds: s.round?.askedQuestionIds || [],
    });
    if (!s.engine.pending && s.engine.status === "answer")
      s.engine = engine.continueNext(s.engine);
    if (
      s.engine.pending &&
      suppressQuestion(
        s,
        { kind: "next", stageId: stage, question: s.engine.pending.question },
        facts,
      )
    ) {
      s.engine.pending = null;
      s.engine.status = "answer";
      s.engine.presented = s.round.questionsUsed || 0;
      s.engine.askedQuestionIds = s.round.askedQuestionIds || [];
    }
    s.round.questionsUsed = caseQuestionsUsed(s);
    s.round.askedQuestionIds = s.engine.askedQuestionIds || [];
    s.pending = s.engine.pending
      ? { kind: "next", question: s.engine.pending.question, stageId: stage }
      : null;
    enhance(s, engine, stage);
  }
  function preserveAdvice(engine, id, stage, facts) {
    return preservesFacts(engine, id, stage, facts);
  }
  function enhance(s, engine, stage) {
    const e = currentEpisode(s),
      facts = project(s, stage);
    const candidates = engine.bundle.subcategories
      .find((x) => x.stage.id === stage)
      .variants.filter((r) =>
        preserveAdvice(engine, r.variant_id, stage, facts),
      );
    const ranked =
      s.retrievalBatch?.episodeId === e.id
        ? (s.retrieval || []).find(
            (h) =>
              h.stageId === stage &&
              candidates.some((r) => r.variant_id === h.variantId),
          )
        : null;
    if (ranked) s.engine.current = ranked.variantId;
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
          s.round.dismissedQuestionIds?.includes(q.id) ||
          s.round.dismissedFields?.includes(q.fieldKey) ||
          Object.entries(q.showWhen.requiredFacts).some(
            ([k, v]) => facts[k] !== v,
          )
        )
          return false;
        // Resolve against the current facts: the package's minimal target may
        // omit another confirmed circumstance (for example forced home entry).
        const targets = q.branches.map((b) =>
          b.nextAction.kind === "variant"
            ? selectAnswer(engine, stage, { ...facts, [q.fieldKey]: b.value })
            : null,
        );
        return targets.every(Boolean) && new Set(targets).size > 1;
      });
    if (!question) return;

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
            : "dm.pps.scope." + key + ".v1",
        question: text,
      },
      key,
      conflictField,
    };
    if (!canServeQuestion(s, s.pending)) {
      s.pending = null;
      return "Не все обстоятельства удалось установить. Доступная помощь основана на том, что уже известно.";
    }
    return text;
  }
  function askRoutingStage(s, engine) {
    const e = currentEpisode(s),
      route = e.unresolvedRouting;
    const candidate = route?.candidates.find(
      (c) => !route.askedStages.includes(c.stageId),
    );
    if (
      !candidate ||
      s.round.questionsUsed >= policy.defaultClarificationLimit
    ) {
      s.pending = null;
      if (catalogFor(engine).fallback(s))
        return retainKnownAdvice(
          s,
          engine,
          "Продолжим по уже известной ситуации. Если появились другие подробности, напишите их.",
        );
      if (route) offerFeedback(s, route.source, "routing_unresolved");
      return unknownMessage;
    }
    route.currentStage = candidate.stageId;
    route.askedStages.push(candidate.stageId);
    s.feedbackOfferId = null;
    return clarification(
      s,
      routingQuestions[candidate.stageId],
      "retrieval_stage",
    );
  }
  function answerRoutingStage(s, engine, value, confirmation) {
    const e = currentEpisode(s),
      route = e.unresolvedRouting;
    if (!route?.currentStage) fail("STALE_ACTION", 409);
    const stage = route.currentStage;
    (e.routingHistory ||= []).push({
      stageId: stage,
      value,
      source: route.source,
      confirmation,
    });
    s.pending = null;
    if (value !== true) return askRoutingStage(s, engine);
    if (e.actor !== "police") fail("ROUTING_ACTOR_UNCONFIRMED", 409);
    e.stageId = stage;
    e.stageConfirmedByUser = true;
    s.articleEntry = null;
    s.feedbackOfferId = null;
    if (stage === "use_of_force") {
      const rec = recordFact(s, "pps.use_of_force.force_actually_used", true, {
        ...route.source,
        confirmation,
      });
      if (rec.status === "conflicted") {
        s.engine = null;
        e.unresolvedRouting = null;
        return clarification(
          s,
          "Вы исправляете прежний ответ или ситуация изменилась?",
          "conflict",
          rec.fieldKey,
        );
      }
      e.dangerOngoing = null;
      e.events.push({
        kind: "force",
        ongoing: null,
        turnId: confirmation.turnId,
        source: confirmation,
      });
    }
    e.stageHistory.push({ stageId: stage, turnId: confirmation.turnId });
    e.unresolvedRouting = null;
    build(s, engine, stage, true);
  }
  async function retrievalFallback(s, parsed, input, bundle, engine, active) {
    const e = currentEpisode(s);
    if (s.pending?.key === "retrieval_stage" && e.unresolvedRouting?.currentStage &&
        !parsed.stage && !parsed.facts.length && !parsed.newEpisode &&
        !parsed.ambiguousActor && e.actor === "police" &&
        (parsed.correction || parsed.intent === "help_now")) {
      return "Чтобы подобрать памятку, осталось уточнить ситуацию: " + s.pending.question.question;
    }
    if (
      !routingEligible(parsed, input.question) ||
      reportedIssue(input.question)
    )
      return null;
    const turnText = input.question.trim();
    const query = turnText;
    if (!turnText) return null;
    const queryKey = hash(
      turnText
        .toLowerCase()
        .replaceAll("ё", "е")
        .replace(/[.!?]+$/u, "")
        .trim(),
    );
    e.routingQueries ||= [];
    if (e.routingQueries.includes(queryKey)) {
      if (
        ["police_actor", "retrieval_stage"].includes(s.pending?.key) &&
        e.unresolvedRouting
      )
        return (
          "Чтобы продолжить, уточните, пожалуйста: " +
          s.pending.question.question
        );
      return null;
    }
    if (active.sha256 !== s.version) return null;
    const batch =
      s.retrievalBatch?.turnId === input.turnId
        ? s.retrievalBatch
        : await retrieveTurn({
            s,
            parsed,
            text: input.question,
            turnId: input.turnId,
            bundle,
            active,
            search,
          });
    const hits = supportedTopicHits(batch, turnText);
    const unavailable = s.retrievalUnavailable;
    let candidates = routingCandidates(hits, bundle, s.version, query, null);
    if (
      e.actor === "police" &&
      e.stageConfirmedByUser &&
      candidates[0]?.stageId === e.stageId &&
      !topicHints(turnText).some((id) => id !== e.stageId)
    ) {
      build(s, engine, e.stageId);
      enhance(s, engine, e.stageId);
      parsed.retrievalAnswered = true;
      s.feedbackOfferId = null;
      return null;
    }
    candidates = candidates.filter(
      (c) => !e.stageConfirmedByUser || c.stageId !== e.stageId,
    );
    // A clear stopping/document clue can still be confirmed if search has no usable topic.
    if (!candidates.length && partialContact(turnText))
      candidates = topicHints(turnText)
        .filter((stage) => !e.stageConfirmedByUser || stage !== e.stageId)
        .map((stageId) => ({ stageId, score: null, basis: "text_hint" }));
    if (!candidates.length) {
      if (unavailable)
        return "Сейчас поиск по базе временно недоступен. Попробуйте повторить сообщение чуть позже.";
      return null;
    }
    e.routingQueries.push(queryKey);
    e.routingQueries = e.routingQueries.slice(-24);
    e.unresolvedRouting = {
      source: parsed.source,
      candidates,
      askedStages: [],
    };
    newRound(s, "routing:" + queryKey);
    s.feedbackOfferId = null;
    if (e.actor !== "police")
      return clarification(s, "Речь о сотруднике полиции?", "police_actor");
    return askRoutingStage(s, engine);
  }
  function answerDocumentQuestion(s, engine, value, confirmation) {
    const e = currentEpisode(s),
      report = e.unresolvedIdentityDocument;
    if (!report) fail("STALE_ACTION", 409);
    e.unresolvedIdentityDocument = null;
    s.pending = null;
    if (value !== true) {
      if (catalogFor(engine).fallback(s))
        return retainKnownAdvice(
          s,
          engine,
          "Тип документа пока не установлен. Продолжим по известной ситуации; памятка о паспорте к этому ответу не применяется.",
        );
      offerFeedback(s, report.source, "document_type_unresolved");
      return "Пока неясно, какой документ забрали. Для этого документа подходящий разбор ещё не установлен. Вы можете описать документ своими словами.";
    }
    const evidence = { ...report.source, confirmation };
    if (e.actor !== "police") {
      e.unresolvedReport = {
        stage: "identity_check",
        facts: [{ field: "identity_check.documents_taken_away", value: true }],
        source: evidence,
      };
      return clarification(s, "Речь о сотруднике полиции?", "police_actor");
    }
    const recorded = recordFact(
      s,
      "pps.identity_check.documents_taken_away",
      true,
      evidence,
    );
    if (recorded.status === "conflicted") {
      s.engine = null;
      return clarification(
        s,
        "Вы исправляете прежний ответ или ситуация изменилась?",
        "conflict",
        recorded.fieldKey,
      );
    }
    e.stageId = "identity_check";
    e.stageConfirmedByUser = true;
    s.articleEntry = null;
    s.feedbackOfferId = null;
    build(s, engine, "identity_check", true);
  }
  function retainKnownAdvice(s, engine, message) {
    const target = catalogFor(engine).fallback(s);
    if (!target) return null;
    s.pending = null;
    if (!s.engine || s.engine.stageId !== target.stageId)
      build(s, engine, target.stageId, true);
    s.pending = null;
    s.engine.pending = null;
    s.engine.status = "answer";
    s.engine.current = target.variantId;
    s.closedAdvice = true;
    return message;
  }
  function answerActorQuestion(s, engine, value, source) {
    const e = currentEpisode(s);
    let text;

    e.actor = value === true ? "police" : value === false ? "other" : null;
    if (e.actor !== "police") {
      s.engine = null;
      e.stageId = null;
      e.stageConfirmedByUser = false;
    }
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
      e.dangerOngoing = e.unresolvedForce?.ongoing ?? e.dangerOngoing ?? null;
      e.unresolvedForce = null;
    } else if (e.actor === "police" && e.unresolvedReport) {
      const saved = e.unresolvedReport;
      e.unresolvedReport = null;
      s.pending = null;
      e.stageId = saved.stage;
      e.stageConfirmedByUser = true;
      for (const f of saved.facts)
        recordFact(
          s,
          "pps." + f.field,
          f.value,
          saved.source,
          f.operation || "assert",
        );
      build(s, engine, saved.stage, true);
    } else if (e.unresolvedRouting) {
      s.pending = null;
      if (e.actor === "police") text = askRoutingStage(s, engine);
      else {
        text =
          value === false
            ? "Эта категория посвящена полиции. Для указанного участника нужен другой разбор. Опишите другую проблему или отправьте ситуацию на разбор."
            : "Участник пока не установлен. Категорию полиции подтвердить не удалось. Вы можете описать, кто к вам обратился.";
        offerFeedback(s, e.unresolvedRouting.source, "actor_unresolved");
        e.unresolvedRouting = null;
      }
    } else {
      s.pending = null;
      text =
        value === null
          ? "Пока неясно, кто к вам обратился. Можете уточнить это позже или описать другую проблему."
          : "Пока у нас нет подходящего разбора для этого участника ситуации.";
      offerFeedback(
        s,
        e.unresolvedReport?.source || {
          turnId: source.turnId,
          quote: source.quote || "Уточнение участника",
        },
        "actor_unresolved",
      );
    }
    return text;
  }
  function answerQuestion(s, engine, value, source) {
    const catalog = catalogFor(engine),
      p = s.pending,
      e = currentEpisode(s);
    if (!catalog.plan(s).admitted) fail("QUESTION_CHANGED", 409);
    const plan = catalog.resolve(s, value);
    answerQuestionReceipt(s, p, value, source);
    s.questionOutcome = {
      ...plan,
      questionId: p.question.id,
      catalogVersion: catalog.version,
    };
    s.closedAdvice = plan.kind === "variant";
    if (plan.operation === "route")
      return answerRoutingStage(s, engine, value, source);
    if (plan.operation === "document")
      return answerDocumentQuestion(s, engine, value, source);
    if (plan.operation === "actor")
      return answerActorQuestion(s, engine, value, source);
    if (plan.operation !== "fact") fail("INVALID_QUESTION_OPERATION");
    if (e.actor !== "police") {
      e.unresolvedReport = {
        stage: plan.stageId,
        facts: [{ field: plan.fieldKey.slice(4), value }],
        source,
      };
      s.pending = null;
      s.engine = null;
      return clarification(s, "Речь о сотруднике полиции?", "police_actor");
    }
    const rec = recordFact(s, plan.fieldKey, value, source);
    if (rec.status === "conflicted") {
      s.engine = null;
      return clarification(
        s,
        "Вы исправляете прежний ответ или ситуация изменилась?",
        "conflict",
        rec.fieldKey,
      );
    }
    if (p.issueId) {
      const issue = e.issues?.find((x) => x.id === p.issueId);
      if (issue) {
        issue.reply = value;
        issue.status = "routed";
      }
    }
    if (
      plan.fieldKey === "pps.use_of_force.force_actually_used" &&
      value === true
    ) {
      e.dangerOngoing ??= null;
      e.events.push({
        kind: "force",
        ongoing: null,
        source,
        turnId: source.turnId,
      });
    }
    s.pending = null;
    s.articleEntry = null;
    e.stageId = plan.stageId;
    e.stageConfirmedByUser = true;
    build(s, engine, plan.stageId, true);
    if (
      !preserveAdvice(
        engine,
        s.engine.current,
        plan.stageId,
        project(s, plan.stageId),
      )
    )
      s.engine.current = plan.variantId;
    s.feedbackOfferId = null;
  }
  function scheduleIssue(s, engine, report, source) {
    const e = currentEpisode(s),
      catalog = catalogFor(engine),
      fallback = catalog.fallback(s);
    e.issues ||= [];
    let issue = e.issues.find(
      (x) => x.kind === report.kind && x.personId === e.personId,
    );
    const repeated = !!issue;
    if (!issue) {
      issue = {
        ...report,
        id: randomUUID(),
        personId: e.personId,
        source,
        status: "reported",
      };
      e.issues.push(issue);
    }
    if (!fallback) {
      s.pending = null;
      offerFeedback(s, source, report.kind);
      return { text: unknownMessage };
    }
    s.closedAdvice = true;
    s.feedbackOfferId = null;
    const field =
      report.kind === "phone_demand"
        ? "pps.delivery_to_station.phone_taken"
        : "pps.use_of_force.force_actually_used";
    const canUseField =
      report.kind !== "phone_demand" ||
      fallback.stageId === "delivery_to_station";
    const known = Object.hasOwn(project(s, field.split(".")[1]), field);
    const currentField =
      s.pending?.fieldKey ||
      (s.pending?.stageId && s.pending.question.field_key
        ? "pps." + s.pending.stageId + "." + s.pending.question.field_key
        : null);
    if (!repeated && canUseField && !known && currentField === field) {
      issue.status = "linked";
      issue.questionId = s.pending.question.id;
      return { prefix: report.summary };
    }
    const investigationKey = field + ":" + e.personId;
    const investigated = e.questionInvestigations?.includes(investigationKey);
    const interruptedPending = s.pending;
    if (
      !repeated &&
      canUseField &&
      !known &&
      !investigated &&
      !s.round.dismissedFields?.includes(field)
    ) {
      // A newly reported circumstance gets one bounded investigation, keyed by
      // the existing field/subject, never by a new issue label or question ID.
      newRound(s, "question-investigation:" + hash(investigationKey));
      (e.questionInvestigations ||= []).push(investigationKey);
      if (interruptedPending) {
        (s.round.dismissedQuestionIds ||= []).push(
          interruptedPending.question.id,
        );
        const interrupted =
          interruptedPending.fieldKey ||
          (interruptedPending.stageId && interruptedPending.question.field_key
            ? "pps." +
              interruptedPending.stageId +
              "." +
              interruptedPending.question.field_key
            : null);
        if (interrupted) (s.round.dismissedFields ||= []).push(interrupted);
        if (s.engine) s.engine.pending = null;
      }
      const key =
        report.kind === "phone_demand" ? "phone_taken" : "actual_force";
      const id = "dm.pps.question." + key + ".v1";
      const pending = {
        kind: "catalog",
        catalogId: id,
        issueId: issue.id,
        fieldKey: field,
        stageId: field.split(".")[1],
        targetStageId: report.kind === "phone_demand" ? null : fallback.stageId,
        question: {
          id,
          question: catalog.definitions.get(id).text,
          data: [true, false, null].map((value) => ({
            value,
            label: value === null ? "Не знаю" : value ? "Да" : "Нет",
          })),
        },
      };
      if (catalog.plan(s, pending).admitted) {
        s.pending = pending;
        (s.round.askedQuestionIds ||= []).push(id);
        issue.status = "clarifying";
        return { prefix: report.summary };
      }
    }
    if (s.pending?.issueId === issue.id) s.pending = null;
    if (report.kind === "phone_demand" && canUseField && known) {
      issue.status = "covered";
      s.feedbackOfferId = null;
      return { prefix: "Эта деталь уже учтена в памятке по поездке в отдел." };
    }
    issue.status = "content_gap";
    e.contentGaps ||= [];
    if (!e.contentGaps.includes(report.kind)) e.contentGaps.push(report.kind);
    offerFeedback(s, source, report.kind);
    return {
      prefix:
        "Отдельной памятки об этой детали пока нет. Продолжим по уже установленной ситуации; доступная памятка остаётся ниже.",
    };
  }

  function urgentAdvice(s, engine) {
    const e = currentEpisode(s),
      facts = project(s, "use_of_force");
    if (
      e.actor !== "police" ||
      e.ambiguousActor ||
      facts["pps.use_of_force.force_actually_used"] !== true
    )
      return null;
    return (
      engine.bundle.subcategories
        .find((x) => x.stage.id === "use_of_force")
        .variants.filter((r) =>
          preserveAdvice(engine, r.variant_id, "use_of_force", facts),
        )
        .sort(
          (a, b) =>
            Object.values(b.context).filter((v) => v !== null).length -
            Object.values(a.context).filter((v) => v !== null).length,
        )[0] || null
    );
  }
  function explainPending(s) {
    const p = s.pending,
      id = p.question.id;
    s.round.explainedQuestionIds ||= [];
    if (!s.round.explainedQuestionIds.includes(id)) {
      s.round.explainedQuestionIds.push(id);
      return questionExplanation(p, s.version);
    }
    (s.round.dismissedQuestionIds ||= []).push(id);
    const field =
      p.fieldKey ||
      (p.stageId && p.question.field_key
        ? "pps." + p.stageId + "." + p.question.field_key
        : null);
    if (field) (s.round.dismissedFields ||= []).push(field);
    s.pending = null;
    if (s.engine) {
      s.engine.pending = null;
      s.engine.status = "answer";
    }
    return "Хорошо, пока продолжим без ответа на этот вопрос. Если появятся другие подробности, напишите их.";
  }
  const actorRoutingPending = (s) =>
    currentEpisode(s).unresolvedRouting && s.pending?.key === "police_actor";
  function present(
    s,
    bundle,
    engine,
    {
      text,
      forceFull = false,
      article = false,
      acknowledgeUnknown = false,
      adviceOverrideId = null,
      noticePrefix = null,
      turnId = "resume",
    } = {},
  ) {
    // Rendering compatible help must not rebuild a conflicted engine or
    // replace the outstanding conflict clarification with another question.
    const fallback = !s.engine?.current ? catalogFor(engine).fallback(s) : null;
    const row = adviceOverrideId
      ? engine.rowFor(adviceOverrideId).row
      : s.engine?.current
        ? engine.rowFor(s.engine.current).row
        : fallback ? engine.rowFor(fallback.variantId).row : null;
    const catalog = catalogFor(engine);
    // A suppressed source question must not block an eligible supplemental
    // question. One replacement attempt is sufficient: enhance filters its
    // candidates for three compatible, useful outcomes before offering one.
    for (let attempt = 0; s.pending && attempt < 2; attempt++) {
      const plan = catalog.plan(s);
      s.questionPlan = plan;
      s.questionCatalogVersion = catalog.version;
      if (!plan.admitted) {
        const qid = s.pending.question.id;
        if (text === s.pending.question.question)
          text =
            "По этой детали полезное уточнение пока недоступно. Можно продолжить по известной ситуации или описать происходящее своими словами.";
        (s.questionGaps ||= []).push({
          questionId: qid,
          reason: plan.reason,
          revision: s.revision,
        });
        s.questionGaps = s.questionGaps.slice(-32);
        if (plan.reason === "no_effect") {
          const dismissed = (s.round.dismissedQuestionIds ||= []);
          if (!dismissed.includes(qid)) dismissed.push(qid);
        }
        s.pending = null;
        if (s.engine) {
          s.engine.pending = null;
          s.engine.status = "answer";
        }
        if (attempt === 0 && s.engine?.stageId)
          enhance(s, engine, s.engine.stageId);
      } else {
        const shown = (s.round.catalogShownQuestionIds ||= []);
        if (!shown.includes(s.pending.question.id))
          shown.push(s.pending.question.id);
        break;
      }
    }
    if (s.pending) bindQuestion(s, s.pending);
    rememberDismissals(s);
    const displayedQuestion = questionText(s.pending, s.version);
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
      text = "Учёл, что ситуация изменилась. Прежняя памятка может требовать уточнения.";
      forceFull = false;
    }
    const fp = row
      ? fingerprint([s.version, row.variant_id, answerForDisplay(row, s.version)])
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
        content = render(row, s.version);
        kind = "full";
      } else {
        content = "Хорошо, учту это.";
        kind = "continuation";
        reference = s.presentation.lastFull.responseId;
      }
    }
    if (!content) content = displayedQuestion ||
      "Пока не удалось установить обстоятельства ситуации. Новые сведения можно добавить в любое время.";
    if (s.feedbackOfferId && !forceFull && !s.closedAdvice) {
      content = text || unknownMessage;
      kind = "notice";
    }
    if (kind === "continuation" && !s.pending)
      content = acknowledgeUnknown
        ? "Хорошо, пока оставим это неизвестным. Можете описать, что происходит сейчас."
        : "Эти обстоятельства уже учтены в памятке выше. Если появилось что-то новое, расскажите об этом.";
    const urgent =
      currentEpisode(s).dangerOngoing === true ? urgentAdvice(s, engine) : null;
    if (noticePrefix) content = escape(noticePrefix) + "\n\n" + content;
    if (
      urgent &&
      row &&
      row.variant_id !== urgent.variant_id &&
      kind !== "notice"
    )
      content =
        "Вы сообщали о продолжающемся применении силы.\n\n" +
        escape(urgent.payload.answer.now) +
        "\n\n" +
        content;
    const responseId = randomUUID();
    if (s.pending && !serveQuestion(s, s.pending, responseId, turnId,
        bundle.metadata.next_policy?.third_question_reasons)) fail("QUESTION_CHANGED", 409);
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
      const data = ["next", "supplemental", "catalog"].includes(p.kind)
        ? p.question.data
        : ["police_actor", "identity_document", "retrieval_stage"].includes(
              p.key,
            ) || p.kind === "issue"
          ? [
              { value: true, label: "Да" },
              { value: false, label: "Нет" },
              { value: null, label: "Не знаю" },
            ]
          : [];
      if (data.length)
        views.push({
          type: "choice",
          questionText: displayedQuestion,
          view: data.map((a) => ({
            type: "badge",
            id: randomUUID(),
            value: a.label,
            question: a.label,
            variantId: "",
            categoryId: bundle.category.id,
            guided: control({
              kind: ["next", "supplemental", "catalog"].includes(p.kind)
                ? "answer"
                : "clarify",
              questionId: p.question.id,
              value: a.value,
            }),
          })),
        });
    }
    const offer = s.feedbackOffers?.find(
      (x) => x.id === s.feedbackOfferId && !x.submitted,
    );
    if (offer)
      views.push({
        type: "actions",
        questionText: "",
        view: [
          {
            type: "badge",
            id: randomUUID(),
            value: "Помочь АЙзащите стать лучше",
            question: "Отправить переписку на разбор",
            variantId: "",
            categoryId: bundle.category.id,
            guided: control({
              kind: "feedback",
              offerId: offer.id,
              consentVersion,
              consentText,
            }),
          },
        ],
      });
    for (const receipt of (s.feedbackOffers || []).filter(
      (x) => x.submitted && !x.withdrawn,
    ))
      views.push({
        type: "actions",
        questionText: "",
        view: [
          {
            type: "badge",
            id: randomUUID(),
            value: "Отозвать согласие и удалить обращение",
            question: "Отозвать согласие и удалить обращение",
            variantId: "",
            categoryId: bundle.category.id,
            guided: control({ kind: "withdraw_feedback", offerId: receipt.id }),
          },
        ],
      });
    if (urgent && row?.variant_id !== urgent.variant_id && kind !== "notice")
      views.push({
        type: "actions",
        questionText: "",
        view: [
          {
            type: "badge",
            id: randomUUID(),
            value: "Памятка о применении силы",
            question: "Показать памятку о применении силы",
            variantId: "",
            categoryId: bundle.category.id,
            guided: control({ kind: "show_urgent_advice" }),
          },
        ],
      });
    if (row && kind !== "full" && !staleAdvice)
      views.push({
        type: "actions",
        questionText: "",
        view: [
          {
            type: "badge",
            id: randomUUID(),
            value: s.feedbackOfferId
              ? "Предыдущая памятка"
              : "Показать памятку",
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
        answerFingerprint:
          !forceFull &&
          !s.closedAdvice &&
          ((s.feedbackOfferId && !s.closedAdvice) ||
            s.pending?.kind === "issue" ||
            s.pending?.key === "retrieval_stage" ||
            Boolean(actorRoutingPending(s)))
            ? null
            : fp,
        referencesResponseId: reference,
        urgentPriority: !!urgent,
        questionCatalogVersion,
      },
      answer: {
        category: bundle.category,
        content,
        variantId:
          !forceFull &&
          !s.closedAdvice &&
          ((article && s.pending) ||
            (s.feedbackOfferId && !s.closedAdvice) ||
            s.pending?.kind === "issue" ||
            s.pending?.key === "retrieval_stage" ||
            Boolean(actorRoutingPending(s)))
            ? undefined
            : row?.variant_id,
        next: views,
      },
    };
  }
  async function internal(input, operation) {
    const id = identity(input);
    return locked(identityKey(id.userId, id.chatId), async () => {
      if (qualifiedPackage) {
        const handler = process.env.CATEGORY_CHILDREN_SITE_MVP === "1" ? (await import("./children-site-session.mjs")).internalQualified : internalQualified;
        const result = await handler(input,operation,{identity:id,file:stateFile(id),qualifiedPackage});
        if (result) return result;
      }
      const file = stateFile(id),
        s = await read(file);
      if (s && !s.deleted) validateState(s, id.userId, id.chatId);
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
        if (s && !s.deleted) await deleteFeedback(dataDir, s);
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
    if (input.guided?.native?.privateDialogue) {
      if (input.privateDialogue) fail("AMBIGUOUS_DIALOGUE_ENVELOPE",409);
      input={...input,privateDialogue:input.guided.native.privateDialogue};
    }
    const id = identity(input);
    return locked(identityKey(id.userId, id.chatId), async () => {
      if (runtimeProfile && input.privateDialogue) fail("DPS_PRIVATE_ENVELOPE_UNSUPPORTED", 409);
      if (input.privateDialogue) {
        if (!qualifiedPackage) fail("PRIVATE_DIALOGUE_NOT_ENABLED", 409);
        const handler = process.env.CATEGORY_CHILDREN_SITE_MVP === "1" ? (await import("./children-site-session.mjs")).respondQualified : respondQualified;
        return handler(input, {identity:id,file:stateFile(id),qualifiedPackage});
      }
      if (privateOnly) fail("PRIVATE_DIALOGUE_ENVELOPE_REQUIRED",409);
      const savedRequestState = await read(stateFile(id));
      const focusedProfile = runtimeProfile ? null : await requestProfile(input, savedRequestState);
      if (focusedProfile) return respondFocusedRequest(input, {
        identity: id, file: stateFile(id), saved: savedRequestState,
        profile: focusedProfile, render,
      });
      const { s, file, bundle, engine, active } = await load(input);
      const action = input.guided?.native?.kind ? input.guided.native : null;
      if (runtimeProfile && input.resume) {
        if (!s.lastResponse) {
          if (["neighbors", "collectors", "divorce_property", "debts"].includes(runtimeProfile.categoryId)) {
            const initial = { ...input, ...(runtimeProfile.categoryId === "collectors" ? { resume: false } : {}), turnId: randomUUID(), question: "" };
            const outcome = runtimeProfile.dispatch(s, initial);
            s.revision++;
            s.nonce = randomUUID();
            const response = runtimeProfile.present(s, outcome, { turnId: initial.turnId });
            return commitResponse(s, file, bundle, initial, response,
              fingerprint({ question: initial.question, action: null,
                variantId: initial.variantId, launchHint: initial.launchHint }));
          }
          const outcome = s.pending
            ? { variantId: runtimeProfile.plan(s).variantId, notice: null }
            : runtimeProfile.dispatch(s, { ...input, question: "" });
          const response = runtimeProfile.present(s, outcome);
          return commitResponse(s, file, bundle,
            { ...input, turnId: randomUUID(), question: "" }, response,
            fingerprint({ resume: true, variantId: input.variantId }));
        }
        return { ...structuredClone(s.lastResponse), _historyEnvelope: s.outbox };
      }
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
          if (s.articleEntry && !s.initialHistorySaved) {
            const responseId = s.lastResponse.presentation.responseId;
            s.outbox = {
              turnId: "initial-" + responseId,
              messageId: responseId,
              createdAt: new Date().toISOString(),
              question: "",
              answer: s.lastResponse.answer.content,
              category: bundle.category.id,
              responseId,
            };
            s.initialHistorySaved = true;
          }
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
      if (s.pending && !bindQuestion(s, s.pending)) fail("STALE_ACTION", 409);
      if (runtimeProfile) {
        const outcome = runtimeProfile.dispatch(s, input);
        s.revision++;
        s.nonce = randomUUID();
        const response = runtimeProfile.present(s, outcome, { turnId: input.turnId });
        return commitResponse(s, file, bundle, input, response, requestHash);
      }
      const reply = pendingReply(s.pending, input, action);
      s.closedAdvice = false;
      s.questionOutcome = null;
      s.round ||= {
        id: randomUUID(),
        triggerEventId: "initial",
        questionsUsed: 0,
        nextPresented: 0,
        clarifications: 0,
      };
      let text,
        adviceOverrideId = null,
        noticePrefix = null,
        forceFull = false;
      if (action?.kind === "submit_feedback") {
        await submitFeedback(dataDir, s, action, input.feedbackTranscript);
        text =
          "Спасибо! Ситуация отправлена на разбор. Мы используем её, чтобы улучшить АЙзащиту. Вы можете продолжить разговор или описать другую проблему.";
      } else if (action?.kind === "withdraw_feedback") {
        await withdrawFeedback(dataDir, s, action.offerId);
        text =
          "Согласие отозвано, отправленное обращение удалено из очереди разбора.";
      } else if (action?.kind === "stage") {
        const stage = input.guided?.stageId;
        if (!bundle.subcategories.some((x) => x.stage.id === stage))
          fail("INVALID_STAGE");
        s.articleEntry = engine.entryFor(stage);
        build(s, engine, stage, true);
        if (!s.pending)
          text =
            "Для этого разбора автоматические уточнения закончились. Доступная помощь основана на известных обстоятельствах.";
      } else if (action?.kind === "show_advice") forceFull = true;
      else if (action?.kind === "show_urgent_advice") {
        const urgent = e.dangerOngoing === true && urgentAdvice(s, engine);
        if (!urgent) fail("STALE_ACTION", 409);
        adviceOverrideId = urgent.variant_id;
        forceFull = true;
      } else if (
        action?.kind === "answer" ||
        action?.kind === "clarify" ||
        reply
      ) {
        if (
          !s.pending ||
          (action && action.questionId !== s.pending.question.id) ||
          !reply ||
          ![true, false, null].includes(reply.value)
        )
          fail("STALE_ACTION", 409);
        text = answerQuestion(s, engine, reply.value, reply.source);
      } else if (action) fail("INVALID_ACTION");
      else if (
        s.pending &&
        conversationalIntent(input.question) === "question_confusion"
      ) {
        s.feedbackOfferId = null;
        text = explainPending(s);
      } else {
        const parsed = interpretTurn(s, input.question, input.turnId);
        if (parsed.resolvedIdentityDocument) e.unresolvedIdentityDocument = null;
        const routingInput = { ...input, question: parsed.evidenceText };
        const pendingBefore = s.pending;
        const factsBefore = fingerprint(s.factLedger);
        if (!parsed.choice) s.feedbackOfferId = null;
        if (parsed.newEpisode) {
          e = episode(s, parsed.newCase ? "new-case" : "new-subject");
          if (parsed.newCase) s.caseState.source = parsed.source;
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
        if (parsed.stage) e.unresolvedRouting = null;
        if (parsed.stage || parsed.facts.length) e.stageConfirmedByUser = true;
        if (parsed.signals?.length)
          e.presentationSignals = [
            ...new Set([
              ...(e.presentationSignals || []),
              ...parsed.signals.map((x) => x.kind),
            ]),
          ];
        if (parsed.actorExplicit) e.actorEvidence = parsed.source;
        if (parsed.itemResolution && e.actor === "police") {
          // The interpreter used the prospective item scope before extracting.
          // Only trusted explicit references are committed to the private map.
          parsed.itemChanged = selectBag(s, parsed.itemResolution);
          if (parsed.itemChanged) forceFull = true;
          if (parsed.itemResolution.kind === "ambiguous") {
            text = clarification(s, "О какой вашей сумке речь: первой или второй?", "describe");
          }
        }
        if (parsed.newDocument) {
          e.documentId = randomUUID();
          newRound(s, "new-document");
          s.engine = null;
        }
        s.recentUserTurns.push({
          turnId: input.turnId,
          episodeId: e.id,
          text: parsed.evidenceText,
          personId: e.personId,
          documentId: e.documentId,
          itemId: e.itemId,
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
          ["describe", "conflict", "actor", "procedure"].includes(s.pending.key)
        ) {
          answerQuestionReceipt(s, s.pending, null, parsed.source);
          s.pending = null;
          text =
            "Хорошо, пока это неизвестно. Уже установленные обстоятельства сохранены.";
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
          e.dangerOngoing =
            e.unresolvedForce?.ongoing ?? e.dangerOngoing ?? null;
          e.unresolvedForce = null;
          s.pending = null;
        }
        if (parsed.actorExplicit && e.unresolvedReport) {
          const saved = e.unresolvedReport;
          parsed.stage ||= saved.stage;
          parsed.facts.push(
            ...saved.facts.map((f) => ({ ...f, originalSource: saved.source })),
          );
          e.unresolvedReport = null;
          parsed.clarification = null;
          s.pending = null;
        }
        if (
          s.pending?.key === "police_actor" &&
          e.unresolvedRouting &&
          parsed.actorExplicit &&
          !parsed.stage
        ) {
          text = askRoutingStage(s, engine);
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
        if (e.actor === "police" && !parsed.ambiguousActor) {
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
        const uncertainContinuation =
          !parsed.stage && !parsed.facts.length && !parsed.newEpisode &&
          !["foreign", "ambiguous"].includes(parsed.itemResolution?.kind) &&
          /не знаю|не помню|не уверен|неизвестно/iu.test(parsed.evidenceText);
        // Retain advice only for a hypothetical continuation about the same
        // known officer and subject. This is presentation, never fact evidence.
        const hypotheticalContinuation =
          !parsed.stage && !parsed.facts.length && !parsed.events.length &&
          !parsed.newEpisode && !parsed.newDocument && !parsed.itemChanged &&
          !parsed.ambiguousActor && !parsed.ambiguousStage &&
          !parsed.deniedStage && !parsed.correction &&
          !["foreign", "ambiguous", "new", "select"].includes(parsed.itemResolution?.kind) &&
          /^(?:а\s+)?если\s+(?:он|они|полицейский|полицейские|сотрудник(?:и)?(?:\s+полиции)?)\s/iu.test(parsed.evidenceText) &&
          !/сосед|охранник|врач|продавец|прохож|друг|родственник|реб[её]н|чуж|новая проблема|новое происшествие|в фильме|в кино/iu.test(parsed.evidenceText) &&
          !!s.engine?.current &&
          catalogFor(engine).fallback(s)?.variantId === s.engine.current;
        const knownDocumentConfirmation =
          !parsed.stage && !parsed.facts.length && !parsed.events.length &&
          !parsed.newEpisode && !parsed.newDocument && !parsed.ambiguousActor &&
          e.stageId === "identity_check" &&
          project(s, "identity_check")["pps.identity_check.documents_taken_away"] === true &&
          /^(?:да[, ]+(?:это )?(?:мой )?паспорт|(?:это )?мой паспорт)[.!?]*$/iu.test(parsed.evidenceText.trim());
        const helpKnown =
          (["help_now", "distress"].includes(parsed.intent) ||
            parsed.restrictionContinuity || uncertainContinuation || hypotheticalContinuation || knownDocumentConfirmation) &&
          e.actor === "police" &&
          !e.ambiguousActor &&
          e.stageConfirmedByUser &&
          e.stageId;
        if (helpKnown) {
          parsed.helpHandled = true;
          if (hypotheticalContinuation)
            noticePrefix =
              "Вы спрашиваете о том, что может случиться. Пока сохраняю памятку по уже описанной ситуации. Если это произошло, расскажите об этом.";
          forceFull ||= ["help_now", "distress"].includes(parsed.intent);
          const urgent = e.dangerOngoing === true && urgentAdvice(s, engine);
          if (urgent) adviceOverrideId = urgent.variant_id;
          if (parsed.intent === "distress") {
            noticePrefix =
              "Вы сообщили, что вам сейчас трудно продолжать разговор. Ниже — доступная памятка по вашей ситуации с полицией.";
            e.contentGaps ||= [];
            if (!e.contentGaps.includes("health_distress"))
              e.contentGaps.push("health_distress");
          }
        }
        const urgentKnown =
          (actualForceEvent(parsed) ||
            parsed.facts.some(
              (f) =>
                f.field === "use_of_force.force_actually_used" &&
                f.value === true,
            )) &&
          e.actor === "police" &&
          !parsed.ambiguousActor &&
          project(s, "use_of_force")["pps.use_of_force.force_actually_used"] ===
            true;
        const ongoingKnown =
          e.dangerOngoing === true &&
          parsed.stage &&
          !parsed.ambiguousActor &&
          urgentAdvice(s, engine);
        const forceCorrection =
          parsed.correction &&
          parsed.facts.some(
            (f) =>
              f.field === "use_of_force.force_actually_used" &&
              f.value !== true,
          );
        if (urgentKnown || helpKnown || ongoingKnown || forceCorrection) {
          parsed.skipRetrieval = true;
          s.retrieval = [];
          s.retrievalBatch = null;
          s.retrievalUnavailable = false;
          s.lastRetrievalDecision = {
            turnId: input.turnId,
            reason: urgentKnown ? "known_urgent_event" : "contextual_help",
          };
        } else
          await retrieveTurn({
            s,
            parsed,
            text: parsed.evidenceText,
            turnId: input.turnId,
            bundle,
            active,
            search,
          });
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
        if (
          parsed.clarification &&
          parsed.clarificationKey === "identity_document"
        ) {
          if (!e.documentTakingClarificationStarted) {
            newRound(s, "document-taking:" + e.id);
            e.documentTakingClarificationStarted = true;
          }
          e.unresolvedIdentityDocument = {
            value: true, source: parsed.source,
            scope: { episodeId: e.id, personId: e.personId, documentId: e.documentId },
          };
          text = clarification(s, parsed.clarification, "identity_document");
          if (!s.pending) {
            text = retainKnownAdvice(s, engine,
              "Тип документа пока не установлен. Продолжим по уже известным обстоятельствам.");
            if (!text) {
              text = unknownMessage;
              offerFeedback(s, parsed.source, "document_type_unresolved");
            }
          }
        } else if (parsed.clarification) {
          s.engine = null;
          e.unresolvedForce =
            parsed.unresolvedForceValue === true
              ? {
                  source: parsed.source,
                  ongoing: parsed.unresolvedForceOngoing,
                }
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
                x.value !== true,
            ) &&
            project(s, "use_of_force")[
              "pps.use_of_force.force_actually_used"
            ] !== true
          ) {
            stage = null;
            e.dangerOngoing = false;
            e.stageId = null;
            s.engine = null;
            s.pending = null;
            text ||=
              "Спасибо за уточнение. Учёл исправление; прежняя оценка этого факта больше не используется.";
          }
          if (stage && e.actor === "police") {
            if (
              parsed.stage &&
              s.articleEntry &&
              engine.rowFor(s.articleEntry).stage.stage.id !== stage
            )
              s.articleEntry = null;
            if (e.stageId !== stage) {
              if (e.stageId && parsed.stage && !actualForceEvent(parsed) && !parsed.resolvedIdentityDocument)
                newRound(s, "stage:" + stage + ":" + input.turnId);
              e.stageHistory.push({ stageId: stage, turnId: input.turnId });
            }
            e.stageId = stage;
            if (!text) build(s, engine, stage);
          } else if (parsed.stage && !e.actor && !parsed.ambiguousActor) {
            e.unresolvedReport = {
              stage: parsed.stage,
              facts: parsed.facts,
              source: parsed.source,
            };
            text = clarification(
              s,
              "Речь о сотруднике полиции?",
              "police_actor",
            );
          } else if (
            s.articleEntry &&
            s.pending?.kind === "next" &&
            !parsed.stage
          ) {
            build(s, engine, s.engine.stageId);
          } else if (!text && !s.engine) {
            const routingText = await retrievalFallback(
              s,
              parsed,
              routingInput,
              bundle,
              engine,
              active,
            );
            if (routingText) text = routingText;
            else if (!parsed.retrievalAnswered) {
              s.pending = null;
              text = unknownMessage;
              offerFeedback(s, parsed.source, "unrecognized");
            }
          }
        }
        const issueReport = reportedIssue(parsed.evidenceText);
        const actualForce = parsed.events.some((x) =>
          ["force", "handcuffs"].includes(x.kind),
        );
        const answeredQuestion = Boolean(parsed.choice && pendingBefore);
        const progressed =
          parsed.stage ||
          parsed.facts.length ||
          parsed.itemChanged ||
          parsed.itemResolution?.kind === "ambiguous" ||
          fingerprint(s.factLedger) !== factsBefore ||
          parsed.signals?.length ||
          parsed.correction ||
          parsed.deniedStage ||
          parsed.retrievalAnswered ||
          parsed.helpHandled;
        if (pendingBefore?.kind === "clarification" &&
            ["describe", "conflict", "actor", "procedure"].includes(pendingBefore.key) &&
            !parsed.newEpisode && !parsed.newDocument && !parsed.itemChanged &&
            bindQuestion(s, pendingBefore) &&
            (parsed.facts.length || parsed.stage || parsed.actorExplicit)) {
          answerQuestionReceipt(s, pendingBefore, null, parsed.source);
          if (s.pending === pendingBefore) s.pending = null;
        }
        if (
          !actualForce &&
          !answeredQuestion &&
          parsed.intent !== "show_advice" &&
          !parsed.clarification
        ) {
          if (
            issueReport &&
            e.actor === "police" &&
            !parsed.stage &&
            !parsed.facts.length &&
            !parsed.ambiguousStage
          ) {
            const result = scheduleIssue(s, engine, issueReport, parsed.source);
            text = result.text;
            noticePrefix = result.prefix;
          } else if (!progressed && !text && !parsed.choice) {
            const routingText = await retrievalFallback(
              s,
              parsed,
              routingInput,
              bundle,
              engine,
              active,
            );
            if (routingText) text = routingText;
            else if (!parsed.retrievalAnswered) {
              s.pending = null;
              text = unknownMessage;
              offerFeedback(s, parsed.source, "unrecognized");
            }
          } else if (
            !progressed &&
            text &&
            s.round.questionsUsed >= 2 &&
            !s.retrievalUnavailable &&
            !s.pending
          ) {
            text = unknownMessage;
            offerFeedback(s, parsed.source, "unrecognized");
          }
        }
      }
      s.revision++;
      s.nonce = randomUUID();
      const response = present(s, bundle, engine, {
        text,
        forceFull,
        adviceOverrideId,
        noticePrefix,
        turnId: input.turnId,
        acknowledgeUnknown:
          action?.value === null ||
          /^(?:не знаю|не помню)[.!]?$/iu.test(input.question.trim()),
        article: Boolean(s.articleEntry) && !forceFull,
      });
      return commitResponse(s, file, bundle, input, response, requestHash);
    });
  }
  // Shared persistence/delivery transaction for PPS and explicit category profiles.
  async function commitResponse(s, file, bundle, input, response, requestHash) {
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
            ["choice", "text"].includes(x.type) &&
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
  }
  return { respond, internal };
}
