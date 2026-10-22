import fs from "node:fs";
export const dialoguePackage = JSON.parse(
  fs.readFileSync(new URL("./policy/pps.v2.json", import.meta.url), "utf8"),
);
export function validateDialoguePackage(bundle) {
  const p = dialoguePackage;
  if (
    p.schemaVersion !== "dialogue-runtime/v1" ||
    p.categoryId !== bundle.category.id
  )
    throw Error("DIALOGUE_PACKAGE_INVALID");
  const fields = new Map(
    bundle.subcategories.flatMap((s) =>
      s.context_fields.map((f) => ["pps." + s.stage.id + "." + f.id, f]),
    ),
  );
  if (
    p.fields.length !== fields.size ||
    p.fields.some((f) => !fields.has(f.fieldKey))
  )
    throw Error("DIALOGUE_FIELDS_INVALID");
  for (const f of p.fields) {
    if (
      !["REVIEWED", "NEEDS_REVIEW"].includes(f.semanticsStatus) ||
      !["event", "state"].includes(f.scope.temporalKind)
    )
      throw Error("DIALOGUE_SEMANTICS_INVALID");
    for (const d of f.dependencies)
      if (!fields.has(d.fieldKey) || ![true, false, null].includes(d.value))
        throw Error("DIALOGUE_DEPENDENCY_INVALID");
  }
  const rows = new Map(
    bundle.subcategories.flatMap((s) =>
      s.variants.map((v) => [v.variant_id, { v, s }]),
    ),
  );
  const ids = new Set();
  for (const q of p.questions) {
    if (
      ids.has(q.id) ||
      q.branches.length !== 3 ||
      new Set(q.branches.map((b) => b.value)).size !== 3
    )
      throw Error("DIALOGUE_QUESTION_INVALID");
    ids.add(q.id);
    if (
      q.purpose === "context" &&
      (!fields.has(q.fieldKey) || p.blockedFields.includes(q.fieldKey))
    )
      throw Error("DIALOGUE_QUESTION_FIELD_INVALID");
    for (const b of q.branches) {
      if (![true, false, null].includes(b.value))
        throw Error("DIALOGUE_VALUE_INVALID");
      if (b.nextAction.kind === "variant") {
        const found = rows.get(b.nextAction.variantId);
        if (!found || found.s.stage.id !== q.stageId)
          throw Error("DIALOGUE_TARGET_INVALID");
        const facts = { ...q.showWhen.requiredFacts, [q.fieldKey]: b.value };
        if (
          !Object.entries(found.v.context).every(
            ([k, v]) => v === null || facts["pps." + q.stageId + "." + k] === v,
          )
        )
          throw Error("DIALOGUE_TARGET_INCOMPATIBLE");
      }
    }
  }
  if (p.maxQuestionsPerRound !== 2) throw Error("DIALOGUE_BUDGET_INVALID");
}
export function assertDialogueVersion(sha) {
  if (sha !== dialoguePackage.categorySha256)
    throw Object.assign(Error("DIALOGUE_BUNDLE_VERSION_UNAVAILABLE"), {
      status: 409,
    });
}
export const runtimeFields = Object.fromEntries(
  dialoguePackage.fields
    .filter((f) => f.semanticsStatus === "REVIEWED")
    .map((f) => [
      f.stageId + "." + f.fieldId,
      {
        semantics: f.scope.temporalKind,
        dependencies: f.dependencies
          .filter((d) => d.value === true)
          .map((d) => d.fieldKey.slice(4)),
        object:
          f.stageId === "explanation_request" ? "current_document" : undefined,
      },
    ]),
);
