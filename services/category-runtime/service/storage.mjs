import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { bytesHash, same } from "./bundle/core.mjs";
import { validateSource } from "./validate.mjs";
import { FORMAT, checkDocumentLinks, blocked } from './explicit/contract.mjs';

export const root = path.resolve(
  process.env.CATEGORY_DATA_DIR || "work/category-loader",
);
export const alias = process.env.CATEGORY_QDRANT_ALIAS || 'aizashchita_active_scenarios';
if (!/^[a-zA-Z0-9_-]{1,120}$/.test(alias)) throw new Error('Invalid Qdrant alias.');
const qdrant = process.env.CATEGORY_QDRANT_URL || "http://127.0.0.1:6333";
const ollama = process.env.CATEGORY_OLLAMA_URL || "http://127.0.0.1:11435";
export async function jsonFile(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
export async function atomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  await writeFile(temp, JSON.stringify(data, null, 2));
  await rename(temp, file);
}
export const active = () => jsonFile(path.join(root, "active.json"));
export async function api(base, route, body, method, signal) {
  const response = await fetch(base + route, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
  });
  if (!response.ok)
    throw new Error(
      `${route}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`,
    );
  return response.json();
}
export const q = (route, body, method, signal) => api(qdrant, route, body, method, signal);
export async function embed(text, signal) {
  const result = await api(ollama, "/api/embed", {
    model: "bge-m3",
    input: text,
    truncate: false,
    keep_alive: "10m",
  }, undefined, signal);
  if (
    !result.embeddings?.length ||
    result.embeddings.some(
      (v) => v.length !== 1024 || v.some((n) => !Number.isFinite(n)),
    )
  )
    throw new Error("bge-m3: ожидался вектор 1024.");
  return result.embeddings;
}
export async function allPoints(collection) {
  const points = [];
  let offset;
  do {
    const r = await q(`/collections/${collection}/points/scroll`, {
      limit: 100,
      with_payload: true,
      with_vector: true,
      ...(offset ? { offset } : {}),
    });
    points.push(...r.result.points);
    offset = r.result.next_page_offset;
  } while (offset);
  return points;
}
export async function backup() {
  const dir = path.join(
    root,
    "backups",
    new Date().toISOString().replaceAll(":", "-"),
  );
  await mkdir(dir, { recursive: true });
  const names = (await q("/collections")).result.collections.map((c) => c.name);
  // These are the actual pre-import scenario routes, not laws or unrelated collections.
  const previous = await active();
  const targets = [
    ...new Set(
      (alias === 'aizashchita_active_scenarios'
        ? ['legal_advice', 'categories', 'aizashchita_review_stages_20261014', previous?.collection]
        : [previous?.collection]).filter((n) => n && names.includes(n)),
    ),
  ];
  const manifest = {
    created_at: new Date().toISOString(),
    previous,
    aliases: (await q("/aliases")).result.aliases,
    collections: [],
  };
  for (const name of targets) {
    const info = (await q(`/collections/${name}`)).result;
    const snapshot = (await q(`/collections/${name}/snapshots`, {}, "POST"))
      .result;
    const response = await fetch(
      `${qdrant}/collections/${name}/snapshots/${encodeURIComponent(snapshot.name)}`,
    );
    if (!response.ok) throw new Error("Не удалось скачать snapshot.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error("Пустой snapshot.");
    await writeFile(path.join(dir, `${name}.snapshot`), bytes);
    const points = await allPoints(name);
    const exported = Buffer.from(JSON.stringify({ info, points }));
    await writeFile(path.join(dir, `${name}.json`), exported);
    if (points.length !== info.points_count)
      throw new Error("Количество точек в резервной копии не совпало.");
    const categories = {};
    for (const p of points) {
      const c =
        p.payload?.category?.id ||
        p.payload?.payload?.category?.id ||
        "unknown";
      categories[c] = (categories[c] || 0) + 1;
    }
    manifest.collections.push({
      name,
      count: points.length,
      categories,
      snapshot: snapshot.name,
      snapshot_sha256: bytesHash(bytes),
      export_sha256: bytesHash(exported),
    });
  }
  await atomic(path.join(dir, "manifest.json"), manifest);
  return { dir, manifest };
}
export async function search(question, options) {
  const stageId = typeof options === 'string' ? options : options?.hardStageId;
  const categoryId = typeof options === 'object' ? options?.categoryId : undefined;
  const current = await active();
  const requestedLimit = typeof options === "object" ? options?.limit : undefined;
  const limit = Number.isInteger(requestedLimit) ? Math.max(8, Math.min(64, requestedLimit)) : 8;
  if (!current) throw new Error("Сначала импортируйте пакет.");
  const key = bytesHash(Buffer.from(question)) + '.json';
  const cached = await jsonFile(path.join(root, 'embedding-cache', current.model_digest, key));
  const signal = typeof options === "object" ? options?.signal : undefined;
  const [vector] = cached ? [cached] : await embed(question, signal);
  return (
    await q(`/collections/${alias}/points/search`, {
      vector,
      limit,
      with_payload: true,
      ...((stageId || categoryId) ? { filter: {must: [
        ...(stageId ? [{key:'stage.id',match:{value:stageId}}] : []),
        ...(categoryId ? [{key:'category.id',match:{value:categoryId}}] : [])
      ]}} : {}),
    }, undefined, signal)
  ).result;
}
export function assertImportPolicy(bundle, previous = null) {
  if (bundle.metadata.format_version !== FORMAT) return;
  if (bundle.metadata.example_only && (process.env.CATEGORY_ALLOW_EXAMPLES !== 'true' || alias === 'aizashchita_active_scenarios'))
    blocked('Пример можно импортировать только в отдельном тестовом namespace.');
  if (!bundle.metadata.example_only && bundle.metadata.coverage !== 'full_category') blocked('Для рабочего импорта требуется полная категория.');
  const count = bundle.subcategories.reduce((n, s) => n + s.variants.length, 0);
  if (previous?.category?.id === bundle.category.id && count < previous.variants)
    blocked('Число вариантов уменьшается. Неполный файл не заменяет активную категорию.');
}
export async function importSource(text, update = () => {}) {
  const { bundle, report } = validateSource(text);
  const previous = await active();
  assertImportPolicy(bundle, previous);
  const documentLinks = bundle.metadata.format_version === FORMAT ? await checkDocumentLinks(bundle) : [];
  if (previous?.sha256 === report.sha256) {
    const points = await allPoints(alias);
    verifyPoints(points, bundle, report.sha256);
    return { ...previous, idempotent: true };
  }
  update({ phase: "backup", done: 0, total: report.variants });
  const saved = await backup();
  const model = (await api(ollama, "/api/tags")).models.find(
    (m) => m.name === "bge-m3:latest",
  );
  if (!model) throw new Error("Локальная bge-m3 отсутствует.");
  const collection = `${alias}_${bundle.category.id}_${report.sha256.slice(0, 20)}`;
  const names = (await q("/collections")).result.collections.map((c) => c.name);
  if (!names.includes(collection))
    await q(
      `/collections/${collection}`,
      { vectors: { size: 1024, distance: "Cosine" } },
      "PUT",
    );
  const versionDir = path.join(root, "versions", report.sha256);
  await mkdir(versionDir, { recursive: true });
  await writeFile(path.join(versionDir, "bundle.json"), text);
  for (const template of bundle.document_templates || [])
    await atomic(
      path.join(versionDir, "templates", `${template.id}.json`),
      template,
    );
  const rows = bundle.subcategories.flatMap((s) => s.variants);
  const cacheDir = path.join(root, "embedding-cache", model.digest);
  await mkdir(cacheDir, { recursive: true });
  for (let i = 0; i < rows.length; i += 4) {
    const batch = rows.slice(i, i + 4);
    const points = [];
    for (const row of batch) {
      const key = bytesHash(Buffer.from(row.question));
      const cache = path.join(cacheDir, key + ".json");
      let vector = await jsonFile(cache);
      const cachedHere = !!vector;
      if (!vector && process.env.CATEGORY_EMBEDDING_READ_CACHE_DIR)
        vector = await jsonFile(path.join(process.env.CATEGORY_EMBEDDING_READ_CACHE_DIR, model.digest, key + '.json'));
      if (!vector) {
        [vector] = await embed(row.question);
      }
      if (!Array.isArray(vector) || vector.length !== 1024 || vector.some(n => !Number.isFinite(n)))
        throw new Error('Некорректный вектор embedding-cache.');
      if (!cachedHere) await atomic(cache, vector);
      const hash = bytesHash(Buffer.from(row.variant_id));
      const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      points.push({
        id,
        vector,
        payload: {
          ...row.payload,
          variant_id: row.variant_id,
          context: row.context,
          question: row.question,
          source_sha256: report.sha256,
        },
      });
    }
    await q(`/collections/${collection}/points?wait=true`, { points }, "PUT");
    update({ phase: "embedding", done: Math.min(i + 4, rows.length), total: rows.length });
  }
  const readback = await allPoints(collection);
  verifyPoints(readback, bundle, report.sha256);
  const aliases = (await q("/aliases")).result.aliases;
  const old = aliases.find((a) => a.alias_name === alias);
  const state = {
    ...report,
    collection,
    alias,
    model: "bge-m3",
    model_digest: model.digest,
    dimensions: 1024,
    document_links: documentLinks,
    backup: saved.dir,
    activated_at: new Date().toISOString(),
  };
  await atomic(path.join(versionDir, "receipt.json"), state);
  await q("/collections/aliases", {
    actions: [
      ...(old ? [{ delete_alias: { alias_name: alias } }] : []),
      { create_alias: { collection_name: collection, alias_name: alias } },
    ],
  });
  try {
    await atomic(path.join(root, "active.json"), state);
  } catch (error) {
    await q("/collections/aliases", {
      actions: [
        { delete_alias: { alias_name: alias } },
        ...(old ? [{ create_alias: old }] : []),
      ],
    });
    throw error;
  }
  return state;
}
function verifyPoints(points, bundle, hash) {
  const rows = new Map(
    bundle.subcategories
      .flatMap((s) => s.variants)
      .map((v) => [v.variant_id, v]),
  );
  if (
    points.length !== rows.size ||
    new Set(points.map((p) => p.payload.variant_id)).size !== rows.size
  )
    throw new Error("Количество/ID точек не совпало с пакетом.");
  for (const point of points) {
    const row = rows.get(point.payload.variant_id);
    if (
      !row ||
      !same(point.payload, {
        ...row.payload,
        variant_id: row.variant_id,
        context: row.context,
        question: row.question,
        source_sha256: hash,
      }) ||
      !Array.isArray(point.vector) ||
      point.vector.length !== 1024 || point.vector.some(n => !Number.isFinite(n))
    )
      throw new Error("Содержимое точки не совпало с проверенным пакетом.");
  }
}
