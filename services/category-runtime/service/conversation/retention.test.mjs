import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createConversationService } from './service.mjs';
import { atomic, fresh, identityKey } from './state.mjs';

test('expiration clears conversation state, outbox, legacy and feedback copies for exactly one chat', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiz-retention-'));
  const userId = '9101', id = randomUUID(), other = randomUUID();
  const key = identityKey(userId, id), otherKey = identityKey(userId, other);
  const state = key => path.join(dir, 'conversation-sessions-v2', key + '.json');
  const legacy = path.join(dir, 'explicit-sessions', key + '.json');
  const temp = state(key) + '.' + randomUUID() + '.tmp';
  const feedback = path.join(dir, 'dialogue-feedback', key, randomUUID() + '.json');
  const marker = 'synthetic private message';
  try {
    await atomic(state(key), { ...fresh(userId, id, 'a'.repeat(64)), outbox: { question: marker } });
    await atomic(state(otherKey), fresh(userId, other, 'a'.repeat(64)));
    for (const file of [legacy, legacy + '.v2-backup.json', temp, feedback]) await atomic(file, { marker });
    const service = createConversationService({ dataDir: dir });
    for (let attempt = 0; attempt < 2; attempt++) assert.deepEqual(await service.internal({ userId, id }, 'expire'), { ok: true });
    const remaining = JSON.parse(await fs.readFile(state(key), 'utf8'));
    assert.deepEqual(remaining, { deleted: true });
    assert.deepEqual(await service.internal({ userId, id }, 'pending'), { historyEnvelope: null });
    for (const file of [legacy, legacy + '.v2-backup.json', temp, feedback]) await assert.rejects(fs.access(file), { code: 'ENOENT' });
    assert.equal(JSON.parse(await fs.readFile(state(otherKey), 'utf8')).chatId, other);
  } finally {
    // Only the directory returned by mkdtemp for this test is removed.
    await fs.rm(dir, { recursive: true, force: true });
  }
});
