import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createConversationService } from "./service.mjs";
import { createExplicitEngine } from "../explicit/engine.mjs";
import { interpretTurn } from "./interpret.mjs";
import { dialoguePackage } from "./package.mjs";
import { createQuestionCatalog } from "./questions.mjs";
import { fresh, episode, newRound, recordFact, project, atomic, identityKey,
  caseQuestionsUsed, canServeQuestion, serveQuestion, resolveBagReference,
  selectBag, ensureCaseState } from "./state.mjs";
const bundle = JSON.parse(await fs.readFile(process.env.CATEGORY_FULL_FIXTURE ||
  new URL("../../../../../category_next_document_json/pps/category/pps.final.json", import.meta.url), "utf8"));
const traces = [];
after(async () => {
  if (process.env.PPS_DM_TRACE_FILE)
    await fs.writeFile(process.env.PPS_DM_TRACE_FILE, JSON.stringify(traces, null, 2) + "\n");
});
function criterion(id, detail, run) {
  test(id + " " + detail, async t => {
    const trace = { id, detail, steps: [], status: "RUNNING" }; traces.push(trace);
    try { await run(t, trace); trace.status = "PASS"; }
    catch (e) { trace.status = "FAIL"; trace.error = { message: e.message, stack: e.stack }; throw e; }
  });
}
const snapshot = s => ({ caseState: structuredClone(s.caseState),
  activeEpisodeId: s.activeEpisodeId, episodes: structuredClone(s.episodes),
  pending: structuredClone(s.pending), round: structuredClone(s.round),
  facts: structuredClone(s.factLedger), engine: structuredClone(s.engine),
  questionOutcome: structuredClone(s.questionOutcome), nonce: s.nonce, revision: s.revision });
async function fixture(t, trace, initial = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pps-continuity-"));
  t.after(async () => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const userId = "81", id = randomUUID(), s = fresh(userId, id, dialoguePackage.categorySha256), e = episode(s);
  e.actor = initial.actor ?? "police"; e.stageId = initial.stageId || null;
  e.stageConfirmedByUser = !!initial.stageId; newRound(s, "fixture");
  for (const [k,v] of Object.entries(initial.facts || {})) recordFact(s,k,v,{kind:"user_text",turnId:"prior",quote:initial.priorQuote || "Prior synthetic user report"});
  const file = path.join(dir,"conversation-sessions-v2",identityKey(userId,id)+".json");
  await atomic(file,s);
  const options = {dataDir:dir,getActive:async()=>({sha256:dialoguePackage.categorySha256}),getBundle:async()=>bundle,search:initial.search || (async()=>[])};
  let service = createConversationService(options), response;
  const f = {
    async state(){return JSON.parse(await fs.readFile(file,"utf8"));},
    async mutate(run){const x=await f.state();await run(x);await atomic(file,x);},
    async send(question,extra={},acknowledge=true){
      const input={id,userId,protocolVersion:2,turnId:randomUUID(),question,
        conversation:response?.conversation || {sessionId:s.id,revision:0},...extra};
      f.lastInput=input;
      try {
        response=await service.respond(input); f.response=response;
        trace.steps.push({input, response:structuredClone(response), state:snapshot(await f.state())});
        if(acknowledge) await service.internal({id,userId,turnId:response.turn.turnId},"ack");
        return response;
      } catch(error){trace.steps.push({input,error:error.message,state:snapshot(await f.state())});throw error;}
    },
    async button(value){const b=response.answer.next.flatMap(g=>g.view).find(v=>v.guided?.native.value===value);assert.ok(b,"button exists");return f.send(b.question,{guided:b.guided});},
    async acknowledge(){await service.internal({id,userId,turnId:f.response.turn.turnId},"ack");},
    async retry(){const r=await service.respond(f.lastInput);trace.steps.push({retry:true,response:r,state:snapshot(await f.state())});return r;},
    async resume(){response=await service.respond({id,userId,resume:true});f.response=response;trace.steps.push({resume:true,response,state:snapshot(await f.state())});return response;},
    restart(){service=createConversationService(options);trace.steps.push({restart:true});},
  };return f;
}
const field = (s,stage,name) => project(s,stage)["pps."+stage+"."+name];
const assertHelp = r => {assert.ok(r.answer.variantId);assert.doesNotMatch(r.answer.content,/пока не удалось подобрать/);};
const hit = stage => ({score:.82,payload:{source_sha256:dialoguePackage.categorySha256,category:{id:"pps"},stage:{id:stage},variant_id:stage==="street_stop"?"pps_street_stop_v12":"pps_identity_check_v1"}});
const noQuestions = s => {assert.equal(s.pending,null);assert.ok(caseQuestionsUsed(s)<=2);};
const ncases = [
 ["N01","Сотрудник полиции запретил мне уходить, но руками не держит.",true],
 ["N02","Сотрудник полиции говорит, что можно уйти, но преграждает мне выход.",true],
 ["N03","Не знаю, что он сказал, но сотрудник полиции держит меня за руку и не выпускает.",true],
 ["N04","Меня не держит.",undefined],
 ["N05","Сотрудник полиции разрешил свободно уйти и не удерживает меня.",false],
 ["N06","Не могу уйти.",undefined],
 ["N07","Мне плохо, поэтому не могу уйти.",undefined],
 ["N08","Если сотрудник полиции запретит мне уйти, что делать?",undefined],
 ["N09","Сотрудник удерживает другого прохожего, меня не удерживает.",undefined],
 ["N10","Сотрудник полиции попросил подождать, но разрешил отказаться и уйти.",false],
];
for (const stage of ["street_stop","delivery_to_station"]) for (const [id,text,want] of ncases)
 criterion(id,stage,async(t,tr)=>{
  const s=fresh("1","synthetic",dialoguePackage.categorySha256),e=episode(s);e.actor="police";e.stageId=stage;
  const parsed=interpretTurn(s,text,randomUUID());
  tr.steps.push({text,stage,parsed});
  const facts=parsed.facts.filter(x=>x.field.endsWith(".free_to_leave_denied"));
  assert.deepEqual(facts.map(x=>x.value),want===undefined?[]:[want]);
  assert.ok(facts.every(x=>x.field===stage+".free_to_leave_denied"));
 });
criterion("N11","correction versus conflicting assertion",async(t,tr)=>{
 for(const correction of [true,false]){
  const f=await fixture(t,tr,{stageId:"street_stop",facts:{"pps.street_stop.free_to_leave_denied":true}});
  await f.send((correction?"Я ошибся: ":"")+"сотрудник полиции разрешил свободно уйти и не удерживает меня.");
  const s=await f.state();assert.equal(field(s,"street_stop","free_to_leave_denied"),correction?false:null);
  assert.ok(s.factLedger.some(x=>x.operation===(correction?"correct":"assert") && x.status===(correction?"active":"conflicted")));
 }
});
criterion("N12","unrelated unknown retains known restriction",async(t,tr)=>{
 const f=await fixture(t,tr,{stageId:"street_stop",facts:{"pps.street_stop.free_to_leave_denied":true}});
 await f.send("Не знаю, какой документ он составляет.");assert.equal(field(await f.state(),"street_stop","free_to_leave_denied"),true);
});
criterion("N13","state change preserves history and case",async(t,tr)=>{
 const f=await fixture(t,tr,{stageId:"street_stop",facts:{"pps.street_stop.free_to_leave_denied":true}}),before=await f.state();
 await f.send("Теперь сотрудник разрешил уйти и больше не удерживает.");const s=await f.state();
 assert.equal(field(s,"street_stop","free_to_leave_denied"),false);assert.equal(s.caseState.id,before.caseState.id);
 assert.ok(s.factLedger.some(x=>x.value===true && x.status==="superseded"));
});
async function exhausted(t,tr){const f=await fixture(t,tr);await f.send("Полицейские пытаются войти в мою квартиру.");await f.button(true);await f.button(false);assert.equal(caseQuestionsUsed(await f.state()),2);return f;}
criterion("B01","source/supplemental shared allowance",async(t,tr)=>{
 const f=await exhausted(t,tr);const s=await f.state();assert.ok(s.caseState.served.some(x=>x.questionId.startsWith("dm.")));
 assertHelp(await f.send("Полицейский досматривает мою сумку."));noQuestions(await f.state());
});
criterion("B02","actor and routing consume both slots",async(t,tr)=>{
 const f=await fixture(t,tr,{actor:"unknown",search:async()=>[hit("street_stop")]});
 await f.send("Меня остановил сотрудник");assert.equal((await f.state()).pending.key,"police_actor");
 await f.button(true);assert.equal((await f.state()).pending.key,"retrieval_stage");
 assertHelp(await f.button(true));noQuestions(await f.state());assert.equal(caseQuestionsUsed(await f.state()),2);
});
criterion("B03","every same-case newRound producer cannot replenish",async(t,tr)=>{
 const f=await exhausted(t,tr);const c=(await f.state()).caseState.id;
 for(const text of ["Полицейский угрожает мне.","Полицейский бьёт меня.","Полицейский везёт меня в отдел.","Он требует телефон.","Полицейский просит написать объяснение.","Составляют новое объяснение.","Полицейский забрал документы.","Полицейский досматривает мою вторую сумку."]){
  const r=await f.send(text),s=await f.state();assert.equal(s.caseState.id,c);assert.equal(caseQuestionsUsed(s),2);assert.equal(s.pending,null);assertHelp(r);
 }
 const s=await f.state();for(const trigger of ["routing:x","question-investigation:x","article","new-document","new-force","document-taking:x","stage:bag_search"]){newRound(s,trigger);assert.equal(caseQuestionsUsed(s),2);tr.steps.push({directResetProbe:trigger,state:snapshot(s)});}
});
criterion("B04","unknown scoped answer survives paraphrase/reload/rebase",async(t,tr)=>{
 const f=await fixture(t,tr);await f.send("Полицейский остановил меня на улице.");const p=(await f.state()).pending;
 await f.send("Не знаю");const count=caseQuestionsUsed(await f.state());f.restart();await f.resume();
 await f.mutate(s=>{s.policyVersion="synthetic-old-version";});await f.send("Что делать дальше?");
 const s=await f.state();assert.equal(field(s,"street_stop",p.question.field_key),null);assert.equal(caseQuestionsUsed(s),count);
 assert.notEqual(s.pending?.question.id,p.question.id);
});
criterion("B05","idempotent delivery and resume",async(t,tr)=>{
 const f=await fixture(t,tr);await f.send("Полицейский остановил меня на улице.");const s=await f.state();
 const replay=await f.retry();assert.equal(replay.turn.replayed,true);f.restart();await f.resume();
 const after=await f.state();assert.deepEqual(after.caseState.served,s.caseState.served);assert.equal(caseQuestionsUsed(after),1);assert.ok(after.pending.receiptId);
 const g=await fixture(t,tr);await g.send("Полицейский остановил меня на улице.",{},false);
 const pending=await g.state();assert.ok(pending.outbox);const replayWithOutbox=await g.retry();
 assert.deepEqual(replayWithOutbox._historyEnvelope,pending.outbox);assert.deepEqual((await g.state()).caseState.served,pending.caseState.served);
 await assert.rejects(()=>g.send("Следующее сообщение до доставки истории."),/HISTORY_DELIVERY_PENDING/);
 await g.acknowledge();assert.equal((await g.state()).outbox,null);tr.steps.push({queuedOutbox:pending.outbox,replayedEnvelope:replayWithOutbox._historyEnvelope});
});
criterion("B06","suppressed proposal never charged",async(t,tr)=>{
 const s=fresh("1","proposal",dialoguePackage.categorySha256),e=episode(s);e.actor="police";e.stageId="street_stop";e.stageConfirmedByUser=true;newRound(s,"test");
 const catalog=createQuestionCatalog(createExplicitEngine(bundle));
 const bad={kind:"catalog",question:{id:"unregistered",question:"Bad?"}};assert.equal(catalog.plan(s,bad).admitted,false);assert.equal(caseQuestionsUsed(s),0);
 const p={key:"describe",kind:"clarification",question:{id:"dm.pps.scope.describe.v1",question:"Что происходит?"}};
 assert.ok(catalog.plan(s,p).admitted);assert.ok(serveQuestion(s,p,"response","turn"));assert.equal(caseQuestionsUsed(s),1);
 assert.equal(catalog.plan(s,bad).admitted,false);assert.equal(caseQuestionsUsed(s),1);tr.steps.push({badPlan:catalog.plan(s,bad),state:snapshot(s)});
});
criterion("B07","approved third fixture and hard fourth ceiling",async(t,tr)=>{
 const s=fresh("1","budget",dialoguePackage.categorySha256);episode(s);newRound(s,"test");
 const p=n=>({kind:"clarification",key:"scope"+n,question:{id:"synthetic.q"+n,question:"Q"+n}});
 for(let n=1;n<=2;n++)assert.ok(serveQuestion(s,p(n),"r"+n,"t"+n));
 assert.equal(canServeQuestion(s,p(3)),false);
 const approved={"synthetic.q3":"Explicit isolated test approval; not production"};assert.ok(serveQuestion(s,p(3),"r3","t3",approved));
 assert.equal(canServeQuestion(s,p(4),{"synthetic.q4":"cannot override absolute3"}),false);assert.equal(caseQuestionsUsed(s),3);
 assert.deepEqual(bundle.metadata.next_policy.third_question_reasons,{});tr.steps.push({state:snapshot(s),approved});
});
criterion("B08","same-incident person change retains allowance",async(t,tr)=>{
 const f=await exhausted(t,tr),id=(await f.state()).caseState.id;await f.send("Теперь про другого человека в этой же ситуации: полицейский проверяет паспорт.");
 const s=await f.state();assert.equal(s.caseState.id,id);assert.equal(caseQuestionsUsed(s),2);assert.equal(s.pending,null);
});
criterion("B09","explicit different incident gets a new case",async(t,tr)=>{
 const f=await exhausted(t,tr),id=(await f.state()).caseState.id;await f.send("Другой случай: вчера меня остановил другой сотрудник полиции.");
 const s=await f.state();assert.notEqual(s.caseState.id,id);assert.ok(s.caseHistory.some(x=>x.id===id));assert.ok(caseQuestionsUsed(s)<=1);assert.equal(project(s,"home_entry")["pps.home_entry.forced_entry_used"],undefined);assert.ok(s.caseState.source.turnId);
});
criterion("B10","legacy incomplete history is never fake zero",async(t,tr)=>{
 const f=await fixture(t,tr,{stageId:"street_stop",facts:{"pps.street_stop.free_to_leave_denied":true}});
 await f.mutate(s=>{delete s.caseState;s.revision=4;});const r=await f.send("Полицейский не разрешает мне уйти.",{conversation:{sessionId:(await f.state()).id,revision:4}});
 const s=await f.state();assert.equal(s.caseState.legacyHistoryComplete,false);assert.equal(s.caseState.baselineUsed,2);assert.equal(s.caseState.served.length,0);assert.equal(s.pending,null);assertHelp(r);
});
criterion("B11","conflict after exhaustion retains compatible help",async(t,tr)=>{
 const f=await exhausted(t,tr);await f.send("Полицейский остановил меня на улице и не разрешает мне уйти.");const r=await f.send("Сотрудник полиции разрешил свободно уйти и не удерживает меня.");
 const s=await f.state();noQuestions(s);assert.equal(field(s,"street_stop","free_to_leave_denied"),null);assertHelp(r);
});
criterion("B12","embedding fallback and new subtopic remain available",async(t,tr)=>{
 const calls=[];const f=await fixture(t,tr,{actor:"unknown",search:async(q,opts)=>{calls.push({q,opts});return [hit("street_stop")];}});
 await f.send("Меня остановил сотрудник");await f.button(true);assertHelp(await f.button(true));
 const r=await f.send("Полицейский требует паспорт.");assertHelp(r);assert.equal((await f.state()).engine.stageId,"identity_check");assert.ok(calls.length);assert.ok(calls.every(x=>!x.opts.hardStageId));tr.steps.push({searchCalls:calls});
});

const opened="pps.bag_search.bag_opened_by_officer";
async function bags(t,tr){
 const f=await fixture(t,tr,{stageId:"bag_search",facts:{[opened]:true},priorQuote:"Сотрудник полиции сам открыл мою сумку."});
 await f.send("Полицейский досматривает мою сумку.");return f;
}
criterion("O01","A event never leaks into second own B",async(t,tr)=>{
 const f=await bags(t,tr),a=(await f.state()).episodes.at(-1).itemId;
 await f.send("Полицейский досматривает вторую мою сумку B; её пока не открывал.");const s=await f.state(),e=s.episodes.at(-1);
 assert.notEqual(e.itemId,a);assert.equal(field(s,"bag_search","bag_opened_by_officer"),undefined);
 assert.ok(s.factLedger.some(x=>x.subjectId===a && x.fieldKey===opened && x.value===true));
 assert.equal(e.items.length,2);assert.ok(e.items.at(-1).sources[0].turnId);
});
criterion("O02","A to B to A restores only A history",async(t,tr)=>{
 const f=await bags(t,tr),a=(await f.state()).episodes.at(-1).itemId,c=(await f.state()).caseState.id;
 const b=await f.send("Полицейский досматривает вторую мою сумку.");assertHelp(b);assert.equal(field(await f.state(),"bag_search","bag_opened_by_officer"),undefined);
 const r=await f.send("Вернёмся к первой моей сумке.");const s=await f.state();assertHelp(r);assert.equal(s.episodes.at(-1).itemId,a);assert.equal(field(s,"bag_search","bag_opened_by_officer"),true);assert.equal(s.caseState.id,c);assert.ok(caseQuestionsUsed(s)<=2);
});
criterion("O03","old A action cannot write B",async(t,tr)=>{
 const f=await bags(t,tr),old=f.response.answer.next.flatMap(g=>g.view).find(x=>x.guided?.native.kind==="answer");assert.ok(old);
 await f.send("Полицейский досматривает вторую мою сумку.");const before=await f.state();
 await assert.rejects(()=>f.send(old.question,{guided:old.guided}),/STALE_ACTION/);
 const s=await f.state();assert.deepEqual(s.factLedger,before.factLedger);assert.deepEqual(s.caseState.served,before.caseState.served);
});
criterion("O04","friend bag is not a new own object",async(t,tr)=>{
 const f=await bags(t,tr),before=await f.state();await f.send("Полицейский досматривает сумку моего друга.");const s=await f.state();
 assert.equal(s.episodes.at(-1).itemId,before.episodes.at(-1).itemId);assert.equal(s.episodes.at(-1).items.length,1);assert.deepEqual(s.factLedger,before.factLedger);
});
criterion("O05","hypothetical other bag creates no object",async(t,tr)=>{
 const f=await bags(t,tr),before=await f.state();await f.send("Если полицейский откроет другую мою сумку, что делать?");const s=await f.state();
 assert.equal(s.episodes.at(-1).itemId,before.episodes.at(-1).itemId);assert.equal(s.episodes.at(-1).items.length,1);assert.deepEqual(s.factLedger,before.factLedger);
});
criterion("O06","ambiguous pronoun cannot pick A or B",async(t,tr)=>{
 const f=await bags(t,tr);await f.send("Полицейский досматривает вторую мою сумку.");const before=await f.state();
 assertHelp(await f.send("Её уже открыли."));const s=await f.state();assert.deepEqual(s.factLedger,before.factLedger);assert.ok(caseQuestionsUsed(s)<=2);assert.equal(s.pending,null);
 const parsed=interpretTurn(s,"Её уже открыли.","ambiguous");assert.equal(parsed.itemResolution.kind,"ambiguous");assert.ok(!parsed.facts.some(x=>x.field.startsWith("bag_search.")));tr.steps.push({parsed});
});
criterion("O07","completed opening remains event true",async(t,tr)=>{
 const f=await bags(t,tr);assertHelp(await f.send("Сейчас её уже не открывает."));const s=await f.state();assert.equal(field(s,"bag_search","bag_opened_by_officer"),true);assert.ok(s.factLedger.some(x=>x.fieldKey===opened && x.value===true && x.status==="active"));
});
criterion("O08","correction explicitly targets first A",async(t,tr)=>{
 const f=await bags(t,tr),a=(await f.state()).episodes.at(-1).itemId;await f.send("Полицейский досматривает вторую мою сумку.");
 const b=(await f.state()).episodes.at(-1).itemId;
 assertHelp(await f.send("Я ошибся про первую сумку: сотрудник её не открывал и сейчас не открывает."));const s=await f.state();
 assert.equal(s.episodes.at(-1).itemId,a);assert.equal(field(s,"bag_search","bag_opened_by_officer"),false);assert.ok(!s.factLedger.some(x=>x.subjectId===b && x.fieldKey===opened));assert.ok(s.factLedger.some(x=>x.subjectId===a && x.operation==="correct"));
});
criterion("O09","A answered unknown does not become B unknown",async(t,tr)=>{
 const f=await fixture(t,tr,{stageId:"bag_search"});await f.send("Полицейский досматривает мою сумку.");const first=await f.state(),a=first.episodes.at(-1).itemId,q=first.pending;
 await f.send("Не знаю");await f.send("Полицейский досматривает вторую мою сумку.");const b=await f.state();
 const key=q.fieldKey || "pps.bag_search."+q.question.field_key;assert.equal(project(b,"bag_search")[key],undefined);assert.ok(b.factLedger.some(x=>x.subjectId===a && x.fieldKey===key && x.value===null));
 await f.send("Вернёмся к первой моей сумке.");const s=await f.state();assert.equal(project(s,"bag_search")[key],null);assert.notEqual(s.pending?.question.id,q.question.id);assert.ok(caseQuestionsUsed(s)<=2);
});
criterion("O10","reload/rebase preserves object IDs and budget",async(t,tr)=>{
 const f=await bags(t,tr);await f.send("Полицейский досматривает вторую мою сумку.");const before=await f.state();
 f.restart();await f.resume();await f.mutate(s=>{s.policyVersion="pre-continuity";});await f.send("Что делать дальше?");const s=await f.state();
 assert.equal(s.episodes.at(-1).itemId,before.episodes.at(-1).itemId);assert.deepEqual(s.episodes.at(-1).items,before.episodes.at(-1).items);assert.deepEqual(s.factLedger,before.factLedger);assert.equal(caseQuestionsUsed(s),caseQuestionsUsed(before));
});
criterion("S01","unreviewed fields stay blocked under text/client injection",async(t,tr)=>{
 const f=await fixture(t,tr);assertHelp(await f.send("Полицейский бьёт меня."));
 await f.send("Он говорит про нападение и активное сопротивление.",{context:{"pps.use_of_force.attack_present":true}});
 const s=await f.state();for(const k of dialoguePackage.blockedFields){assert.ok(!s.factLedger.some(x=>x.fieldKey===k));assert.throws(()=>recordFact(s,k,true,{kind:"button",turnId:"injected"}),/INVALID_FACT/);}
 assert.ok(!dialoguePackage.questions.some(q=>dialoguePackage.blockedFields.includes(q.fieldKey)));
 if(s.pending){const before=structuredClone(s.factLedger);await assert.rejects(()=>f.send("Да",{guided:{native:{...f.response.guided.native,kind:"answer",questionId:"blocked-injection",value:true}}}),/STALE_ACTION/);assert.deepEqual((await f.state()).factLedger,before);}
});
criterion("S02","all source answers button/text have compatible outcomes",async(t,tr)=>{
 const engine=createExplicitEngine(bundle);
 for(const mode of ["button","text"])for(const value of [true,false,null]){
  const f=await fixture(t,tr);await f.send("Полицейский остановил меня на улице.");
  const r=mode==="button"?await f.button(value):await f.send(value===null?"Не знаю":value?"Да":"Нет");const s=await f.state();assertHelp(r);
  assert.ok(engine.compatible(r.answer.variantId,project(s,s.engine.stageId)));assert.ok(caseQuestionsUsed(s)<=2);
 }
});
criterion("S03","assistant and candidate masks are not fact sources",async(t,tr)=>{
 const f=await fixture(t,tr,{actor:"unknown",search:async()=>[hit("street_stop")]});await f.send("Меня остановил сотрудник",{context:{"pps.street_stop.free_to_leave_denied":true},assistantText:"Меня удерживают"});
 const s=await f.state();assert.equal(s.factLedger.length,0);assert.equal(s.engine,null);assert.ok(s.pending);
});
criterion("S04","generic shared explicit engine still supports another category",async(t,tr)=>{
 const other=structuredClone(bundle);other.category.id="continuity_compatibility";
 for(const st of other.subcategories)for(const row of st.variants)row.payload.category=other.category;
 const engine=createExplicitEngine(other),entry=engine.entryFor("street_stop");let s=engine.start(entry);
 assert.ok(s.pending);s=engine.answer(s,null);assert.equal(s.facts["continuity_compatibility.street_stop."+Object.keys(s.facts)[0].split(".").at(-1)],null);assert.ok(engine.compatible(s.current,s.facts));tr.steps.push({genericCategory:other.category.id,engineState:s});
});
criterion("S05","explicit withdrawal removes certainty only for its item",async(t,tr)=>{
 const f=await bags(t,tr);await f.send("Полицейский досматривает вторую мою сумку.");const b=(await f.state()).episodes.at(-1).itemId;
 await f.send("Про первую сумку: я не уверен в своём прежнем ответе, не помню, открывал ли сотрудник именно мою первую сумку.");const s=await f.state();
 assert.equal(field(s,"bag_search","bag_opened_by_officer"),null);assert.ok(s.factLedger.some(x=>x.fieldKey===opened && x.operation==="withdraw" && x.status==="active"));assert.ok(!s.factLedger.some(x=>x.subjectId===b && x.fieldKey===opened));assert.ok(caseQuestionsUsed(s)<=2);
});
criterion("S06","missing and answered unknown remain distinct",async(t,tr)=>{
 const known="pps.street_stop.reason_explained";const f=await fixture(t,tr,{stageId:"street_stop",facts:{[known]:true}});
 assert.equal(field(await f.state(),"street_stop","free_to_leave_denied"),undefined);
 await f.send("Полицейский остановил меня на улице.");const p=(await f.state()).pending,key=p.fieldKey || "pps.street_stop."+p.question.field_key;
 await f.send("Не знаю");assert.equal(project(await f.state(),"street_stop")[key],null);
 await f.send("Не знаю, какой документ он составляет.");const s=await f.state();assert.equal(project(s,"street_stop")[known],true);assert.equal(project(s,"street_stop")[key],null);assert.notEqual(s.pending?.question.id,p.question.id);
});

criterion("N13","partial release is unknown, physical positive survives",async(t,tr)=>{
 const partial=await fixture(t,tr,{stageId:"street_stop",facts:{"pps.street_stop.free_to_leave_denied":true},priorQuote:"Сотрудник полиции не разрешает мне уйти."});
 await partial.send("Теперь он разрешил мне уйти");
 const updated=await partial.state();assert.equal(field(updated,"street_stop","free_to_leave_denied"),null);assert.ok(updated.factLedger.some(x=>x.operation==="withdraw"));
 const physical=await fixture(t,tr,{stageId:"street_stop",facts:{"pps.street_stop.free_to_leave_denied":true},priorQuote:"Сотрудник полиции не разрешает мне уйти и удерживает меня за руку."});
 await physical.send("Теперь он разрешил мне уйти");assert.equal(field(await physical.state(),"street_stop","free_to_leave_denied"),true);
});

criterion("O02","explicit bag return after a force topic",async(t,tr)=>{
 const f=await bags(t,tr),a=(await f.state()).episodes.at(-1).itemId;
 await f.send("Полицейский досматривает вторую мою сумку.");await f.send("Полицейский меня ударил.");
 const r=await f.send("Вернёмся к первой моей сумке.");const s=await f.state();
 assertHelp(r);assert.equal(s.engine.stageId,"bag_search");assert.equal(s.episodes.at(-1).itemId,a);
 assert.equal(field(s,"bag_search","bag_opened_by_officer"),true);assert.equal(field(s,"use_of_force","force_actually_used"),true);assert.equal(caseQuestionsUsed(s),2);
});
criterion("O06","another bag without ownership is ambiguous",async(t,tr)=>{
 const f=await bags(t,tr),before=await f.state();await f.send("Полицейский досматривает другую сумку и говорит об основаниях.");
 const s=await f.state();assert.equal(s.episodes.at(-1).itemId,before.episodes.at(-1).itemId);assert.deepEqual(s.factLedger,before.factLedger);
 const parsed=interpretTurn(s,"Досматривают другую сумку.","ambiguous-own");assert.equal(parsed.itemResolution.kind,"ambiguous");tr.steps.push({parsed});
});

criterion("B04","actor unknown is an answered scope, not a reusable question",async(t,tr)=>{
 const f=await fixture(t,tr,{actor:"unknown",search:async()=>[hit("street_stop")]});
 await f.send("Меня остановил сотрудник");await f.send("Не знаю");const before=await f.state();
 assert.equal(before.caseState.served[0].status,"answered");assert.equal(before.caseState.served[0].answer.value,null);
 await f.send("Сотрудник остановил меня рядом с домом.");const s=await f.state();assert.equal(s.pending,null);assert.equal(caseQuestionsUsed(s),1);
});
criterion("S06","free-text unknown closes its scope without false fact",async(t,tr)=>{
 const f=await fixture(t,tr);await f.send("Полицейский и охранник стоят рядом, он меня бьёт.");
 assert.equal((await f.state()).pending.key,"actor");await f.send("Не знаю");const s=await f.state();
 assert.equal(s.pending,null);assert.equal(s.factLedger.length,0);assert.equal(s.caseState.served[0].status,"answered");assert.equal(s.caseState.served[0].answer.value,null);
});

// P37: counterexamples discovered during the bounded semantic review.
criterion("N01", "P37 negated prohibition and third-party restraint stay unasserted", async(t,tr)=>{
 for(const stage of ["street_stop","delivery_to_station"]){
  for(const text of ["Сотрудник полиции не запретил мне уходить.",
   "Охранник удерживает меня за руку.",
   "Сотрудник полиции разрешает мне уйти, но охранник держит меня за руку.",
   "Сотрудник полиции не удерживает меня, а охранник запретил уходить."]){
   const s=fresh("1","p37-actor",dialoguePackage.categorySha256),e=episode(s);e.actor="police";e.stageId=stage;
   const parsed=interpretTurn(s,text,"p37");tr.steps.push({text,stage,parsed});
   assert.ok(!parsed.facts.some(x=>x.field.endsWith(".free_to_leave_denied")),text);
  }
 }
});
criterion("N13", "P37 explicit current release supersedes historical prohibition in one turn", async(t,tr)=>{
 for(const stage of ["street_stop","delivery_to_station"]){
  const f=await fixture(t,tr,{stageId:stage});
  await f.send("Сотрудник полиции раньше не разрешал уходить, теперь разрешил уйти и не удерживает меня.");
  assert.equal(field(await f.state(),stage,"free_to_leave_denied"),false);
 }
});
criterion("B08", "P37 denied or hypothetical new incident cannot replenish allowance", async(t,tr)=>{
 const f=await exhausted(t,tr),before=await f.state();
 for(const text of ["Это не другой случай: полицейский проверяет паспорт.","Если будет другой случай, я расскажу позже."]){
  await f.send(text);const s=await f.state();assert.equal(s.caseState.id,before.caseState.id);assert.equal(caseQuestionsUsed(s),2);assert.equal(s.pending,null);
 }
});
criterion("O06", "P37 simultaneous A and B references do not choose the first ordinal", async(t,tr)=>{
 const f=await bags(t,tr);await f.send("Полицейский досматривает вторую мою сумку.");const before=await f.state();
 const text="Сотрудник полиции открыл мою первую сумку, а вторую мою сумку не открывал и сейчас не открывает.";
 const parsed=interpretTurn(before,text,"p37-mixed");tr.steps.push({text,parsed});assert.equal(parsed.itemResolution.kind,"ambiguous");
 await f.send(text);const s=await f.state();assert.deepEqual(s.factLedger,before.factLedger);assert.equal(s.episodes.at(-1).itemId,before.episodes.at(-1).itemId);assert.equal(caseQuestionsUsed(s),2);
});

criterion("S05", "P37 withdrawal of bag opening keeps unrelated known bag facts", async(t,tr)=>{
 const grounds="pps.bag_search.grounds_explained",consent="pps.bag_search.voluntary_show_agreed";
 const f=await fixture(t,tr,{stageId:"bag_search",facts:{[opened]:true,[grounds]:true,[consent]:true}});
 await f.send("Про мою сумку: я не уверен в своём прежнем ответе, не помню, открывал ли сотрудник мою сумку.");
 const s=await f.state();assert.equal(field(s,"bag_search","bag_opened_by_officer"),null);
 assert.equal(project(s,"bag_search")[grounds],true);assert.equal(project(s,"bag_search")[consent],true);
 assert.equal(s.factLedger.filter(x=>x.operation==="withdraw").length,1);
});
criterion("N12", "P37 uncertainty and partial release retain compatible known help", async(t,tr)=>{
 const f=await exhausted(t,tr);await f.send("Полицейский остановил меня на улице и не разрешает уйти.");
 assertHelp(await f.send("Не знаю, какой документ он составляет."));noQuestions(await f.state());
 const g=await fixture(t,tr,{stageId:"street_stop",facts:{"pps.street_stop.free_to_leave_denied":true},priorQuote:"Сотрудник полиции не разрешает мне уйти и удерживает меня за руку."});
 assertHelp(await g.send("Теперь он разрешил мне уйти"));assert.equal(field(await g.state(),"street_stop","free_to_leave_denied"),true);
});
