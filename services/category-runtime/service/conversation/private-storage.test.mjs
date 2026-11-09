import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { atomic, read } from "./state.mjs";
import { consentVersion, offerFeedback, submitFeedback } from "./feedback.mjs";
import { initializePrivateStore, acquireStore, commitStore, readStore } from "./children-site-sqlite-store.mjs";

const marker = "synthetic-private-marker-Ю-2026";
const prefix = /^azchat:v1:k1:/;
const generateKey = () => randomBytes(32).toString("base64");

test("runtime encrypts state, outbox and consented feedback, and restores only with its key", async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "az-chatcrypto-"));
  assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
  assert(path.basename(fixture).startsWith("az-chatcrypto-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const key = generateKey();
  const keysFile = path.join(fixture, "runtime-keys.json");
  const wrongFile = path.join(fixture, "wrong-keys.json");
  const rotatedFile = path.join(fixture, "rotated-keys.json");
  const writeKeyring = (file, active, keys) => fs.writeFile(file, JSON.stringify({ active, keys }), { mode: 0o600 });
  await writeKeyring(keysFile, "k1", { k1: key });
  await writeKeyring(wrongFile, "k1", { k1: generateKey() });
  await writeKeyring(rotatedFile, "k2", { k1: key, k2: generateKey() });
  const dataDir = path.join(fixture, "runtime");
  const backup = path.join(fixture, "data-backup");
  process.env.CATEGORY_DATA_DIR = dataDir;
  process.env.CHAT_RUNTIME_KEYS_FILE = keysFile;
  const statePath = path.join(dataDir, "conversation-sessions-v2", "test.json");
  const payload = { recentUserTurns: [marker], outbox: { question: marker, answer: marker } };
  await atomic(statePath, payload);
  const first = await fs.readFile(statePath, "utf8");
  await atomic(statePath, payload);
  const raw = await fs.readFile(statePath, "utf8");
  assert.match(raw, prefix);
  assert(!raw.includes(marker));
  assert.notEqual(raw, first);
  assert.deepEqual(await read(statePath), payload);

  const s = { userId: "81", chatId: randomUUID(), activeEpisodeId: randomUUID() };
  const offer = offerFeedback(s, { turnId: randomUUID() }, "synthetic-test");
  await submitFeedback(dataDir, s, { offerId: offer.id, consent: true, consentVersion }, [{ direction: 1, text: marker }]);
  const owner = createHash("sha256").update(s.userId + ":" + s.chatId).digest("hex");
  const feedback = path.join(dataDir, "dialogue-feedback", owner, offer.id + ".json");
  assert.match(await fs.readFile(feedback, "utf8"), prefix);
  assert.equal((await read(feedback)).transcript[0].text, marker);
  assert(!(await fs.readFile(feedback, "utf8")).includes(marker));

  // Copy data alone to a different root, and reload the key in a new process.
  await fs.cp(dataDir, backup, { recursive: true });
  const childScript = `import {read} from ${JSON.stringify(new URL("./state.mjs", import.meta.url).href)};
    try { const s=await read(process.argv[1]); if(s?.outbox?.question!==process.argv[2])process.exit(3); }
    catch(e){console.error(e.message);process.exit(2);}`;
  const restore = (keyFile) => {
    const env = { ...process.env, CATEGORY_DATA_DIR: backup };
    if (keyFile) env.CHAT_RUNTIME_KEYS_FILE = keyFile;
    else delete env.CHAT_RUNTIME_KEYS_FILE;
    return spawnSync(process.execPath, ["--input-type=module", "-e", childScript, path.join(backup, "conversation-sessions-v2", "test.json"), marker], { env, encoding: "utf8" });
  };
  assert.equal(restore(keysFile).status, 0);
  assert.equal(restore(rotatedFile).status, 0);
  assert.match(restore(wrongFile).stderr, /CHAT_RUNTIME_CIPHERTEXT_UNREADABLE/);
  assert.match(restore(null).stderr, /CHAT_RUNTIME_KEY_FILE_MISSING_OR_INVALID/);

  const foreign = path.join(dataDir, "conversation-sessions-v2", "other.json");
  await fs.writeFile(foreign, raw);
  await assert.rejects(read(foreign), /CHAT_RUNTIME_CIPHERTEXT_UNREADABLE/);
  await fs.writeFile(statePath, raw.replace(/(:)([A-Za-z0-9_-])([A-Za-z0-9_-]+)$/, (_, sep, firstChar, rest) =>
    sep + (firstChar === "A" ? "B" : "A") + rest));
  await assert.rejects(read(statePath), /CHAT_RUNTIME_CIPHERTEXT_UNREADABLE/);
  await fs.writeFile(statePath, JSON.stringify(payload));
  await assert.rejects(read(statePath), /CHAT_RUNTIME_CIPHERTEXT_UNREADABLE/);

  if (process.platform === "win32") {
    await t.test("children SQLite bindings and snapshots do not write plaintext", async () => {
      const root = path.join(fixture, "fresh-sqlite");
      const cfg = initializePrivateStore(root);
      process.env.CHILDREN_PRIVATE_SQLITE_STORE = JSON.stringify(cfg);
      const file = path.join(root, "session.qualified.json");
      const context = { identity: { userId: "81", chatId: randomUUID() }, tuple: { v: "test" },
        scope: { caseId: randomUUID(), childId: marker, subjectId: "subject" }, runtimeVersion: "test" };
      const state = { ...context, schema: "qualified-session/v2", id: randomUUID(), revision: 1, used: 0,
        ledger: [], events: [{ quote: marker }], asked: [], displayedFields: [], turns: {} };
      state.lastResponse = { conversation: { sessionId: state.id, revision: 1 }, questionsUsed: 0 };
      let lease = await acquireStore(file, context);
      try { await commitStore(file, state); } finally { await lease.release(); }
      lease = await acquireStore(file, context);
      try { assert.deepEqual(readStore(file), state); } finally { await lease.release(); }
      const db = new DatabaseSync(cfg.database, { readOnly: true });
      try {
        assert.match(db.prepare("SELECT text FROM snapshots").get().text, prefix);
        assert.match(db.prepare("SELECT binding FROM bindings").get().binding, prefix);
      } finally { db.close(); }
      assert(!(await fs.readFile(cfg.database)).includes(Buffer.from(marker)));
    });
  }
});

test("both runtime HTTP entrypoints fail closed before serving without a key", () => {
  const env = { ...process.env };
  delete env.CHAT_RUNTIME_KEYS_FILE;
  for (const server of ["../server.mjs", "../local-server.mjs"]) {
    const entry = new URL(server, import.meta.url);
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import ${JSON.stringify(entry.href)}`], {
      encoding: "utf8", env, timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CHAT_RUNTIME_KEY_FILE_MISSING_OR_INVALID/);
  }
});
