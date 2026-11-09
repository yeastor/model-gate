import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { conversationFixture, bundle } from "./test-helpers.mjs";
import { fresh, episode, identityKey, hash, read } from "./state.mjs";
import { createConversationService } from "./service.mjs";
import { reportedIssue } from "./issues.mjs";
import {
  consentVersion,
  offerFeedback,
  submitFeedback,
  withdrawFeedback,
  deleteFeedback,
} from "./feedback.mjs";
const views = (r) => r.answer.next.flatMap((x) => x.view);
test("real transcript: shouting becomes a question, repetitions stop the acknowledgement loop", async (t) => {
  const f = await conversationFixture(t, {
    stageId: "street_stop",
    activeFacts: { "pps.street_stop.free_to_leave_denied": true },
  });
  const a = await f.send("он кричит и орет на меня оскорбляет");
  assert.match(a.answer.content, /Вы сообщили/);
  assert.ok(views(a).some((x) => x.guided.native.value === true));
  const round = (await f.state()).round.id;
  const b = await f.send("сотрудник он кричит и орет на меня оскорбляет");
  assert.match(b.answer.content, /Отдельной памятки об этой детали пока нет/);
  assert.ok(b.answer.variantId);
  assert.equal((await f.state()).round.id, round);
  assert.equal((await f.state()).pending, null);
  assert.ok(views(b).some((x) => x.guided.native.kind === "feedback"));
  assert.doesNotMatch(b.answer.content, /учту уточнение/);
  assert.equal(
    (await f.state()).engine.facts["pps.street_stop.free_to_leave_denied"],
    true,
  );
});
test("phone outside a confirmed trip does not ask a question with no useful destination", async (t) => {
  const f = await conversationFixture(t, {
    stageId: "use_of_force",
    activeFacts: { "pps.use_of_force.force_actually_used": true },
  });
  const r = await f.send("требуют телефон"),
    s = await f.state();
  assert.ok(r.answer.variantId?.startsWith("pps_use_of_force"));
  assert.ok(
    !r.answer.next.some((g) => g.questionText?.includes("Телефон уже забрали")),
  );
  assert.ok(!s.factLedger.some((x) => x.fieldKey.endsWith("phone_taken")));
});
test("reported arrest threat does not assert arrest or actual force before an explicit answer", async (t) => {
  const f = await conversationFixture(t, { stageId: "identity_check" });
  const r = await f.send("он мне угро арестом");
  assert.match(
    r.answer.next.find((x) => x.type === "choice").questionText,
    /уже применил/,
  );
  assert.equal((await f.state()).factLedger.length, 0);
  await f.button(null);
  assert.equal((await f.state()).engine.stageId, "identity_check");
  assert.ok(
    !(await f.state()).factLedger.some(
      (x) =>
        x.fieldKey === "pps.use_of_force.force_actually_used" &&
        x.value === true,
    ),
  );
  const full = await f.send("он бьет меня");
  assert.equal(full.guided.stageId, "use_of_force");
  assert.equal(full.presentation.kind, "full");
});
test("unrecognized text offers feedback without changing existing known facts", async (t) => {
  const f = await conversationFixture(t, {
    stageId: "identity_check",
    activeFacts: { "pps.identity_check.minor_person": false },
  });
  const r = await f.send("он мне что-то про симку говорит и непонятно зачем"),
    s = await f.state();
  assert.match(r.answer.content, /пока не удалось/);
  assert.equal(r.answer.variantId, undefined);
  assert.equal(s.engine.facts["pps.identity_check.minor_person"], false);
  assert.equal(s.pending, null);
});
test("new supported problem leaves a bounded round and no feedback notice", async (t) => {
  const f = await conversationFixture(t, { stageId: "identity_check" });
  await f.send("абракадабра");
  const r = await f.send("Сотрудник полиции досматривает мою сумку");
  assert.equal(r.guided.stageId, "bag_search");
  assert.equal(r.presentation.kind, "full");
  assert.ok(!views(r).some((x) => x.guided.native.kind === "feedback"));
});
test("negative and third person issue reports are not positive evidence", () => {
  for (const text of [
    "он не угрожает",
    "он не кричит",
    "он кричит на прохожего",
    "а если он угрожает",
    "не требуют телефон",
  ])
    assert.equal(reportedIssue(text), null, text);
});
test("first document request is retained across police actor confirmation and initial article question is durable", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pps-actor-report-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  // Use the exact sealed hash required by the runtime package.
  const { dialoguePackage } = await import("./package.mjs");
  const runtime = createConversationService({
    dataDir: dir,
    getActive: async () => ({ sha256: dialoguePackage.categorySha256 }),
    getBundle: async () => bundle,
  });
  const id = randomUUID(),
    userId = "61";
  let r = await runtime.respond({
    id,
    userId,
    question: "Меня остановил сотрудник и просит документы",
    turnId: randomUUID(),
  });
  assert.match(r.answer.content, /сотруднике полиции/);
  await runtime.internal({ id, userId, turnId: r.turn.turnId }, "ack");
  const yes = views(r).find((x) => x.guided.native.value === true);
  r = await runtime.respond({
    id,
    userId,
    question: "Да",
    turnId: randomUUID(),
    conversation: r.conversation,
    guided: yes.guided,
  });
  assert.equal(r.guided.stageId, "identity_check");
  assert.equal(r.presentation.kind, "full");
  const article = randomUUID();
  let a = await runtime.respond({
    id: article,
    userId,
    resume: true,
    variantId: "pps_street_stop_v11",
  });
  assert.equal(a._historyEnvelope.question, "");
  assert.equal(a._historyEnvelope.answer, a.answer.content);
  const firstID = a._historyEnvelope.messageId;
  assert.equal(
    (await runtime.respond({ id: article, userId, resume: true }))
      ._historyEnvelope.messageId,
    firstID,
  );
  await runtime.internal(
    { id: article, userId, turnId: a._historyEnvelope.turnId },
    "ack",
  );
  a = await runtime.respond({ id: article, userId, resume: true });
  assert.equal(a._historyEnvelope, null);
});
test("feedback requires explicit current consent and stores all supplied trusted history exactly once", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pps-feedback-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const s = fresh("61", randomUUID(), "a".repeat(64));
  episode(s);
  const offer = offerFeedback(
    s,
    { turnId: randomUUID(), quote: "требуют телефон" },
    "phone_demand",
  );
  const transcript = [
    { direction: 1, text: "первое сообщение" },
    { direction: 2, text: "проверенный ответ" },
    { direction: 1, text: "требуют телефон" },
  ];
  const action = { offerId: offer.id, consentVersion, consent: true };
  const file = path.join(
    dir,
    "dialogue-feedback",
    identityKey(s.userId, s.chatId),
    offer.id + ".json",
  );
  await assert.rejects(
    submitFeedback(dir, s, { ...action, consent: false }, transcript),
    /CONSENT_REQUIRED/,
  );
  assert.equal(await read(file), null);
  await assert.rejects(
    submitFeedback(dir, s, { ...action, consentVersion: "old" }, transcript),
    /CONSENT_REQUIRED/,
  );
  await assert.rejects(
    submitFeedback(dir, s, action, []),
    /INVALID_FEEDBACK_TRANSCRIPT/,
  );
  await submitFeedback(dir, s, action, transcript);
  const saved = await read(file);
  assert.deepEqual(saved.transcript, transcript);
  assert.equal(saved.consent.accepted, true);
  assert.equal(saved.status, "NEW");
  await submitFeedback(dir, s, action, [
    ...transcript,
    { direction: 2, text: "receipt" },
  ]);
  assert.deepEqual((await read(file)).transcript, transcript);
  const stranger = fresh("62", s.chatId, s.version);
  episode(stranger);
  await assert.rejects(
    withdrawFeedback(dir, stranger, offer.id),
    /INVALID_FEEDBACK_RECEIPT/,
  );
  assert.ok(await read(file));
  await withdrawFeedback(dir, s, offer.id);
  assert.equal(await read(file), null);
  const second = offerFeedback(
    s,
    { turnId: randomUUID(), quote: "другая непонятная ситуация" },
    "unrecognized",
  );
  await submitFeedback(dir, s, { ...action, offerId: second.id }, transcript);
  await deleteFeedback(dir, s);
  assert.deepEqual(await fs.readdir(path.dirname(file)), []);
});

test("explicit previous memo remains accessible without claiming to answer the uncovered issue", async (t) => {
  const f = await conversationFixture(t, { stageId: "identity_check" });
  await f.send("совсем непонятная новая ситуация");
  const r = await f.resume();
  const view = views(r).find((x) => x.guided.native.kind === "show_advice");
  const full = await f.send(view.question, { guided: view.guided });
  assert.equal(full.presentation.kind, "full");
  assert.ok(full.answer.variantId);
  assert.ok(views(full).some((x) => x.guided.native.kind === "feedback"));
});
