# Chat storage encryption — operation and rollout

The Go gateway encrypts PostgreSQL chat titles and ClickHouse questions and answers
before either database receives them. Category Runtime separately encrypts private
conversation files, delivery outboxes, consented feedback, qualified cases, and
the Windows children-site SQLite snapshot and binding payloads. Public scenario
bundles, Qdrant content and the document generator are not part of this change.
IDs, timestamps, categories, lengths and operational indexes are not hidden.

The format is authenticated AES-256-GCM: `azchat:v1:<key-id>:<base64url>`. Each
write uses a fresh random nonce. Ciphertext is bound to its field and chat/message
identities, or to its logical runtime path or SQLite snapshot. No database schema
change is needed. Only the authenticated owner receives the decrypted title and
history through the normal application routes. The server still sees text in
memory to answer requests. This does not replace LUKS2, network isolation or
transport security; a compromise of the running service can expose its keys.

## Keys and first start

1. Create two **different** 32-byte random keys outside the repository and outside
   data/backup directories. In each keyring use the structure below; the sample
   intentionally has no usable secret:

   ```json
   {"active":"k1","keys":{"k1":"<32 random bytes, standard base64>"}}
   ```

   On Linux, have an operator provision the files in
   `/etc/aizashchita/secrets/` with restrictive access. Compose's file-backed
   secrets are read-only mounts; host file ownership and permissions still apply.
   For the current root gateway image, use root-owned `0400`. For the standard
   Node image, ensure only root and the runtime's actual mapped user/group can
   read its file (normally root:1000 and `0440` without user namespaces). Restrict
   access to Docker, the host, and the separate encrypted key backup. Do not pass
   key values through env vars, command arguments or logs.
2. The gateway reads `CHAT_STORAGE_KEYS_FILE`; the Node runtime reads
   `CHAT_RUNTIME_KEYS_FILE`. Set only the paths in the environment. In
   `model-compose/app-1` the base file mounts the gateway key and
   `docker-compose.chat-storage-runtime.yml` optionally configures the standard
   Node service and mounts only its key. No keys are mounted on PostgreSQL,
   ClickHouse, Qdrant, the reverse proxy, or browser-facing services. Use the
   current protected Node implementation, not an older loader or runtime.
3. Use newly provisioned chat storage and a fresh private runtime directory. Load
   only the reviewed public content and apply the existing database migrations.
   Do not reuse old plaintext chat history, session directories, or SQLite
   journals for this rollout. Missing/invalid key configuration stops the
   affected process before it serves traffic. Wrong keys, unknown key IDs,
   altered ciphertext, and plaintext rows are rejected on read. Keep the old
   stack and old data separate; no automatic migration or reset is performed.
4. Before opening traffic, smoke-test login, rename, history after restart,
   denied access from a second account, and export. Inspect raw storage with a
   synthetic marker. The Windows multi-category registry is an independent
   release artifact: build a reviewed new registry with the new implementation
   pins and a newly initialized encrypted SQLite store if that pilot is enabled.
   Do not overwrite the previously approved pointer or old locator. The Linux
   Compose overlay runs the standard runtime, not that Windows-only pilot.

## Backup, recovery, and rotation

- Back up encrypted database/runtime data and keyrings **separately**, with
  separate access control. Keep the runtime directory layout and store type
  (`CATEGORY_DATA_DIR`, `CATEGORY_LOCAL_DATA_DIR`, or isolated mode). Restore
  the current Windows SQLite store at its original logical/absolute path and use
  a consistent SQLite backup, including the effects of the WAL.
- Verify the restore in isolation with a test conversation. With the right
  keyring the old history must open; without it the service must refuse to start
  and a wrong key must never make it display or reset unreadable data. Loss of a
  key makes its ciphertext unrecoverable.
- For rotation, append a new, independently generated key under a new ID in the
  corresponding ring, make it active and recreate the service. Keep previous IDs
  for old rows and snapshots. Remove old keys only after all live data and backup
  generations that need them have expired or have been explicitly re-encrypted.
  Never change the bytes of an existing key ID in place.
- This does not change the 10-chat limit or the 30-day expiry. Backups need
  their own controlled retention schedule.

Local verification: from the gateway repository run
`pwsh -NoProfile -File scripts/test-chat-storage.ps1` (Docker, Go and Node).
It uses two disposable loopback databases and synthetic accounts, restores a
`pg_dump` and a ClickHouse Native logical export with the separate test key,
then stops only its own containers. The runtime checks can be run from the gateway
repository with `node --test services/category-runtime/service/conversation/private-storage.test.mjs services/category-runtime/service/conversation/focused-request-http.test.mjs`.
