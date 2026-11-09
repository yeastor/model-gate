import test from "node:test";
import assert from "node:assert/strict";
import { conversationFixture, bundle } from "./test-helpers.mjs";
import { dialoguePackage } from "./package.mjs";
import { routingCandidates } from "./routing.mjs";
const sha = dialoguePackage.categorySha256;
const hit = (stage, id, score) => ({
  score,
  payload: {
    source_sha256: sha,
    category: { id: "pps" },
    stage: { id: stage },
    variant_id: id,
  },
});
const originalHits = [
  hit("delivery_to_station", "pps_delivery_to_station_v125", 0.6713),
  hit("street_stop", "pps_street_stop_v12", 0.6404),
];
const allViews = (r) => r.answer.next.flatMap((g) => g.view);
const hasFeedback = (r) =>
  allViews(r).some((v) => v.guided.native.kind === "feedback");
test("original broad report uses search, confirms actor and street topic, never candidate context", async (t) => {
  const calls = [];
  const f = await conversationFixture(t, {
    actor: "unknown",
    search: async (q, opts) => {
      calls.push({ q, opts });
      return originalHits;
    },
  });
  let r = await f.send("Меня остановил сотрудник");
  assert.match(r.answer.content, /сотруднике полиции/);
  assert.equal(hasFeedback(r), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].q, "Меня остановил сотрудник");
  assert.equal(calls[0].opts.hardStageId, undefined);
  assert.equal(calls[0].opts.limit, 32);
  assert.equal((await f.state()).factLedger.length, 0);
  assert.equal((await f.state()).engine, null);
  r = await f.button(true);
  assert.match(r.answer.content, /на улице/);
  assert.equal((await f.state()).round.questionsUsed, 2);
  assert.equal((await f.state()).factLedger.length, 0);
  r = await f.button(true);
  assert.equal(r.guided.stageId, "street_stop");
  assert.equal(r.presentation.kind, "full");
  const s = await f.state();
  assert.equal(s.factLedger.length, 0);
  assert.equal(s.pending, null);
  const row = bundle.subcategories
    .find((x) => x.stage.id === "street_stop")
    .variants.find((x) => x.variant_id === r.answer.variantId);
  assert.ok(Object.values(row.context).every((v) => v === null));
  assert.notEqual(r.answer.variantId, "pps_delivery_to_station_v125");
  assert.equal(hasFeedback(r), false);
});
for (const value of [false, null])
  test(
    "declining topic does not set facts or ask a third question: " + value,
    async (t) => {
      const f = await conversationFixture(t, {
        actor: "unknown",
        search: async () => originalHits,
      });
      await f.send("Меня остановил сотрудник");
      await f.button(true);
      const r = await f.button(value),
        s = await f.state();
      assert.equal(s.engine, null);
      assert.equal(s.factLedger.length, 0);
      assert.equal(s.round.questionsUsed, 2);
      assert.equal(s.pending, null);
      assert.ok(hasFeedback(r));
    },
  );
test("free yes applies once, routing survives restart and rejected queries do not reset budget", async (t) => {
  let calls = 0;
  const f = await conversationFixture(t, {
    actor: "unknown",
    search: async () => {
      calls++;
      return originalHits;
    },
  });
  const first = await f.send("Меня остановил сотрудник");
  const round = (await f.state()).round.id;
  await f.send("Меня остановил сотрудник");
  assert.equal((await f.state()).round.id, round);
  assert.equal((await f.state()).round.questionsUsed, 1);
  assert.equal(calls, 1);
  f.restart();
  assert.equal((await f.resume()).guided.native.revision, 2);
  let r = await f.send("Да");
  assert.match(r.answer.content, /на улице/);
  assert.equal((await f.state()).engine, null);
  r = await f.send("Нет");
  assert.equal((await f.state()).engine, null);
  assert.equal((await f.state()).round.questionsUsed, 2);
  await f.send("Меня остановил сотрудник");
  assert.equal((await f.state()).round.id, round);
  assert.equal(calls, 1);
});
test("new wording retrieves identity topic but makes none of its candidate context true", async (t) => {
  const f = await conversationFixture(t, {
    search: async () => [
      hit("personal_search", "pps_personal_search_v35", 0.6949),
      hit("identity_check", "pps_identity_check_v41", 0.6806),
    ],
  });
  let r = await f.send("Инспектор интересуется моим удостоверением");
  assert.match(r.answer.content, /проверяет вашу личность/);
  r = await f.button(true);
  const s = await f.state();
  assert.equal(r.guided.stageId, "identity_check");
  assert.equal(s.factLedger.length, 0);
  assert.ok(s.round.questionsUsed <= 2);
  assert.equal(hasFeedback(r), false);
});
test("new topic can be found outside previous stage while previous facts remain", async (t) => {
  const calls = [];
  const f = await conversationFixture(t, {
    stageId: "street_stop",
    activeFacts: { "pps.street_stop.free_to_leave_denied": true },
    questionsUsed: 1,
    search: async (q, opts) => {
      calls.push({ q, opts });
      return [hit("bag_search", "pps_bag_search_v114", 0.76)];
    },
  });
  let r = await f.send("Он интересуется содержимым моего рюкзака");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].q, "Он интересуется содержимым моего рюкзака");
  assert.match(calls[1].q, /Предыдущая тема: Остановили на улице/);
  assert.ok(calls.every((c) => c.opts.hardStageId === undefined));
  assert.match(r.answer.content, /сумку/);
  assert.equal(r.answer.variantId, undefined);
  r = await f.button(true);
  assert.equal(r.guided.stageId, "bag_search");
  assert.ok(
    (await f.state()).factLedger.some(
      (x) =>
        x.fieldKey === "pps.street_stop.free_to_leave_denied" &&
        x.value === true,
    ),
  );
});
test("new direct force report overrides a pending retrieval question", async (t) => {
  const f = await conversationFixture(t, {
    actor: "unknown",
    search: async () => originalHits,
  });
  await f.send("Меня остановил сотрудник");
  const r = await f.send("Полицейский меня бьёт");
  assert.equal(r.guided.stageId, "use_of_force");
  assert.equal(r.presentation.kind, "full");
  assert.equal((await f.state()).episodes[0].unresolvedRouting, null);
});
test("out of scope and weak results keep the honest fallback", async (t) => {
  const f = await conversationFixture(t, {
    search: async () => [
      hit("delivery_to_station", "pps_delivery_to_station_v67", 0.5907),
    ],
  });
  const r = await f.send("Где купить телефон");
  assert.ok(hasFeedback(r));
  assert.equal((await f.state()).engine, null);
});
test("invalid, stale and cross-category candidates cannot propose a topic", () => {
  const good = hit("street_stop", "pps_street_stop_v12", 0.9);
  const bad = [
    { ...good, payload: { ...good.payload, source_sha256: "0".repeat(64) } },
    { ...good, payload: { ...good.payload, category: { id: "other" } } },
    { ...good, payload: { ...good.payload, stage: { id: "use_of_force" } } },
    { ...good, payload: { ...good.payload, variant_id: "unknown" } },
    { ...good, score: NaN },
  ];
  assert.deepEqual(routingCandidates(bad, bundle, sha, "test"), []);
});
test("search failure is temporary unavailability, never unsupported coverage", async (t) => {
  const f = await conversationFixture(t, {
    search: async () => {
      throw Error("offline");
    },
  });
  const r = await f.send("Новая непонятная ситуация");
  assert.match(r.answer.content, /временно недоступен/);
  assert.equal(hasFeedback(r), false);
  assert.equal((await f.state()).factLedger.length, 0);
});
test("explicit stopping clue can still be clarified during a search outage", async (t) => {
  const f = await conversationFixture(t, {
    actor: "unknown",
    search: async () => {
      throw Error("offline");
    },
  });
  let r = await f.send("Меня остановил сотрудник");
  assert.match(r.answer.content, /сотруднике полиции/);
  r = await f.button(true);
  assert.match(r.answer.content, /на улице/);
  r = await f.button(true);
  assert.equal(r.guided.stageId, "street_stop");
  assert.equal((await f.state()).factLedger.length, 0);
});
test("an embedding force topic needs explicit physical-force confirmation", async (t) => {
  // A real existing variant is chosen dynamically; its context remains irrelevant.
  const id = bundle.subcategories.find((s) => s.stage.id === "use_of_force")
    .variants[0].variant_id;
  const g = await conversationFixture(t, {
    search: async () => [hit("use_of_force", id, 0.8)],
  });
  await g.send("У нас неприятная ситуация с полицейским");
  assert.equal((await g.state()).factLedger.length, 0);
  await g.button(true);
  assert.equal(
    (await g.state()).factLedger.find(
      (x) => x.fieldKey === "pps.use_of_force.force_actually_used",
    ).value,
    true,
  );
});


test("exhausted case budget keeps compatible advice until an explicit new topic", async (t) => {
  const f = await conversationFixture(t, {
    stageId: "street_stop",
    activeFacts: { "pps.street_stop.free_to_leave_denied": true },
    questionsUsed: 2,
    search: async () => [hit("bag_search", "pps_bag_search_v114", 0.76)],
  });
  const r = await f.send("Он интересуется содержимым моего рюкзака");
  const s = await f.state();
  assert.equal(r.answer.variantId, "pps_street_stop_v12");
  assert.equal(s.pending, null);
  assert.equal(s.round.questionsUsed, 2);
  assert.ok(!s.factLedger.some(x => x.fieldKey.startsWith("pps.bag_search.")));
  const next = await f.send("Полицейский досматривает мою сумку");
  const after = await f.state();
  assert.equal(next.guided.stageId, "bag_search");
  assert.ok(next.answer.variantId);
  assert.equal(after.pending, null);
  assert.equal(after.round.questionsUsed, 2);
  assert.ok(after.factLedger.some(x => x.fieldKey === "pps.street_stop.free_to_leave_denied" && x.value === true));
});


test("scope correction and help keep the unanswered routing question instead of guessing a new topic", async (t) => {
  const f = await conversationFixture(t, { search: async () => [hit("street_stop", "pps_street_stop_v11", 0.8)] });
  await f.send("Полицейский запретил мне уходить");
  const before = await f.state();
  for (const text of ["Я ошибся: полицейский разрешил свободно уйти и не удерживает меня", "Что делать дальше?"]) {
    const r = await f.send(text), s = await f.state();
    assert.match(r.answer.content, /остановили на улице/);
    assert.equal(s.pending.receiptId, before.pending.receiptId);
    assert.equal(s.round.questionsUsed, before.round.questionsUsed);
    assert.equal(s.factLedger.length, 0);
  }
  const r = await f.button(true);
  assert.equal(r.guided.stageId, "street_stop");
});
