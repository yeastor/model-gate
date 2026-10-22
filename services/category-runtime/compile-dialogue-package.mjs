// Compile accepted data only. Authoring examples never execute as extraction rules.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const input = path.resolve(
  process.argv[2] ||
    path.join(
      root,
      "dialogue-generator/output/pps/20261022-v2-semantic-review",
    ),
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(input, "manifest.json"), "utf8"),
);
for (const pin of manifest.files) {
  if (path.basename(pin.path) !== pin.path) throw Error("INVALID_PIN_PATH");
  const b = fs.readFileSync(path.join(input, pin.path));
  if (
    b.length !== pin.bytes ||
    createHash("sha256").update(b).digest("hex") !== pin.sha256
  )
    throw Error("AUTHORING_INTEGRITY");
}
const read = (n) => JSON.parse(fs.readFileSync(path.join(input, n), "utf8"));
const sem = read("field-semantics.json"),
  sup = read("supplemental-next.json");
const data = {
  schemaVersion: "dialogue-runtime/v1",
  version: "pps-dialogue/20261022-v2",
  categoryId: "pps",
  categorySha256: manifest.categorySha256,
  sourceAuthoringVersion: manifest.packageVersion,
  sourceManifestSha256: createHash("sha256")
    .update(fs.readFileSync(path.join(input, "manifest.json")))
    .digest("hex"),
  maxQuestionsPerRound: sup.scheduler.maxQuestionsPerRound,
  fields: sem.fields.map((f) => ({
    fieldKey: f.fieldKey,
    stageId: f.stageId,
    fieldId: f.fieldId,
    definition: f.definition,
    values: f.values,
    scope: f.scope,
    dependencies: f.dependencies,
    questionPrerequisites: f.questionPrerequisites,
    semanticsStatus: f.coverage.semanticsStatus,
  })),
  questions: sup.questions.map(({ caseIds, activationStatus, ...q }) => ({
    ...q,
    activationStatus: "ENABLED",
  })),
  decisions: sup.decisions.map((d) => ({
    fieldKey: d.fieldKey,
    decision: d.decision,
    sourceQuestionIds: d.sourceQuestionIds,
  })),
  blockedFields: sem.fields
    .filter((f) => f.coverage.semanticsStatus !== "REVIEWED")
    .map((f) => f.fieldKey),
};
const output = path.join(
  root,
  "services/category-runtime/service/conversation/policy/pps.v2.json",
);
fs.writeFileSync(output, JSON.stringify(data, null, 2) + "\n");
const ext = read("extraction-cases.json");
const testDir = path.join(root, "services/category-runtime/testdata");
fs.mkdirSync(testDir, { recursive: true });
fs.writeFileSync(
  path.join(testDir, "pps-extraction.json"),
  JSON.stringify({
    sourceSha256: ext.categorySha256,
    packageVersion: ext.packageVersion,
    cases: ext.cases.map((c) => ({
      id: c.id,
      fieldKeys: c.fieldKeys,
      family: c.family,
      input: c.input,
      expected: c.expected,
    })),
  }) + "\n",
);
console.log(
  JSON.stringify({
    output,
    fields: data.fields.length,
    blocked: data.blockedFields,
    questions: data.questions.length,
  }),
);
