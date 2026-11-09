import { dialoguePackage } from "./package.mjs";
// Display-only overlay: same questionId, field, polarity and branches.
export const questionDisplayVersion = "pps-question-display/20261024-v2";
export function questionText(pending, version) {
  if (!pending) return "";
  if (version !== dialoguePackage.categorySha256)
    return pending.question.question;
  const field =
    pending.fieldKey?.split(".").at(-1) || pending.question.field_key;
  if (
    field === "free_to_leave_denied" &&
    ["street_stop", "delivery_to_station"].includes(pending.stageId)
  )
    return "Сотрудник мешает вам уйти? Например, говорит, что уходить нельзя, или преграждает путь.";
  if (field === "minor_person" && pending.stageId === "identity_check")
    return "Человеку, чью личность проверяют, меньше 18 лет?";
  if (field === "minor_person" && pending.stageId === "delivery_to_station")
    return "Человеку, которого везут в отдел полиции, меньше 18 лет?";
  if (
    pending.question.id === "dm.pps.bag_search.bag_opened_by_officer.v1" &&
    pending.stageId === "bag_search" && field === "bag_opened_by_officer"
  ) return "Сотрудник полиции сам открывает или уже открыл вашу сумку при этом досмотре?";
  return pending.question.question;
}
export function questionExplanation(pending, version) {
  const field =
    pending.fieldKey?.split(".").at(-1) || pending.question.field_key;
  if (field === "taken_to_station_for_id")
    return "Этот вопрос о том, везут ли вас в отдел, чтобы установить, кто вы. Если не знаете цель поездки, выберите «Не знаю».";
  if (field === "free_to_leave_denied")
    return "Есть ли сейчас препятствие уходу со стороны сотрудника — словами или действиями? Если это пока непонятно, выберите «Не знаю».";
  return (
    "Уточню вопрос: " +
    questionText(pending, version) +
    " Если вы этого не знаете, можно выбрать «Не знаю»."
  );
}
export function suppressQuestion(s, pending, facts) {
  if (!pending) return false;
  const field =
    pending.fieldKey?.split(".").at(-1) || pending.question.field_key;
  if (s.round?.dismissedQuestionIds?.includes(pending.question.id)) return true;
  return (
    pending.stageId === "identity_check" &&
    facts["pps.identity_check.documents_taken_away"] === true &&
    ["taken_to_station_for_id", "minor_person"].includes(field)
  );
}
