import { createScopedQuestionCatalog } from "./questions.mjs";
import fs from "node:fs/promises";
import { hash } from "./state.mjs";
import { fail } from "./errors.mjs";

const profileURL = new URL("./policy/management-company-reports.json", import.meta.url);
const profileHash = "932fd07e2a65975780beaa2bb7ad5462cc75f1f29b58d14d571d4893781d3b23";
export async function requestProfile(input, saved) {
  if (saved?.deleted) fail("CHAT_DELETED", 410);
  const {inferMCStage}=await import("./management-company.mjs");
  const inferredStage=inferMCStage(input.question,{withinCategory:input.categoryId==="management_company"||saved?.requestDialogue?.profileId});
  const selected = saved?.requestDialogue?.profileId;
  const category = input.categoryId || input.guided?.categoryId || input.launchHint?.categoryId;
  const stage = input.stageId || input.guided?.stageId || input.launchHint?.stageId || inferredStage || saved?.requestDialogue?.activeStage;
  const variant = input.variantId || input.guided?.entryVariantId;
  const requested = (!saved && !category && !!inferredStage) || [input.categoryId,input.guided?.categoryId,input.launchHint?.categoryId].includes("management_company") ||
    [input.variantId,input.guided?.entryVariantId].some(id => typeof id === "string" && id.startsWith("management_company_"));
  if ((selected || requested) && [input.categoryId,input.guided?.categoryId,input.launchHint?.categoryId]
    .some(value=>value && value!=="management_company")) fail("CATEGORY_SESSION_MISMATCH",409);

  if (!selected && !requested) return null;
  if(new Set([input.stageId,input.guided?.stageId,input.launchHint?.stageId].filter(Boolean)).size>1)fail("REQUEST_STAGE_MISMATCH",409);
  if (saved && !selected) fail("CATEGORY_SESSION_MISMATCH", 409);
  if (selected && category && category !== "management_company") fail("CATEGORY_SESSION_MISMATCH", 409);

  const raw = await fs.readFile(profileURL, "utf8");
  if (hash(raw) !== profileHash) fail("REQUEST_PACKAGE_INTEGRITY", 503);
  const base = JSON.parse(raw);
  const {withMCStage,mcBundle}=await import("./management-company.mjs");
  const entryStage=variant?mcBundle.subcategories.find(s=>s.variants.some(v=>v.variant_id===variant))?.stage.id:null;
  if(stage&&entryStage&&stage!==entryStage)fail("REQUEST_ENTRY_UNAVAILABLE",409);
  const profile=withMCStage(base,stage||entryStage||"reports");
  createScopedQuestionCatalog(profile);
  if (selected && selected !== profile.id) fail("REQUEST_PACKAGE_UNAVAILABLE", 409);
  if ([input.variantId, input.guided?.entryVariantId].some(id => id && !profile.stage.variants.some(r => r.variant_id === id)))
    fail("REQUEST_ENTRY_UNAVAILABLE", 409);
  if (!selected && !variant && !stage) fail("REQUEST_STAGE_REQUIRED", 409);
  return profile;
}
