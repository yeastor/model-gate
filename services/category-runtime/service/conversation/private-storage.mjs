import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const version = "azchat:v1:";
const algorithm = "aes-256-gcm";
const keyId = /^[A-Za-z0-9_-]{1,40}$/;
const nonceBytes = 12;
const tagBytes = 16;
let keyring;

const failure = (code) => Object.assign(new Error(code), { status: 503 });

export function requirePrivateStorage() {
  if (keyring) return;
  try {
    const { active, keys } = JSON.parse(
      readFileSync(process.env.CHAT_RUNTIME_KEYS_FILE, "utf8"),
    );
    if (typeof active !== "string" || !keyId.test(active) || !keys ||
        typeof keys !== "object" || Array.isArray(keys)) throw Error();
    const byId = new Map(Object.entries(keys).map(([id, value]) => {
      if (!keyId.test(id) || typeof value !== "string") throw Error();
      const key = Buffer.from(value, "base64");
      if (key.length !== 32 || key.toString("base64") !== value) throw Error();
      return [id, key];
    }));
    if (!byId.has(active)) throw Error();
    keyring = { active, byId };
  } catch {
    throw failure("CHAT_RUNTIME_KEY_FILE_MISSING_OR_INVALID");
  }
}

// HTTP entry points require a key. Direct offline fixtures can run without one.
export function privateStorageEnabled() {
  if (!keyring && process.env.CHAT_RUNTIME_KEYS_FILE !== undefined) requirePrivateStorage();
  return Boolean(keyring);
}

export function sealPrivate(scope, text) {
  if (!privateStorageEnabled()) return text;
  const prefix = version + keyring.active + ":";
  const nonce = randomBytes(nonceBytes);
  const cipher = createCipheriv(algorithm, keyring.byId.get(keyring.active), nonce, { authTagLength: tagBytes });
  cipher.setAAD(Buffer.from(prefix + scope));
  const ciphertext = Buffer.concat([nonce, cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return prefix + ciphertext.toString("base64url");
}

export function openPrivate(scope, text) {
  if (!privateStorageEnabled()) {
    if (text.startsWith(version)) throw failure("CHAT_RUNTIME_KEY_FILE_MISSING_OR_INVALID");
    return text;
  }
  try {
    const parts = text.split(":");
    const id = parts[2], encoded = parts[3], key = keyring.byId.get(id);
    if (!text.startsWith(version) || parts.length !== 4 || !key) throw Error();
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded || bytes.length < nonceBytes + tagBytes) throw Error();
    const decipher = createDecipheriv(algorithm, key, bytes.subarray(0, nonceBytes), { authTagLength: tagBytes });
    decipher.setAAD(Buffer.from(version + id + ":" + scope));
    decipher.setAuthTag(bytes.subarray(-tagBytes));
    return Buffer.concat([decipher.update(bytes.subarray(nonceBytes, -tagBytes)), decipher.final()]).toString("utf8");
  } catch {
    throw failure("CHAT_RUNTIME_CIPHERTEXT_UNREADABLE");
  }
}

function fileScope(file) {
  const childrenStore = process.env.CHILDREN_PRIVATE_SQLITE_STORE;
  const roots = [
    ["local", process.env.CATEGORY_LOCAL_DATA_DIR],
    ["isolated", process.env.CATEGORY_PRIVATE_DIALOGUE_DATA_DIR],
    ["children", childrenStore ? JSON.parse(childrenStore).root : null],
    ["service", process.env.CATEGORY_DATA_DIR || "work/category-loader"],
  ];
  for (const [kind, root] of roots) {
    if (!root) continue;
    const relative = path.relative(path.resolve(root), path.resolve(file));
    if (relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
      return "runtime/file/" + kind + "/" + relative.split(path.sep).join("/");
  }
  throw failure("CHAT_RUNTIME_PRIVATE_PATH_UNCONFIGURED");
}

export function sealPrivateFile(file, text) {
  return privateStorageEnabled() ? sealPrivate(fileScope(file), text) : text;
}

export function openPrivateFile(file, text) {
  return openPrivate(privateStorageEnabled() ? fileScope(file) : "", text);
}
