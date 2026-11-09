# Category runtime and conversation state

Node.js 24+, npm. This service is separate from Next.js/Payload. Existing category imports and legacy requests remain available; protocolVersion=2 uses conversation state.

```sh
npm ci --ignore-scripts
npm test
npm start
```

Required configuration: CATEGORY_INTERNAL_TOKEN (existing internal token, at least 32 characters), CATEGORY_DATA_DIR (persistent mounted data), CHAT_RUNTIME_KEYS_FILE (path to the separate keyring), CATEGORY_PORT (loopback, default 18100). Existing Qdrant, Ollama and document-generator configuration is preserved. Never put tokens, keys, session data or .env in source control. See [chat storage encryption](../../docs/chat-storage-encryption.md) before rollout.

The gateway enables v2 with CONVERSATION_STATE_V2=true and APP_CONVERSATION_RUNTIME_URL=http://127.0.0.1:<port>. Keep APP_CATEGORY_RUNTIME_URL for legacy requests. Only one Node writer may use a given session directory. File locking inside Node is process-local; ownership/serialization is also enforced by the Go gateway.

State: <data>/conversation-sessions-v2/. Bundle versions remain pinned under <data>/versions/<sha>/bundle.json. Unknown facts stay null. The interpreter is intentionally bounded; unsupported wording is clarified rather than treated as evidence.

See ../../docs/dialogue-rules.md from the model-gate root (docs/dialogue-rules.md) for authorship, examples and review requirements.

Internal token-protected routes: /respond, /conversation/pending, /conversation/ack, /conversation/delete. Pending history is delivered before accepting the next turn. Message IDs are stable; ClickHouse reads deduplicate before LIMIT. No distributed transaction or physically exactly-once insert is claimed.

Rollout: build the gateway and Angular frontend together, test an owned isolated chat through the existing proxy, then enable v2. Preserve the legacy binary and v1 sessions. Never feed v2 JSON to a v1 engine on rollback. Disable the frontend v2 client together with the gateway flag; saved messages remain available.

The local developer launch/rollback helper and captured evidence are under the task's work/chat-dialog-state-implementation-20261022-v1 folder. It does not deploy to an external server or install the owner's Ollama 13B model.

Neighbors has an explicit private retrieval mode via
`CATEGORY_PRIVATE_NEIGHBORS_INTEGRATION_PIN` (JSON path/bytes/SHA-256 pin of
`neighbors-private-qdrant-integration/v1`). It requires
`CATEGORY_PRIVATE_DIALOGUE_DATA_DIR` outside the default store and the usual
internal token. The existing server and protocol v2 are used. The pinned
400-row collection is separate from the active PPS alias. Source applicability,
dialogue rules, sessions and full DOCUMENT templates remain outside Qdrant.
Search selects a general stage entry only; retrieved masks never become facts.
This opt-in mode is mutually exclusive with other private modes. Defaults are
unchanged. Deployment to the shared gateway/UI is separate from a local HTTP
integration test. Evidence and the launch helper are in
`_work/neighbors/qdrant-integration/20261028-v1` under the workspace root.

PPS now uses the reviewed pps-dialogue/20261022-v2 package. See docs/pps-dialogue-integration.md and docs/pps-dialogue-integration-report.json in the repository root for the compiled configuration, commands, executed coverage and local rollout evidence. The two unresolved fields remain blocked.

Native NEXT questions may supply optional `answer_labels` with exactly the keys
`"true"`, `"false"`, and `"null"`. Each caption must be distinct, trimmed, nonempty,
single-line text of at most 100 Unicode code points. The labels change display
only: `answers` and stored facts remain Boolean/null, without inverse mapping.
Changing a caption changes the block ID, so old buttons cannot answer the new
block. Questions without this optional dictionary keep their existing captions.
The existing explicit NEXT `data[].label` and frontend badges already preserve
display text separately from the submitted Boolean value. Adding label support
does not activate a category bundle or add routes/targets to it.
