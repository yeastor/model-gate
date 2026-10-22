import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createConversationService } from "./service.mjs";
import { identityKey, hash, recordFact, project } from "./state.mjs";
import { createExplicitEngine } from "../explicit/engine.mjs";
import { interpretTurn } from "./interpret.mjs";
const source = await fs.readFile(
  process.env.CATEGORY_FULL_FIXTURE ||
    "C:/Users/mujlo/Documents/Codex/model-category-document-generator/work/pps-natural-speech-content-seal-20261022-v2/pps.final.json",
  "utf8",
);
const bundle = JSON.parse(source),
  sha = hash(source);
async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aiza-dialogue-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const id = randomUUID(),
    userId = "51";
  const config = {
    dataDir: dir,
    getActive: async () => ({ sha256: sha }),
    getBundle: async () => bundle,
    search: async () => [],
    ...options,
  };
  let service = createConversationService(config),
    response;
  return {
    dir,
    id,
    userId,
    config,
    get service() {
      return service;
    },
    restart() {
      service = createConversationService(config);
    },
    async send(question, extra = {}) {
      const input = {
        id,
        userId,
        protocolVersion: 2,
        turnId: randomUUID(),
        question,
        conversation: response?.conversation,
        ...extra,
      };
      response = await service.respond(input);
      await service.internal(
        { id, userId, turnId: response.turn?.turnId },
        "ack",
      );
      return response;
    },
    async button(value) {
      const control = response.answer.next
        .flatMap((x) => x.view)
        .find((x) => x.guided.native.value === value);
      assert.ok(control, "choice available");
      return this.send(control.question, { guided: control.guided });
    },
    async resume(extra = {}) {
      response = await service.respond({
        id,
        userId,
        protocolVersion: 2,
        resume: true,
        ...extra,
      });
      return response;
    },
    async state() {
      return JSON.parse(
        await fs.readFile(
          path.join(
            dir,
            "conversation-sessions-v2",
            identityKey(userId, id) + ".json",
          ),
          "utf8",
        ),
      );
    },
    get response() {
      return response;
    },
  };
}
test("D01/D27 shouting is not explanation or trip, irrespective of retrieval score", async (t) => {
  const f = await fixture(t, {
    search: async () => [
      {
        score: 0.99,
        payload: {
          variant_id: "pps_delivery_to_station_v65",
          stage: { id: "delivery_to_station" },
          source_sha256: sha,
        },
      },
    ],
  });
  const r = await f.send("На меня кричит полицейский");
  assert.equal(r.presentation.kind, "clarification");
  assert.equal(r.answer.variantId, undefined);
  assert.equal((await f.state()).engine, null);
});
test("D02/D03/D07 force continuation resolves officer and escapes launch stage", async (t) => {
  const f = await fixture(t);
  await f.send("На меня кричит полицейский", {
    launchHint: { stageId: "explanation_request" },
  });
  await f.send("не знаю");
  const r = await f.send("Он меня бьёт");
  assert.equal(r.guided.stageId, "use_of_force");
  assert.equal(r.presentation.kind, "full");
  const s = await f.state();
  assert.equal(s.engine.facts["pps.use_of_force.force_actually_used"], true);
  assert.equal(s.pending.question.field_key, "injuries_present");
  assert.equal(
    Object.hasOwn(s.engine.facts, "pps.use_of_force.injuries_present"),
    false,
  );
});
test("D04/D05 unknown employee clarified before police-specific advice", async (t) => {
  const f = await fixture(t);
  let r = await f.send("Меня бьёт сотрудник");
  assert.equal(r.answer.variantId, undefined);
  assert.match(r.answer.content, /сотруднике полиции/);
  r = await f.button(true);
  assert.equal(r.guided.stageId, "use_of_force");
  const g = await fixture(t);
  assert.equal(
    (await g.send("Меня бьёт сотрудник полиции")).guided.stageId,
    "use_of_force",
  );
});
test("D06 article starts with empty facts and can be interrupted", async (t) => {
  const f = await fixture(t);
  let r = await f.resume({ variantId: "pps_explanation_request_v49" });
  assert.equal(r.status, "question");
  assert.equal(r.answer.variantId, undefined);
  assert.deepEqual((await f.state()).engine.facts, {});
  r = await f.send("Полицейский меня бьёт");
  assert.equal(r.guided.stageId, "use_of_force");
  assert.equal(r.presentation.kind, "full");
});
test("D08/D15 unknown stays null and unchanged advice is not repeated", async (t) => {
  const f = await fixture(t);
  const first = await f.send("Полицейский просит дать письменное объяснение");
  assert.equal(first.presentation.kind, "full");
  const second = await f.button(null);
  assert.equal(second.presentation.kind, "continuation");
  const third = await f.button(null);
  assert.equal(third.presentation.kind, "continuation");
  assert.notEqual(third.answer.content, first.answer.content);
  const s = await f.state();
  assert.equal(s.engine.facts["pps.explanation_request.copy_requested"], null);
  assert.equal(
    s.engine.facts[
      "pps.explanation_request.signature_on_explanation_requested"
    ],
    null,
  );
});
test("D09 unknown injuries can later be clarified", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский меня ударил");
  await f.button(null);
  const r = await f.send("Теперь вижу синяк после удара");
  assert.equal(
    (await f.state()).engine.facts["pps.use_of_force.injuries_present"],
    true,
  );
  assert.equal(r.presentation.kind, "full");
});
test("D10/D11 correction differs from ended event", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский меня ударил");
  await f.send("Я ошибся: он не ударил меня, только кричал");
  const s = await f.state();
  assert.equal(s.engine, null);
  assert.equal(
    s.factLedger.find(
      (x) =>
        x.status === "active" && x.fieldKey.endsWith("force_actually_used"),
    ).value,
    false,
  );
  const g = await fixture(t);
  await g.send("Полицейский меня бьёт");
  await g.send("Он перестал меня бить");
  const ended = await g.state();
  assert.equal(
    ended.engine.facts["pps.use_of_force.force_actually_used"],
    true,
  );
  assert.equal(ended.episodes[0].dangerOngoing, false);
});
test("D12 release updates current restriction and keeps earlier record", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский остановил меня на улице и не разрешает уйти");
  await f.send("Теперь он разрешил мне уйти");
  const s = await f.state();
  assert.equal(s.engine.facts["pps.street_stop.free_to_leave_denied"], false);
  assert.ok(
    s.factLedger.some((x) => x.value === true && x.status === "superseded"),
  );
});
test("D13 conflict is not silent overwrite", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский меня ударил");
  const r = await f.send("Меня никто не ударил");
  assert.match(r.answer.content, /исправляете/);
  assert.equal((await f.state()).factLedger.at(-1).status, "conflicted");
});
test("D14 uncertainty withdraws earlier injury claim", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский меня ударил");
  await f.button(true);
  await f.send("Я не уверен в своём ответе о травмах");
  const s = await f.state();
  assert.equal(s.engine.facts["pps.use_of_force.injuries_present"], null);
});
test("D16/D17 denials, threats and hypothetical statements do not assert actual force", async (t) => {
  for (const text of [
    "Полицейский меня не бьёт, только кричит",
    "Полицейский сказал, что ударит меня",
    "А если полицейский меня ударит?",
    "В фильме полицейский бьёт человека",
  ]) {
    const f = await fixture(t);
    await f.send(text);
    assert.ok(
      !(await f.state()).factLedger.some(
        (x) => x.fieldKey.endsWith("force_actually_used") && x.value === true,
      ),
    );
  }
});
test("D18 ambiguous actor is not guessed", async (t) => {
  const f = await fixture(t);
  await f.send("Со мной полицейский и охранник");
  const r = await f.send("Он меня ударил");
  assert.equal(r.answer.variantId, undefined);
  assert.match(r.answer.content, /Кто именно/);
});
test("D19 new episode does not inherit police actor", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский проверяет мой паспорт");
  const r = await f.send(
    "Теперь другой случай: охранник магазина кричит на меня",
  );
  const s = await f.state();
  assert.equal(s.episodes.length, 2);
  assert.equal(s.episodes[1].actor, "other");
  assert.equal(r.answer.variantId, undefined);
});
test("D20 compound answer retains new event", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский просит дать письменное объяснение");
  const r = await f.send(
    "Нет, копию не просил, а сейчас полицейский меня бьёт",
  );
  assert.equal(r.guided.stageId, "use_of_force");
  assert.ok(
    (await f.state()).factLedger.some(
      (x) => x.fieldKey.endsWith("copy_requested") && x.value === false,
    ),
  );
});
test("D21/D22/D23 copy dependencies and different documents", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский просит дать письменное объяснение");
  await f.send("Я просил копию этого объяснения и мне отказали");
  await f.send("Позже копию всё-таки выдали");
  let s = await f.state();
  assert.equal(
    s.engine.facts["pps.explanation_request.copy_requested_and_refused"],
    true,
  );
  await f.send("Исправлю: копию этого объяснения я не просил");
  s = await f.state();
  assert.notEqual(
    s.engine.facts["pps.explanation_request.copy_requested_and_refused"],
    true,
  );
  await f.send("Сейчас составляют другое объяснение");
  s = await f.state();
  assert.equal(
    Object.hasOwn(s.engine.facts, "pps.explanation_request.copy_requested"),
    false,
  );
});
test("D24 every category row and NEXT true/false/null target stays unchanged", () => {
  const before = hash(bundle);
  const engine = createExplicitEngine(bundle);
  let branches = 0;
  for (const stage of bundle.subcategories)
    for (const row of stage.variants) {
      assert.equal(
        engine.rowFor(row.variant_id).row.variant_id,
        row.variant_id,
      );
      const visit = (q) => {
        for (const a of q.data) {
          assert.ok([true, false, null].includes(a.value));
          branches++;
          if (a.go_to_variant) engine.rowFor(a.go_to_variant);
          if (a.ask_next_question) visit(a.ask_next_question);
        }
      };
      row.payload.next.forEach(visit);
    }
  assert.equal(hash(bundle), before);
  assert.equal(branches, 3462);
});
test("D25/D26 budget is round-scoped, repeated event does not renew it", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский просит дать письменное объяснение");
  await f.button(null);
  await f.button(null);
  const old = (await f.state()).round;
  await f.send("Полицейский меня бьёт");
  let s = await f.state();
  assert.notEqual(s.round.id, old.id);
  const id = s.round.id;
  const count = s.round.nextPresented;
  await f.send("Полицейский меня бьёт");
  s = await f.state();
  assert.equal(s.round.id, id);
  assert.equal(s.round.nextPresented, count);
  assert.ok(count <= 2);
});
test("D28 dependency failure preserves known facts", async (t) => {
  const f = await fixture(t, {
    search: async () => {
      throw Error("unavailable");
    },
  });
  await f.send("Полицейский кричит");
  await f.send("Он меня бьёт");
  const before = (await f.state()).engine.facts;
  await f.send("непонятная подробность");
  assert.deepEqual((await f.state()).engine.facts, before);
});
test("D29/D30/D33 turn retry, receipt after restart, stale state, delivery barrier", async (t) => {
  const f = await fixture(t),
    input = {
      id: f.id,
      userId: f.userId,
      protocolVersion: 2,
      turnId: randomUUID(),
      question: "Полицейский меня бьёт",
    };
  const one = await f.service.respond(input);
  f.restart();
  const two = await f.service.respond(input);
  assert.equal(two.presentation.responseId, one.presentation.responseId);
  assert.equal((await f.state()).revision, 1);
  await assert.rejects(
    f.service.respond({ ...input, question: "другое" }),
    /TURN_ID_CONFLICT/,
  );
  await assert.rejects(
    f.service.respond({
      ...input,
      turnId: randomUUID(),
      conversation: one.conversation,
    }),
    /HISTORY_DELIVERY_PENDING/,
  );
  await f.service.internal(
    { id: f.id, userId: f.userId, turnId: input.turnId },
    "ack",
  );
  await assert.rejects(
    f.service.respond({
      ...input,
      turnId: randomUUID(),
      conversation: { sessionId: one.conversation.sessionId, revision: 0 },
    }),
    /STALE_STATE/,
  );
});
test("D31 server resume does not write another turn", async (t) => {
  const f = await fixture(t);
  const one = await f.send("Полицейский меня бьёт");
  f.restart();
  const two = await f.resume();
  assert.equal(one.presentation.responseId, two.presentation.responseId);
  assert.equal((await f.state()).revision, 1);
});
test("D32 client context is not evidence; ownership partitions state", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский кричит", {
    guided: { context: { force_actually_used: true } },
  });
  assert.equal((await f.state()).factLedger.length, 0);
  const foreign = await f.service.respond({
    id: f.id,
    userId: "52",
    protocolVersion: 2,
    resume: true,
  });
  assert.notEqual(
    foreign.guided.native.sessionId,
    f.response.guided.native.sessionId,
  );
});
test("D34 legacy buttons migrate with evidence and null retained", async (t) => {
  const f = await fixture(t);
  const old = {
    userId: f.userId,
    chatId: f.id,
    version: sha,
    stageId: "street_stop",
    presented: 1,
    revision: 1,
    history: [
      {
        fieldKey: "pps.street_stop.free_to_leave_denied",
        questionId: "legacy-q",
        value: null,
        revision: 1,
      },
    ],
  };
  const dir = path.join(f.dir, "explicit-sessions");
  await fs.mkdir(dir);
  await fs.writeFile(
    path.join(dir, identityKey(f.userId, f.id) + ".json"),
    JSON.stringify(old),
  );
  await f.resume();
  const s = await f.state();
  assert.equal(s.factLedger[0].source.kind, "legacy_button");
  assert.equal(s.factLedger[0].value, null);
});
test("D35 deleted state cannot revive; unavailable pinned version is explicit", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский меня бьёт");
  await f.service.internal({ id: f.id, userId: f.userId }, "delete");
  await assert.rejects(f.resume(), /CHAT_DELETED/);
  const g = await fixture(t, {
    getBundle: async () => {
      throw Error("missing");
    },
  });
  await assert.rejects(g.resume(), /PINNED_BUNDLE_UNAVAILABLE/);
});
test("D36 all eight stage prerequisites route and explicit show can repeat advice", async (t) => {
  const texts = [
    "Полицейский остановил меня на улице",
    "Полицейский проверяет паспорт",
    "Полицейский предлагает проехать в отдел",
    "Полицейский просит дать письменное объяснение",
    "Полицейский проводит личный досмотр",
    "Полицейский досматривает сумку",
    "Полицейский меня бьёт",
    "Полицейский требует войти в квартиру",
  ];
  const stages = [
    "street_stop",
    "identity_check",
    "delivery_to_station",
    "explanation_request",
    "personal_search",
    "bag_search",
    "use_of_force",
    "home_entry",
  ];
  for (let i = 0; i < texts.length; i++) {
    const f = await fixture(t);
    const r = await f.send(texts[i]);
    assert.equal(r.guided.stageId, stages[i], texts[i]);
  }
  const f = await fixture(t);
  await f.send("Полицейский меня бьёт");
  await f.button(null);
  assert.equal((await f.send("Показать памятку")).presentation.kind, "full");
});

test("unknown clarification is acknowledged instead of repeating the question", async (t) => {
  const f = await fixture(t);
  const a = await f.send("На меня кричит полицейский");
  const b = await f.send("не знаю");
  assert.notEqual(a.answer.content, b.answer.content);
  assert.match(b.answer.content, /пока это неизвестно/);
});
test("conflicted facts cannot leave old confirmed engine projection", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский меня ударил");
  await f.send("Меня никто не ударил");
  assert.equal((await f.state()).engine, null);
});

test("negative and ambiguous procedures are not positive routing evidence", async (t) => {
  for (const input of [
    "Полицейский не просит паспорт",
    "Полицейский проверяет паспорт и досматривает сумку",
  ]) {
    const f = await fixture(t);
    const r = await f.send(input);
    assert.equal(r.answer.variantId, undefined);
  }
});

test("D30 superseded button and two concurrent turns cannot mutate twice", async (t) => {
  const f = await fixture(t);
  const a = await f.send("Полицейский просит дать письменное объяснение");
  const old = a.answer.next[0].view[0].guided;
  await f.send("Полицейский меня бьёт");
  await assert.rejects(f.send("Да", { guided: old }), /STALE_ACTION/);
  const current = f.response;
  const input = {
    id: f.id,
    userId: f.userId,
    protocolVersion: 2,
    question: "не знаю",
    conversation: current.conversation,
  };
  const results = await Promise.allSettled([
    f.service.respond({ ...input, turnId: randomUUID() }),
    f.service.respond({ ...input, turnId: randomUUID() }),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
});
test("D25 explicit stage navigation does not reset an exhausted budget", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский просит дать письменное объяснение");
  await f.button(null);
  await f.button(null);
  const a = f.response;
  const native = { ...a.guided.native, kind: "stage" };
  await f.send("Досмотр", {
    guided: { ...a.guided, stageId: "bag_search", native },
  });
  assert.equal((await f.state()).round.nextPresented, 2);
  assert.equal((await f.state()).engine.pending, null);
});
test("D35 active category updates keep existing conversation pinned", async (t) => {
  let active = sha;
  const f = await fixture(t, {
    getActive: async () => ({ sha256: active }),
    getBundle: async (requested) => {
      assert.equal(requested, sha);
      return bundle;
    },
  });
  await f.send("Полицейский меня бьёт");
  active = "f".repeat(64);
  const r = await f.resume();
  assert.equal(r.guided.version, sha);
});
test("saved history includes the actual pending question", async (t) => {
  const f = await fixture(t);
  const r = await f.send("Полицейский просит дать письменное объяснение");
  const s = await f.state();
  assert.ok(s.turns[r.turn.turnId]);
  const last = await f.service.respond({
    id: f.id,
    userId: f.userId,
    protocolVersion: 2,
    turnId: randomUUID(),
    question: "Не знаю",
    conversation: r.conversation,
    guided: r.answer.next[0].view.find((x) => x.guided.native.value === null)
      .guided,
  });
  assert.match(last._historyEnvelope.answer, /Вопрос: Вас просят подписать/);
});

test("retrieval query uses user history within the current episode only", async (t) => {
  const queries = [];
  const f = await fixture(t, {
    search: async (q) => {
      queries.push(q);
      return [];
    },
  });
  await f.send("Полицейский кричит");
  await f.send("Говорит непонятно");
  assert.match(queries.at(-1), /Полицейский кричит; Говорит непонятно/);
  await f.send("Другой случай: что происходит");
  assert.doesNotMatch(queries.at(-1), /Полицейский кричит/);
});

test("past force does not imply ongoing beating; resumed force is a new material event", async (t) => {
  const f = await fixture(t);
  await f.send("Полицейский меня ударил");
  assert.equal((await f.state()).episodes[0].dangerOngoing, null);
  await f.send("Он перестал меня бить");
  const before = (await f.state()).round.id;
  const again = await f.send("Полицейский опять меня бьёт");
  assert.notEqual((await f.state()).round.id, before);
  assert.equal(again.presentation.kind, "full");
});
