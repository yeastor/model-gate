// Embeddings propose topics. Only user confirmation activates a topic.
export const routingQuestions = Object.freeze({
  street_stop: "Вас остановили на улице?",
  identity_check:
    "Сотрудник проверяет вашу личность или просит документ, удостоверяющий личность?",
  delivery_to_station: "Вас везут в отдел полиции или требуют поехать туда?",
  explanation_request:
    "Сотрудник просит вас дать или подписать письменное объяснение?",
  personal_search: "Сотрудник досматривает вас, вашу одежду или карманы?",
  bag_search:
    "Сотрудник проверяет или требует открыть вашу сумку, рюкзак или вещи?",
  home_entry: "Сотрудники пытаются войти в ваше жильё или уже вошли?",
  use_of_force: "Сотрудник уже применил к вам физическую силу?",
});
export const routingThreshold = 0.6;
export function routingEligible(parsed, text) {
  return (
    !parsed.choice &&
    !parsed.correction &&
    !parsed.deniedStage &&
    !parsed.ambiguousActor &&
    !parsed.ambiguousStage &&
    parsed.actor !== "other" &&
    !/(?:^|[\s,«])если(?:\s|$)|имеет ли право|в фильме|в кино|^я боюсь|^боюсь|в прошлом году|в другом эпизоде/i.test(
      text,
    )
  );
}
export function topicHints(text) {
  const t = text.toLowerCase().replaceAll("ё", "е");
  if (/останов/.test(t)) return ["street_stop"];
  if (/паспорт|удостовер|документ.{0,20}личност/.test(t))
    return ["identity_check"];
  return [];
}
export function routingCandidates(
  hits,
  bundle,
  sha,
  text,
  currentStage = null,
) {
  const stages = new Map(
    bundle.subcategories.map((s) => [
      s.stage.id,
      new Set(s.variants.map((v) => v.variant_id)),
    ]),
  );
  const scores = new Map();
  for (const hit of hits || []) {
    const p = hit?.payload,
      stage = p?.stage?.id;
    if (
      !Number.isFinite(hit.score) ||
      hit.score < routingThreshold ||
      p?.source_sha256 !== sha ||
      p.category?.id !== bundle.category.id ||
      !stages.get(stage)?.has(p.variant_id) ||
      !routingQuestions[stage] ||
      stage === currentStage
    )
      continue;
    if (
      !scores.has(stage) ||
      (scores.get(stage).fusionScore ?? scores.get(stage).score) <
        (hit.fusionScore ?? hit.score)
    )
      scores.set(stage, {
        stageId: stage,
        score: hit.score,
        ...(Number.isFinite(hit.fusionScore)
          ? { fusionScore: hit.fusionScore }
          : {}),
        basis: "embedding",
      });
  }
  const result = [...scores.values()].sort(
    (a, b) =>
      (b.fusionScore ?? b.score) - (a.fusionScore ?? a.score) ||
      a.stageId.localeCompare(b.stageId),
  );
  const hints = topicHints(text),
    top = result[0]?.score || 0;
  result.sort(
    (a, b) =>
      Number(hints.includes(b.stageId) && b.score >= top - 0.08) -
        Number(hints.includes(a.stageId) && a.score >= top - 0.08) ||
      (b.fusionScore ?? b.score) - (a.fusionScore ?? a.score),
  );
  return result.slice(0, 3);
}
export function partialContact(text) {
  return (
    /сотрудник|полицейск|инспектор|ппс/i.test(text) &&
    /останов|подош|обратил|интересуе|попросил|велел|требу/i.test(text)
  );
}
