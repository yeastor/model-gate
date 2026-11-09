import path from "node:path";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import { root, active, search } from "../storage.mjs";
import { hash } from "./state.mjs";
import { createConversationService } from "./service.mjs";
import { loadQualifiedPackage } from "./qualified-package.mjs";
// Both private modes require an explicit exact package and an isolated store.
// Defaults, active aliases and production activation remain unchanged.
export const privateGosuslugiMode = Boolean(process.env.CATEGORY_PRIVATE_GOSUSLUGI_POLICY_PIN);
const gosuslugiIntegrationMode = Boolean(process.env.CATEGORY_GOSUSLUGI_INTEGRATION_PIN);
const debtsMode = Boolean(process.env.CATEGORY_PRIVATE_DEBTS_INTEGRATION_PIN);
const bailiffsMode = Boolean(process.env.CATEGORY_PRIVATE_BAILIFFS_INTEGRATION_PIN);
const qualifiedMode = Boolean(process.env.CATEGORY_PRIVATE_DIALOGUE_PACKAGE_PIN);
const neighborsMode = Boolean(process.env.CATEGORY_PRIVATE_NEIGHBORS_INTEGRATION_PIN);
const divorceMode = Boolean(process.env.CATEGORY_PRIVATE_DIVORCE_INTEGRATION_PIN);
const floodingMode = Boolean(process.env.CATEGORY_PRIVATE_FLOODING_INTEGRATION_PIN);
const phoneMode = Boolean(process.env.CATEGORY_PRIVATE_PHONE_INTEGRATION_PIN);
const threatsMode = Boolean(process.env.CATEGORY_PRIVATE_DIGITAL_THREATS_POLICY_PIN);
if ([bailiffsMode,threatsMode,debtsMode,privateGosuslugiMode,qualifiedMode,floodingMode,neighborsMode,phoneMode,gosuslugiIntegrationMode,divorceMode].filter(Boolean).length>1) throw Error("PRIVATE_MODE_CONFLICT");
export const privateQualifiedMode = bailiffsMode || threatsMode || debtsMode || floodingMode || qualifiedMode || privateGosuslugiMode || neighborsMode || phoneMode || gosuslugiIntegrationMode || divorceMode;
let debtsIntegration = null, bailiffsIntegration = null;
let floodingIntegration = null, qualifiedPackage = null, categoryProfile = null, neighborsIntegration = null, phoneIntegration = null, gosuslugiIntegration = null, divorceIntegration = null, dataDir = root;
if (privateQualifiedMode) {
  if (!process.env.CATEGORY_PRIVATE_DIALOGUE_DATA_DIR) throw Error("PRIVATE_DATA_DIR_REQUIRED");
  dataDir = path.resolve(process.env.CATEGORY_PRIVATE_DIALOGUE_DATA_DIR);
  const relative=path.relative(root,dataDir), reverse=path.relative(dataDir,root);
  const outside=rel=>rel==='..' || rel.startsWith('..'+path.sep) || path.isAbsolute(rel);
  if (!outside(relative) || !outside(reverse)) throw Error("PRIVATE_DATA_DIR_MUST_BE_ISOLATED");
  if (threatsMode) {
    const pin = JSON.parse(process.env.CATEGORY_PRIVATE_DIGITAL_THREATS_POLICY_PIN);
    if (!pin || typeof pin.path !== 'string' || !Number.isSafeInteger(pin.bytes) || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw Error('TH_PRIVATE_PIN_REQUIRED');
    const bytes = await fs.readFile(path.resolve(pin.path));
    if (bytes.length !== pin.bytes || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw Error('TH_PRIVATE_PIN_MISMATCH');
    const {createDigitalThreatsProfile} = await import('./digital-threats-profile.mjs');
    categoryProfile = await createDigitalThreatsProfile({policyBytes:bytes});
    if (categoryProfile.version !== 'digital_threats.20261028.v2') throw Error('TH_PRIVATE_V2_REQUIRED');
  }
  if (floodingMode) {
    const {loadFloodingIntegration}=await import('./flooding-qdrant.mjs');
    floodingIntegration=await loadFloodingIntegration(JSON.parse(process.env.CATEGORY_PRIVATE_FLOODING_INTEGRATION_PIN));
    categoryProfile=floodingIntegration.profile;
  }
  if (bailiffsMode) {
    const {loadBailiffsIntegration}=await import('./bailiffs-profile.mjs');
    bailiffsIntegration=await loadBailiffsIntegration(JSON.parse(process.env.CATEGORY_PRIVATE_BAILIFFS_INTEGRATION_PIN));
    categoryProfile=bailiffsIntegration.profile;
  }
  if (debtsMode) {
    const {loadDebtsIntegration}=await import('./debts-qdrant.mjs');
    debtsIntegration=await loadDebtsIntegration(JSON.parse(process.env.CATEGORY_PRIVATE_DEBTS_INTEGRATION_PIN));
    categoryProfile=debtsIntegration.profile;
  }
  if (qualifiedMode) qualifiedPackage=await loadQualifiedPackage(JSON.parse(process.env.CATEGORY_PRIVATE_DIALOGUE_PACKAGE_PIN));
  if (gosuslugiIntegrationMode) {
    const {loadGosuslugiIntegration}=await import('./gosuslugi-access-qdrant.mjs');
    gosuslugiIntegration=await loadGosuslugiIntegration(JSON.parse(process.env.CATEGORY_GOSUSLUGI_INTEGRATION_PIN));
    categoryProfile=gosuslugiIntegration.profile;
  }
  if (divorceMode) {
    const {loadDivorceIntegration}=await import('./divorce-qdrant.mjs');
    divorceIntegration=await loadDivorceIntegration(JSON.parse(process.env.CATEGORY_PRIVATE_DIVORCE_INTEGRATION_PIN));
    categoryProfile=divorceIntegration.profile;
  }
  if (phoneMode) {
    const {loadPhoneIntegration}=await import('./phone-qdrant.mjs');
    phoneIntegration=await loadPhoneIntegration(JSON.parse(process.env.CATEGORY_PRIVATE_PHONE_INTEGRATION_PIN));
    categoryProfile=phoneIntegration.profile;
  }
  if (neighborsMode) {
    const {loadNeighborsIntegration}=await import('./neighbors-qdrant.mjs');
    neighborsIntegration=await loadNeighborsIntegration(JSON.parse(process.env.CATEGORY_PRIVATE_NEIGHBORS_INTEGRATION_PIN));
    categoryProfile=neighborsIntegration.profile;
  }
  if (privateGosuslugiMode) {
    const pin = JSON.parse(process.env.CATEGORY_PRIVATE_GOSUSLUGI_POLICY_PIN);
    if (!pin || typeof pin.path !== 'string' || !Number.isSafeInteger(pin.bytes) || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw Error('GA_PRIVATE_PIN_REQUIRED');
    const bytes = await fs.readFile(path.resolve(pin.path));
    if (bytes.length !== pin.bytes || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw Error('GA_PRIVATE_PIN_MISMATCH');
    const {createGosuslugiAccessProfile} = await import('./gosuslugi-access-profile.mjs');
    categoryProfile = createGosuslugiAccessProfile({policyBytes:bytes});
  }
}
export const privateQualifiedTuple = categoryProfile ? {categoryId:categoryProfile.categoryId,sourceSha256:categoryProfile.sourceSha256,policyVersion:categoryProfile.version} : qualifiedPackage?.tuple ?? null;
const nativeConversation = createConversationService({
  dataDir,
  qualifiedPackage,
  categoryProfile,
  privateOnly: qualifiedMode,
  getActive: categoryProfile ? async()=>({sha256:categoryProfile.sourceSha256}) : qualifiedMode ? async()=>{throw Error("PRIVATE_MODE_NO_ACTIVE_ALIAS");} : active,
  search: privateQualifiedMode ? async()=>{throw Error("PRIVATE_MODE_NO_RETRIEVAL");} : search,
  getBundle: async (sha) => {
    if (!/^[a-f0-9]{64}$/.test(sha)) throw Error("INVALID_BUNDLE");
    if (categoryProfile) {
      if (sha !== categoryProfile.sourceSha256) throw Error('GA_SOURCE_VERSION_UNAVAILABLE');
      return categoryProfile.bundle;
    }
    const bytes = await fs.readFile(path.join(root, "versions", sha, "bundle.json"), "utf8");
    if (hash(bytes) !== sha) throw Error("BUNDLE_INTEGRITY");
    return JSON.parse(bytes);
  },
});
export const conversation = bailiffsIntegration ? bailiffsIntegration.wrap(nativeConversation) : debtsIntegration ? debtsIntegration.wrap(nativeConversation) : divorceIntegration ? divorceIntegration.wrap(nativeConversation) : floodingIntegration ? floodingIntegration.wrap(nativeConversation) : gosuslugiIntegration ? gosuslugiIntegration.wrap(nativeConversation) : phoneIntegration ? phoneIntegration.wrap(nativeConversation) : neighborsIntegration ? neighborsIntegration.wrap(nativeConversation) : nativeConversation;
