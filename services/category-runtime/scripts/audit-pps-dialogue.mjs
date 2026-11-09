import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createExplicitEngine } from "../service/explicit/engine.mjs";
import { validateExplicitBundle } from "../service/explicit/contract.mjs";
import { dialoguePackage } from "../service/conversation/package.mjs";
import { createConversationService } from "../service/conversation/service.mjs";
import {
  fresh,
  episode,
  newRound,
  recordFact,
  project,
  hash,
  identityKey,
  atomic,
} from "../service/conversation/state.mjs";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const outputArg = process.argv.find((arg) => arg.startsWith("--output-dir="));
const out = outputArg
  ? path.resolve(root, outputArg.slice("--output-dir=".length))
  : path.join(root, "work/pps-broad-audit-20261023-v1");
await fs.mkdir(out, { recursive: true });
const sourcePath =
  "C:/Users/mujlo/Documents/Codex/model-category-document-generator/work/pps-natural-speech-content-seal-20261022-v2/pps.final.json";
const bytes = await fs.readFile(sourcePath),
  bundle = JSON.parse(bytes);
if (hash(bytes.toString()) !== dialoguePackage.categorySha256)
  throw Error("SOURCE_HASH_MISMATCH");
const engine = createExplicitEngine(bundle);
const originalQuestions = new Map();
const rows = new Map(
  bundle.subcategories.flatMap((s) =>
    s.variants.map((r) => [r.variant_id, { row: r, stage: s.stage.id }]),
  ),
);
const inventory = new Map();
const paths = [];
function walk(q, row, stage, facts = {}, chain = []) {
  const key = stage + ":" + q.id;
  originalQuestions.set(q.id, { q, stage });
  const found = inventory.get(key) || {
    id: q.id,
    stage,
    field: q.field_key,
    text: q.question,
    variants: [],
  };
  found.variants.push(row.variant_id);
  inventory.set(key, found);
  for (const a of q.data) {
    const known = { ...facts, ["pps." + stage + "." + q.field_key]: a.value };
    const nextChain = [
      ...chain,
      { questionId: q.id, field: q.field_key, value: a.value },
    ];
    if (a.ask_next_question)
      walk(a.ask_next_question, row, stage, known, nextChain);
    else {
      const target = rows.get(a.go_to_variant);
      const missing = target
        ? Object.entries(target.row.context)
            .filter(
              ([k, v]) =>
                v !== null && known["pps." + target.stage + "." + k] !== v,
            )
            .map(([k, v]) => ({
              field: "pps." + target.stage + "." + k,
              value: v,
            }))
        : ["missing_target"];
      paths.push({
        entryVariant: row.variant_id,
        target: a.go_to_variant,
        chain: nextChain,
        missing,
      });
    }
  }
}
for (const s of bundle.subcategories)
  for (const r of s.variants)
    for (const q of r.payload.next) walk(q, r, s.stage.id);
const staticReport = {
  sourcePath,
  sourceSha: dialoguePackage.categorySha256,
  validation: validateExplicitBundle(bundle),
  uniqueQuestions: [...inventory.values()],
  leafPaths: paths.length,
  incompleteLeafPaths: paths.filter((p) => p.missing.length),
  simulation: {
    terminal: 0,
    compatibleAnswers: 0,
    holds: 0,
    invalidAnswers: [],
  },
};
for (const { row, stage } of rows.values()) {
  for (const mode of ["empty", "known-source-context"]) {
    const facts =
      mode === "empty"
        ? {}
        : Object.fromEntries(
            Object.entries(row.context)
              .filter(([, v]) => v !== null)
              .map(([k, v]) => ["pps." + stage + "." + k, v]),
          );
    const start = engine.start(row.variant_id, {
      facts,
      history: [],
      presented: 0,
      revision: 0,
      askedQuestionIds: [],
    });
    function expand(s, trace = []) {
      if (s.pending) {
        if (trace.length >= 4) throw Error("AUDIT_DEPTH_LIMIT");
        for (const value of [true, false, null])
          expand(engine.answer(s, value), [...trace, value]);
      } else {
        staticReport.simulation.terminal++;
        if (s.status === "hold") staticReport.simulation.holds++;
        if (s.current && engine.compatible(s.current, s.facts))
          staticReport.simulation.compatibleAnswers++;
        else if (s.status === "answer")
          staticReport.simulation.invalidAnswers.push({
            entry: row.variant_id,
            mode,
            trace,
            current: s.current,
          });
      }
    }
    expand(start);
  }
}
staticReport.supplemental = dialoguePackage.questions
  .filter((q) => q.purpose === "context")
  .map((q) => ({
    id: q.id,
    stage: q.stageId,
    field: q.fieldKey,
    text: q.question,
  }));
await fs.writeFile(
  path.join(out, "graph-audit.json"),
  JSON.stringify(staticReport, null, 2),
);
console.log(
  JSON.stringify({
    phase: "graph",
    variants: rows.size,
    questions: inventory.size,
    leaves: paths.length,
    incomplete: staticReport.incompleteLeafPaths.length,
    simulation: staticReport.simulation,
  }),
);
if (process.argv.includes("--graph-only")) process.exit(0);
let search = async () => [];
if (process.argv.includes("--live-search"))
  ({ search } = await import("../service/storage.mjs"));
const urgent = process.argv.includes("--urgent");
const corpusArg = process.argv.find((arg) => arg.startsWith("--corpus="));
const corpus = JSON.parse(
  await fs.readFile(
    corpusArg
      ? path.resolve(root, corpusArg.slice("--corpus=".length))
      : new URL(
          urgent
            ? "../testdata/pps-urgent-audit-20261023-v1.json"
            : "../testdata/pps-broad-audit-20261023-v1.json",
          import.meta.url,
        ),
    "utf8",
  ),
);
const mode =
  (process.argv.includes("--live-search") ? "live-search" : "no-search") +
  (urgent ? "-urgent" : "");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "pps-audit-"));
const results = [];
const questionTarget = (s) => {
  const e = s.episodes.find((x) => x.id === s.activeEpisodeId);
  return e.unresolvedRouting?.currentStage;
};
try {
  for (const c of corpus.cases) {
    const id = randomUUID(),
      userId = "999999999988",
      s = fresh(userId, id, dialoguePackage.categorySha256),
      e = episode(s);
    e.actor = c.initial.actor || null;
    e.stageId = c.initial.stageId || null;
    e.stageConfirmedByUser = !!e.stageId;
    newRound(s, "audit");
    for (const [k, v] of Object.entries(c.initial.activeFacts || {}))
      recordFact(s, k, v, { kind: "audit_fixture", turnId: "prior" });
    const file = path.join(
      temp,
      "conversation-sessions-v2",
      identityKey(userId, id) + ".json",
    );
    await atomic(file, s);
    const svc = createConversationService({
      dataDir: temp,
      getActive: async () => ({ sha256: dialoguePackage.categorySha256 }),
      getBundle: async () => bundle,
      search,
    });
    let prior = null,
      lastFull = null;
    const failures = [],
      trace = [];
    for (const [i, turn] of c.turns.entries()) {
      let text = turn.text,
        guided;
      if (Object.hasOwn(turn, "value")) {
        const control = prior?.answer.next
          .flatMap((g) => g.view)
          .find((v) => v.guided?.native.value === turn.value);
        if (!control) {
          failures.push({
            turn: i + 1,
            kind: "NO_CHOICE",
            expected: turn.value,
          });
          break;
        }
        text = control.question;
        guided = control.guided;
      }
      const turnId = randomUUID(),
        start = Date.now();
      let r;
      try {
        r = await svc.respond({
          id,
          userId,
          protocolVersion: 2,
          turnId,
          question: text,
          guided,
          conversation: prior?.conversation,
        });
        await svc.internal({ id, userId, turnId }, "ack");
      } catch (error) {
        failures.push({
          turn: i + 1,
          kind: "EXCEPTION",
          message: error.message,
        });
        break;
      }
      const saved = JSON.parse(await fs.readFile(file, "utf8")),
        ep = saved.episodes.find((x) => x.id === saved.activeEpisodeId);
      const facts = Object.assign(
        {},
        ...bundle.subcategories.map((sub) => project(saved, sub.stage.id)),
      );
      const exp = turn.expect || {},
        actualStage = r.answer.variantId
          ? rows.get(r.answer.variantId)?.stage
          : null;
      const fail = (kind, expected, actual) =>
        failures.push({ turn: i + 1, kind, expected, actual });
      if (exp.stage && r.guided.stageId !== exp.stage)
        fail("STAGE", exp.stage, r.guided.stageId);
      if (exp.full && r.presentation.kind !== "full")
        fail("EXPECTED_IMMEDIATE_ADVICE", "full", r.presentation.kind);
      if (exp.acceptableTopic) {
        const proposed = questionTarget(saved);
        if (actualStage && actualStage !== exp.acceptableTopic)
          fail("WRONG_ADVICE_TOPIC", exp.acceptableTopic, actualStage);
        else if (!actualStage && proposed && proposed !== exp.acceptableTopic)
          fail("WRONG_PROPOSED_TOPIC", exp.acceptableTopic, proposed);
        else if (!actualStage && !proposed && !saved.pending)
          fail("NO_USEFUL_ROUTE", exp.acceptableTopic, r.presentation.kind);
      }
      for (const [k, v] of Object.entries(exp.mustFacts || {}))
        if (facts[k] !== v)
          fail("FACT", { [k]: v }, { [k]: facts[k] ?? "absent" });
      for (const k of exp.forbidTrue || [])
        if (facts[k] === true)
          fail(
            "FALSE_POSITIVE_FACT",
            { [k]: "must not be true" },
            { [k]: true },
          );
      for (const k of exp.absentFacts || [])
        if (Object.hasOwn(facts, k)) fail("EPISODE_FACT_LEAK", k, facts[k]);
      if (exp.pendingKey && saved.pending?.key !== exp.pendingKey)
        fail(
          "PENDING",
          exp.pendingKey,
          saved.pending?.key || saved.pending?.kind || null,
        );
      if (
        Object.hasOwn(exp, "urgentPriority") &&
        r.presentation.urgentPriority !== exp.urgentPriority
      )
        fail(
          "URGENT_PRIORITY",
          exp.urgentPriority,
          r.presentation.urgentPriority,
        );
      if (exp.notFull && r.presentation.kind === "full")
        fail("OBSOLETE_FULL_ADVICE", "not full", r.answer.variantId);
      if (exp.noAdvice && r.answer.variantId)
        fail("UNRELATED_ADVICE", "no legal answer", r.answer.variantId);
      if (
        exp.noUnknownFallback &&
        r.answer.next
          .flatMap((g) => g.view)
          .some((v) => v.guided?.native.kind === "feedback")
      )
        fail(
          "URGENT_OR_CURRENT_ISSUE_FALLBACK",
          "preserve useful response to current situation",
          r.presentation.kind,
        );
      if (
        Object.hasOwn(exp, "dangerOngoing") &&
        ep.dangerOngoing !== exp.dangerOngoing
      )
        fail("CURRENT_DANGER", exp.dangerOngoing, ep.dangerOngoing);
      if (
        exp.noIdenticalFullRepeat &&
        r.presentation.kind === "full" &&
        r.presentation.answerFingerprint === lastFull
      )
        fail("FULL_REPEAT", "no identical full answer", r.answer.variantId);
      if (
        r.answer.variantId &&
        !engine.compatible(r.answer.variantId, project(saved, actualStage))
      )
        fail("INCOMPATIBLE_ADVICE", "compatible", r.answer.variantId);
      trace.push({
        turn: i + 1,
        input: text,
        kind: r.presentation.kind,
        variantId: r.answer.variantId || null,
        stage: r.guided.stageId,
        pending: saved.pending
          ? {
              kind: saved.pending.kind,
              key: saved.pending.key,
              field: saved.pending.fieldKey || saved.pending.question.field_key,
              text: saved.pending.question.question,
            }
          : null,
        proposedStage: questionTarget(saved) || null,
        activeFacts: facts,
        durationMs: Date.now() - start,
        searchFailures: saved.retrievalBatch?.failed,
        answerExcerpt: r.answer.content.slice(0, 260),
      });
      if (r.presentation.kind === "full")
        lastFull = r.presentation.answerFingerprint;
      prior = r;
    }
    results.push({
      id: c.id,
      family: c.family,
      status: failures.length ? "FAIL" : "PASS",
      failures,
      trace,
    });
    if (results.length % 10 === 0)
      console.log(
        JSON.stringify({
          phase: mode,
          completed: results.length,
          total: corpus.cases.length,
          failed: results.filter((r) => r.status === "FAIL").length,
        }),
      );
    await fs.writeFile(
      path.join(out, "runtime-" + mode + ".json"),
      JSON.stringify({ mode, total: results.length, results }, null, 2),
    );
  }
} finally {
  if (
    path.dirname(temp) !== path.resolve(os.tmpdir()) ||
    !path.basename(temp).startsWith("pps-audit-")
  )
    throw Error("UNSAFE_TEMP_PATH");
  await fs.rm(temp, { recursive: true, force: true });
}
const summary = {
  mode,
  total: results.length,
  passed: results.filter((r) => r.status === "PASS").length,
  failed: results.filter((r) => r.status === "FAIL").length,
  turns: results.reduce((n, r) => n + r.trace.length, 0),
  failureKinds: {},
};
for (const r of results)
  for (const f of r.failures)
    summary.failureKinds[f.kind] = (summary.failureKinds[f.kind] || 0) + 1;
await fs.writeFile(
  path.join(out, "summary-" + mode + ".json"),
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary));
