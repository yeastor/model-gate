import test from "node:test";
import assert from "node:assert/strict";
import { createExplicitEngine } from "../explicit/engine.mjs";
import { conversationFixture, bundle } from "./test-helpers.mjs";
import { dialoguePackage } from "./package.mjs";
import {
  createQuestionCatalog,
  validateQuestionDefinition,
} from "./questions.mjs";
const views = (r) => r.answer.next.flatMap((g) => g.view);
const force = "pps.use_of_force.force_actually_used";
const say = (value) => (value === null ? "Не знаю" : value ? "Да" : "Нет");
function assertAnswer(r) {
  assert.ok(r.answer.variantId);
  assert.notEqual(r.presentation.kind, "notice");
  assert.doesNotMatch(r.answer.content, /пока не удалось подобрать/);
}
for (const mode of ["button", "text"])
  for (const value of [true, false, null]) {
    test(`threat closure ${mode} ${value}`, async (t) => {
      const f = await conversationFixture(t);
      await f.send("Полицейский остановил меня на улице.");
      const first = await f.send("Он угрожает.");
      assert.match(
        first.answer.next.find((g) => g.type === "choice").questionText,
        /уже применил/,
      );
      const before = await f.state();
      assert.ok(
        !before.factLedger.some(
          (x) => x.fieldKey === force && x.value === true,
        ),
      );
      const r =
        mode === "button" ? await f.button(value) : await f.send(say(value));
      const s = await f.state();
      assertAnswer(r);
      assert.equal(
        s.factLedger.findLast((x) => x.fieldKey === force).value,
        value,
      );
      assert.equal(
        s.engine.stageId,
        value === true ? "use_of_force" : "street_stop",
      );
      assert.ok(s.round.questionsUsed <= 2);
      assert.equal(s.questionOutcome.operation, "fact");
      assert.equal(s.questionOutcome.variantId, r.answer.variantId);
    });
    test(`phone trip closure ${mode} ${value}`, async (t) => {
      const f = await conversationFixture(t);
      await f.send("Полицейский везёт меня в отдел.");
      await f.send("Он требует телефон.");
      const r =
        mode === "button" ? await f.button(value) : await f.send(say(value));
      const s = await f.state();
      assertAnswer(r);
      assert.equal(
        s.engine.facts["pps.delivery_to_station.phone_taken"],
        value,
      );
      assert.equal(
        r.answer.variantId,
        value === true
          ? "pps_delivery_to_station_v67"
          : "pps_delivery_to_station_v65",
      );
      assert.ok(s.round.questionsUsed <= 2);
    });
  }
for (const value of [false, null])
  test(`document rejection retains safe known stop ${value}`, async (t) => {
    const f = await conversationFixture(t);
    await f.send("Полицейский остановил меня на улице.");
    await f.send("Он забрал документы.");
    const r = await f.button(value);
    const s = await f.state();
    assertAnswer(r);
    assert.ok(r.answer.variantId.startsWith("pps_street_stop"));
    assert.ok(
      !s.factLedger.some(
        (x) => x.fieldKey.endsWith("documents_taken_away") && x.value === true,
      ),
    );
  });
for (const value of [false, null])
  test(`declined routing retains current compatible advice ${value}`, async (t) => {
    const f = await conversationFixture(t, {
      stageId: "street_stop",
      search: async () => [
        {
          score: 0.92,
          payload: {
            source_sha256: dialoguePackage.categorySha256,
            category: { id: "pps" },
            stage: { id: "identity_check" },
            variant_id: "pps_identity_check_v33",
          },
        },
      ],
    });
    await f.send("Помогите разобраться с ситуацией.");
    const r = await f.button(value);
    assertAnswer(r);
    assert.equal((await f.state()).engine.stageId, "street_stop");
  });
test("known ongoing force is retained when phone question is outside its scope", async (t) => {
  const f = await conversationFixture(t);
  await f.send("Полицейский меня бьёт.");
  const r = await f.send("Он требует телефон.");
  const s = await f.state();
  assertAnswer(r);
  assert.equal(r.presentation.urgentPriority, true);
  assert.ok(r.answer.variantId.startsWith("pps_use_of_force"));
  assert.ok(
    !r.answer.next.some((g) => g.questionText?.includes("Телефон уже забрали")),
  );
  assert.ok(!s.factLedger.some((x) => x.fieldKey.endsWith("phone_taken")));
});
test("different issue labels retain one question identity and the common budget", async (t) => {
  const f = await conversationFixture(t);
  await f.send("Полицейский остановил меня на улице.");
  await f.send("Он угрожает.");
  const s1 = await f.state();
  const r = await f.send("Он кричит на меня.");
  const s2 = await f.state();
  assertAnswer(r);
  assert.equal(s2.round.id, s1.round.id);
  assert.ok(s2.round.questionsUsed <= 2);
  assert.equal(s2.pending.question.id, s1.pending.question.id);
  assert.equal(s2.round.questionsUsed, s1.round.questionsUsed);
});
test("known material stop fact survives a declined force question", async (t) => {
  const f = await conversationFixture(t, {
    stageId: "street_stop",
    activeFacts: { "pps.street_stop.free_to_leave_denied": true },
  });
  await f.send("Он угрожает.");
  const r = await f.button(false);
  assertAnswer(r);
  assert.equal(r.answer.variantId, "pps_street_stop_v12");
});
test("all displayed source and supplemental questions have three planned destinations", async (t) => {
  const f = await conversationFixture(t);
  for (const q of [
    "Полицейский остановил меня на улице.",
    "Требует паспорт.",
    "Он просит подписать объяснение.",
  ]) {
    await f.send(q);
    const s = await f.state();
    if (s.pending) {
      assert.equal(s.questionPlan.admitted, true);
      assert.equal(s.questionPlan.branches.length, 3);
      assert.ok(
        s.questionPlan.branches.every(
          (b) => b.kind !== "variant" || b.variantId,
        ),
      );
    }
  }
});
for (const q of dialoguePackage.questions.filter(
  (q) => q.purpose === "context",
))
  for (const value of [true, false, null])
    test(`supplemental catalog route ${q.id} ${value}`, async (t) => {
      const f = await conversationFixture(t, {
        stageId: q.stageId,
        activeFacts: q.showWhen.requiredFacts,
        pending: {
          kind: "supplemental",
          fieldKey: q.fieldKey,
          stageId: q.stageId,
          question: {
            id: q.id,
            question: q.question,
            data: q.branches.map((b) => ({ value: b.value, label: b.label })),
          },
        },
      });
      const r = await f.send(say(value));
      assertAnswer(r);
      const s = await f.state();
      assert.equal(s.engine.facts[q.fieldKey], value);
    });
test("catalog validates source inventory and rejects missing branch or invalid target", () => {
  const e = createExplicitEngine(bundle),
    c = createQuestionCatalog(e);
  assert.equal(
    [...c.definitions.values()].filter((x) => x.source === "existing_next")
      .length,
    1154,
  );
  assert.throws(
    () =>
      validateQuestionDefinition(
        {
          id: "missing",
          branches: [
            { value: true, kind: "variant", variantId: "pps_street_stop_v11" },
          ],
        },
        e,
      ),
    /QUESTION_BRANCHES_INVALID/,
  );
  assert.throws(() =>
    validateQuestionDefinition(
      {
        id: "bad",
        branches: [true, false, null].map((value) => ({
          value,
          kind: "variant",
          variantId: "missing",
        })),
      },
      e,
    ),
  );
  assert.throws(
    () =>
      validateQuestionDefinition(
        {
          id: "dead",
          branches: [true, false, null].map((value) => ({
            value,
            kind: "describe",
          })),
        },
        e,
      ),
    /BOUNDARY_REASON/,
  );
});
for (const value of [false, null])
  test(`scope boundary does not invent a police answer ${value}`, async (t) => {
    const f = await conversationFixture(t, { actor: null });
    await f.send("Меня бьёт сотрудник.");
    const r = await f.button(value);
    const s = await f.state();
    assert.equal(r.answer.variantId, undefined);
    assert.equal(s.engine, null);
    assert.ok(s.questionOutcome.reason);
    assert.ok(
      !s.factLedger.some((x) => x.fieldKey === force && x.value === true),
    );
  });

test("an article question answer cannot invent the police actor", async (t) => {
  const e = createExplicitEngine(bundle);
  const q = e.rowFor(e.entryFor("use_of_force")).row.payload.next[0];
  const f = await conversationFixture(t, {
    actor: null,
    stageId: "use_of_force",
    pending: { kind: "next", stageId: "use_of_force", question: q },
  });
  const r = await f.send("Да");
  assert.match(r.answer.content, /сотруднике полиции/);
  assert.ok(
    !(await f.state()).factLedger.some(
      (x) => x.fieldKey === force && x.value === true,
    ),
  );
  const full = await f.button(true);
  assertAnswer(full);
  assert.equal((await f.state()).engine.facts[force], true);
});

test("old issue buttons are invalidated without reinterpreting threat as actual force", async (t) => {
  const fs = await import("node:fs/promises"),
    os = await import("node:os"),
    path = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const { fresh, episode, newRound, atomic, identityKey } =
    await import("./state.mjs");
  const { createConversationService } = await import("./service.mjs");
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pps-closure-migration-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const id = randomUUID(),
    userId = "84",
    s = fresh(userId, id, dialoguePackage.categorySha256),
    e = episode(s);
  newRound(s, "old-issue");
  e.actor = "police";
  e.stageId = "street_stop";
  e.stageConfirmedByUser = true;
  s.behaviourVersion = "mvp-feedback/20261023-v5";
  s.policyVersion = dialoguePackage.version;
  s.pending = {
    kind: "issue",
    issueId: "old",
    question: {
      id: "old-threat",
      question: "Сотрудник угрожает применить силу?",
    },
  };
  const old = {
    sessionId: s.id,
    nonce: s.nonce,
    revision: s.revision,
    episodeId: s.activeEpisodeId,
    roundId: s.round.id,
    questionId: s.pending.question.id,
    value: true,
    kind: "clarify",
  };
  await atomic(
    path.join(
      dir,
      "conversation-sessions-v2",
      identityKey(userId, id) + ".json",
    ),
    s,
  );
  const service = createConversationService({
    dataDir: dir,
    getActive: async () => ({ sha256: s.version }),
    getBundle: async () => bundle,
  });
  const resumed = await service.respond({ id, userId, resume: true });
  assert.ok(
    !resumed.answer.next.some((g) =>
      g.questionText?.includes("угрожает применить"),
    ),
  );
  await assert.rejects(
    service.respond({
      id,
      userId,
      question: "Да",
      turnId: randomUUID(),
      conversation: resumed.conversation,
      guided: { native: old },
    }),
    /STALE_ACTION/,
  );
  const saved = JSON.parse(
    await fs.readFile(
      path.join(
        dir,
        "conversation-sessions-v2",
        identityKey(userId, id) + ".json",
      ),
      "utf8",
    ),
  );
  assert.ok(
    !saved.factLedger.some((x) => x.fieldKey === force && x.value === true),
  );
});

test("exact user transcript: threat retains help without replenishing the case budget", async (t) => {
  const f = await conversationFixture(t, { actor: null });
  await f.send("меня остановил сотрудник ппс");
  await f.button(true);
  const before = await f.state();
  assert.equal(before.round.questionsUsed, 2);
  const r = await f.send("он угрожает");
  const after = await f.state();
  assertAnswer(r);
  assert.equal(after.pending, null);
  assert.ok(!r.answer.next.some((g) => g.type === "choice"));
  assert.equal(after.caseState.id, before.caseState.id);
  assert.equal(after.round.questionsUsed, 2);
  assert.deepEqual(after.caseState.served, before.caseState.served);
  // Exhaustion limits questions, not unsolicited facts or urgent advice.
  const full = await f.send("Сотрудник полиции меня ударил.");
  assertAnswer(full);
  const force = await f.state();
  assert.equal(force.engine.stageId, "use_of_force");
  assert.equal(force.engine.facts["pps.use_of_force.force_actually_used"], true);
  assert.equal(force.round.questionsUsed, 2);
  assert.equal(force.pending, null);
});

test("a dismissed force question is not reopened under the threat label", async (t) => {
  const f = await conversationFixture(t, { stageId: "use_of_force" });
  await f.send("Показать памятку");
  await f.send("Я не понимаю ваш вопрос.");
  await f.send("Я не понимаю ваш вопрос.");
  const r = await f.send("Он угрожает.");
  assertAnswer(r);
  assert.ok(
    !r.answer.next.some(
      (g) =>
        g.questionText?.includes("уже применил") ||
        g.questionText?.includes("уже применили"),
    ),
  );
});
