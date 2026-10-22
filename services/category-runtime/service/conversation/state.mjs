import { dialoguePackage } from "./package.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fail } from "./errors.mjs";
export const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export const identityKey = (userId, chatId) => hash(userId + ":" + chatId);
export async function read(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
export async function atomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID() + ".tmp";
  const handle = await fs.open(temp, "wx");
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
}
export function fresh(userId, chatId, bundleSha) {
  return {
    schemaVersion: "conversation-state/v2",
    policyVersion: dialoguePackage.version,
    userId,
    chatId,
    id: randomUUID(),
    version: bundleSha,
    revision: 0,
    nonce: randomUUID(),
    episodes: [],
    activeEpisodeId: null,
    round: null,
    factLedger: [],
    engine: null,
    pending: null,
    presentation: { lastFull: null },
    turns: {},
    recentUserTurns: [],
    lastResponse: null,
    outbox: null,
  };
}
export function episode(s, trigger = "initial") {
  const e = {
    id: randomUUID(),
    actor: null,
    events: [],
    stageHistory: [],
    documentId: randomUUID(),
    personId: randomUUID(),
    itemId: randomUUID(),
  };
  s.episodes.push(e);
  s.activeEpisodeId = e.id;
  s.engine = null;
  s.pending = null;
  s.round = null;
  return e;
}
export const currentEpisode = (s) =>
  s.episodes.find((e) => e.id === s.activeEpisodeId);
export function newRound(s, eventId) {
  s.round = {
    id: randomUUID(),
    triggerEventId: eventId,
    nextPresented: 0,
    clarifications: 0,
  };
  s.pending = null;
}
export function recordFact(
  s,
  fieldKey,
  value,
  source,
  operation = "assert",
  dependencies = [],
) {
  if (![true, false, null].includes(value)) fail("INVALID_FACT");
  const e = currentEpisode(s);
  const subjectId = fieldKey.includes("explanation_request.")
    ? e.documentId
    : fieldKey.includes("bag_search.")
      ? e.itemId
      : e.personId;
  const old = s.factLedger
    .filter(
      (f) =>
        f.episodeId === e.id &&
        f.subjectId === subjectId &&
        f.fieldKey === fieldKey &&
        ["active", "conflicted"].includes(f.status),
    )
    .at(-1);
  if (old && old.status === "active" && old.value === value) return old;
  if (
    old &&
    value === null &&
    old.value !== null &&
    !["withdraw", "dispute"].includes(operation)
  )
    return old;
  const conflict =
    old &&
    ["assert", "dispute"].includes(operation) &&
    (operation === "dispute" ||
      old.status === "conflicted" ||
      (old.value !== null && value !== null));
  if (old) old.status = conflict ? "conflicted" : "superseded";
  const f = {
    id: randomUUID(),
    episodeId: e.id,
    subjectId,
    fieldKey,
    value: conflict ? null : value,
    source,
    observedAt: new Date().toISOString(),
    operation,
    status: conflict ? "conflicted" : "active",
    supersedes: old ? [old.id] : [],
    dependencies,
  };
  s.factLedger.push(f);
  if (fieldKey.endsWith(".copy_requested") && value !== true) {
    for (const x of s.factLedger)
      if (
        x.episodeId === e.id &&
        x.subjectId === e.documentId &&
        x.fieldKey.endsWith(".copy_requested_and_refused") &&
        x.status === "active"
      )
        x.status = "invalidated";
  }
  return f;
}
export function project(s, stage) {
  const e = currentEpisode(s),
    result = {};
  for (const f of s.factLedger) {
    if (f.episodeId !== e.id || !f.fieldKey.startsWith("pps." + stage + "."))
      continue;
    const subject = f.fieldKey.includes("explanation_request.")
      ? e.documentId
      : f.fieldKey.includes("bag_search.")
        ? e.itemId
        : e.personId;
    if (f.subjectId !== subject) continue;
    if (f.status === "active") result[f.fieldKey] = f.value;
    else if (f.status === "conflicted") result[f.fieldKey] = null;
  }
  return result;
}
export function validateState(s, userId, chatId) {
  if (
    s.schemaVersion !== "conversation-state/v2" ||
    s.userId !== userId ||
    s.chatId !== chatId ||
    !Number.isSafeInteger(s.revision) ||
    !s.turns ||
    !Array.isArray(s.factLedger)
  )
    fail("INVALID_SAVED_STATE", 409);
}
export async function migrateLegacy(file, userId, chatId, sha, engine) {
  const old = await read(file);
  if (!old) return null;
  if (old.userId !== userId || old.chatId !== chatId)
    fail("INVALID_SAVED_STATE", 409);
  const s = fresh(userId, chatId, old.version || sha);
  const e = episode(s);
  for (const h of old.history || [])
    if ([true, false, null].includes(h.value) && h.fieldKey && h.questionId) {
      recordFact(s, h.fieldKey, h.value, {
        kind: "legacy_button",
        questionId: h.questionId,
        turnId: "legacy-" + h.revision,
      });
    }
  if (old.stageId) {
    const facts = project(s, old.stageId);
    const id = engine.entryFor(old.stageId);
    newRound(s, "legacy");
    s.engine = engine.start(id, {
      facts,
      history: old.history || [],
      presented: old.presented || 0,
      revision: old.revision || 0,
    });
    s.round.nextPresented = s.engine.presented;
  }
  await atomic(file + ".v2-backup.json", old);
  return s;
}
