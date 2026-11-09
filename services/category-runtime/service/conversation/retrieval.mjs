import { currentEpisode, project, hash } from "./state.mjs";
import { routingThreshold } from "./routing.mjs";

const bare = /^(?:да|нет|не знаю|не помню)[.!]?$/iu;
const safeFields = (s, stage, bundle) => {
  const facts = project(s, stage.stage.id);
  return stage.context_fields.flatMap((f) => {
    const value = facts[bundle.category.id + "." + stage.stage.id + "." + f.id];
    return [true, false].includes(value)
      ? [f.name + ": " + (value ? "да" : "нет")]
      : [];
  });
};
export function retrievalQueries(s, text, bundle) {
  const current = text.trim(),
    e = currentEpisode(s);
  const memory = [];
  if (e.actor === "police" && !e.ambiguousActor)
    memory.push("Участник: сотрудник полиции.");
  const stage =
    e.stageConfirmedByUser &&
    bundle.subcategories.find((x) => x.stage.id === e.stageId);
  if (stage) {
    memory.push("Предыдущая тема: " + stage.stage.name + ".");
    for (const sub of bundle.subcategories) {
      const fields = safeFields(s, sub, bundle);
      if (fields.length)
        memory.push(sub.stage.name + ": " + fields.join("; ") + ".");
    }
  } else {
    // User descriptions only; never assistant advice or an unconfirmed article.
    const prior = s.recentUserTurns
      .filter(
        (x) =>
          x.episodeId === e.id &&
          x.text !== text &&
          !bare.test(x.text.trim()) &&
          x.personId === e.personId &&
          x.documentId === e.documentId &&
          x.itemId === e.itemId,
      )
      .slice(-2);
    for (const turn of prior)
      memory.push("Ранее пользователь написал: " + turn.text.slice(0, 1000));
  }
  return [
    ...new Set([
      current,
      memory.length
        ? memory.join("\n").slice(0, 3000) +
          "\nНовое сообщение пользователя: " +
          current
        : current,
    ]),
  ];
}

export function validHits(hits, bundle, sha) {
  const rows = new Map(
    bundle.subcategories.flatMap((s) =>
      s.variants.map((v) => [v.variant_id, s.stage.id]),
    ),
  );
  return (Array.isArray(hits) ? hits : [])
    .filter(
      (h) =>
        Number.isFinite(h?.score) &&
        h.score >= routingThreshold &&
        h.payload?.source_sha256 === sha &&
        h.payload?.category?.id === bundle.category.id &&
        rows.has(h.payload.variant_id) &&
        rows.get(h.payload.variant_id) === h.payload.stage?.id,
    )
    .map((h) => ({
      score: h.score,
      payload: {
        source_sha256: sha,
        category: { id: bundle.category.id },
        stage: { id: h.payload.stage.id },
        variant_id: h.payload.variant_id,
      },
    }));
}

export function mergeRetrieval(results, bundle, sha) {
  const byId = new Map();
  for (const [queryIndex, list] of results.entries()) {
    const seen = new Set();
    const hits = validHits(list, bundle, sha);
    for (const [rank, h] of hits.entries()) {
      const id = h.payload.variant_id;
      if (seen.has(id)) continue;
      seen.add(id);
      const prev = byId.get(id) || { ...h, fusionScore: 0, sources: [] };
      prev.score = Math.max(prev.score, h.score);
      prev.fusionScore += 1 / (60 + rank + 1);
      prev.sources.push(queryIndex === 0 ? "direct" : "contextual");
      byId.set(id, prev);
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.fusionScore - a.fusionScore || b.score - a.score,
  );
}

async function boundedSearch(search, query, categoryId, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("DIALOGUE_SEARCH_TIMEOUT"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() =>
        search(query, { categoryId, limit: 32, signal: controller.signal }),
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function retrieveTurn({
  s,
  parsed,
  text,
  turnId,
  bundle,
  active,
  search,
  timeoutMs = 10000,
}) {
  if (
    parsed.choice ||
    parsed.intent === "show_advice" ||
    parsed.actor === "other" ||
    parsed.ambiguousActor
  )
    return null;
  const repeatedRouting = currentEpisode(s).routingQueries?.includes(
    hash(
      text
        .trim()
        .toLowerCase()
        .replaceAll("ё", "е")
        .replace(/[.!?]+$/u, "")
        .trim(),
    ),
  );
  if (
    repeatedRouting &&
    !parsed.stage &&
    !parsed.facts.length &&
    !parsed.newEpisode &&
    !parsed.correction &&
    s.retrievalBatch?.episodeId === s.activeEpisodeId &&
    !s.retrievalBatch.failed &&
    !s.retrievalBatch.pinnedUnavailable
  ) {
    s.retrievalBatch.turnId = turnId;
    return s.retrievalBatch;
  }
  const queries = retrievalQueries(s, text, bundle);
  const key = hash([s.activeEpisodeId, s.version, queries]);
  if (
    s.retrievalBatch?.key === key &&
    !s.retrievalBatch.failed &&
    !s.retrievalBatch.pinnedUnavailable
  ) {
    s.retrievalBatch.turnId = turnId;
    return s.retrievalBatch;
  }
  const batch = {
    key,
    turnId,
    episodeId: s.activeEpisodeId,
    queries,
    hits: [],
    attempted: 0,
    failed: 0,
    pinnedUnavailable: active.sha256 !== s.version,
  };
  if (!batch.pinnedUnavailable) {
    const results = await Promise.allSettled(
      queries.map((q) =>
        boundedSearch(search, q, bundle.category.id, timeoutMs),
      ),
    );

    batch.attempted = results.length;
    batch.failed = results.filter((r) => r.status === "rejected").length;
    batch.hits = mergeRetrieval(
      results.map((r) => (r.status === "fulfilled" ? r.value : [])),
      bundle,
      s.version,
    );
  }
  s.retrievalBatch = batch;
  s.retrievalUnavailable =
    batch.attempted > 0 && batch.failed === batch.attempted;
  s.retrieval = batch.hits.map((h) => ({
    variantId: h.payload.variant_id,
    stageId: h.payload.stage.id,
    score: h.score,
    fusionScore: h.fusionScore,
    sources: h.sources,
  }));
  return batch;
}

export function supportedTopicHits(batch, text) {
  const hits = batch?.hits || [];
  const directStages = new Set(
    hits
      .filter((h) => h.sources.includes("direct"))
      .map((h) => h.payload.stage.id),
  );
  const dependent =
    /^(?:он|она|они|его|ее|это|так|тогда|говорит|сказал|требует|требуют|просит|просят|непонятно)(?:\s|$)/iu.test(
      text.trim(),
    );
  return hits.filter((h) => directStages.has(h.payload.stage.id) || dependent);
}
