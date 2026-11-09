import test from "node:test";
import assert from "node:assert/strict";
import { conversationFixture, bundle } from "./test-helpers.mjs";
import { interpretTurn } from "./interpret.mjs";
import { questionText } from "./question-display.mjs";
import { dialoguePackage } from "./package.mjs";
const force = "pps.use_of_force.force_actually_used";
const feedback = (r) =>
  r.answer.next
    .flatMap((g) => g.view)
    .some((v) => v.guided?.native.kind === "feedback");
for (const text of [
  "Со мной полицейский и врач. Он меня ударил.",
  "Меня ударил охранник, а полицейский стоял рядом.",
  "Полицейский читает моё заявление: «Он меня ударил».",
  "Вчера полицейский ударил меня. Сейчас другой случай: проверяют документы.",
])
  test("scope guard: " + text, async (t) => {
    const f = await conversationFixture(t);
    const r = await f.send(text);
    const s = await f.state();
    assert.ok(
      !s.factLedger.some(
        (x) =>
          x.status === "active" && x.fieldKey === force && x.value === true,
      ),
    );
    assert.notEqual(r.answer.variantId, "pps_use_of_force_v34");
  });
for (const owner of ["моего коллеги", "моей жены", "моего ребёнка", "соседа"])
  test("foreign passport does not become user's: " + owner, async (t) => {
    const f = await conversationFixture(t);
    await f.send("Полицейский забрал паспорт " + owner);
    assert.ok(
      !(await f.state()).factLedger.some(
        (x) =>
          x.fieldKey === "pps.identity_check.documents_taken_away" &&
          x.value === true,
      ),
    );
  });
test("clear police force survives another observer and an unrelated quote", async (t) => {
  for (const text of [
    "Полицейский ударил меня, а врач стоял рядом.",
    "Полицейский сказал «стой» и ударил меня.",
  ]) {
    const f = await conversationFixture(t);
    const r = await f.send(text);
    assert.equal(r.guided.stageId, "use_of_force");
    assert.equal((await f.state()).engine.facts[force], true);
  }
});
test("an ambiguous force actor can be clarified without losing the report", async (t) => {
  const f = await conversationFixture(t);
  let r = await f.send("Со мной полицейский и врач. Он меня ударил.");
  assert.match(r.answer.content, /Кто именно/);
  r = await f.send("Полицейский");
  assert.equal(r.guided.stageId, "use_of_force");
  assert.equal((await f.state()).engine.facts[force], true);
});
for (const text of [
  "Я ошибся: он меня не ударил.",
  "Я ошибся: он не ударил меня.",
])
  test("correction withdraws sole hit: " + text, async (t) => {
    const f = await conversationFixture(t);
    await f.send("Полицейский меня ударил.");
    await f.send(text);
    const s = await f.state();
    assert.equal(
      s.factLedger.findLast(
        (x) => x.fieldKey === force && x.status === "active",
      ).value,
      null,
    );
    assert.equal(s.engine, null);
    assert.equal(s.episodes[0].dangerOngoing, false);
    assert.equal(s.pending, null);
  });
test("denying a hit does not erase a separately reported push", async (t) => {
  const f = await conversationFixture(t);
  await f.send("Полицейский меня ударил.");
  await f.send("Он ещё толкнул меня.");
  await f.send("Я ошибся: он меня не ударил.");
  assert.equal((await f.state()).engine.facts[force], true);
});
for (const text of [
  "Помогите!",
  "Что делать сейчас?",
  "Не могу говорить.",
  "Мне трудно дышать.",
])
  test("urgent continuation keeps help: " + text, async (t) => {
    let calls = 0;
    const f = await conversationFixture(t, {
      search: async () => {
        calls++;
        throw Error("offline");
      },
    });
    await f.send("Полицейский меня бьёт.");
    const r = await f.send(text);
    const s = await f.state();
    assert.equal(calls, 0);
    assert.equal(feedback(r), false);
    assert.equal(r.guided.stageId, "use_of_force");
    assert.equal(s.engine.facts[force], true);
    assert.equal(
      Object.hasOwn(s.engine.facts, "pps.use_of_force.injuries_present"),
      false,
    );
  });
test("a never completing search is never called for known urgent advice", async (t) => {
  let calls = 0;
  const f = await conversationFixture(t, {
    search: async () => {
      calls++;
      return new Promise(() => {});
    },
  });
  const r = await f.send("Полицейский меня бьёт.");
  assert.equal(r.presentation.kind, "full");
  assert.equal(calls, 0);
});
test("new procedure retains urgent access without locking topic; action preserves current procedure", async (t) => {
  const f = await conversationFixture(t);
  await f.send("Полицейский меня бьёт.");
  let r = await f.send("Он просит подписать объяснение.");
  assert.equal(r.guided.stageId, "explanation_request");
  assert.equal(r.presentation.urgentPriority, true);
  assert.match(r.answer.content, /продолжающемся применении силы/);
  const action = r.answer.next
    .flatMap((g) => g.view)
    .find((v) => v.guided?.native.kind === "show_urgent_advice");
  assert.ok(action);
  r = await f.send(action.question, { guided: action.guided });
  assert.equal(r.presentation.kind, "full");
  assert.ok(r.answer.variantId.startsWith("pps_use_of_force"));
  assert.equal((await f.state()).engine.stageId, "explanation_request");
  r = await f.send("Он перестал меня бить.");
  assert.equal(r.presentation.urgentPriority, false);
});
test("visible question wording preserves polarity, question identity and history", async (t) => {
  const f = await conversationFixture(t);
  const r = await f.send("Полицейский остановил меня на улице.");
  const s = await f.state();
  assert.match(r.answer.next[0].questionText, /Сотрудник мешает вам уйти/);
  assert.match(
    s.outbox?.answer || (await f.resume()).answer.next[0].questionText,
    /Сотрудник мешает вам уйти/,
  );
  const before = s.pending.question.id;
  await f.button(true);
  const after = await f.state();
  assert.equal(
    after.engine.facts["pps.street_stop.free_to_leave_denied"],
    true,
  );
  assert.ok(before.includes("free_to_leave_denied"));
});
test("confusion explains once, then leaves fact unknown and dismisses without a loop", async (t) => {
  const f = await conversationFixture(t);
  await f.send("Полицейский проверяет мой паспорт.");
  const before = await f.state();
  let r = await f.send("Я не понимаю ваш вопрос.");
  assert.equal(feedback(r), false);
  assert.match(r.answer.content, /везут ли вас в отдел/);
  assert.equal(
    (await f.state()).pending.question.id,
    before.pending.question.id,
  );
  r = await f.send("Я не понимаю ваш вопрос.");
  const s = await f.state();
  assert.equal(s.pending, null);
  assert.equal(
    Object.hasOwn(s.engine.facts, "pps.identity_check.taken_to_station_for_id"),
    false,
  );
  assert.equal(s.round.questionsUsed, before.round.questionsUsed);
  assert.equal(feedback(r), false);
});
test("a taken passport prioritizes its grounds over the generic delivery/age questionnaire", async (t) => {
  const f = await conversationFixture(t);
  const r = await f.send("Полицейский забрал мой паспорт.");
  const s = await f.state();
  assert.equal(s.engine.facts["pps.identity_check.documents_taken_away"], true);
  assert.notEqual(s.pending?.question.field_key, "taken_to_station_for_id");
  assert.notEqual(s.pending?.question.field_key, "minor_person");
  assert.equal(
    Object.hasOwn(s.engine.facts, "pps.identity_check.taken_to_station_for_id"),
    false,
  );
  assert.equal(r.presentation.kind, "full");
});
test("blood following force records reported injury, unrelated breathing does not", async (t) => {
  const f = await conversationFixture(t);
  const r = await f.send("Полицейский меня ударил, у меня идёт кровь.");
  const s = await f.state();
  assert.equal(s.engine.facts["pps.use_of_force.injuries_present"], true);
  assert.notEqual(s.pending?.question.field_key, "injuries_present");
  assert.match(r.answer.content, /медицинской помощью/);
});
for (const [text, stage] of [
  [
    "Сотрудник полиции хочет, чтобы я письменно рассказал, что произошло.",
    "explanation_request",
  ],
  ["Сотрудник полиции ощупывает мою одежду.", "personal_search"],
])
  test("bounded procedure wording: " + text, async (t) => {
    const f = await conversationFixture(t);
    assert.equal((await f.send(text)).guided.stageId, stage);
  });
test("short restriction uses established actor and existing field", async (t) => {
  const f = await conversationFixture(t);
  await f.send("Полицейский остановил меня на улице.");
  const r = await f.send("Не выпускает!");
  assert.equal(
    (await f.state()).engine.facts["pps.street_stop.free_to_leave_denied"],
    true,
  );
  assert.equal(feedback(r), false);
});

for (const text of [
  "Полицейский меня ударил, но у меня кровь не идёт.",
  "Полицейский меня ударил. Кровотечение у меня было до этого.",
  "Полицейский меня ударил, у меня кровь коллеги на одежде.",
])
  test("symptom guard does not invent injury: " + text, async (t) => {
    const f = await conversationFixture(t);
    await f.send(text);
    assert.notEqual(
      (await f.state()).engine.facts["pps.use_of_force.injuries_present"],
      true,
    );
  });
for (const text of [
  "Сотрудник полиции не ощупывает мою одежду.",
  "Сотрудник полиции не хочет, чтобы я письменно рассказал, что произошло.",
])
  test("new procedure cues respect negation: " + text, async (t) => {
    const f = await conversationFixture(t);
    const r = await f.send(text);
    assert.equal(r.answer.variantId, undefined);
  });
test("reading a quotation in first person does not assert current force", async (t) => {
  const f = await conversationFixture(t);
  await f.send("Я читаю заявление: «Полицейский меня ударил».");
  assert.ok(
    !(await f.state()).factLedger.some(
      (x) => x.status === "active" && x.fieldKey === force && x.value === true,
    ),
  );
});

test("confirmed actor restores ongoing urgency and its fast path", async (t) => {
  let calls = 0;
  const f = await conversationFixture(t, {
    actor: null,
    search: async () => {
      calls++;
      return [];
    },
  });
  await f.send("Меня бьёт сотрудник.");
  let r = await f.button(true);
  assert.equal((await f.state()).episodes[0].dangerOngoing, true);
  const n = calls;
  r = await f.send("Он просит подписать объяснение.");
  assert.equal(r.presentation.urgentPriority, true);
  assert.equal(calls, n);
});
