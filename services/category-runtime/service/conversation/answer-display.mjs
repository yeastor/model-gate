import fs from "node:fs";
const overlay = JSON.parse(
  fs.readFileSync(new URL("./policy/pps-text-display.json", import.meta.url), "utf8"),
);
export const answerDisplayVersion = overlay.version;
// Only presentation changes. Never mutate the source row or its context.
export function answerForDisplay(row, sourceSha256) {
  const original = row.payload.answer;
  const edits = overlay.variants[row.variant_id];
  if (sourceSha256 !== overlay.sourceSha256 || !edits) return original;
  if (edits.some((edit) =>
    (edit.index === undefined ? original[edit.field] : original[edit.field]?.[edit.index]) !== edit.before
  )) return original;
  const answer = { ...original };
  for (const edit of edits) {
    if (edit.index === undefined) answer[edit.field] = edit.after;
    else {
      if (answer[edit.field] === original[edit.field]) answer[edit.field] = [...original[edit.field]];
      answer[edit.field][edit.index] = edit.after;
    }
  }
  return answer;
}
