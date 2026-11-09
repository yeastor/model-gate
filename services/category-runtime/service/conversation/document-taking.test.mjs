import test from "node:test";
import assert from "node:assert/strict";
import { fresh, episode } from "./state.mjs";
import { interpretTurn } from "./interpret.mjs";
import { conversationFixture, bundle } from "./test-helpers.mjs";
function parse(text, stage = null) {
  const s = fresh("1", "test", "a".repeat(64));
  const e = episode(s);
  e.stageId = stage;
  return interpretTurn(s, text, "reported");
}
for (const text of [
  "паспорт забрал сотрудник полиции",
  "Сотрудник полиции забрал мой паспорт",
  "Мой паспорт сотрудник полиции унёс",
  "Сотрудник полиции унес мой паспорт",
  "Сотрудник полиции забирает мой паспорт",
  "Паспорт забрали полицейские",
])
  test("identity document taking: " + text, () => {
    const p = parse(text);
    assert.equal(p.stage, "identity_check");
    assert.equal(
      p.facts.find((x) => x.field === "identity_check.documents_taken_away")
        ?.value,
      true,
    );
  });
for (const text of [
  "документы забрал сотрудник полиции",
  "Сотрудник полиции забрал документы",
  "Документы сотрудник полиции забрал",
])
  test("unspecified document requires identity confirmation: " + text, () => {
    const p = parse(text);
    assert.equal(p.clarificationKey, "identity_document");
    assert.ok(
      !p.facts.some((x) => x.field === "identity_check.documents_taken_away"),
    );
    assert.equal(p.stage, null);
  });
for (const text of [
  "Сотрудник полиции не забрал мой паспорт",
  "Мой паспорт сотрудник полиции не забирал",
  "Сотрудник полиции заберет мой паспорт",
  "Если сотрудник полиции забрал паспорт",
  "Я боюсь, что сотрудник полиции забрал паспорт",
  "Не знаю, забрал ли сотрудник полиции паспорт",
  "Сотрудник полиции забрал паспорт у моего друга",
  "Документы забрал у соседа сотрудник полиции",
  "Я забрал паспорт у сотрудника полиции",
  "Документы забрал я у сотрудника полиции",
  "Сотрудник полиции забрал договор и документы по делу",
  "Сотрудник полиции забрал мой паспорт в прошлом году",
])
  test("does not invent current personal taking: " + text, () => {
    const p = parse(text);
    assert.ok(
      !p.facts.some(
        (x) =>
          x.field === "identity_check.documents_taken_away" && x.value === true,
      ),
      text,
    );
  });
for (const value of [true, false, null])
  test("original report, button branch " + value, async (t) => {
    const f = await conversationFixture(t);
    let r = await f.send("документы забрал сотрудник полиции");
    assert.match(r.answer.content, /удостоверяющем личность/);
    r = await f.button(value);
    const s = await f.state();
    const fact = s.factLedger.findLast(
      (x) => x.fieldKey === "pps.identity_check.documents_taken_away",
    );
    if (value === true) {
      assert.equal(fact.value, true);
      assert.equal(fact.source.quote, "документы забрал сотрудник полиции");
      assert.equal(fact.source.confirmation.kind, "button");
      assert.equal(r.guided.stageId, "identity_check");
      const row = bundle.subcategories
        .find((x) => x.stage.id === "identity_check")
        .variants.find((x) => x.variant_id === r.answer.variantId);
      assert.equal(row.context.documents_taken_away, true);
      assert.match(r.answer.content, /вернуть документ/);
      assert.ok(
        !s.factLedger.some((x) => x.fieldKey.endsWith("documents_present")),
      );
    } else {
      assert.equal(fact, undefined);
      assert.match(r.answer.content, /какой документ забрали/);
    }
  });
test("free confirmation and topic change retain original evidence and prior facts", async (t) => {
  const f = await conversationFixture(t, {
    stageId: "street_stop",
    activeFacts: { "pps.street_stop.free_to_leave_denied": true },
    questionsUsed: 2,
  });
  await f.send("документы забрал сотрудник полиции");
  const round = (await f.state()).round.id;
  const r = await f.send("Да, это мой паспорт");
  const s = await f.state();
  assert.equal(r.guided.stageId, "identity_check");
  assert.ok(s.round.questionsUsed <= 2);
  assert.ok(
    s.factLedger.some(
      (x) =>
        x.fieldKey === "pps.street_stop.free_to_leave_denied" &&
        x.value === true,
    ),
  );
  assert.ok(
    s.factLedger.some(
      (x) =>
        x.fieldKey === "pps.identity_check.documents_taken_away" &&
        x.value === true,
    ),
  );
  const same = await f.send("документы забрал сотрудник полиции");
  assert.equal((await f.state()).round.id, round);
});
test("direct passport report leaves the prior topic without losing prior facts", async (t) => {
  const f = await conversationFixture(t, {
    stageId: "street_stop",
    activeFacts: { "pps.street_stop.free_to_leave_denied": true },
  });
  const r = await f.send("паспорт забрал сотрудник полиции");
  assert.equal(r.guided.stageId, "identity_check");
  assert.ok(
    (await f.state()).factLedger.some(
      (x) => x.fieldKey === "pps.street_stop.free_to_leave_denied",
    ),
  );
});
test("unknown officer is confirmed after document type without reusing the same yes twice", async (t) => {
  const f = await conversationFixture(t, { actor: "unknown" });
  let r = await f.send("документы забрал сотрудник");
  r = await f.send("Да");
  assert.match(r.answer.content, /сотруднике полиции/);
  assert.equal((await f.state()).factLedger.length, 0);
  r = await f.button(true);
  assert.equal(r.guided.stageId, "identity_check");
  assert.equal(
    (await f.state()).factLedger.findLast((x) =>
      x.fieldKey.endsWith("documents_taken_away"),
    ).value,
    true,
  );
});

test("fear about unspecified documents is not a report to confirm", () => {
  const p = parse("Я боюсь, что документы забрал сотрудник полиции");
  assert.equal(p.clarificationKey, undefined);
  assert.ok(!p.facts.some((x) => x.value === true));
});

test("document and action in separate sentences are not joined", () => {
  for (const text of [
    "Паспорт у меня. Сотрудник полиции забрал договор",
    "Паспорт у меня\nСотрудник полиции забрал пакет",
  ]) {
    assert.ok(
      !parse(text).facts.some(
        (x) =>
          x.field === "identity_check.documents_taken_away" && x.value === true,
      ),
    );
  }
});


for (const detail of ["Да, это мой паспорт", "Это мой паспорт", "мой паспорт"])
  test("volunteered document type after budget exhaustion: " + detail, async (t) => {
    const f = await conversationFixture(t, { stageId: "street_stop", questionsUsed: 2 });
    await f.send("документы забрал сотрудник полиции");
    assert.equal((await f.state()).pending, null);
    f.restart();
    await f.resume();
    const r = await f.send(detail), s = await f.state();
    assert.equal(r.guided.stageId, "identity_check");
    const fact = s.factLedger.find(x => x.fieldKey === "pps.identity_check.documents_taken_away");
    assert.equal(fact.value, true);
    assert.equal(fact.source.quote, "документы забрал сотрудник полиции");
    assert.equal(fact.source.confirmation.quote, detail);
    assert.equal(fact.source.confirmation.questionId, undefined);
    assert.equal(s.round.questionsUsed, 2);
    assert.equal(s.pending, null);
  });

for (const detail of ["Да", "Не знаю", "Нет, это не мой паспорт", "Это паспорт друга", "А если это мой паспорт?", "Другой случай: это мой паспорт", "Он сказал: «Это мой паспорт»"])
  test("deferred document type never guesses from: " + detail, async (t) => {
    const f = await conversationFixture(t, { stageId: "street_stop", questionsUsed: 2 });
    await f.send("документы забрал сотрудник полиции");
    await f.send(detail);
    assert.ok(!(await f.state()).factLedger.some(x => x.fieldKey === "pps.identity_check.documents_taken_away" && x.value === true));
  });

test("a deferred document report cannot bind across an intervening topic", async (t) => {
  const f = await conversationFixture(t, { stageId: "street_stop", questionsUsed: 2 });
  await f.send("документы забрал сотрудник полиции");
  await f.send("Полицейский досматривает мою сумку");
  await f.send("Это мой паспорт");
  assert.ok(!(await f.state()).factLedger.some(x => x.fieldKey === "pps.identity_check.documents_taken_away" && x.value === true));
});


test("restating a known taken passport retains the compatible answer without new facts", async (t) => {
  const f = await conversationFixture(t, { stageId: "identity_check", questionsUsed: 2,
    activeFacts: { "pps.identity_check.documents_taken_away": true } });
  const before = await f.state();
  const r = await f.send("Да, это мой паспорт"), s = await f.state();
  assert.equal(r.answer.variantId, "pps_identity_check_v37");
  assert.deepEqual(s.factLedger, before.factLedger);
  assert.equal(s.pending, null);
  assert.equal(s.round.questionsUsed, 2);
});
