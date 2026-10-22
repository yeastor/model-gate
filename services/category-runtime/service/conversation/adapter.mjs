import path from "node:path";
import fs from "node:fs/promises";
import { root, active, search } from "../storage.mjs";
import { hash } from "./state.mjs";
import { createConversationService } from "./service.mjs";
export const conversation = createConversationService({
  dataDir: root,
  getActive: active,
  search,
  getBundle: async (sha) => {
    if (!/^[a-f0-9]{64}$/.test(sha)) throw Error("INVALID_BUNDLE");
    const bytes = await fs.readFile(
      path.join(root, "versions", sha, "bundle.json"),
      "utf8",
    );
    if (hash(bytes) !== sha) throw Error("BUNDLE_INTEGRITY");
    return JSON.parse(bytes);
  },
});
