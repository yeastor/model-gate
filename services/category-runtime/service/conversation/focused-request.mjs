import { choiceValue, createScopedQuestionCatalog } from "./questions.mjs";
import { randomUUID } from "node:crypto";
import { atomic, hash, validateState } from "./state.mjs";
import { fail, uuid } from "./errors.mjs";
import {
  documentKinds, explicitCandidates, focusIntent, isCorrection, isNewCase, documentObservations, resolveRequest, mergeRequestScope, requestIdentity, refusalEvidence,
  isWithdrawal, refersToSelected, requestValue, sameRequest, scopeLabel, sharedValues, unambiguous,
} from "./request-evidence.mjs";

const own = (o, k) => Object.hasOwn(o, k);
const values = [true, false, null];
const shortAnswer = choiceValue;
const showAdvice = text => /^(?:покажи(?:те)?|повтори(?:те)?) (?:полную )?(?:памятку|ответ)(?: целиком| полностью)?[.!]*$/iu.test(text.trim());
export const escapeRequestText = t => String(t).replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function newCase(s) {
  const c = { id: randomUUID(), used: 0, focusAsked: false, requests: [], selectedId: null, stopped: false };
  s.requestDialogue.cases.push(c);
  s.requestDialogue.caseId = c.id;
  s.pending = null;
  return c;
}
const current = s => s.requestDialogue.cases.find(c => c.id === s.requestDialogue.caseId);
const selected = c => c.requests.find(r => r.id === c.selectedId);
const activeFact = (s, c, r, field) => s.factLedger.filter(f =>
  f.caseId === c.id && f.subjectId === r.id && f.field === field && f.status === "active").at(-1);
function record(s, c, r, field, value, source, correction = false) {
  const previous = s.factLedger.filter(f => f.caseId === c.id &&
    f.subjectId === r.id && f.field === field && ["active", "conflicted"].includes(f.status));
  const old = previous.at(-1);
  if (!correction && old?.status === "active" && ((old.value === value && hash(old.source?.projectionOf||[])===hash(source.projectionOf||[])) || (value === null && old.value !== null)))
    return;
  const conflict = !correction && previous.some(f => f.status === "conflicted" ||
    (f.value !== null && value !== null && f.value !== value));
  for (const f of previous) f.status = conflict ? "conflicted" : "superseded";
  s.factLedger.push({ id: randomUUID(), caseId: c.id, subjectId: r.id, field, fieldKey: "management_company."+(r.stageId||"reports")+"."+field,
    value, source, status: conflict ? "conflicted" : "active",
    operation: correction ? "correct" : "assert" });
}
function observe(s, c, r, text, source, profile) {
  updateDocuments(s,c,r,text,source,profile);
  if (isWithdrawal(text)) {
    for (const f of s.factLedger)
      if (f.caseId === c.id && f.subjectId === r.id &&
          [profile.fields.sent, profile.fields.refused].includes(f.field) &&
          /отправ|направ|отказ/iu.test(text) &&
          ((f.field === profile.fields.sent && /отправ|направ/iu.test(text)) ||
           (f.field === profile.fields.refused && /отказ/iu.test(text))))
        f.status = "withdrawn";
    return;
  }

  for (const field of [profile.fields.sent, profile.fields.refused]) {
    const value = requestValue(text, field, true);
    if (value !== undefined) record(s, c, r, field, value, source, isCorrection(text));
  }
}
function remember(s,c,label,source,profile) {
  const resolution=resolveRequest(c.requests,label,selected(c));
  if(['ambiguous','unresolved'].includes(resolution.kind))return null;
  let r=resolution.request;
  if(!r){r={id:randomUUID(),label,sources:[],asked:[]};c.requests.push(r);}
  r.sources.push(source);mergeRequestScope(r,label);
  observe(s,c,r,label,source,profile);return r;
}
export function requestFacts(s, profile) {
  if(profile.stageAdapter)return profile.stageAdapter.facts(s,profile);
  const c = current(s), r = selected(c), facts = {};
  // Preserve independent material actions for all described requests.
  for (const field of profile.fields.shared) {
    const known=c.requests.filter(req=>(req.stageId||"reports")==="reports").map(req=>activeFact(s,c,req,field));
    if(known.some(f=>f?.value===true))facts[field]=true;
    else if(known.length && known.every(Boolean))facts[field]=known.every(f=>f.value===false)?false:null;
  }
  if (r) for (const field of [profile.fields.sent, profile.fields.refused]) {
    const fact = activeFact(s, c, r, field);
    if (fact) facts[field] = fact.value;
  }
  return facts;
}
export function requestAnswer(s, profile) {
  const facts = requestFacts(s, profile);
  const signature = Object.keys(facts).filter(k => facts[k] === true).sort().join("|");
  const rows = profile.stage.variants.filter(r =>
    Object.entries(r.context).filter(([,v]) => v === true).map(([k]) => k).sort().join("|") === signature);
  if (rows.length !== 1) fail("REQUEST_TARGET_UNAVAILABLE", 409);
  return rows[0];
}
function plan(s, profile) {
  if(profile.stageAdapter)return profile.stageAdapter.plan(s,profile);
  const catalog = createScopedQuestionCatalog(profile);
  const c = current(s), r = selected(c);
  const conflict = s.factLedger.some(f => f.caseId === c.id &&
    f.status === "conflicted" && (!r || f.subjectId === r.id));
  if (c.stopped || conflict || r?.documentFacts?.some(f=>f.status==="conflicted")) { s.pending = null; return; }
  if (s.pending || c.used >= profile.normalBudget) return;
  if (!r) {
    if (c.focusAsked) return;
    c.focusAsked = true;
    c.used++;
    s.pending = { id: randomUUID(), kind: "request_focus", caseId: c.id,
      questionId: catalog.focus.id, text: catalog.focus.text };
    return;
  }
  const q = catalog.questions.find(q => !activeFact(s,c,r,q.field) && !r.asked.includes(q.field));
  if (!q) return;
  c.used++;
  r.asked.push(q.field);
  s.pending = { id: randomUUID(), kind: "request_fact", caseId: c.id,
    requestId: r.id, field: q.field, questionId: q.id,
    text: (r.descriptionRetracted?"Прежнее описание выбранного запроса: «":"Речь о выбранном запросе: «") + r.label + "».\n" + (r.descriptionRetracted?"Учитываем ваше уточнение.\n":"") + q.text + "\n" + q.hint };
}
function applyText(s, input, profile) {
  if(profile.stageAdapter)return profile.stageAdapter.applyText(s,input,profile,{record,newCase});
  const text = input.question.trim();
  let c = current(s);
  if (isNewCase(text)) c = newCase(s);
  const source = { kind: "user_text", turnId: input.turnId, quote: text };
  (c.userSources ||= []).push(source);
  const p = s.pending, r = selected(c);
  const answer = shortAnswer(text);
  if (p?.kind === "request_fact" && answer) {
    if (!r || p.requestId !== r.id || p.caseId !== c.id) fail("STALE_ACTION",409);
    record(s,c,r,p.field,answer.value,{...source,questionId:p.id});
    s.pending = null;
    return;
  }
  const resolution=resolveRequest(c.requests,text,r);
  if(focusIntent(text)&&["ambiguous","unresolved"].includes(resolution.kind)){unresolved(c,s,source,"Focused identity is incomplete or ambiguous; no old sending is projected.");return;}
  if (r && !focusIntent(text) && !isNewCase(text) && resolution.kind==="unique" && resolution.request.id===r.id) {
    mergeRequestScope(r,text);
    r.sources.push(source);
    observe(s,c,r,text,source,profile);
    s.pending = null;
    c.stopped = false;
    return;
  }
  const label = scopeLabel(text);
  if ((p?.kind === "request_focus" || focusIntent(text) || !r || isNewCase(text)) && unambiguous(label)) {
    const req = remember(s,c,label,p?.kind==="request_focus"?{...source,focusSelection:true,questionId:p.id}:source,profile);
    if(!req){unresolved(c,s,source,"Request identity is ambiguous; no business fact changed.");return;}
    c.selectedId = req.id;
    c.stopped = false;
    s.pending = null;
    return;
  }
  if ((isCorrection(text)||isWithdrawal(text)) && resolution.kind!=="unique") {
    unresolved(c,s,source,"Correction/withdrawal does not identify an existing request.");return;
  }
  // More than one request never supplies the business sending value.
  const candidates = explicitCandidates(text);
  if (candidates.length) {
    for (const label of candidates) remember(s,c,label,{...source,quote:label},profile);
    c.selectedId = null;
    s.pending = null;
    if (p?.kind === "request_focus") c.stopped = true;
    return;
  }
  if (p?.kind === "request_focus") {
    s.pending = null;
    c.stopped = true;
  } else if (p?.kind === "request_fact") {
    s.pending = null;
    c.stopped = true;
  }
}
function response(s, profile, render, forceFull = false, historyAvailable = null) {
  const c = current(s), r = selected(c), row = requestAnswer(s,profile);
  const control = action => ({ version:s.version,categoryId:profile.category.id,stageId:profile.stage.stage.id,
    context:{},native:{sessionId:s.id,nonce:s.nonce,revision:s.revision,
      episodeId:c.id,roundId:c.id,...action} });
  const next = [], p = s.pending;
  const answerFingerprint = hash([s.version, row.payload.answer]);
  const visible = historyAvailable?.({caseId:c.id,version:s.version,responseId:c.lastFull?.responseId,fingerprint:answerFingerprint}) === true;
  const full = forceFull || c.lastFull?.fingerprint !== answerFingerprint || !visible;
  const responseId = randomUUID();
  const referencesResponseId = full ? undefined : c.lastFull.responseId;
  let content = full ? render(row) : "Порядок действий в памятке выше остаётся прежним. Учту ваш ответ при дальнейших уточнениях.";
  if (full) c.lastFull = { fingerprint: answerFingerprint, responseId };
  if (r && !profile.stageAdapter) content = (r.descriptionRetracted?"Прежнее описание выбранного запроса: «":"Сейчас разбираем запрос: «") + escapeRequestText(r.label) + "»." + (r.descriptionRetracted?" Вы уточнили прежнее описание; ниже учтены действующие сведения.":"") + "\n\n" + content;
  const documents=profile.documentOffers?.(s,row)||[];
  if(full&&documents.length)content+="\n\nЕсли нужен письменный запрос, можно заполнить форму: "+documents.map(d=>'<a href="'+d.href+'">'+escapeRequestText(d.title)+'</a>').join(", ")+". Перед подготовкой подтвердите получателя, его роль и обстоятельства именно этого случая. Сведения из прошлых обращений автоматически не подставляются.";
  if (p?.kind === "request_focus") content += "\n\n" + escapeRequestText(p.text);
  if (p?.kind === "request_fact") next.push({type:"choice",questionText:p.text,
    view:values.map(value=>({type:"badge",id:randomUUID(),
      value:value===null?"Не знаю":value?"Да":"Нет",question:value===null?"Не знаю":value?"Да":"Нет",
      variantId:"",categoryId:profile.category.id,
      guided:control({kind:"answer",questionId:p.id,value})}))});
  if (!p && c.used >= profile.normalBudget)
    content += "\n\nУточнения для этого разбора завершены. Вы можете воспользоваться показанным порядком действий.";
  if (c.stopped) content += "\n\nНе удалось однозначно связать сведения с одним запросом. Факт отправки оставлен без изменения.";
  if ((s.factLedger.some(f => f.caseId===c.id && f.status==="conflicted") || r?.documentFacts?.some(f=>f.status==="conflicted")))
    content += "\n\nСведения об одном запросе противоречат друг другу. Спорное обстоятельство не использовано; остальные подтверждённые действия сохранены.";
  return {status:"answer",guided:control({}),conversation:{sessionId:s.id,revision:s.revision},
    presentation:{kind:full?"full":"continuation",responseId,answerFingerprint,referencesResponseId,
      urgentPriority:requestFacts(s,profile).immediate_danger_present===true||requestFacts(s,profile).people_injured_or_trapped===true,questionCatalogVersion:profile.categoryRuntimeVersion||profile.version},
    answer:{category:profile.category,content,variantId:row.variant_id,next}};
}
export async function respondFocusedRequest(input, { identity, file, saved, profile, render, historyAvailable = null }) {
  if (saved?.deleted) fail("CHAT_DELETED",410);
  if (saved) validateState(saved,identity.userId,identity.chatId);
  let s = saved;
  if (!s) {
    s = {schemaVersion:"conversation-state/v2",userId:identity.userId,chatId:identity.chatId,
      id:randomUUID(),version:profile.categorySha256,revision:0,nonce:randomUUID(),
      turns:{},factLedger:[],pending:null,outbox:null,
      requestDialogue:{profileId:profile.id,version:profile.version,cases:[]}};
    newCase(s);
  }
  if (s.version!==profile.categorySha256 || s.requestDialogue?.version!==profile.version)
    fail("PINNED_REQUEST_PACKAGE_UNAVAILABLE",409);
  if (input.guided?.version && input.guided.version!==s.version) fail("STALE_ACTION",409);
  const revalidated=profile.stageAdapter?false:revalidateRequestBindings(s,profile);
  if(revalidated && s.lastResponse){(s.requestDialogue.priorResponses ||= []).push(s.lastResponse);s.lastResponse=null;}
  if (input.resume) {
    const previousStage=current(s).activeStage||"reports";
    if(s.outbox && previousStage!==profile.stage.stage.id)fail("HISTORY_DELIVERY_PENDING",409);
    profile.prepare?.(s,input,profile);
    if(previousStage!==profile.stage.stage.id)s.lastResponse=null;
    if (!s.lastResponse || (!s.outbox && s.lastResponse.presentation.kind==="continuation" && historyAvailable?.({caseId:current(s).id,version:s.version,responseId:current(s).lastFull?.responseId,fingerprint:hash([s.version,requestAnswer(s,profile).payload.answer])})!==true)) {
      // Opening an article carries no user facts or request description.
      plan(s,profile);
      s.lastResponse=response(s,profile,render,true,historyAvailable);
      const responseId=s.lastResponse.presentation.responseId;
      s.outbox={turnId:"initial-"+responseId,messageId:responseId,createdAt:new Date().toISOString(),
        question:"",answer:s.lastResponse.answer.content,category:profile.category.id,responseId};
      await atomic(file,s);
    }
    return {...structuredClone(s.lastResponse),_historyEnvelope:s.outbox};
  }
  if (!uuid.test(input.turnId||"")) fail("TURN_ID_REQUIRED");
  if (typeof input.question!=="string" || Array.from(input.question).length>10000) fail("INVALID_MESSAGE");
  const action=input.guided?.native?.kind?input.guided.native:null;
  const requestHash=hash({question:input.question,action,variantId:input.variantId,
    categoryId:input.categoryId,stageId:input.stageId,launchHint:input.launchHint});
  const receipt=s.turns[input.turnId];
  if (receipt) {
    if(receipt.requestHash!==requestHash)fail("TURN_ID_CONFLICT",409);
    return {...structuredClone(receipt.response),turn:{...receipt.response.turn,replayed:true},_historyEnvelope:s.outbox};
  }
  if(s.outbox)fail("HISTORY_DELIVERY_PENDING",409);
  if((s.revision>0 || saved?.lastResponse) && (!input.conversation ||
    input.conversation.sessionId!==s.id || input.conversation.revision!==s.revision))fail("STALE_STATE",409);
  profile.prepare?.(s,input,profile);
  if(action) {
    const c=current(s),r=selected(c),p=s.pending;
    if(action.sessionId!==s.id || action.nonce!==s.nonce || action.revision!==s.revision ||
      action.episodeId!==c.id || action.roundId!==c.id || action.kind!=="answer" ||
      p?.kind!=="request_fact" || action.questionId!==p.id || p.requestId!==r?.id ||
      !values.includes(action.value))fail("STALE_ACTION",409);
    record(s,c,r,p.field,action.value,{kind:"button",turnId:input.turnId,questionId:p.id});
    s.pending=null;
  } else if (!showAdvice(input.question)) applyText(s,input,profile);
  plan(s,profile);
  s.revision++;
  s.nonce=randomUUID();
  const result=response(s,profile,render,!action && showAdvice(input.question),historyAvailable),messageId=randomUUID();
  result.turn={turnId:input.turnId,revision:s.revision,replayed:false,messageId};
  s.outbox={turnId:input.turnId,messageId,createdAt:new Date().toISOString(),
    question:input.question,answer:[result.answer.content,...result.answer.next.map(x=>x.questionText)].join("\n\n"),
    category:profile.category.id,responseId:result.presentation.responseId};
  s.turns[input.turnId]={requestHash,response:result};
  s.lastResponse=result;
  await atomic(file,s);
  return {...structuredClone(result),_historyEnvelope:s.outbox};
}

function updateDocuments(s,c,r,text,source,profile) {
  const observations=documentObservations(text,{explicitFocus:source.focusSelection===true});
  if(!observations.length)return;
  if(!r.documentFacts) {
    r.documentFacts=[];
    for(const fact of s.factLedger.filter(f=>f.caseId===c.id&&f.subjectId===r.id&&profile.fields.shared.includes(f.field)&&['active','conflicted'].includes(f.status))) {
      const observations=(fact.source?.kind==='user_text'?documentObservations(fact.source.quote||'',{explicitFocus:fact.source.focusSelection===true}):[]).filter(o=>o.operation!=='withdraw'&&o.value===fact.value&&((o.type==='report')===(fact.field===profile.fields.shared[0])));
      for(const o of observations)r.documentFacts.push({id:randomUUID(),type:o.type,value:o.value,status:fact.status,operation:'rebase',source:{...fact.source,rebasedFromFactId:fact.id,clause:o.quote}});
      if(!observations.length) {
        (r.unresolvedSharedHistory ||= []).push({field:fact.field,factId:fact.id,reason:'No trusted component source; partial withdrawal cannot erase unbound alternatives.'});
      }
    }
  }
  const affected=new Set();
  for(const observation of observations) {
    const field=observation.type==='report'?profile.fields.shared[0]:profile.fields.shared[1];
    affected.add(field);
    const previous=r.documentFacts.filter(f=>f.type===observation.type&&['active','conflicted'].includes(f.status));
    const old=previous.at(-1);
    const origin={...source,clause:observation.quote};
    if(observation.operation==='withdraw') {
      for(const f of previous)f.status='withdrawn';
      r.documentFacts.push({id:randomUUID(),type:observation.type,operation:'withdraw',status:'withdrawal',source:origin});
      continue;
    }
    const correction=observation.operation==='correct';
    if(!correction&&old?.status==='active'&&(old.value===observation.value||(old.value!==null&&observation.value===null)))continue;
    const conflict=!correction&&previous.some(f=>f.status==='conflicted'||(f.value!==null&&observation.value!==null&&f.value!==observation.value));
    for(const f of previous)f.status=conflict?'conflicted':'superseded';
    r.documentFacts.push({id:randomUUID(),type:observation.type,value:observation.value,operation:observation.operation,status:conflict?'conflicted':'active',source:origin});
  }
  for(const field of affected) {
    const relevant=r.documentFacts.filter(f=>(f.type==='report')===(field===profile.fields.shared[0]));
    const active=relevant.filter(f=>f.status==='active');
    const positive=active.filter(f=>f.value===true);
    const previous=s.factLedger.filter(f=>f.caseId===c.id&&f.subjectId===r.id&&f.field===field&&['active','conflicted'].includes(f.status));
    if(positive.length)record(s,c,r,field,true,{...source,projectionOf:positive.map(f=>f.id)},isCorrection(text)||isWithdrawal(text));
    else if(relevant.some(f=>f.status==='conflicted'))for(const f of previous)f.status='conflicted';
    else if(field===profile.fields.shared[0]&&active.length)record(s,c,r,field,active.at(-1).value,{...source,projectionOf:active.map(f=>f.id)},isCorrection(text));
    else if(r.unresolvedSharedHistory?.some(x=>x.field===field)) {
      for(const f of previous)f.status='conflicted';
      (c.unresolvedSources ||= []).push({...source,reason:'Prior shared fact has no trusted component evidence; no component-specific inference made.'});
    } else for(const f of previous)f.status=isWithdrawal(text)?'withdrawn':'invalidated';
  }
  if(isWithdrawal(text)||isCorrection(text))r.descriptionRetracted=true;
}
function unresolved(c,s,source,reason) {
  (c.unresolvedSources ||= []).push({...source,reason});
  c.selectedId=null;c.stopped=true;s.pending=null;
}
function revalidateRequestBindings(s,profile) {
  const c=current(s);let changed=false;
  for(const r of c.requests.filter(r=>(r.stageId||"reports")==="reports")) {
    if(r.id===c.selectedId&&requestIdentity(r).ambiguous){unresolved(c,s,r.sources.at(-1)||{kind:"saved_scope"},"Stored identity contains distinct named addresses/recipients; no guessed sending is projected.");changed=true;}
    if(!r.scope && /^(?:запрос )?(?:акты|отч[её]т|сметы|договор)$/iu.test(r.label.trim())) {
      const others=c.requests.filter(x=>x.id!==r.id);
      const resolution=resolveRequest(others,r.label);
      if(r.id===c.selectedId&&resolution.kind==='ambiguous') {
        unresolved(c,s,r.sources.at(-1)||{kind:'saved_scope'},'Legacy bare description matches several requests; no stored sending value is assigned to a guessed subject.');changed=true;
      }
    }
    const refusalFacts=s.factLedger.filter(f=>f.caseId===c.id&&f.subjectId===r.id&&f.field===profile.fields.refused&&['active','conflicted'].includes(f.status));
    let invalidated=false;
    for(const fact of refusalFacts.filter(f=>f.source?.kind==='user_text')) {
      const assessment=refusalEvidence(fact.source.quote||'',true);
      if(assessment.foreignObjects.length && !assessment.documentValues.length) {
        fact.status='invalidated';fact.invalidatedBy='MC21-F03-unrelated-refusal-object';changed=true;invalidated=true;
      }
    }
    if(invalidated) {
      const valid=refusalFacts.filter(f=>f.status!=='invalidated'&&((f.source?.kind==='button'&&f.source.questionId)||(f.source?.questionId&&shortAnswer(f.source?.quote||''))||refusalEvidence(f.source?.quote||'',true).value===f.value));
      const known=[...new Set(valid.map(f=>f.value).filter(v=>v!==null))];
      if(known.length<=1&&valid.length){const winner=(known.length?valid.filter(f=>f.value===known[0]):valid).at(-1);for(const f of valid)f.status=f===winner?'active':'superseded';}
    }
  }
  return changed;
}
