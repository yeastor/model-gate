import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomic, read, identityKey, hash } from "./state.mjs";
import { fail, uuid } from "./errors.mjs";
export const consentVersion = "dialogue-feedback/2026-10-22-v2";
export const consentText =
  "Я согласен на обработку и хранение всей сохранённой переписки в этом чате и её связи с моей учётной записью для разбора ситуации и улучшения АЙзащиты. Я понимаю, что переписка может содержать персональные данные и что она не будет опубликована автоматически. Отозвать согласие и удалить обращение можно в этом чате.";
export function offerFeedback(s, source, reason) {
  s.feedbackOffers ||= [];
  let offer = s.feedbackOffers.find((x) => x.sourceTurnId === source.turnId);
  if (!offer) {
    offer = {
      id: randomUUID(),
      sourceTurnId: source.turnId,
      reason,
      episodeId: s.activeEpisodeId,
    };
    s.feedbackOffers.push(offer);
    s.feedbackOffers = [
      ...s.feedbackOffers.filter((x) => x.submitted && !x.withdrawn),
      ...s.feedbackOffers.filter((x) => !x.submitted).slice(-30),
    ];
  }
  s.feedbackOfferId = offer.id;
  return offer;
}
const directory = (dataDir, s) =>
  path.join(dataDir, "dialogue-feedback", identityKey(s.userId, s.chatId));
export async function submitFeedback(dataDir, s, action, transcript) {
  const offer = s.feedbackOffers?.find((x) => x.id === action.offerId);
  if (!offer || offer.episodeId !== s.activeEpisodeId)
    fail("INVALID_FEEDBACK_OFFER", 409);
  if (action.consent !== true || action.consentVersion !== consentVersion)
    fail("FEEDBACK_CONSENT_REQUIRED");
  if (
    !Array.isArray(transcript) ||
    !transcript.length ||
    transcript.length > 20000 ||
    transcript.some(
      (x) => ![1, 2].includes(x.direction) || typeof x.text !== "string",
    ) ||
    Buffer.byteLength(JSON.stringify(transcript)) > 6 * 1024 * 1024
  )
    fail("INVALID_FEEDBACK_TRANSCRIPT");
  const file = path.join(directory(dataDir, s), offer.id + ".json");
  const contentHash = hash(transcript);
  const old = await read(file);
  if (old) {
    offer.submitted = true;
    s.feedbackReceiptId = offer.id;
    s.feedbackOfferId = null;
    return offer.id;
  }
  if (!old)
    await atomic(file, {
      schemaVersion: "dialogue-feedback/v1",
      id: offer.id,
      status: "NEW",
      createdAt: new Date().toISOString(),
      ownerKey: identityKey(s.userId, s.chatId),
      categorySha256: s.version,
      policyVersion: s.policyVersion,
      reason: offer.reason,
      categoryId: "pps",
      stageId: s.engine?.stageId || null,
      behaviourVersion: s.behaviourVersion,
      transcript,
      contentHash,
      consent: {
        version: consentVersion,
        text: consentText,
        accepted: true,
        at: new Date().toISOString(),
      },
    });
  offer.submitted = true;
  s.feedbackReceiptId = offer.id;
  s.feedbackOfferId = null;
  return offer.id;
}
export async function withdrawFeedback(dataDir, s, id) {
  if (!uuid.test(id || "") || !s.feedbackOffers?.some((x) => x.id === id))
    fail("INVALID_FEEDBACK_RECEIPT", 403);
  await fs.rm(path.join(directory(dataDir, s), id + ".json"), { force: true });
  const offer = s.feedbackOffers.find((x) => x.id === id);
  offer.withdrawn = true;
  if (s.feedbackReceiptId === id) s.feedbackReceiptId = null;
}
export async function deleteFeedback(dataDir, s) {
  const dir = directory(dataDir, s);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  for (const name of names) {
    const parts = name.split(".");
    if (uuid.test(parts[0]) && parts[1] === "json" &&
        (parts.length === 2 || (parts.length === 4 && uuid.test(parts[2]) && parts[3] === "tmp")))
      await fs.rm(path.join(dir, name), { force: true });
  }
}
