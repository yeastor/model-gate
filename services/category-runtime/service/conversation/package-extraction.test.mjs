import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fresh, episode, recordFact } from "./state.mjs";
import { interpretTurn } from "./interpret.mjs";
import { dialoguePackage } from "./package.mjs";
const corpus = JSON.parse(
  fs.readFileSync(
    new URL("../../testdata/pps-extraction.json", import.meta.url),
    "utf8",
  ),
);
assert.equal(corpus.sourceSha256, dialoguePackage.categorySha256);
const failures = [];
for (const c of corpus.cases) {
  const s = fresh("1", "test", corpus.sourceSha256),
    e = episode(s),
    prior = c.input.prior;
  e.actor = prior.actor;
  e.ambiguousActor = prior.actor === "ambiguous";
  e.stageId = prior.stageId;
  for (const [k, v] of Object.entries(prior.activeFacts || {}))
    recordFact(s, k, v, {
      kind: "user_text",
      quote:
        prior.userStatements?.find((x) => x.turnId === "prior-fact")?.text ||
        prior.userStatements?.at(-1)?.text ||
        "",
      turnId: "prior",
    });
  if (c.input.pendingQuestion)
    s.pending = {
      kind: "next",
      stageId: prior.stageId,
      question: {
        id: c.input.pendingQuestion.questionId,
        field_key: c.input.pendingQuestion.fieldKey.split(".").at(-1),
      },
    };
  const parsed = interpretTurn(s, c.input.turn.text, c.input.turn.id);
  let facts = parsed.facts;
  if (
    parsed.choice &&
    s.pending &&
    !dialoguePackage.blockedFields.includes(c.input.pendingQuestion.fieldKey)
  )
    facts = [
      ...facts,
      {
        field: prior.stageId + "." + s.pending.question.field_key,
        value: parsed.choiceValue,
      },
    ];
  for (const k of c.fieldKeys) {
    const actual = facts
      .filter((f) => "pps." + f.field === k)
      .map((f) => f.value);
    const expected = dialoguePackage.blockedFields.includes(k)
      ? []
      : c.expected.proposals
          .filter((p) => p.fieldKey === k)
          .map((p) => p.value);
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      failures.push({ id: c.id, text: c.input.turn.text, actual, expected });
  }
}
test("reviewed PPS extraction corpus: actual interpreter against frozen labels", () => {
  if (failures.length)
    console.log(
      JSON.stringify(
        { total: corpus.cases.length, failed: failures.length, failures },
        null,
        2,
      ),
    );
  assert.deepEqual(failures, []);
});
