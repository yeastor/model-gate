import test from "node:test";
import assert from "node:assert/strict";
import { answerForDisplay } from "./answer-display.mjs";
import { conversationFixture, bundle } from "./test-helpers.mjs";
import { dialoguePackage } from "./package.mjs";
const sha = dialoguePackage.categorySha256;
const rows = new Map(bundle.subcategories.flatMap((s) => s.variants.map((v) => [v.variant_id, v])));

test("no explanation remains false while the displayed request does not invent it", async (t) => {
  const f = await conversationFixture(t);
  const r = await f.send("Полицейский проверяет мои документы, причину проверки не объяснил.");
  assert.match(r.answer.content, /Какой документ или какие сведения обо мне вам сейчас нужны/);
  assert.doesNotMatch(r.answer.content, /Вы объяснили причину проверки/);
  assert.equal((await f.state()).engine.facts["pps.identity_check.reason_explained"], false);
});

test("forced home entry and no consent retain both facts without inventing prior words or crossing the threshold", async (t) => {
  const f = await conversationFixture(t);
  await f.send("Полицейские пытаются войти в мою квартиру.");
  await f.button(true);
  const r = await f.button(false);
  assert.equal(r.answer.variantId, "pps_home_entry_v29");
  assert.match(r.answer.content, /Если вы уже отказались впустить полицию/);
  assert.match(r.answer.content, /что сотрудники уже сделали при вскрытии двери или входе/);
  assert.doesNotMatch(r.answer.content, /Дословно запишите, как вы отказались|как вошли сотрудники|Запишите, как вы вошли/);
  const s = await f.state();
  assert.equal(s.engine.facts["pps.home_entry.forced_entry_used"], true);
  assert.equal(s.engine.facts["pps.home_entry.resident_consent_given"], false);
  assert.ok(!s.pending);
  assert.ok(s.round.questionsUsed <= 2);
});

test("opening question includes completed event and direct Yes preserves all other bag facts", async (t) => {
  const facts = {
    "pps.bag_search.grounds_explained": true,
    "pps.bag_search.witnesses_or_video_present": true,
    "pps.bag_search.items_seized": false,
    "pps.bag_search.search_protocol_created": true,
    "pps.bag_search.voluntary_show_agreed": false,
  };
  const f = await conversationFixture(t, { stageId: "bag_search", activeFacts: facts });
  const before = await f.send("Полицейский досматривает мою сумку.");
  assert.equal(before.answer.next.find((x) => x.type === "choice")?.questionText,
    "Сотрудник полиции сам открывает или уже открыл вашу сумку при этом досмотре?");
  await f.button(true);
  const s = await f.state();
  assert.equal(s.engine.facts["pps.bag_search.bag_opened_by_officer"], true);
  for (const [key, value] of Object.entries(facts)) assert.equal(s.engine.facts[key], value);
});

test("display correction preserves immutable source, law/document references and arrays", () => {
  for (const id of ["pps_home_entry_v19", "pps_home_entry_v29", "pps_identity_check_v48"]) {
    const row = rows.get(id), original = structuredClone(row);
    const shown = answerForDisplay(row, sha);
    assert.deepEqual(row, original);
    assert.strictEqual(shown.laws, row.payload.answer.laws);
    assert.strictEqual(shown.where_to, row.payload.answer.where_to);
    for (const field of ["steps", "dont", "say"]) assert.equal(shown[field].length, row.payload.answer[field].length);
    assert.ok(shown.steps.reduce((n, x) => n + Array.from(x.trim()).length, 0) <= 900);
    assert.ok(shown.say.reduce((n, x) => n + Array.from(x.trim()).length, 0) <= 450);
  }
});

test("another source version or mismatched original text never gets a mixed overlay", () => {
  const row = rows.get("pps_home_entry_v29");
  assert.strictEqual(answerForDisplay(row, "0".repeat(64)), row.payload.answer);
  const changed = structuredClone(row);
  changed.payload.answer.steps[0] = "Different version";
  assert.strictEqual(answerForDisplay(changed, sha), changed.payload.answer);
});
