import { readFileSync } from 'node:fs';

// The verified registry and older adapters pin these logical origins. Map
// them to deployment peers at the transport boundary without rewriting pins.
export function configurePeers() {
  const peers = new Map();
  for (const [logical, name] of [
    ['http://127.0.0.1:6333', 'CATEGORY_QDRANT_URL'],
    ['http://127.0.0.1:11435', 'CATEGORY_OLLAMA_URL'],
  ]) {
    const value = process.env[name];
    if (!value) continue;
    const peer = new URL(value);
    if (!['http:', 'https:'].includes(peer.protocol) || peer.username || peer.password ||
        peer.pathname !== '/' || peer.search || peer.hash) throw Error(name + '_INVALID');
    peers.set(logical, peer.origin);
  }
  let qdrantKey;
  if (process.env.CATEGORY_QDRANT_API_KEY_FILE) {
    qdrantKey = readFileSync(process.env.CATEGORY_QDRANT_API_KEY_FILE, 'utf8').trim();
    if (!qdrantKey || /[\r\n]/u.test(qdrantKey)) throw Error('CATEGORY_QDRANT_API_KEY_INVALID');
  }
  if (!peers.size && !qdrantKey) return;
  const fetchNative = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, options) => {
    if (typeof input !== 'string' && !(input instanceof URL)) return fetchNative(input, options);
    let url;
    try { url = new URL(input); } catch { return fetchNative(input, options); }
    const remote = peers.get(url.origin);
    const useKey = qdrantKey && url.origin === 'http://127.0.0.1:6333';
    if (!remote && !useKey) return fetchNative(input, options);
    const target = new URL(remote ?? url.origin);
    target.pathname = url.pathname;
    target.search = url.search;
    const headers = new Headers(options?.headers);
    if (useKey) headers.set('api-key', qdrantKey);
    return fetchNative(target, { ...options, headers, redirect: 'error' });
  };
}
