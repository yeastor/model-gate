import fs from "node:fs";
import { currentEpisode } from "./state.mjs";
import { extractReviewed } from "./extract.mjs";
import {
  runtimeFields,
  dialoguePackage,
  validateDialoguePackage,
} from "./package.mjs";
export const policy = JSON.parse(
  fs.readFileSync(new URL("./policy/pps.json", import.meta.url), "utf8"),
);
policy.fields = runtimeFields;
policy.version = dialoguePackage.version;
const norm = (s) => s.toLowerCase().replaceAll("ё", "е").trim();
export function source(text, turnId) {
  return {
    kind: "user_text",
    turnId,
    quote: text,
    span: { start: 0, end: Array.from(text).length },
  };
}
export function interpretTurn(s, text, turnId) {
  const t = norm(text),
    e = currentEpisode(s);
  const out = {
    facts: [],
    events: [],
    stage: null,
    actor: e?.actor,
    source: source(text, turnId),
    intent: "add_detail",
  };
  out.newEpisode = /другой случай|другое происшествие|теперь про другого/.test(
    t,
  );
  if (out.newEpisode) out.actor = null;
  out.actorExplicit =
    /полицейск|сотрудник(?:а|и|ом)? полиции|сотрудники ппс|(?:^|\s)ппс(?:\s|$)/.test(
      t,
    );
  if (out.actorExplicit) out.actor = "police";
  if (/охранник/.test(t) && !out.actor) out.actor = "other";
  out.ambiguousActor =
    /(?:полицейск).{0,30}(?:охранник)|(?:охранник).{0,30}(?:полицейск)/.test(
      t,
    ) ||
    (!out.actorExplicit && !!e?.ambiguousActor);
  if (out.ambiguousActor && /^(?:он|тот)(?:\s|$)/.test(t)) out.actor = null;
  if (
    /не полицейский|не сотрудник полиции/.test(t) &&
    /охранник|сотрудник охраны/.test(t)
  ) {
    out.actor = "other";
    out.actorExplicit = false;
    out.ambiguousActor = false;
  }
  out.correction =
    /ошиб(?:ся|лась)|исправ(?:лю|ляю)|неправильно (?:написал|объяснил)|не так написал/.test(
      t,
    );
  out.withdraw = /не уверен.{0,35}(?:ответ|сказал|травм|сил)/.test(t);
  out.choice = /^(да|нет|не знаю|не помню)[.!]?$/.exec(t)?.[1];
  if (out.choice)
    out.choiceValue =
      out.choice === "да" ? true : out.choice === "нет" ? false : null;
  const rawForce =
    new RegExp(policy.forcePattern, "u").test(t) ||
    /наручник|перестал.{0,20}бить|прекратил.{0,20}бить/.test(t);
  if (rawForce) out.stage = "use_of_force";
  if (!out.stage) {
    const matches = policy.stageRules.filter((r) =>
      new RegExp(r.pattern, "u").test(t),
    );
    if (matches.length === 1) {
      out.stage = matches[0].id;
      out.events.push({ kind: matches[0].requires });
    } else if (matches.length > 1) out.ambiguousStage = true;
  }
  if (
    /не\s+(?:просит|просят|требует|требуют|везут|ведут|проверяет|проверяют|досматривает|досматривают|открывает|приглашает)/.test(
      t,
    ) &&
    out.stage &&
    out.stage !== "use_of_force"
  ) {
    out.deniedStage = out.stage;
    out.stage = null;
  }
  if (/крич|орет|повышает голос/.test(t)) out.events.push({ kind: "shouting" });
  out.newDocument =
    (e?.stageId === "explanation_request" ||
      out.stage === "explanation_request") &&
    /другое объяснение|новое объяснение|второе объяснение/.test(t);
  const reviewed = extractReviewed(s, text, out);
  out.facts = reviewed.facts;
  out.signals = reviewed.signals;
  const force = out.facts.find(
    (f) => f.field === "use_of_force.force_actually_used",
  );
  if (force?.value === true) {
    out.stage = "use_of_force";
    out.events.push({
      kind: "force",
      ongoing: /бьет|бьют|выкручива|применяют|распуска/.test(t) ? true : null,
    });
    if (/(?:перестал|прекратил|больше не).{0,20}(?:бить|бьет|бьют)/.test(t))
      out.events.push({ kind: "force_ended" });
  }
  if (
    out.facts.some(
      (f) => f.field === "use_of_force.handcuffs_used" && f.value === true,
    )
  ) {
    out.stage = "use_of_force";
    out.events.push({ kind: "handcuffs" });
  }
  if (
    out.stage === "use_of_force" &&
    !out.facts.some((f) => f.field.startsWith("use_of_force.")) &&
    !out.ambiguousActor
  )
    out.stage = null;
  if (!out.stage && !e?.stageId) {
    const stages = [
      ...new Set(
        out.facts
          .filter((f) => f.value === true)
          .map((f) => f.field.split(".")[0]),
      ),
    ];
    if (stages.length === 1) out.stage = stages[0];
  }
  if (/^(?:а )?если |имеет ли право|в фильме|в кино/.test(t)) {
    out.stage = null;
    out.events = [];
  }
  if (
    /покажи.{0,15}памятк|повтори.{0,15}(?:ответ|совет)|показать памятку/.test(t)
  )
    out.intent = "show_advice";
  if (!out.actor && out.stage === "use_of_force") {
    out.unresolvedForceValue = extractReviewed(s, text, {
      ...out,
      ambiguousActor: false,
    }).facts.find((f) => f.field === "use_of_force.force_actually_used")?.value;
    if (out.unresolvedForceValue === true)
      out.clarification = out.ambiguousActor
        ? "Кто именно применяет к вам силу?"
        : "Речь о сотруднике полиции?";
  }
  return out;
}
export function validatePolicy(bundle) {
  validateDialoguePackage(bundle);
  if (bundle.category.id !== policy.categoryId)
    throw Object.assign(Error("CONVERSATION_POLICY_UNAVAILABLE"), {
      status: 409,
    });
  const stages = new Map(
    bundle.subcategories.map((s) => [
      s.stage.id,
      new Set(s.context_fields.map((f) => f.id)),
    ]),
  );
  for (const rule of policy.stageRules) {
    if (!stages.has(rule.id)) throw Error("POLICY_STAGE_INVALID");
    new RegExp(rule.pattern, "u");
  }
  new RegExp(policy.forcePattern, "u");
  for (const [field, rule] of Object.entries(policy.fields)) {
    for (const key of [field, ...rule.dependencies]) {
      const [stage, name] = key.split(".");
      if (!stages.get(stage)?.has(name)) throw Error("POLICY_FIELD_INVALID");
    }
    if (!["event", "state"].includes(rule.semantics))
      throw Error("POLICY_SEMANTICS_INVALID");
  }
}
