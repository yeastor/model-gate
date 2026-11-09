import { dialoguePackage } from "./package.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fail } from "./errors.mjs";
import { openPrivateFile, sealPrivateFile } from "./private-storage.mjs";
export const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export const identityKey = (userId, chatId) => hash(userId + ":" + chatId);
export async function read(file) {
  try {
    return JSON.parse(openPrivateFile(file, await fs.readFile(file, "utf8")));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
export async function atomic(file, value) {
  const data = sealPrivateFile(file, JSON.stringify(value));
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID() + ".tmp";
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
}
export async function removeAtomicTemps(file) {
  const dir = path.dirname(file), prefix = path.basename(file) + ".";
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith(prefix) && /^[a-f0-9-]{36}\.tmp$/i.test(entry.name.slice(prefix.length)))
      await fs.rm(path.join(dir, entry.name), { force: true });
  }
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
    caseState: newCaseState(),
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
  if (trigger === "new-case") startCase(s);
  const incident = ensureCaseState(s);
  const e = {
    caseId: incident.id,
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
  rememberDismissals(s);
  s.round = {
    id: randomUUID(),
    triggerEventId: eventId,
    nextPresented: 0,
    clarifications: 0,
    questionsUsed: caseQuestionsUsed(s),
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
  if (![true, false, null].includes(value) ||
      (["detention_guide", "phone_police", "flooding", "gosuslugi_access", "digital_access", "labor_disputes", "bailiffs", "digital_threats", "neighbors", "collectors", "divorce_property", "debts"].includes(s.categoryId)
        ? !s.categoryFieldKeys?.includes(fieldKey) || s.categoryBlockedFields?.includes(fieldKey)
        : s.categoryId === "dps"
        ? !s.dpsFieldKeys?.includes(fieldKey) || s.dpsBlockedFields?.includes(fieldKey)
        : dialoguePackage.blockedFields.includes(fieldKey)))
    fail("INVALID_FACT");
  const e = currentEpisode(s);
  const subjectId = subjectFor(s, fieldKey);
  const old = s.factLedger
    .filter(
      (f) =>
        f.episodeId === e.id &&
        f.subjectId === subjectId &&
        f.fieldKey === fieldKey &&
        ["active", "conflicted"].includes(f.status),
    )
    .at(-1);
  if (old && old.status === "active" && old.value === value &&
      !(s.categoryId === "neighbors" && ["correct", "withdraw"].includes(operation))) {
    if (
      (fieldKey === "pps.use_of_force.force_actually_used" || fieldKey.endsWith(".free_to_leave_denied")) &&
      value === true &&
      source?.quote &&
      source.quote !== old.source?.quote &&
      !(old.supportingSources || []).some((x) => x.quote === source.quote)
    )
      old.supportingSources = [...(old.supportingSources || []), source].slice(
        -16,
      );
    return old;
  }
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
    caseId: ensureCaseState(s).id,
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
  if (s.categoryId !== "dps" && fieldKey.endsWith(".copy_requested") && value !== true) {
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
    if (f.episodeId !== e.id || !f.fieldKey.startsWith((s.categoryId || "pps") + "." + stage + "."))
      continue;
    const subject = subjectFor(s, f.fieldKey);
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
  s.caseState.baselineUsed = 2;
  s.caseState.legacyHistoryComplete = false;
  s.caseState.migrationReason = "legacy_explicit_history_incomplete";
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


// Private incident accounting. Rounds only sequence questions; they do not own
// the allowance. The receipts are saved atomically with the final response.
function newCaseState(source = null) {
  return {
    schemaVersion: "pps-case/v1", id: randomUUID(), source,
    baselineUsed: 0, legacyHistoryComplete: true, served: [], dismissed: [],
  };
}
export function ensureCaseState(s) {
  if (!s.caseState) {
    s.caseState = newCaseState();
    // Old round counters cannot prove that earlier rounds asked no questions.
    s.caseState.baselineUsed = 2;
    s.caseState.legacyHistoryComplete = false;
    s.caseState.migrationReason = "legacy_case_history_incomplete";
    s.pending = null;
    if (s.engine) s.engine.pending = null;
    s.lastResponse = null;
  }
  if (!s.caseState.served.length && (s.round?.questionsUsed || 0) > s.caseState.baselineUsed) {
    s.caseState.baselineUsed = Math.min(2, s.round.questionsUsed);
    s.caseState.legacyHistoryComplete = false;
    s.caseState.migrationReason ||= "unreceipted_round_lower_bound";
  }
  return s.caseState;
}
export function startCase(s, source = null) {
  rememberDismissals(s);
  if (s.caseState) (s.caseHistory ||= []).push(s.caseState);
  s.caseState = newCaseState(source);
  s.round = null;
  s.pending = null;
  s.engine = null;
}
export function caseQuestionsUsed(s) {
  const c = ensureCaseState(s);
  return c.baselineUsed + c.served.length;
}
export function subjectFor(s, fieldKey = "", snapshot = null) {
  const e = snapshot || currentEpisode(s);
  if (["detention_guide", "phone_police", "flooding", "gosuslugi_access", "digital_access", "labor_disputes", "bailiffs", "digital_threats", "neighbors", "collectors", "divorce_property", "debts"].includes(s.categoryId)) {
    const group = s.categoryScopeGroups?.[fieldKey];
    return group ? e.categorySubjects?.[group]?.current : e.personId;
  }
  if (s.categoryId === "dps") {
    const stage = fieldKey.startsWith("dps.") ? fieldKey.split(".")[1] : e.stageId;
    return e.dpsSubjects?.[stage]?.current || e.personId;
  }
  return fieldKey.includes("explanation_request.") ? e.documentId
    : fieldKey.includes("bag_search.") ? e.itemId : e.personId;
}
export function pendingField(p) {
  return p?.fieldKey || p?.conflictField || (p?.stageId && p.question?.field_key
    ? "pps." + p.stageId + "." + p.question.field_key : null);
}
export function questionScope(s, p) {
  const c = ensureCaseState(s), e = currentEpisode(s), field = pendingField(p);
  const purpose = p.key === "conflict" && field ? field + ":conflict" : field || p.key || p.question.id;
  const base = [c.id, e.id, subjectFor(s, field || ""), purpose].join(":");
  if (s.categoryId === "neighbors") {
    if (!/^[a-f0-9-]{36}$/.test(p.neighborsAttemptId || "")) fail("NBR_ATTEMPT_REQUIRED", 409);
    return base + ":neighbors-attempt:" + p.neighborsAttemptId;
  }
  return base;
}
export function bindQuestion(s, p) {
  const scope = questionScope(s, p);
  if (p.scope && p.scope !== scope) return false;
  p.scope = scope;
  p.binding = {
    caseId: ensureCaseState(s).id, episodeId: s.activeEpisodeId,
    subjectId: subjectFor(s, pendingField(p) || ""), fieldKey: pendingField(p),
  };
  return true;
}
export function rememberDismissals(s) {
  const c = ensureCaseState(s), r = s.round;
  if (!r) return;
  for (const key of r.dismissedQuestionIds || []) {
    const scope = r.questionScopes?.[key];
    if (scope && !c.dismissed.includes(scope)) c.dismissed.push(scope);
  }
  for (const fieldKey of r.dismissedFields || []) {
    const e = currentEpisode(s);
    if (!e) continue;
    const scope = [c.id, e.id, subjectFor(s, fieldKey), fieldKey].join(":");
    if (!c.dismissed.includes(scope)) c.dismissed.push(scope);
  }
}
export function questionDismissed(s, p) {
  rememberDismissals(s);
  return ensureCaseState(s).dismissed.includes(questionScope(s, p));
}
export function canServeQuestion(s, p, approvedThirdReasons = {}) {
  if (!p || !bindQuestion(s, p) || questionDismissed(s, p)) return false;
  const c = ensureCaseState(s);
  // Re-rendering the same outstanding question is not another served question.
  const previous = c.served.find(x => x.scope === p.scope);
  if (previous) return previous.status !== "answered" && previous.questionId === p.question.id;
  const used = caseQuestionsUsed(s);
  if (used >= 3) return false;
  if (used < 2) return true;
  const reason = approvedThirdReasons[p.question.id];
  return typeof reason === "string" && !!reason.trim();
}
export function serveQuestion(s, p, responseId, turnId, approvedThirdReasons = {}) {
  if (!canServeQuestion(s, p, approvedThirdReasons)) return false;
  const c = ensureCaseState(s);
  let receipt = c.served.find(x => x.scope === p.scope);
  if (!receipt) {
    receipt = {
      id: randomUUID(), status: "served", scope: p.scope, questionId: p.question.id,
      ...p.binding, turnId, responseId,
      thirdReason: caseQuestionsUsed(s) === 2 ? approvedThirdReasons[p.question.id] : null,
    };
    c.served.push(receipt);
    if (s.round) {
      const counter = p.kind === "next" ? "nextPresented"
        : p.kind === "supplemental" ? "supplementalPresented" : "clarifications";
      s.round[counter] = (s.round[counter] || 0) + 1;
    }
  }
  p.receiptId = receipt.id;
  s.round ||= { id: randomUUID(), nextPresented: 0, clarifications: 0 };
  s.round.questionsUsed = caseQuestionsUsed(s);
  (s.round.questionScopes ||= {})[p.question.id] = p.scope;
  return true;
}

export function resolveBagReference(s, text, source) {
  const e = currentEpisode(s);
  if (!e) return null;
  const t = text.toLowerCase().replaceAll("ё", "е");
  const bag = /сумк|рюкзак/u.test(t);
  const items = e.items || [{ id: e.itemId, ordinal: 1, sources: [] }];
  if (/^(?:а )?если |имеет ли право|боюсь|в фильме|в кино/u.test(t)) return null;
  if (/сумк[а-я]* (?:моего |моей )?(?:друга|подруги|соседа)|чуж.{0,12}сумк/u.test(t) &&
      !/о моей.{0,25}(?:неизвестно|не знаю)/u.test(t))
    return { kind: "foreign", source };
  const first = /перв(?:ая|ую|ой)|сумк[а-я]*\s+[aа](?:[.,:; ]|$)/u.test(t);
  const second = /втор(?:ая|ую|ой)|сумк[а-я]*\s+[bб](?:[.,:; ]|$)/u.test(t);
  if (first && second && (bag || items.length > 1))
    return { kind: "ambiguous", source };
  const ordinal = first ? 1 : second ? 2 : null;
  const currentBag = e.stageId === "bag_search";
  if (!bag && !currentBag) return null;
  if (ordinal && (bag || items.length > 1)) {
    const found = items.find(x => x.ordinal === ordinal);
    if (found) return { kind: "select", itemId: found.id, ordinal, source };
    if (bag && /мо[яюей]|сво[яюей]/u.test(t) && items.length < 32)
      return { kind: "new", itemId: randomUUID(), ordinal, source };
    return { kind: "ambiguous", source };
  }
  if (bag && /друг(?:ая|ую|ой)|нов(?:ая|ую|ой)/u.test(t)) {
    if (!/мо[яюей]|сво[яюей]/u.test(t) || items.length >= 32)
      return { kind: "ambiguous", source };
    return { kind: "new", itemId: randomUUID(), ordinal: items.length + 1, source };
  }
  if (items.length > 1 && !bag && /(?:^|\s)(?:ее|её|ею)(?:\s|[.,:;!?]|$)/u.test(t))
    return { kind: "ambiguous", source };
  return bag ? { kind: "current", itemId: e.itemId, source } : null;
}
export function selectBag(s, resolution) {
  if (!resolution || !["new", "select", "current"].includes(resolution.kind)) return false;
  const e = currentEpisode(s);
  e.items ||= [{ id: e.itemId, ordinal: 1, sources: [] }];
  if (resolution.kind === "new" && !e.items.some(x => x.id === resolution.itemId))
    e.items.push({ id: resolution.itemId, ordinal: resolution.ordinal, sources: [] });
  const item = e.items.find(x => x.id === resolution.itemId);
  if (!item) return false;
  if (item.sources.length < 32 && !item.sources.some(x => x.turnId === resolution.source.turnId))
    item.sources.push(resolution.source);
  const changed = e.itemId !== item.id;
  if (changed) {
    newRound(s, "bag-object-change");
    e.itemId = item.id;
    s.engine = null;
    s.nonce = randomUUID();
  }
  return changed;
}

export function answerQuestionReceipt(s, p, value, source) {
  if (!p || !bindQuestion(s, p)) fail("STALE_ACTION", 409);
  const receipt = ensureCaseState(s).served.find(x => x.scope === p.scope && x.questionId === p.question.id);
  if (receipt) {
    receipt.status = "answered";
    receipt.answer = { value, source };
  }
}
