import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const service = './runtime/model-gate/services/category-runtime/service/conversation/';
const { initializePrivateStore } = await import(service + 'children-site-sqlite-store.mjs');
const { loadQualifiedPackage } = await import(service + 'qualified-package.mjs');
const root = await mkdtemp(path.join(tmpdir(), 'dm-protected-'));
const keyfile = path.join(root, 'test-key.json');
const badkey = path.join(root, 'wrong-key.json');
const sessions = path.join(root, 'sessions');
const marker = 'Нужна помощь по этой теме.';
const token = randomBytes(32).toString('hex');
const locator = path.join(root, 'children-store.json');
const ring = () => JSON.stringify({ active: 'test', keys: { test: randomBytes(32).toString('base64') } });
await writeFile(keyfile, ring(), { mode: 0o600 });
await writeFile(badkey, ring(), { mode: 0o600 });
process.env.CHAT_RUNTIME_KEYS_FILE = keyfile;
const childrenStore = initializePrivateStore(path.join(root, 'children'));
await writeFile(locator, JSON.stringify(childrenStore), { mode: 0o600 });
const env = {
  ...process.env,
  CATEGORY_INTERNAL_TOKEN: token,
  CATEGORY_LOCAL_DATA_DIR: sessions,
  CATEGORY_DATA_DIR: path.join(root, 'base'),
  CATEGORY_CHILDREN_LOCATOR_FILE: locator,
  CATEGORY_PORT: '18151',
  CATEGORY_BIND_HOST: '127.0.0.1',
};
delete env.CHAT_RUNTIME_KEYS_FILE;
const address = 'http://127.0.0.1:18151';
const contract = JSON.parse(await readFile(new URL(
  './runtime/_work/coordination/site-qdrant-all18/20261031-v1/categories/phone_police/targeted-correction-r2/candidate/integration-contract-r2.json',
  import.meta.url,
), 'utf8'));

const mock = async (port, routes) => {
  const server = createServer((req, res) => {
    const value = routes[req.url];
    req.resume();
    res.writeHead(value ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value ?? {}));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
};
const mocks = process.env.DM_SMOKE_REAL_VECTOR === 'true' ? [] : [
  await mock(6333, {
    ['/collections/' + contract.collection + '/points/count']: { result: { count: 216 } },
    ['/collections/' + contract.collection + '/points/search']: { result: [] },
  }),
  await mock(11435, {
    '/api/tags': { models: [{ name: 'bge-m3:latest', digest: contract.model_digest }] },
    '/api/embed': { embeddings: [Array(1024).fill(0)] },
  }),
];
let child;
let exited;
const spawnDM = (key) => {
  child = spawn(process.execPath, ['start.mjs'], {
    env: { ...env, ...(key ? { CHAT_RUNTIME_KEYS_FILE: key } : {}) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  exited = new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
};
const stop = async () => {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await exited;
};
const launch = async (key) => {
  spawnDM(key);
  for (let i = 0; i < 150; i++) {
    assert.equal(child.exitCode, null, 'runtime exited during startup');
    try {
      const response = await fetch(address + '/health');
      if (response.ok) return await response.json();
    } catch {}
    await pause(100);
  }
  throw new Error('runtime health check timed out');
};
const post = async (route, body, auth = token) => {
  const res = await fetch(address + route, {
    method: 'POST',
    headers: { 'x-category-token': auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};
async function files(dir) {
  const paths = await readdir(dir, { withFileTypes: true });
  const results = await Promise.all(paths.map((entry) => {
    const name = path.join(dir, entry.name);
    return entry.isDirectory() ? files(name) : [name];
  }));
  return results.flat();
}

try {
  spawnDM();
  assert.equal(await exited, 1, 'DM must refuse to start without a runtime key');
  const health = await launch(keyfile);
  assert.equal(health.chatStorageEncryption, 'aes-256-gcm/v1');
  assert.equal(health.categories.length, 18);
  assert(health.categories.every((row) => row.mode !== 'blocked' && row.stages.length === 8));
  assert.equal((await post('/respond', {}, 'wrong')).status, 403);
  const turns = new Map();
  for (const item of health.categories) {
    const stage = item.stages[0];
    const req = {
      protocolVersion: 2, userId: '9012', id: randomUUID(), turnId: randomUUID(),
      question: marker, categoryId: item.category, variantId: stage.variant_id,
      launchHint: { categoryId: item.category, stageId: stage.id },
    };
    const result = await post('/respond', req);
    assert.equal(result.status, 200, item.category + ': ' + result.data.error);
    const answer = result.data.answer;
    assert.equal(answer?.category?.id ?? answer?.category, item.category);
    assert(answer?.content || answer?.next?.some((q) => q.questionText || q.question), item.category);
    const id = { userId: req.userId, id: req.id };
    const pending = await post('/conversation/pending', id);
    assert.equal(pending.status, 200, item.category + ': pending ' + pending.data.error);
    assert.equal((await post('/conversation/ack', { ...id, turnId: req.turnId })).status, 200, item.category);
    turns.set(item.category, { req, id, messageId: result.data.turn?.messageId });
  }
  for (const file of await files(sessions)) {
    const raw = await readFile(file, 'utf8');
    assert(raw.startsWith('azchat:v1:test:'), 'plaintext session/outbox: ' + path.basename(file));
    assert(!raw.includes(marker));
    assert.equal((await stat(file)).mode & 0o077, 0);
  }
  const pps = turns.get('pps');
  assert(pps.messageId);
  process.env.CHAT_RUNTIME_KEYS_FILE = keyfile;
  process.env.CATEGORY_LOCAL_DATA_DIR = sessions;
  const { openPrivateFile, sealPrivateFile } = await import(service + 'private-storage.mjs');
  const ppsKey = createHash('sha256').update(pps.id.userId + ':' + pps.id.id).digest('hex');
  const feedback = path.join(sessions, 'pps', 'dialogue-feedback', ppsKey, randomUUID() + '.json');
  await mkdir(path.dirname(feedback), { recursive: true });
  await writeFile(feedback, sealPrivateFile(feedback, JSON.stringify({ marker })), { mode: 0o600 });
  assert.equal((await post('/respond', pps.req)).data.turn?.messageId, pps.messageId);
  const second = await post('/conversation/pending', { ...pps.id, userId: '9013' });
  assert.deepEqual(second.data, { historyEnvelope: null });
  await stop();
  await launch(badkey);
  assert.equal((await post('/conversation/pending', pps.id)).status, 503);
  await stop();
  await launch(keyfile);
  const resumed = await post('/respond', { ...pps.id, protocolVersion: 2, resume: true });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.answer?.category?.id ?? resumed.data.answer?.category, 'pps');

  for (const [category, { id }] of turns) {
    const key = createHash('sha256').update(id.userId + ':' + id.id).digest('hex');
    const route = category === 'pps' ? '/conversation/delete' : '/conversation/expire';
    assert.deepEqual(await post(route, id), { status: 200, data: { ok: true } }, category);
    assert.deepEqual(await post(route, id), { status: 200, data: { ok: true } }, 'retry ' + category);
    assert.deepEqual(await post('/conversation/pending', id), {
      status: 200, data: { historyEnvelope: null },
    }, category);
    assert.equal((await post('/respond', { ...id, protocolVersion: 2, resume: true })).status, 410, category);
    for (const file of (await files(sessions)).filter((p) => path.basename(p) === key + '.json')) {
      assert.deepEqual(JSON.parse(openPrivateFile(file, await readFile(file, 'utf8'))), { deleted: true }, file);
    }
  }
  await assert.rejects(stat(feedback), { code: 'ENOENT' });

  const registry = JSON.parse(await readFile('runtime/registry.linux.json', 'utf8'));
  const children = registry.categories.find((item) => item.category === 'children_alimony');
  const qualified = await loadQualifiedPackage(children.packagePin);
  const childMarker = 'synthetic-child-' + randomUUID();
  const identity = { userId: '9012', id: randomUUID() };
  const child = await post('/respond', {
    ...identity, protocolVersion: 2, turnId: randomUUID(), question: 'Есть задолженность по алиментам.',
    categoryId: 'children_alimony', guided: { context: {}, native: { privateDialogue: {
      tuple: qualified.tuple, stageId: 'alimony_debt',
      scope: { caseId: randomUUID(), childId: childMarker, subjectId: 'self', obligationId: 'obligation',
        periodId: 'period', objectId: 'statement', objectVersion: '1' },
    } } },
  });
  assert.equal(child.status, 200, child.data.error);
  const checkChildren = (removed) => {
    const db = new DatabaseSync(childrenStore.database, { readOnly: true });
    try {
      for (const [table, column] of [['snapshots', 'text'], ['bindings', 'binding']]) {
        const rows = db.prepare('SELECT ' + column + ' FROM ' + table).all();
        if (removed) assert.equal(rows.length, 0, table);
        else assert(rows.length && rows.every((row) => row[column].startsWith('azchat:v1:test:')), table);
      }
    } finally { db.close(); }
  };
  checkChildren(false);
  assert(!(await readFile(childrenStore.database)).includes(Buffer.from(childMarker)));
  assert.deepEqual(await post('/conversation/expire', identity), { status: 200, data: { ok: true } });
  checkChildren(true);
  console.log('PASS: 18/18 categories, wrong key, owner isolation, restart, expiry, feedback and scoped SQLite');
} finally {
  await stop();
  for (const server of mocks) server.close();
}
