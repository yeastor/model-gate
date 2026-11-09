import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createConversationService } from "./service.mjs";
import { atomic, identityKey } from "./state.mjs";
import { requestProfile } from "./request-profile.mjs";
import { requestAnswer, requestFacts } from "./focused-request.mjs";
import { createScopedQuestionCatalog } from "./questions.mjs";
import { requestValue, unambiguous, sameRequest, refersToSelected, sharedValues, documentTypes } from "./request-evidence.mjs";

const profile = await requestProfile({categoryId:"management_company",stageId:"reports"},null);
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"mc-request-dm-"));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const id=randomUUID(),userId="81",file=path.join(dir,"conversation-sessions-v2",identityKey(userId,id)+".json");
  let service,response;
  const restart=()=>service=createConversationService({dataDir:dir,
    getActive:async()=>{throw Error("PPS must not be loaded for MC");},
    getBundle:async()=>{throw Error("PPS must not be loaded for MC");}});
  restart();
  const f={
    id,userId,file,restart,
    get response(){return response;},
    async state(){return JSON.parse(await fs.readFile(file,"utf8"));},
    async raw(input){return service.respond({id,userId,...input});},
    async send(question,extra={}) {
      response=await service.respond({id,userId,categoryId:"management_company",stageId:"reports",
        protocolVersion:2,turnId:randomUUID(),question,conversation:response?.conversation,...extra});
      if(response.turn)await service.internal({id,userId,turnId:response.turn.turnId},"ack");
      return response;
    },
    async resume(extra={}){response=await service.respond({id,userId,categoryId:"management_company",stageId:"reports",resume:true,...extra});if(response._historyEnvelope)await f.ack(response._historyEnvelope.turnId);return response;},
    async button(value){const b=response.answer.next.flatMap(x=>x.view).find(x=>x.guided.native.value===value);assert(b,"button exists");return f.send(b.question,{guided:b.guided});},
    async ack(turnId){return service.internal({id,userId,turnId},"ack");},
    async internal(op,extra={}){return service.internal({id,userId,...extra},op);},
  };
  return f;
}
const current=s=>s.requestDialogue.cases.find(c=>c.id===s.requestDialogue.caseId);
const pending=r=>r.answer.next[0]?.questionText||"";
const facts=async f=>requestFacts(await f.state(),profile);

test("one named request: dynamic text, full answer, three direct values",async t=>{
  for(const [value,id] of [[true,"v08"],[false,"v03"],[null,"v03"]]) {
    const f=await fixture(t);
    let r=await f.send("Я просил акты ремонта за сентябрь в УК.");
    assert.match(pending(r),/акты ремонта за сентябрь в УК/u);
    assert.equal(current(await f.state()).used,1);
    r=await f.button(value);
    assert.equal((await facts(f)).written_document_request_sent,value);
    assert.equal(r.answer.variantId,"management_company_reports_"+id);
    if (value === true) assert.match(r.answer.content,/Перечислите договор/u);
    else { assert.equal(r.presentation.kind,"full"); assert.equal(r.presentation.referencesResponseId,undefined); assert.match(r.answer.content,/Перечислите договор/u); }
    assert.equal(current(await f.state()).used,2);
    await f.button(null);
    assert.equal(f.response.answer.next.length,0);
  }
});
test("two current requests: scope first; no sending aggregate; retain both actions",async t=>{
  const f=await fixture(t);
  let r=await f.send("Нужны годовой отчёт и акты. Годовой отчёт я запросил письменно. Акты я просил только устно.");
  assert.match(r.answer.content,/Какой один запрос/u);
  assert.equal(r.answer.next.length,0);
  assert.equal((await facts(f)).written_document_request_sent,undefined);
  assert.equal(r.answer.variantId,"management_company_reports_v13");
  r=await f.send("Акты");
  assert.equal((await facts(f)).written_document_request_sent,false);
  assert.match(pending(r),/прямой отказ/u);
  assert.equal(current(await f.state()).used,2);
  assert.equal(r.presentation.kind,"full");
  assert.equal(r.presentation.referencesResponseId,undefined);
});
test("ambiguous initial need: focus plus B02 consumes two; no refusal third",async t=>{
  const f=await fixture(t);
  await f.send("Мне нужны отчёт и акты.");
  const r=await f.send("Акты ремонта за сентябрь в УК");
  assert.match(pending(r),/Вы уже отправили/u);
  assert.equal(current(await f.state()).used,2);
  await f.button(true);
  assert.equal(f.response.answer.next.length,0);
  assert.equal((await facts(f)).written_document_request_sent,true);
});
test("focus confusion is not unknown sending or asked-null",async t=>{
  const f=await fixture(t);
  await f.send("Нужны отчёт и акты.");
  await f.send("Не знаю, о каком из двух запросов речь.");
  assert.equal((await facts(f)).written_document_request_sent,undefined);
  assert.equal((await f.state()).factLedger.length,0);
  assert.equal(f.response.answer.next.length,0);
});
test("missing period and recipient are not invented or required",async t=>{
  const f=await fixture(t);
  const r=await f.send("Разбираем мой единственный запрос актов");
  assert.match(pending(r),/мой единственный запрос актов/u);
  assert.doesNotMatch(pending(r),/сентябр|в УК/u);
});
test("article entry starts empty, including true source masks",async t=>{
  const f=await fixture(t);
  const r=await f.resume({variantId:"management_company_reports_v16"});
  assert.equal(r.answer.variantId,"management_company_reports_v01");
  assert.match(r.answer.content,/Какой один запрос/u);
  assert.equal((await f.state()).factLedger.length,0);
});
test("source mask and guided.context never seed facts",async t=>{
  const f=await fixture(t);
  const r=await f.send("Нужны документы.",{variantId:"management_company_reports_v16",
    guided:{categoryId:"management_company",stageId:"reports",context:{written_document_request_sent:true}}});
  assert.equal(r.answer.variantId,"management_company_reports_v01");
});
test("switching request keeps history and case budget, stale button rejected",async t=>{
  const f=await fixture(t);
  let r=await f.send("Разбираем запрос актов за сентябрь");
  const old=r.answer.next[0].view[0].guided;
  await f.button(true);
  r=await f.send("Теперь разбираем запрос отчёта за октябрь");
  assert.equal((await facts(f)).written_document_request_sent,undefined);
  assert.equal(current(await f.state()).used,2);
  assert.equal(r.answer.next.length,0);
  await assert.rejects(()=>f.send("Да",{guided:old}),/STALE_ACTION/);
  assert((await f.state()).factLedger.some(x=>x.field==="written_document_request_sent"&&x.value===true));
});
test("repeat/resume/restart do not ask again or reset budget",async t=>{
  const f=await fixture(t);
  await f.send("Разбираем запрос актов");
  await f.button(null);
  const before=await f.state();
  f.restart();
  await f.resume();
  assert.equal(current(await f.state()).used,2);
  assert.deepEqual((await f.state()).factLedger,before.factLedger);
});
test("request replay is idempotent; changed body with same turn rejected",async t=>{
  const f=await fixture(t),turnId=randomUUID();
  const input={categoryId:"management_company",stageId:"reports",question:"Разбираем запрос актов",turnId};
  const a=await f.raw(input),b=await f.raw(input);
  assert.equal(b.turn.replayed,true);
  assert.deepEqual(a.answer,b.answer);
  await assert.rejects(()=>f.raw({...input,question:"Другой запрос"}),/TURN_ID_CONFLICT/);
  assert.equal(current(await f.state()).used,1);
});
test("outbox prevents unsaved next turn and supports delivery acknowledgement",async t=>{
  const f=await fixture(t);
  const a=await f.raw({categoryId:"management_company",stageId:"reports",question:"Разбираем запрос актов",turnId:randomUUID()});
  assert((await f.internal("pending")).historyEnvelope.answer.includes("Вы уже отправили"));
  await assert.rejects(()=>f.raw({question:"Да",turnId:randomUUID(),conversation:a.conversation}),/HISTORY_DELIVERY_PENDING/);
  await f.ack(a.turn.turnId);
  assert.equal((await f.internal("pending")).historyEnvelope,null);
});
test("delete leaves tombstone; another user cannot reuse controls",async t=>{
  const f=await fixture(t),r=await f.send("Разбираем запрос актов");
  await assert.rejects(()=>f.raw({userId:"82",categoryId:"management_company",stageId:"reports",
    question:"Да",turnId:randomUUID(),guided:r.answer.next[0].view[0].guided}),/STALE_ACTION/);
  await f.internal("delete");
  await assert.rejects(()=>f.resume(),/CHAT_DELETED/);
});
test("old state revision and forged question are rejected",async t=>{
  const f=await fixture(t),r=await f.send("Разбираем запрос актов");
  const a=r.answer.next[0].view[0].guided;
  await assert.rejects(()=>f.send("Да",{conversation:{sessionId:r.conversation.sessionId,revision:42}}),/STALE_STATE/);
  await assert.rejects(()=>f.send("Да",{guided:{...a,native:{...a.native,questionId:randomUUID()}}}),/STALE_ACTION/);
});
test("known sending skips B02; lost copy, delivery unknown, oral draft distinct",async t=>{
  for(const [text,expected] of [
    ["Я отправил запрос актов за сентябрь в УК. Копию потерял.",true],
    ["Я отправил запрос актов в УК. Дошло ли письмо, не знаю.",true],
    ["Запрос актов не отправлял, остался черновик.",false],
    ["Акты я просил только устно.",false],
    ["Разбираем запрос актов. Не помню, отправлял ли запрос.",null],
  ]) {
    const f=await fixture(t),r=await f.send(text);
    assert.equal((await facts(f)).written_document_request_sent,expected,text);
    assert.match(pending(r),/прямой отказ/u);
  }
});
test("explicitly one combined request is allowed, independent requests not aggregated",async t=>{
  const f=await fixture(t);
  await f.send("В одном письме я запросил годовой отчёт и акты письменно.");
  assert.equal((await facts(f)).written_document_request_sent,true);
  for(const text of ["Нужны акты за сентябрь и октябрь.","Нужны отчёт и акты.","Запрос актов прежней УК и запрос актов новой УК."])
    assert.equal(unambiguous(text),false,text);
});
test("negatives: hypotheses, other person, quoted instructions do not establish sending",async t=>{
  for(const text of [
    "Если я отправил запрос актов, что делать?",
    "Сосед отправил запрос актов.",
    "Муж отправил запрос актов.",
    "Иван отправил запрос актов.",
    "Он сказал: «Я отправил запрос актов».",
    "В статье сказано: я отправил запрос актов.",
    "Например, я отправил запрос актов.",
  ]) {
    const f=await fixture(t); await f.send(text);
    assert.equal((await facts(f)).written_document_request_sent,undefined,text);
  }
});
test("correction, withdrawal, and contradiction keep independent help",async t=>{
  const f=await fixture(t);
  await f.send("Я отправил запрос актов.");
  await f.send("Исправляю: этот запрос не отправлял.");
  assert.equal((await facts(f)).written_document_request_sent,false);
  await f.send("Этот запрос я отправил.");
  assert.equal((await facts(f)).written_document_request_sent,undefined);
  assert.match(f.response.answer.content,/противоречат/u);
  assert.equal((await facts(f)).management_or_work_documents_requested,true);
  await f.send("Исправляю: этот запрос я отправил.");
  assert.equal((await facts(f)).written_document_request_sent,true);
  await f.send("Отзываю свои слова об отправке этого запроса.");
  assert.equal((await facts(f)).written_document_request_sent,undefined);
});
test("new case needs explicit user declaration; no earlier request facts",async t=>{
  const f=await fixture(t);
  await f.send("Я отправил запрос актов.");
  const first=current(await f.state()).id;
  await f.send("Новый случай: запрос отчёта по другому дому");
  const s=await f.state();
  assert.notEqual(current(s).id,first);
  assert.equal((await facts(f)).written_document_request_sent,undefined);
  assert.equal(s.requestDialogue.cases.length,2);
});
test("16 existing contexts x three values preserve exact full targets",async t=>{
  for(const row of profile.stage.variants) for(const value of [true,false,null]) {
    const f=await fixture(t);
    await f.send("Разбираем запрос актов");
    const s=await f.state(),c=current(s),r=c.requests[0];
    for(const [field,v] of Object.entries(row.context))
      if(v===true && field!==profile.fields.sent)
        s.factLedger.push({id:randomUUID(),caseId:c.id,subjectId:r.id,field,value:true,
          status:"active",source:{kind:"test_fixture",quote:"Explicit independent trusted scenario"}});
    await atomic(f.file,s);
    await f.button(value);
    const state=await f.state(),target=requestAnswer(state,profile);
    const expected=Object.fromEntries(Object.entries(row.context).filter(([,v])=>v===true));
    expected[profile.fields.sent]=value;
    const sig=Object.keys(expected).filter(k=>expected[k]===true).sort().join("|");
    const match=profile.stage.variants.find(r=>Object.entries(r.context).filter(([,v])=>v===true).map(([k])=>k).sort().join("|")===sig);
    assert.equal(target.variant_id,match.variant_id);
    assert.deepEqual(target.payload.answer,match.payload.answer);
    assert.equal(f.response.answer.variantId,match.variant_id);
    if (f.response.presentation.kind === "full") assert.match(f.response.answer.content,new RegExp(match.payload.answer.now.slice(0,25),"u"));
    else assert.ok(f.response.presentation.referencesResponseId);
  }
});
test("MC supported stages resolve and foreign entry fails closed",async()=>{
  assert.equal((await requestProfile({categoryId:"management_company",stageId:"change_uk"},null)).stage.stage.id,"change_uk");
  await assert.rejects(()=>requestProfile({categoryId:"management_company",stageId:"reports",variantId:"management_company_change_uk_v01"},null),/REQUEST_ENTRY_UNAVAILABLE/);
});

test("late direct fact and unknown do not discard earlier confirmed sending",async t=>{
  const f=await fixture(t);
  await f.send("Разбираем запрос актов");
  await f.send("Я отправил запрос актов.");
  assert.equal((await facts(f)).written_document_request_sent,true);
  await f.send("Не помню, отправлял ли этот запрос.");
  assert.equal((await facts(f)).written_document_request_sent,true);
});
test("two windows cannot apply the same pending question twice",async t=>{
  const f=await fixture(t),r=await f.send("Разбираем запрос актов");
  const action=r.answer.next[0].view[0].guided;
  const payload={question:"Да",guided:action,conversation:r.conversation};
  const results=await Promise.allSettled([f.raw({...payload,turnId:randomUUID()}),f.raw({...payload,turnId:randomUUID()})]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
  assert.equal((await f.state()).factLedger.filter(x=>x.field==="written_document_request_sent").length,1);
});
test("expired package, cross-category history and malformed values fail closed",async t=>{
  const f=await fixture(t),r=await f.send("Разбираем запрос актов");
  const action=r.answer.next[0].view[0].guided;
  await assert.rejects(()=>f.send("Да",{guided:{...action,native:{...action.native,value:"true"}}}),/STALE_ACTION/);
  await assert.rejects(()=>f.send("Да",{categoryId:"pps"}),/CATEGORY_SESSION_MISMATCH/);
  const s=await f.state();s.requestDialogue.version="old";await atomic(f.file,s);
  await assert.rejects(()=>f.resume(),/PINNED_REQUEST_PACKAGE_UNAVAILABLE/);
});


test("audit: acts and estimates cannot inherit each other's sending or refusal",async t=>{
  assert.equal(sameRequest([{id:"a",label:"Я отправил запрос актов"}],"Сметы"),null);
  assert.equal(refersToSelected("Я отправил запрос смет.","Запрос актов"),false);
  const f=await fixture(t);
  await f.send("Я отправил запрос актов.");
  assert.equal((await facts(f)).written_document_request_sent,true);
  await f.send("Теперь разбираем сметы");
  assert.equal((await facts(f)).written_document_request_sent,undefined);
  assert.equal(current(await f.state()).requests.length,2);
  assert.equal(current(await f.state()).used,2);
  await f.button(false);
  const state=await f.state();
  assert.equal(requestFacts(state,profile).written_document_request_sent,false);
  assert.ok(state.factLedger.some(f=>f.field==="written_document_request_sent" && f.value===true));
});
test("audit: no host visibility proof gives full advice; explicit show and changed facts do",async t=>{
  const f=await fixture(t),first=await f.send("Разбираем запрос актов");
  const before=current(await f.state()).used;
  let r=await f.button(null);
  assert.equal(r.presentation.kind,"full");
  assert.equal(r.presentation.referencesResponseId,undefined);
  assert.match(r.answer.content,/Пункты 31–33/u);
  r=await f.send("Покажите памятку");
  assert.equal(r.presentation.kind,"full");
  assert.match(r.answer.content,/Пункты 31–33/u);
  assert.equal(current(await f.state()).used,before+1);
  f.restart();
  r=await f.resume();
  assert.equal(r.presentation.kind,"full");
  await f.button(null);
  r=await f.send("Я отправил запрос актов.");
  assert.equal(r.presentation.kind,"full");
  assert.equal(current(await f.state()).used,2);
});
test("audit: report kind and event scope come only from explicit evidence",()=>{
  assert.deepEqual(sharedValues("Я запросил отчёт о пожаре письменно."),{});
  assert.equal(sharedValues("Я запросил годовой отчёт письменно.").annual_report_requested,true);
  assert.deepEqual(sharedValues("Я не отправил запрос актов."),{});
  assert.deepEqual(documentTypes("Я хочу активно действовать"),[]);
  assert.equal(unambiguous("Запрос актов за 2024 и 2025 годы"),false);
  assert.equal(unambiguous("В одном запросе акты за 2024 и 2025 годы"),true);
  assert.equal(requestValue("Я отправил запрос актов. Я не отправил запрос актов.",profile.fields.sent),undefined);
});
test("audit: supported stage aliases load and unknown targets fail closed",async()=>{
  for (const stage of ["no_response","poor_services","common_property","bills_wrong","meetings_protocol","emergency_house_condition","change_uk"])
    assert.equal((await requestProfile({launchHint:{categoryId:"management_company",stageId:stage}},null)).stage.stage.id,stage);
  await assert.rejects(()=>requestProfile({categoryId:"management_company",stageId:"unknown_stage"},null),/REQUEST_STAGE_UNSUPPORTED/);
  await assert.rejects(()=>requestProfile({variantId:"management_company_reports_v01",guided:{entryVariantId:"pps_x"}},null),/REQUEST_ENTRY_UNAVAILABLE/);
  const p=structuredClone(Object.fromEntries(Object.entries(profile).filter(([,v])=>typeof v!=="function")));
  p.stage.variants=p.stage.variants.filter(r=>r.variant_id!=="management_company_reports_v16");
  assert.throws(()=>createScopedQuestionCatalog(p),/QUESTION_TARGET_UNAVAILABLE/);
  const dup=structuredClone(Object.fromEntries(Object.entries(profile).filter(([,v])=>typeof v!=="function")));dup.questions.push(dup.questions[0]);
  assert.throws(()=>createScopedQuestionCatalog(dup),/QUESTION_DUPLICATE/);
});


test("audit: conflicting category selectors never fall through to PPS",async()=>{
  for (const input of [
    {categoryId:"pps",launchHint:{categoryId:"management_company",stageId:"reports"}},
    {categoryId:"pps",guided:{categoryId:"management_company"}},
    {variantId:"pps_x",guided:{entryVariantId:"management_company_reports_v01"}},
  ]) await assert.rejects(()=>requestProfile(input,null),/CATEGORY_SESSION_MISMATCH|REQUEST_ENTRY_UNAVAILABLE/);
});
