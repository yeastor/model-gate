// Local operator utility. Reports are never fed into generation automatically.
import fs from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2),
  root = path.resolve(
    process.env.CATEGORY_DATA_DIR || "work/category-loader",
    "dialogue-feedback",
  );
const records = [];
let owners = [];
try {
  owners = await fs.readdir(root);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
for (const owner of owners) {
  if (!/^[a-f0-9]{64}$/.test(owner)) continue;
  for (const name of await fs.readdir(path.join(root, owner))) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const file = path.join(root, owner, name),
      record = JSON.parse(await fs.readFile(file, "utf8"));
    records.push({ file, record });
  }
}
const statusAt = args.indexOf("--status"),
  idAt = args.indexOf("--id");
if (statusAt >= 0) {
  const status = args[statusAt + 1],
    id = args[idAt + 1];
  if (
    idAt < 0 ||
    !["NEW", "NEEDS_REVIEW", "PLANNED", "COVERED", "DECLINED"].includes(status)
  )
    throw Error(
      "Use --id <id> --status NEW|NEEDS_REVIEW|PLANNED|COVERED|DECLINED",
    );
  const found = records.find((x) => x.record.id === id);
  if (!found) throw Error("Report not found");
  const { atomic } = await import("../service/conversation/state.mjs");
  await atomic(found.file, {
    ...found.record,
    status,
    reviewedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ id, status }));
} else
  console.log(
    JSON.stringify(
      records.map(({ record: r }) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
        reason: r.reason,
        messages: r.transcript.length,
        ...(args.includes("--include-transcript")
          ? { transcript: r.transcript }
          : {}),
      })),
      null,
      2,
    ),
  );
