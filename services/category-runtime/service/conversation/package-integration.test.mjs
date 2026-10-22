import test from "node:test";
import assert from "node:assert/strict";
import {
  dialoguePackage,
  assertDialogueVersion,
  validateDialoguePackage,
} from "./package.mjs";
import { conversationFixture, bundle } from "./test-helpers.mjs";
test("package is pinned and validates every field/branch", () => {
  validateDialoguePackage(bundle);
  assertDialogueVersion(dialoguePackage.categorySha256);
  assert.throws(
    () => assertDialogueVersion("f".repeat(64)),
    /VERSION_UNAVAILABLE/,
  );
  assert.equal(
    dialoguePackage.fields.filter((f) => f.semanticsStatus === "REVIEWED")
      .length,
    45,
  );
});
for (const q of dialoguePackage.questions.filter(
  (q) => q.purpose === "context",
)) {
  for (const branch of q.branches)
    test(q.id + " / " + branch.label, async (t) => {
      const stage = bundle.subcategories.find((s) => s.stage.id === q.stageId),
        facts = {};
      const walk = (q) => {
        facts["pps." + stage.stage.id + "." + q.field_key] = null;
        q.data.forEach((a) => {
          if (a.ask_next_question) walk(a.ask_next_question);
        });
      };
      stage.variants[0].payload.next.forEach(walk);
      Object.assign(facts, q.showWhen.requiredFacts);
      const f = await conversationFixture(t, {
        stageId: q.stageId,
        activeFacts: facts,
        questionsUsed: 1,
        pending: {
          kind: "supplemental",
          stageId: q.stageId,
          fieldKey: q.fieldKey,
          question: {
            id: q.id,
            question: q.question,
            data: q.branches.map((b) => ({ value: b.value, label: b.label })),
          },
        },
      });
      const r = await f.answerPending(branch.value),
        s = await f.state();
      assert.equal(s.engine.facts[q.fieldKey], branch.value);
      assert.equal(r.answer.variantId, branch.nextAction.variantId);
      assert.ok(s.round.questionsUsed <= 2);
      assert.notEqual(s.pending?.question.id, q.id);
      f.restart();
      assert.equal(
        (await f.resume()).presentation.responseId,
        r.presentation.responseId,
      );
    });
}
test("known original NEXT facts leave room for safe supplemental question", async (t) => {
  const f = await conversationFixture(t);
  await f.send("Полицейский остановил меня на улице.");
  await f.button(false);
  const s = await f.state();
  assert.equal(s.round.questionsUsed, 1); // street fields do not route other supplemental advice
  assert.equal(s.pending, null);
  const g = await conversationFixture(t, {
    stageId: "identity_check",
    activeFacts: {
      "pps.identity_check.taken_to_station_for_id": null,
      "pps.identity_check.minor_person": null,
    },
    questionsUsed: 0,
  });
  await g.send("Сотрудник полиции продолжает проверку моей личности.");
  const state = await g.state();
  assert.equal(state.pending?.kind, "supplemental");
  assert.equal(state.round.questionsUsed, 1);
});
test("returned phone keeps event and suppresses obsolete full instruction", async (t) => {
  const f = await conversationFixture(t, { stageId: "delivery_to_station" });
  await f.send(
    "По дороге в отдел сотрудник полиции забрал мой телефон и не возвращает.",
  );
  const r = await f.send(
    "Сотрудник уже вернул мне телефон, который забрал в этой поездке.",
  );
  const s = await f.state();
  assert.equal(s.engine.facts["pps.delivery_to_station.phone_taken"], true);
  assert.notEqual(r.presentation.kind, "full");
  assert.doesNotMatch(r.answer.content, /Попросите вернуть телефон/);
});
test("mixed denial retains real physical action and stops after shared budget", async (t) => {
  const f = await conversationFixture(t);
  await f.send("Сотрудник полиции меня не бил, но толкнул.");
  let s = await f.state();
  assert.equal(s.engine.facts["pps.use_of_force.force_actually_used"], true);
  await f.button(null);
  await f.send("Не знаю.");
  s = await f.state();
  assert.ok(s.round.questionsUsed <= 2);
});
test("standalone pressure and signature alternatives keep their scope", async (t) => {
  const f = await conversationFixture(t, { stageId: "explanation_request" });
  await f.send("Меня просят подписать протокол досмотра, а не объяснение.");
  const s = await f.state();
  assert.equal(
    s.factLedger.findLast(
      (x) =>
        x.fieldKey ===
        "pps.explanation_request.signature_on_explanation_requested",
    ).value,
    false,
  );
});
test("narrow denial does not invent total absence of force", async (t) => {
  const f = await conversationFixture(t);
  await f.send("Сотрудник полиции меня не бил.");
  const s = await f.state();
  assert.ok(
    !s.factLedger.some(
      (x) =>
        x.fieldKey === "pps.use_of_force.force_actually_used" &&
        x.value === false,
    ),
  );
});

test("actor is the police officer, not the person struck by the user", async (t) => {
  for (const text of [
    "Я толкнул полицейского.",
    "Полицейский ударил моего друга.",
    "Полицейский меня не бил, он только кричит.",
  ]) {
    const f = await conversationFixture(t);
    await f.send(text);
    const s = await f.state();
    assert.ok(
      !s.factLedger.some(
        (x) =>
          x.fieldKey === "pps.use_of_force.force_actually_used" &&
          x.value === true,
      ),
    );
  }
});
test("different procedures do not share explanations across clauses", async (t) => {
  const f = await conversationFixture(t, { stageId: "personal_search" });
  await f.send(
    "Сотрудник полиции объяснил основание проверки паспорта, но основание личного досмотра не называл.",
  );
  const s = await f.state();
  assert.equal(
    s.factLedger.findLast(
      (x) => x.fieldKey === "pps.personal_search.grounds_explained",
    ).value,
    false,
  );
  assert.equal(
    s.factLedger.findLast(
      (x) => x.fieldKey === "pps.identity_check.reason_explained",
    ).value,
    true,
  );
});
test("correcting actor to guard prevents further police advice", async (t) => {
  const f = await conversationFixture(t);
  await f.send("На меня кричит полицейский.");
  const r = await f.send("Я ошибся: это охранник магазина, не полицейский.");
  assert.equal(r.answer.variantId, undefined);
  assert.equal((await f.state()).episodes[0].actor, "other");
});
test("supplemental question uses the same single remaining budget", async (t) => {
  const f = await conversationFixture(t, {
    stageId: "identity_check",
    questionsUsed: 1,
    activeFacts: {
      "pps.identity_check.taken_to_station_for_id": null,
      "pps.identity_check.minor_person": null,
    },
  });
  await f.send("Сотрудник полиции продолжает проверку моей личности.");
  let s = await f.state();
  assert.equal(s.pending.kind, "supplemental");
  assert.equal(s.round.questionsUsed, 2);
  await f.button(null);
  s = await f.state();
  assert.equal(s.round.questionsUsed, 2);
  assert.equal(s.pending, null);
});
