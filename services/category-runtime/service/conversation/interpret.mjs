import fs from "node:fs";
import { currentEpisode, resolveBagReference } from "./state.mjs";
import { extractReviewed, documentTakingReport } from "./extract.mjs";
import { turnEvidence, forceActor, conversationalIntent } from "./evidence.mjs";
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
  const scope = turnEvidence(text);
  const scopedState = scope.newEpisode
    ? {
        ...s,
        activeEpisodeId: "new-turn",
        episodes: [{ id: "new-turn", actor: null }],
        factLedger: [],
        pending: null,
      }
    : s;
  const t = norm(scope.text),
    e = currentEpisode(scopedState);
  const out = {
    facts: [],
    events: [],
    stage: null,
    actor: e?.actor,
    source: {
      ...source(scope.quote, turnId),
      span: {
        start: Array.from(text.slice(0, scope.offset)).length,
        end: Array.from(text).length,
      },
    },
    evidenceText: scope.text,
    rawSourceText: scope.quote,
    intent: "add_detail",
  };
  out.newEpisode = scope.newEpisode;
  out.newCase = scope.newCase;
  out.itemResolution = resolveBagReference(scopedState, scope.text, out.source);
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
  const binding = forceActor(t);
  if (binding === "other") {
    out.actor = "other";
    out.actorExplicit = false;
    out.ambiguousActor = false;
  }
  if (binding === "police") {
    out.actor = "police";
    out.actorExplicit = true;
    out.ambiguousActor = false;
  }
  if (binding === "ambiguous") {
    out.actor = null;
    out.ambiguousActor = true;
  }
  out.correction =
    /ошиб(?:ся|лась)|исправ(?:лю|ляю)|неправильно (?:написал|объяснил)|не так написал/.test(
      t,
    );
  out.withdraw = /не уверен.{0,65}(?:ответ|сказал|травм|сил|открывал)|не уверен в сво[её]м прежнем ответе/u.test(t);
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
  if (!out.stage && ["select", "new"].includes(out.itemResolution?.kind) &&
      /сумк|рюкзак/u.test(t) &&
      (e?.stageId === "bag_search" || e?.stageHistory?.some(x => x.stageId === "bag_search") ||
        scopedState.factLedger?.some(x => x.episodeId === e?.id && x.status === "active" &&
          x.fieldKey.startsWith("pps.bag_search."))))
    out.stage = "bag_search";
  if (
    !out.stage &&
    !/не\s+(?:хочет|просит|попросил)/u.test(t) &&
    /(?:хочет|просит|попросил)[^.!?]{0,45}(?:письменно рассказал|письменно описал)|протягивает[^.!?]{0,30}объяснение[^.!?]{0,20}подпись/u.test(
      t,
    )
  )
    out.stage = "explanation_request";
  if (
    !out.stage &&
    !/не\s+(?:ощупывает|обыскивает|досматривает|досматривают)/u.test(t) &&
    /ощупывает[^.!?]{0,25}(?:мою одежду|меня)|(?:обыскивает|досматривает|досматривают)[^.!?]{0,20}мои карманы/u.test(
      t,
    )
  )
    out.stage = "personal_search";
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
  // Ending/denying the opening event does not deny the already established
  // bag procedure. Keep its scoped help while the event ledger is updated.
  if (/не открывает/u.test(t) &&
      !/не (?:досматривает|досматривают|обыскивает|обыскивают)/u.test(t) &&
      (e?.stageId === "bag_search" ||
        (["select", "new"].includes(out.itemResolution?.kind) &&
          (e?.stageHistory?.some(x => x.stageId === "bag_search") ||
            scopedState.factLedger?.some(x => x.episodeId === e?.id && x.fieldKey.startsWith("pps.bag_search.")))))) {
    if (out.deniedStage === "bag_search") delete out.deniedStage;
    out.stage = "bag_search";
  }
  if (
    !/не (?:кричит|орет|повышает)/.test(t) &&
    /крич|орет|повышает голос/.test(t)
  )
    out.events.push({ kind: "shouting" });
  out.newDocument =
    (e?.stageId === "explanation_request" ||
      out.stage === "explanation_request") &&
    /другое объяснение|новое объяснение|второе объяснение/.test(t);
  const itemScope = out.itemResolution;
  const extractionState = itemScope && ["new", "select"].includes(itemScope.kind)
    ? { ...scopedState, episodes: scopedState.episodes.map(x => x.id === scopedState.activeEpisodeId
        ? { ...x, itemId: itemScope.itemId } : x) }
    : scopedState;
  const reviewed = extractReviewed(extractionState, scope.text, out);
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
  if ((!out.actor || out.ambiguousActor) && out.stage === "use_of_force") {
    out.unresolvedForceValue = extractReviewed(scopedState, scope.text, {
      ...out,
      ambiguousActor: false,
    }).facts.find((f) => f.field === "use_of_force.force_actually_used")?.value;
    if (out.unresolvedForceValue === true)
      out.clarification = out.ambiguousActor
        ? "Кто именно применяет к вам силу?"
        : "Речь о сотруднике полиции?";
  }
  if (
    out.ambiguousActor &&
    rawForce &&
    !/если|угрож|не (?:бил|ударил|бьет)/u.test(t)
  ) {
    out.facts = [];
    out.events = [];
    out.actor = null;
    out.unresolvedForceValue = true;
    out.clarification = "Кто именно применяет к вам силу?";
  }
  if (binding === "other") {
    out.facts = [];
    out.events = [];
    out.stage = null;
  }
  out.intent =
    out.intent === "show_advice"
      ? out.intent
      : conversationalIntent(t) || out.intent;
  if (out.unresolvedForceValue === true)
    out.unresolvedForceOngoing = /бьет|бьют|выкручива|применяют|распуска/u.test(
      t,
    )
      ? true
      : null;
  // A volunteered document name may complete the immediately preceding report
  // even when no question could be asked. It is not an answer to an unseen NEXT.
  const savedDocument = e?.unresolvedIdentityDocument;
  if (!s.pending && !out.newEpisode && !out.newDocument &&
      !out.ambiguousActor && out.actor === "police" &&
      !out.stage && !out.facts.length && !out.events.length &&
      savedDocument?.scope?.episodeId === e?.id &&
      savedDocument.scope.personId === e.personId &&
      savedDocument.scope.documentId === e.documentId &&
      s.recentUserTurns?.at(-1)?.turnId === savedDocument.source.turnId &&
      /^(?:да[, ]+(?:это )?(?:мой )?паспорт|(?:это )?мой паспорт)[.!?]*$/iu.test(t)) {
    out.stage = "identity_check";
    out.facts.push({
      field: "identity_check.documents_taken_away", value: true,
      originalSource: { ...savedDocument.source, confirmation: out.source },
    });
    out.resolvedIdentityDocument = true;
  }
  const documentReport = documentTakingReport(t);
  if (
    !out.stage &&
    out.facts.some(
      (f) =>
        f.field === "identity_check.documents_taken_away" && f.value === true,
    )
  )
    out.stage = "identity_check";
  if (
    documentReport?.value === true &&
    documentReport.kind === "unspecified" &&
    !out.stage &&
    out.actor !== "other" &&
    !out.ambiguousActor &&
    !out.facts.some((f) => f.field === "identity_check.documents_taken_away")
  ) {
    out.clarification =
      "Речь о вашем паспорте или другом документе, удостоверяющем личность?";
    out.clarificationKey = "identity_document";
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
