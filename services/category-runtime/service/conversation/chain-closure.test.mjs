import test from "node:test";
import assert from "node:assert/strict";
import { conversationFixture } from "./test-helpers.mjs";
import { conversationalIntent } from "./evidence.mjs";
const help = [
  "Что делать дальше?",
  "Что мне делать теперь?",
  "А что дальше?",
  "Что теперь?",
  "Как мне действовать дальше?",
  "Как действовать?",
];
for (const text of help)
  test("completed stop keeps advice: " + text, async (t) => {
    let calls = 0;
    const f = await conversationFixture(t, {
      search: async () => {
        calls++;
        return [];
      },
    });
    await f.send("Полицейский остановил меня на улице.");
    await f.button(true);
    const before = await f.state(),
      searched = calls;
    const r = await f.send(text),
      after = await f.state();
    assert.equal(r.answer.variantId, before.engine.current);
    assert.equal(r.presentation.kind, "full");
    assert.equal(calls, searched);
    assert.deepEqual(after.factLedger, before.factLedger);
    assert.equal(after.round.id, before.round.id);
    assert.equal(after.pending, null);
  });
for (const text of [
  "Он спрашивает: «Что делать дальше?»",
  "Что делать дальше, если сосед меня ударил?",
  "Полицейский досматривает мои карманы.",
  "Другой случай: что теперь?",
])
  test("help alias does not swallow substantive message: " + text, () =>
    assert.equal(conversationalIntent(text), null),
  );
for (const a of [true, false, null])
  for (const b of [true, false, null])
    test(`home entry skips useless question, preserves two facts and budget: ${a}/${b}`, async (t) => {
      const f = await conversationFixture(t);
      await f.send("Полицейские пытаются войти в мою квартиру.");
      const first = await f.state();
      await f.button(a);
      const middle = await f.state();
      assert.equal(
        middle.pending.fieldKey,
        "pps.home_entry.resident_consent_given",
      );
      assert.equal(middle.round.questionsUsed, 2);
      const r = await f.button(b),
        s = await f.state();
      assert.equal(s.engine.facts["pps.home_entry.forced_entry_used"], a);
      assert.equal(s.engine.facts["pps.home_entry.resident_consent_given"], b);
      assert.equal(
        r.answer.variantId,
        a === true
          ? b === false
            ? "pps_home_entry_v29"
            : "pps_home_entry_v19"
          : b === false
            ? "pps_home_entry_v18"
            : "pps_home_entry_v17",
      );
      assert.equal(s.pending, null);
      assert.equal(s.round.questionsUsed, 2);
      assert.equal(s.round.id, first.round.id);
      await f.send("Что делать дальше?");
      const end = await f.state();
      assert.equal(end.round.questionsUsed, 2);
      assert.equal(end.pending, null);
    });
test("personal pocket search enters its existing scenario without embeddings", async (t) => {
  const f = await conversationFixture(t);
  const r = await f.send("Полицейский досматривает мои карманы.");
  const s = await f.state();
  assert.equal(s.engine.stageId, "personal_search");
  assert.ok(r.answer.variantId.startsWith("pps_personal_search_"));
  assert.ok(s.pending);
});
for (const text of [
  "Полицейский не досматривает мои карманы.",
  "Если полицейский досматривает мои карманы?",
  "Полицейский говорит: «Досматривают мои карманы».",
])
  test("pocket cue guard: " + text, async (t) => {
    const f = await conversationFixture(t);
    await f.send(text);
    assert.notEqual((await f.state()).engine?.stageId, "personal_search");
  });


for (const text of [
  "А если он ударит меня?",
  "А если полицейский меня ударит?",
  "Если сотрудник полиции заберёт мой паспорт?",
  "А если он откроет мою сумку?",
]) for (const answeredUnknown of [false, true])
  test(`hypothetical continuation retains scoped advice: ${answeredUnknown}/${text}`, async (t) => {
    const f = await conversationFixture(t);
    await f.send("Полицейский остановил меня на улице.");
    if (answeredUnknown) await f.button(null);
    const before = await f.state();
    const r = await f.send(text), after = await f.state();
    assert.equal(r.answer.variantId, "pps_street_stop_v11");
    assert.doesNotMatch(r.answer.content, /пока не удалось подобрать/);
    assert.match(r.answer.content, /Вы спрашиваете о том, что может случиться/);
    assert.deepEqual(after.factLedger, before.factLedger);
    assert.equal(after.activeEpisodeId, before.activeEpisodeId);
    assert.deepEqual(after.caseState, before.caseState);
    assert.equal(after.pending?.receiptId, before.pending?.receiptId);
    assert.equal(after.feedbackOfferId, null);
    assert.equal(after.engine.facts["pps.street_stop.free_to_leave_denied"],
      answeredUnknown ? null : undefined);
    f.restart();
    assert.equal((await f.resume()).presentation.responseId, r.presentation.responseId);
  });

test("hypothetical continuation does not block real urgent events or refill the budget", async (t) => {
  const f = await conversationFixture(t);
  await f.send("Полицейский остановил меня на улице.");
  await f.button(null);
  await f.send("требуют паспорт");
  const before = await f.state();
  assert.equal(before.round.questionsUsed, 2);
  await f.send("А если он ударит меня?");
  const r = await f.send("Он меня бьёт"), after = await f.state();
  assert.equal(r.answer.variantId, "pps_use_of_force_v34");
  assert.equal(r.presentation.urgentPriority, true);
  assert.equal(after.engine.facts["pps.use_of_force.force_actually_used"], true);
  assert.equal(after.round.questionsUsed, 2);
  assert.equal(after.pending, null);
  assert.equal(after.caseState.id, before.caseState.id);
});

for (const text of [
  "Другая проблема: сосед затопил мою квартиру.",
  "А если сосед ударит меня?",
  "А если он ударит моего друга?",
  "Другой случай: а если он ударит меня?",
  "А если он ударит меня в другом эпизоде?",
]) test("hypothetical help does not claim an unrelated scope: " + text, async (t) => {
  const f = await conversationFixture(t);
  await f.send("Полицейский остановил меня на улице.");
  const r = await f.send(text), s = await f.state();
  assert.doesNotMatch(r.answer.content, /Вы спрашиваете о том, что может случиться/);
  assert.equal(s.factLedger.some(x => x.fieldKey === "pps.use_of_force.force_actually_used" && x.value === true), false);
});

test("hypothetical question alone cannot create a confirmed situation", async (t) => {
  const f = await conversationFixture(t, { actor: null });
  const r = await f.send("А если он ударит меня?"), s = await f.state();
  assert.ok(!r.answer.variantId);
  assert.doesNotMatch(r.answer.content, /Вы спрашиваете о том, что может случиться/);
  assert.equal(s.factLedger.length, 0);
});

test("a factual new topic still replaces retained hypothetical help", async (t) => {
  const f = await conversationFixture(t);
  await f.send("Полицейский остановил меня на улице.");
  await f.send("А если он ударит меня?");
  const r = await f.send("Он забрал мой паспорт и не возвращает."), s = await f.state();
  assert.equal(r.answer.variantId, "pps_identity_check_v37");
  assert.equal(s.engine.facts["pps.identity_check.documents_taken_away"], true);
  assert.ok(!s.factLedger.some(x => x.fieldKey === "pps.use_of_force.force_actually_used" && x.value === true));
});
