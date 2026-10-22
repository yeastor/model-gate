import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createConversationService } from "./service.mjs";
import { createExplicitEngine } from "../explicit/engine.mjs";
import {
  fresh,
  episode,
  newRound,
  atomic,
  identityKey,
  recordFact,
  project,
  hash,
} from "./state.mjs";
import { dialoguePackage } from "./package.mjs";
export const bundle = JSON.parse(
  fsSync.readFileSync(
    process.env.CATEGORY_FULL_FIXTURE ||
      "C:/Users/mujlo/Documents/Codex/model-category-document-generator/work/pps-natural-speech-content-seal-20261022-v2/pps.final.json",
    "utf8",
  ),
);
export async function conversationFixture(t, initial = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pps-package-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const userId = "81",
    id = randomUUID(),
    s = fresh(userId, id, dialoguePackage.categorySha256),
    e = episode(s);
  Object.assign(e, {
    actor: initial.actor ?? "police",
    stageId: initial.stageId || null,
    stageConfirmedByUser: !!initial.stageId,
  });
  s.policyVersion = dialoguePackage.version;
  newRound(s, "test");
  s.round.questionsUsed = initial.questionsUsed || 0;
  s.round.nextPresented = initial.nextPresented || 0;
  for (const [k, v] of Object.entries(initial.activeFacts || {}))
    recordFact(s, k, v, { kind: "test_fixture", turnId: "prior" });
  if (initial.pending) {
    const engine = createExplicitEngine(bundle);
    s.engine = engine.start(engine.entryFor(initial.stageId), {
      facts: project(s, initial.stageId),
      history: [],
      presented: s.round.questionsUsed,
      askedQuestionIds: [],
      revision: 0,
    });
    s.pending = initial.pending;
    s.lastResponse = {
      conversation: { sessionId: s.id, revision: 0 },
      answer: { next: [] },
    };
  }
  const filename = path.join(
    dir,
    "conversation-sessions-v2",
    identityKey(userId, id) + ".json",
  );
  await atomic(filename, s);
  let service = createConversationService({
      dataDir: dir,
      getActive: async () => ({ sha256: s.version }),
      getBundle: async () => bundle,
      search: async () => [],
    }),
    response;
  const f = {
    async send(question, extra = {}) {
      response = await service.respond({
        id,
        userId,
        protocolVersion: 2,
        turnId: randomUUID(),
        question,
        conversation: response?.conversation || {
          sessionId: s.id,
          revision: 0,
        },
        ...extra,
      });
      await service.internal(
        { id, userId, turnId: response.turn.turnId },
        "ack",
      );
      return response;
    },
    async state() {
      return JSON.parse(await fs.readFile(filename, "utf8"));
    },
    async button(value) {
      const choice = response.answer.next
        .flatMap((g) => g.view)
        .find((v) => v.guided?.native.value === value);
      if (!choice) throw Error("NO_CHOICE");
      return f.send(choice.question, { guided: choice.guided });
    },
    async resume() {
      response = await service.respond({ id, userId, resume: true });
      return response;
    },
    restart() {
      service = createConversationService({
        dataDir: dir,
        getActive: async () => ({ sha256: s.version }),
        getBundle: async () => bundle,
      });
    },
    async answerPending(value) {
      const now = await f.state();
      return f.send(value === null ? "Не знаю" : value ? "Да" : "Нет", {
        guided: {
          native: {
            kind: "answer",
            sessionId: now.id,
            nonce: now.nonce,
            revision: now.revision,
            episodeId: now.activeEpisodeId,
            roundId: now.round.id,
            questionId: now.pending.question.id,
            value,
          },
        },
      });
    },
  };
  return f;
}
