import { dialoguePackage } from "./conversation/package.mjs";
import { conversation } from "./conversation/adapter.mjs";
import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { validateSource } from "./validate.mjs";
import { active, importSource, alias } from "./storage.mjs";
import { respond } from "./runtime.mjs";
import { checkDocumentLinks, FORMAT } from "./explicit/contract.mjs";

const token = process.env.CATEGORY_INTERNAL_TOKEN;
if (!token || token.length < 32)
  throw new Error("CATEGORY_INTERNAL_TOKEN required");
const plans = new Map();
let job = null;
function authorised(req) {
  const received = Buffer.from(req.headers["x-category-token"] || "");
  const expected = Buffer.from(token);
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.url === "/health") {
      res.end(
        JSON.stringify({
          ok: true,
          service: "category-bundle",
          conversationPolicy: dialoguePackage.version,
          categorySha256: dialoguePackage.categorySha256,
        }),
      );
      return;
    }
    if (!authorised(req)) {
      res.statusCode = 403;
      res.end("{}");
      return;
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 9 * 1024 * 1024) throw new Error("Файл превышает 8 МБ.");
      chunks.push(chunk);
    }
    const input = size
      ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
      : {};
    let result;
    if (req.url === "/state")
      result = {
        active: await active(),
        job,
        namespace: alias,
        exampleImports:
          process.env.CATEGORY_ALLOW_EXAMPLES === "true" &&
          alias !== "aizashchita_active_scenarios",
      };
    else if (req.url === "/validate") {
      const { bundle, report } = validateSource(input.sourceText);
      if (report.format_version === FORMAT)
        report.document_links = await checkDocumentLinks(bundle);
      const id = randomUUID();
      plans.clear();
      plans.set(id, {
        text: input.sourceText,
        at: Date.now(),
        previous: (await active())?.sha256,
        total: report.variants,
      });
      result = { planId: id, report };
    } else if (req.url === "/import") {
      const plan = plans.get(input.planId);
      if (!plan || Date.now() - plan.at > 30 * 60 * 1000)
        throw new Error("Повторите проверку файла.");
      if (job?.status === "running") throw new Error("Импорт уже выполняется.");
      if (plan.previous !== (await active())?.sha256)
        throw new Error("Активный пакет изменился. Повторите проверку.");
      job = {
        id: randomUUID(),
        status: "running",
        phase: "start",
        done: 0,
        total: plan.total,
      };
      void importSource(plan.text, (progress) => Object.assign(job, progress))
        .then((result) => Object.assign(job, { status: "complete", result }))
        .catch((error) =>
          Object.assign(job, { status: "failed", error: error.message }),
        );
      result = { job };
    } else if (req.url === "/conversation/pending")
      result = await conversation.internal(input, "pending");
    else if (req.url === "/conversation/ack")
      result = await conversation.internal(input, "ack");
    else if (req.url === "/conversation/delete")
      result = await conversation.internal(input, "delete");
    else if (req.url === "/respond") result = await respond(input);
    else {
      res.statusCode = 404;
      result = { error: "Not found" };
    }
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = error.status || 400;
    res.end(
      JSON.stringify({ error: error.message, issues: error.report?.issues }),
    );
  }
});
server.listen(Number(process.env.CATEGORY_PORT || 18100), "127.0.0.1", () =>
  console.log("Category bundle service: loopback"),
);
