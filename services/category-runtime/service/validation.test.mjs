import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateSource } from "./validate.mjs";
import { createBundleRuntime, sealBundle, jsonHash } from "./bundle/core.mjs";
const source = process.env.PPS_BUNDLE_PATH ? await readFile(process.env.PPS_BUNDLE_PATH, "utf8") : null;
const bundle = source ? JSON.parse(source) : null;
test("self-contained bundle, all 80 references, object NEXT", { skip: !source }, () => {
  const { report } = validateSource(source);
  assert.equal(report.variants, 290);
  assert.equal(report.document_uses, 80);
  assert.equal(report.document_templates, 3);
});
test("invalid JSON and v4 fail before any IO", () => {
  assert.throws(() => validateSource("{"));
  assert.throws(
    () =>
      validateSource(
        JSON.stringify({ ...bundle, metadata: { format_version: "mvp_v4" } }),
      ),
    /самодостаточный/,
  );
});
test("changed content and missing template blocked", { skip: !source }, () => {
  const copy = structuredClone(bundle);
  copy.document_templates.pop();
  assert.throws(() => validateSource(JSON.stringify(copy)));
});
test("PPS canonical field order checked even after re-sealing", { skip: !source }, () => {
  const copy = structuredClone(bundle);
  copy.subcategories[0].context_fields.reverse();
  copy.metadata.bundle.stage_closures[0].bundle_stage_sha256 = jsonHash(
    copy.subcategories[0],
  );
  sealBundle(copy);
  assert.throws(() => validateSource(JSON.stringify(copy)));
});
test("native facts and dependencies cannot be supplied by retrieval", { skip: !source }, () => {
  const runtime = createBundleRuntime(bundle);
  const row = bundle.subcategories.find(
    (s) => s.stage.id === "explanation_request",
  ).variants[0];
  assert.throws(() => runtime.prepare({ variant_id: row.variant_id }));
  assert.throws(() =>
    runtime.prepare({
      variant_id: row.variant_id,
      facts: { "pps.explanation_request.copy_requested_and_refused": true },
    }),
  );
  const r = runtime.prepare({ variant_id: row.variant_id, facts: {} });
  assert.equal(r.block.questions.length, 1);
  assert.notEqual(
    r.block.questions[0].field_key,
    "pps.explanation_request.copy_requested_and_refused",
  );
});
