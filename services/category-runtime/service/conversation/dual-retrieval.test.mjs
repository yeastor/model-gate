import test from "node:test";
import assert from "node:assert/strict";
import { conversationFixture, bundle } from "./test-helpers.mjs";
import { dialoguePackage } from "./package.mjs";
import {
  retrievalQueries,
  mergeRetrieval,
  supportedTopicHits,
  retrieveTurn,
} from "./retrieval.mjs";
import { fresh, episode, recordFact } from "./state.mjs";
const sha = dialoguePackage.categorySha256;
const hit = (stage, id, score = 0.8) => ({
  score,
  payload: {
    source_sha256: sha,
    category: { id: "pps" },
    stage: { id: stage },
    variant_id: id,
  },
});
const row = (id) =>
  bundle.subcategories
    .flatMap((s) => s.variants)
    .find((v) => v.variant_id === id);
const feedback = (r) =>
  r.answer.next
    .flatMap((g) => g.view)
    .some((v) => v.guided.native.kind === "feedback");

test("every recognized substantive message searches directly and with memory, choices do not", async (t) => {
  const calls = [];
  const f = await conversationFixture(t, {
    search: async (q, opts) => {
      calls.push({ q, opts });
      return [
        hit("identity_check", "pps_identity_check_v37", 0.95),
        hit("identity_check", "pps_identity_check_v33", 0.7),
      ];
    },
  });
  const r = await f.send("Сотрудник полиции требует паспорт");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].q, "Сотрудник полиции требует паспорт");
  assert.match(calls[1].q, /Участник: сотрудник полиции/);
  assert.equal(r.presentation.kind, "full");
  assert.equal(r.answer.variantId, "pps_identity_check_v33");
  assert.ok(
    Object.values(row(r.answer.variantId).context).every((v) => v === null),
  );
  assert.equal((await f.state()).factLedger.length, 0);
  assert.ok(
    calls.every((c) => c.opts.categoryId === "pps" && !c.opts.hardStageId),
  );
  if ((await f.state()).pending) {
    const n = calls.length;
    await f.button(null);
    assert.equal(calls.length, n);
  }
});

test("stop then passport then force changes topic immediately despite misleading retrieval", async (t) => {
  const calls = [];
  const f = await conversationFixture(t, {
    search: async (q) => {
      calls.push(q);
      return [hit("delivery_to_station", "pps_delivery_to_station_v125", 0.99)];
    },
  });
  let r = await f.send("Меня остановил сотрудник полиции на улице");
  assert.equal(r.guided.stageId, "street_stop");
  r = await f.send("Требуют паспорт");
  assert.equal(r.guided.stageId, "identity_check");
  assert.equal(r.presentation.kind, "full");
  assert.equal(feedback(r), false);
  assert.ok(
    calls.some(
      (q) =>
        /Предыдущая тема: Остановили на улице/.test(q) &&
        /Требуют паспорт/.test(q),
    ),
  );
  r = await f.send("Он меня ударил");
  assert.equal(r.guided.stageId, "use_of_force");
  assert.equal(
    (await f.state()).engine.facts["pps.use_of_force.force_actually_used"],
    true,
  );
  assert.equal(r.presentation.kind, "full");
  // A confirmed urgent event bypasses retrieval instead of waiting for it.
  assert.equal(calls.includes("Он меня ударил"), false);
  assert.equal((await f.state()).lastRetrievalDecision.reason, "known_urgent_event");
});

test("known context is a compatibility requirement, never replaced by a more similar variant", async (t) => {
  const f = await conversationFixture(t, {
    stageId: "identity_check",
    activeFacts: { "pps.identity_check.documents_taken_away": true },
    search: async () => [
      hit("identity_check", "pps_identity_check_v33", 0.99),
      hit("identity_check", "pps_identity_check_v37", 0.72),
    ],
  });
  const r = await f.send("Документы сотрудник пока не вернул");
  const s = await f.state();
  assert.equal(row(s.engine.current).context.documents_taken_away, true);
  assert.equal(feedback(r), false);
  assert.equal(s.factLedger.filter((f) => f.value === true).length, 1);
});

test("understood continuation of confirmed topic does not require confirming topic again", async (t) => {
  const f = await conversationFixture(t, {
    stageId: "identity_check",
    questionsUsed: 2,
    search: async () => [hit("identity_check", "pps_identity_check_v33")],
  });
  const r = await f.send("Он говорит непонятно");
  const s = await f.state();
  assert.equal(r.guided.stageId, "identity_check");
  assert.equal(r.presentation.kind, "full");
  assert.equal(s.pending, null);
  assert.equal(s.factLedger.length, 0);
  assert.equal(feedback(r), false);
  f.restart();
  const again = await f.send("Он говорит непонятно");
  assert.equal(again.presentation.kind, "continuation");
  assert.equal(feedback(again), false);
});

test("old topic cannot turn unrelated words into a police answer", async (t) => {
  const f = await conversationFixture(t, {
    stageId: "identity_check",
    search: async (q) =>
      q.startsWith("Участник:")
        ? [hit("identity_check", "pps_identity_check_v33", 0.9)]
        : [],
  });
  const r = await f.send("Как сварить борщ");
  assert.equal(feedback(r), true);
  assert.equal(r.answer.variantId, undefined);
});

test("failed contextual search still uses direct results without claiming unsupported coverage", async (t) => {
  const f = await conversationFixture(t, {
    search: async (q) => {
      if (q.startsWith("Участник:")) throw Error("offline");
      return [hit("identity_check", "pps_identity_check_v33")];
    },
  });
  const r = await f.send("Сотрудник полиции требует паспорт");
  assert.equal(r.presentation.kind, "full");
  assert.equal(feedback(r), false);
  assert.equal((await f.state()).retrievalBatch.failed, 1);
});

test("complete search outage does not block explicit compatible advice", async (t) => {
  const f = await conversationFixture(t, {
    search: async () => {
      throw Error("offline");
    },
  });
  const r = await f.send("Полицейский меня ударил");
  assert.equal(r.guided.stageId, "use_of_force");
  assert.equal(r.presentation.kind, "full");
  assert.equal(feedback(r), false);
});

test("memory excludes null, conflicted, superseded and other subject facts", () => {
  const s = fresh("81", "synthetic", sha),
    e = episode(s);
  e.actor = "police";
  e.stageId = "identity_check";
  e.stageConfirmedByUser = true;
  const source = { kind: "test", turnId: "1" };
  recordFact(s, "pps.identity_check.documents_present", null, source);
  recordFact(s, "pps.identity_check.documents_taken_away", true, source);
  recordFact(s, "pps.identity_check.documents_taken_away", false, source);
  recordFact(s, "pps.identity_check.reason_explained", false, source);
  const q = retrievalQueries(s, "Что дальше?", bundle)[1];
  assert.match(q, /: нет/);
  assert.doesNotMatch(q, /документы при себе/);
  assert.doesNotMatch(q, /забрали документ/);
  e.personId = "new-person";
  assert.doesNotMatch(retrievalQueries(s, "Что дальше?", bundle)[1], /: нет/);
});

test("new episode and article hint never supply old user facts or topic", () => {
  const s = fresh("81", "synthetic", sha),
    old = episode(s);
  s.recentUserTurns.push({ episodeId: old.id, text: "СЕКРЕТ СТАРОГО СЛУЧАЯ" });
  const e = episode(s);
  e.stageId = "home_entry";
  s.articleEntry = "pps_home_entry_v17";
  const queries = retrievalQueries(s, "Что происходит", bundle);
  assert.deepEqual(queries, ["Что происходит"]);
});

test("fusion removes duplicates, rejects stale results and retains independent direct evidence", () => {
  const a = hit("identity_check", "pps_identity_check_v33"),
    b = hit("street_stop", "pps_street_stop_v11");
  a.payload.answer = "Do not copy advice into state";
  const stale = { ...b, payload: { ...b.payload, source_sha256: "bad" } };
  const merged = mergeRetrieval(
    [
      [a, a, b, stale],
      [b, a],
    ],
    bundle,
    sha,
  );
  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.find((h) => h.payload.variant_id === "pps_identity_check_v33")
      .sources,
    ["direct", "contextual"],
  );
  assert.ok(merged.every((h) => !h.payload.answer));
  const onlyContext = mergeRetrieval([[], [a]], bundle, sha);
  assert.deepEqual(
    supportedTopicHits({ hits: onlyContext }, "Как сварить борщ"),
    [],
  );
  assert.equal(
    supportedTopicHits({ hits: onlyContext }, "Он говорит непонятно").length,
    1,
  );
});

test("timed out retrieval is cancelled and retry can recover on the same message", async () => {
  const s = fresh("81", "synthetic", sha);
  episode(s).actor = "police";
  const parsed = { facts: [], actor: "police" };
  const args = {
    s,
    parsed,
    text: "Непонятная ситуация",
    turnId: "1",
    bundle,
    active: { sha256: sha },
    timeoutMs: 20,
  };
  const signals = [];
  await retrieveTurn({
    ...args,
    search: async (_, opts) => {
      signals.push(opts.signal);
      return new Promise(() => {});
    },
  });
  assert.equal(s.retrievalUnavailable, true);
  assert.equal(s.retrievalBatch.failed, 2);
  assert.ok(signals.every((signal) => signal.aborted));
  await retrieveTurn({
    ...args,
    turnId: "2",
    search: async () => [hit("identity_check", "pps_identity_check_v33")],
  });
  assert.equal(s.retrievalUnavailable, false);
  assert.equal(s.retrievalBatch.hits.length, 1);
});
