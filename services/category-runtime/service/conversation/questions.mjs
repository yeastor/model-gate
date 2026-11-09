import { dialoguePackage, validateDialoguePackage } from "./package.mjs";
import { routingQuestions } from "./routing.mjs";
import { currentEpisode, project, canServeQuestion, questionDismissed } from "./state.mjs";

export const questionCatalogVersion = "pps-question-catalog/20261023-v1";
export const questionValues = Object.freeze([true, false, null]);
export function choiceValue(text) {
  const t = text.trim().toLowerCase().replaceAll("ё", "е");
  if (/^(?:да)[.!?]*$/u.test(t)) return { value: true };
  if (/^нет[.!?]*$/u.test(t)) return { value: false };
  if (/^не (?:знаю|помню)[.!?]*$/u.test(t)) return { value: null };
  return null;
}
export function pendingReply(pending, input, action) {
  if (!pending) return null;
  if (["actor", "procedure", "conflict", "describe"].includes(pending.key))
    return null;
  if (action && ["answer", "clarify"].includes(action.kind))
    return {
      value: action.value,
      source: {
        kind: "button",
        turnId: input.turnId,
        questionId: action.questionId,
      },
    };
  if (action) return null;
  let reply = choiceValue(input.question);
  if (
    !reply &&
    pending.key === "identity_document" &&
    /^(?:да[, ]+(?:это )?(?:мой )?паспорт|(?:это )?мой паспорт)[.!?]*$/iu.test(
      input.question.trim(),
    )
  )
    reply = { value: true };
  if (!reply) return null;
  return {
    ...reply,
    source: {
      kind: "user_text",
      turnId: input.turnId,
      questionId: pending.question.id,
      quote: input.question,
    },
  };
}
export function preservesFacts(engine, id, stage, facts) {
  if (!id || !engine.compatible(id, facts)) return false;
  const rows = engine.bundle.subcategories.find(
    (s) => s.stage.id === stage,
  )?.variants;
  if (!rows || engine.rowFor(id).stage.stage.id !== stage) return false;
  const row = engine.rowFor(id).row;
  return Object.entries(facts).every(([key, value]) => {
    if (![true, false].includes(value)) return true;
    const field = key.split(".").at(-1);
    return (
      !rows.some((r) => r.context[field] === value) ||
      row.context[field] === value
    );
  });
}
export function selectAnswer(engine, stage, facts, preferred = null) {
  if (preservesFacts(engine, preferred, stage, facts)) return preferred;
  return (
    engine.bundle.subcategories
      .find((s) => s.stage.id === stage)
      ?.variants.filter((r) =>
        preservesFacts(engine, r.variant_id, stage, facts),
      )
      .sort(
        (a, b) =>
          Object.values(a.context).filter((v) => v !== null).length -
            Object.values(b.context).filter((v) => v !== null).length ||
          a.variant_id.localeCompare(b.variant_id),
      )[0]?.variant_id || null
  );
}
export function validateQuestionDefinition(def, engine) {
  if (def.inputMode === "text") {
    if (!def.id || def.operation !== "free_text" || !def.fallback?.reason)
      throw Error("QUESTION_SCOPE_INVALID");
    return def;
  }
  if (
    !def.id ||
    !Array.isArray(def.branches) ||
    def.branches.length !== 3 ||
    questionValues.some(
      (v) => def.branches.filter((b) => b.value === v).length !== 1,
    )
  )
    throw Error("QUESTION_BRANCHES_INVALID");
  const allowed = new Set(["variant", "stage", "scope", "describe"]);
  for (const b of def.branches) {
    if (!allowed.has(b.kind)) throw Error("QUESTION_DESTINATION_INVALID");
    if (b.kind === "variant" && !b.variantId)
      throw Error("QUESTION_TARGET_MISSING");
    if (b.variantId) engine.rowFor(b.variantId);
    if (
      b.kind === "stage" &&
      !engine.bundle.subcategories.some((s) => s.stage.id === b.stageId)
    )
      throw Error("QUESTION_STAGE_INVALID");
    if (["scope", "describe"].includes(b.kind) && !b.reason)
      throw Error("QUESTION_BOUNDARY_REASON_REQUIRED");
  }
  return def;
}
export function createQuestionCatalog(engine) {
  validateDialoguePackage(engine.bundle);
  const definitions = new Map(),
    fields = new Set(dialoguePackage.fields.map((f) => f.fieldKey));
  const add = (def) => {
    if (definitions.has(def.id)) throw Error("QUESTION_DUPLICATE");
    if (
      !["fact", "route", "actor", "document", "free_text"].includes(
        def.operation,
      )
    )
      throw Error("QUESTION_OPERATION_INVALID");
    validateQuestionDefinition(def, engine);
    definitions.set(def.id, def);
  };
  function sourceQuestion(q, stage, stack = new Set()) {
    if (stack.has(q.id)) throw Error("QUESTION_CYCLE");
    if (definitions.has(q.id)) return;
    if (q.data.some((b) => !b.go_to_variant && !b.ask_next_question))
      throw Error("QUESTION_TARGET_MISSING");
    const fieldKey = "pps." + stage + "." + q.field_key;
    if (!fields.has(fieldKey)) throw Error("QUESTION_FIELD_INVALID");
    add({
      id: q.id,
      source: "existing_next",
      operation: "fact",
      stageId: stage,
      fieldKey,
      text: q.question,
      branches: q.data.map((b) => ({
        value: b.value,
        kind: b.go_to_variant ? "variant" : "stage",
        variantId: b.go_to_variant,
        stageId: stage,
        nextQuestionId: b.ask_next_question?.id,
      })),
    });
    for (const b of q.data)
      if (b.ask_next_question)
        sourceQuestion(b.ask_next_question, stage, new Set([...stack, q.id]));
  }
  for (const s of engine.bundle.subcategories)
    for (const r of s.variants)
      for (const q of r.payload.next) sourceQuestion(q, s.stage.id);
  for (const q of dialoguePackage.questions.filter(
    (q) => q.purpose === "context",
  ))
    add({
      id: q.id,
      source: "supplemental_context",
      operation: "fact",
      stageId: q.stageId,
      fieldKey: q.fieldKey,
      text: q.question,
      branches: q.branches.map((b) => ({
        value: b.value,
        kind: "variant",
        variantId: b.nextAction.variantId,
      })),
    });
  for (const [stage, text] of Object.entries(routingQuestions))
    add({
      id: "dm.pps.route." + stage + ".v1",
      source: "routing",
      operation: "route",
      stageId: stage,
      text,
      branches: questionValues.map((value) =>
        value === true
          ? { value, kind: "stage", stageId: stage }
          : { value, kind: "describe", reason: "route_not_confirmed" },
      ),
    });
  for (const [key, operation] of [
    ["police_actor", "actor"],
    ["identity_document", "document"],
    ["actual_force", "fact"],
    ["phone_taken", "fact"],
  ])
    add({
      id: "dm.pps.question." + key + ".v1",
      source: "service_context",
      operation,
      key,
      text:
        key === "actual_force"
          ? routingQuestions.use_of_force
          : key === "phone_taken"
            ? "Телефон уже забрали?"
            : key === "police_actor"
              ? "Речь о сотруднике полиции?"
              : "Речь о вашем паспорте или другом документе, удостоверяющем личность?",
      branches: questionValues.map((value) => ({
        value,
        kind: "describe",
        reason: "requires_current_scope",
      })),
    });
  // These are free-text scope gates, not yes/no questions or legal conclusions.
  const freeTextKeys = new Set(["actor", "procedure", "conflict", "describe"]);
  for (const key of freeTextKeys)
    add({
      id: "dm.pps.scope." + key + ".v1",
      source: "scope",
      operation: "free_text",
      inputMode: "text",
      fallback: { kind: "describe", reason: "scope_unresolved" },
    });
  for (const d of definitions.values())
    for (const b of d.branches || [])
      if (b.nextQuestionId && !definitions.has(b.nextQuestionId))
        throw Error("QUESTION_NEXT_MISSING");
  function describe(p, s) {
    if (!p) return null;
    if (definitions.has(p.question.id)) return definitions.get(p.question.id);
    if (p.key === "retrieval_stage")
      return definitions.get(
        "dm.pps.route." +
          currentEpisode(s).unresolvedRouting?.currentStage +
          ".v1",
      );
    if (["police_actor", "identity_document"].includes(p.key))
      return definitions.get("dm.pps.question." + p.key + ".v1");
    if (p.kind === "catalog") return definitions.get(p.catalogId);
    if (freeTextKeys.has(p.key))
      return definitions.get("dm.pps.scope." + p.key + ".v1");
    return null;
  }
  function fallback(s) {
    const e = currentEpisode(s),
      stage =
        e.stageConfirmedByUser && e.actor === "police" && !e.ambiguousActor
          ? e.stageId
          : null;
    const variantId = stage
      ? selectAnswer(engine, stage, project(s, stage), s.engine?.current)
      : null;
    return variantId ? { kind: "variant", stageId: stage, variantId } : null;
  }
  function plan(s, p = s.pending) {
    const def = describe(p, s);
    if (!def)
      return { admitted: false, reason: "unregistered_question", branches: [] };
    const e = currentEpisode(s),
      keep = fallback(s);
    if (def.inputMode === "text")
      return {
        id: def.id,
        source: def.source,
        operation: "free_text",
        admitted: canServeQuestion(s, p, engine.bundle.metadata.next_policy?.third_question_reasons),
        reason: !canServeQuestion(s, p, engine.bundle.metadata.next_policy?.third_question_reasons) ? "question_budget" : null,
        inputMode: "text",
        branches: [],
        fallback: keep || { kind: "describe", reason: "scope_unresolved" },
      };
    const fieldKey = p.fieldKey || def.fieldKey;
    const branches = questionValues.map((value) => {
      if (def.operation === "fact") {
        const stage =
            p.targetStageId && value !== true
              ? p.targetStageId
              : p.stageId || def.stageId,
          facts = { ...project(s, stage) };
        if (fieldKey?.startsWith("pps." + stage + ".")) facts[fieldKey] = value;
        const target = selectAnswer(
          engine,
          stage,
          facts,
          s.engine?.stageId === stage ? s.engine.current : null,
        );
        return {
          value,
          kind: e.actor === "police" ? "variant" : "describe",
          reason: e.actor === "police" ? undefined : "police_actor_unconfirmed",
          stageId: stage,
          variantId: target,
          fieldKey,
          operation: "fact",
        };
      }
      if (def.operation === "route") {
        if (value !== true)
          return {
            value,
            ...(keep || { kind: "describe", reason: "route_not_confirmed" }),
            operation: "route",
          };
        const facts = { ...project(s, def.stageId) };
        if (def.stageId === "use_of_force")
          facts["pps.use_of_force.force_actually_used"] = true;
        return {
          value,
          kind: "variant",
          stageId: def.stageId,
          variantId: selectAnswer(engine, def.stageId, facts),
          operation: "route",
        };
      }
      if (def.operation === "document") {
        if (value !== true)
          return {
            value,
            ...(keep || { kind: "describe", reason: "document_type_unknown" }),
            operation: "document",
          };
        const facts = {
          ...project(s, "identity_check"),
          "pps.identity_check.documents_taken_away": true,
        };
        return {
          value,
          kind: e.actor === "police" ? "variant" : "describe",
          stageId: "identity_check",
          variantId: selectAnswer(engine, "identity_check", facts),
          reason: "police_actor_unconfirmed",
          operation: "document",
        };
      }
      if (def.operation === "actor") {
        if (value !== true)
          return {
            value,
            kind: value === false ? "scope" : "describe",
            reason:
              value === false
                ? "outside_police_category"
                : "police_actor_unknown",
            operation: "actor",
          };
        const saved = e.unresolvedReport,
          stage = e.unresolvedForce
            ? "use_of_force"
            : saved?.stage || e.unresolvedRouting?.candidates?.[0]?.stageId;
        if (!stage)
          return {
            value,
            kind: "describe",
            reason: "procedure_unknown",
            operation: "actor",
          };
        const facts = { ...project(s, stage) };
        for (const f of saved?.facts || []) facts["pps." + f.field] = f.value;
        if (e.unresolvedForce)
          facts["pps.use_of_force.force_actually_used"] = true;
        return {
          value,
          kind: e.unresolvedRouting ? "describe" : "variant",
          reason: e.unresolvedRouting
            ? "procedure_confirmation_required"
            : undefined,
          nextQuestionId: e.unresolvedRouting
            ? "dm.pps.route." + stage + ".v1"
            : undefined,
          stageId: stage,
          variantId: selectAnswer(engine, stage, facts),
          operation: "actor",
        };
      }
      return { value, kind: "describe", reason: "unsupported_operation" };
    });
    const knownField =
      fieldKey && Object.hasOwn(project(s, fieldKey.split(".")[1]), fieldKey);
    const noEffect =
      branches.every((b) => b.kind === "variant") &&
      new Set(branches.map((b) => b.variantId)).size === 1 &&
      !def.branches.some((b) => b.nextQuestionId);
    const dismissed = questionDismissed(s, p);
    const withinBudget = canServeQuestion(s, p, engine.bundle.metadata.next_policy?.third_question_reasons);
    const scopeAllowed =
      e.actor !== "other" &&
      !e.ambiguousActor &&
      !dialoguePackage.blockedFields.includes(fieldKey);
    const admitted =
      scopeAllowed &&
      !dismissed &&
      !knownField &&
      !noEffect &&
      withinBudget &&
      branches.every(
        (b) =>
          (b.kind !== "variant" && b.operation !== "fact") || !!b.variantId,
      );
    return {
      id: def.id,
      source: def.source,
      operation: def.operation,
      fieldKey,
      admitted,
      reason: !scopeAllowed
        ? "scope_or_field_not_reviewed"
        : dismissed
          ? "question_dismissed"
          : knownField
            ? "field_already_known"
            : noEffect
              ? "no_effect"
              : !withinBudget
                ? "question_budget"
                : admitted
                  ? null
                  : "no_compatible_destination",
      branches,
    };
  }
  return {
    version: questionCatalogVersion,
    definitions,
    describe,
    plan,
    fallback,
    resolve(s, value) {
      const p = plan(s);
      if (!p.admitted) throw Error("QUESTION_NOT_ADMISSIBLE");
      const branch = p.branches.find((b) => b.value === value);
      if (!branch) throw Error("QUESTION_VALUE_INVALID");
      return branch;
    },
  };
}

// Register a pinned single-stage profile with the common question validators.
// Every outcome must resolve while preserving all other positive facts.
export function createScopedQuestionCatalog(profile) {
  const stage = profile.stage;
  const engine = {
    bundle: { subcategories: [stage] },
    rowFor(id) {
      const row = stage.variants.find(r => r.variant_id === id);
      if (!row) throw Error("QUESTION_TARGET_MISSING");
      return { row, stage };
    },
  };
  const focus = validateQuestionDefinition({
    ...profile.focusQuestion, inputMode: "text", operation: "free_text",
    fallback: { reason: "Keep request unbound; never infer a sending fact." },
  }, engine);
  const ids = new Set([focus.id]);
  const fields = new Set(stage.context_fields.map(f => f.id));
  const signature = context => Object.keys(context).filter(k => context[k] === true).sort().join("|");
  for (const q of profile.questions) {
    if (ids.has(q.id)) throw Error("QUESTION_DUPLICATE");
    ids.add(q.id);
    if (!fields.has(q.field)) throw Error("QUESTION_FIELD_INVALID");
    validateQuestionDefinition({ ...q, operation: "fact",
      fieldKey: profile.category.id + "." + stage.stage.id + "." + q.field,
      branches: questionValues.map(value => ({ value, kind: "stage", stageId: stage.stage.id })),
    }, engine);
    for (const row of stage.variants) for (const value of questionValues) {
      const key = signature({ ...row.context, [q.field]: value });
      if (stage.variants.filter(r => signature(r.context) === key).length !== 1)
        throw Error("QUESTION_TARGET_UNAVAILABLE");
    }
  }
  return { focus, questions: profile.questions };
}
