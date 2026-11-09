import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createBailiffsProfile} from './bailiffs-profile.mjs';
import {createConversationService} from './service.mjs';
import {fresh,episode,newRound,atomic,identityKey,currentEpisode,caseQuestionsUsed} from './state.mjs';
const p=createBailiffsProfile(),root=process.env.BA_DM_TEST_ROOT,allowed='C:/Users/mujlo/Documents/Codex/2026-06-20/_work/bailiffs/hold-closure/20261026-v1/';
if(!root||!path.resolve(root).replaceAll('\\','/').startsWith(allowed))throw Error('BA_TEST_OUTPUT_REQUIRED');
await fs.mkdir(root,{recursive:true});const trace=path.join(root,'native-traces.jsonl');await fs.writeFile(trace,'');let records=0;
after(async()=>{await fs.writeFile(path.join(root,'native-trace-index.json'),JSON.stringify({records,file:trace,origin:'synthetic_dev_native_service_not_independent_holdout'})+'\n');});
function check(id,title,run){test(id+' '+title,async()=>{const tr={id,title,origin:'synthetic_dev_native_service',steps:[],status:'RUNNING'};try{await run(tr);tr.status='PASS';}catch(e){tr.status='FAIL';tr.error=e.stack;throw e;}finally{records++;await fs.appendFile(trace,JSON.stringify(tr)+'\n');}});}
const prefix=stage=>[p.policy.stages.find(s=>s.id===stage).phrase,'С меня взыскивают этот долг','Речь об одном исполнительном производстве',...({ip_opened:['Обсуждаем постановление о возбуждении'],account_arrest:['Мой банк Альфа','Обсуждаем мой счёт зарплаты'],money_writeoff:['Мой банк Альфа','Обсуждаем мой счёт зарплаты','Обсуждаем мою выплату зарплаты за сентябрь'],wage_garnishment:['Мой банк Альфа','Обсуждаем мой счёт зарплаты','Мой плательщик работодатель Альфа','Обсуждаем мою выплату зарплаты за сентябрь'],property_arrest:['Обсуждаем вещь автомобиль'],restrictions:['Обсуждаем постановление по текущим ограничениям'],installment_suspension:['Обсуждаем судебный акт решение по этому долгу'],complaint_bailiff:['Обсуждаем моё заявление о розыске счетов']}[stage])].join('; ');
const literal=(key,value)=>{const q=p.policy.predicates.find(x=>x.fieldKey===key);return value===true?q.positive:value===false?q.negative:q.unknown;};
async function fixture(tr,{stage='ip_opened',used=0,reports=[],start=true}={}){
 const dir=await fs.mkdtemp(path.join(root,'case-')),s=fresh('19',randomUUID(),p.sourceSha256);episode(s);p.prepareState(s);newRound(s,'synthetic-initial');s.caseState.baselineUsed=used;
 const file=path.join(dir,'conversation-sessions-v2',identityKey(s.userId,s.chatId)+'.json');await atomic(file,s);
 const options={dataDir:dir,getActive:async()=>({sha256:p.sourceSha256}),getBundle:async()=>p.bundle,categoryProfile:p};let service=createConversationService(options);
 const f={file,dir,id:s.chatId,userId:s.userId,state:async()=>JSON.parse(await fs.readFile(file,'utf8')),service:()=>service,restart(){service=createConversationService(options);},async mutate(fn){const st=await f.state();fn(st);await atomic(file,st);},async send(question,extra={},ack=true){const st=await f.state(),input={id:f.id,userId:f.userId,turnId:randomUUID(),question,conversation:{sessionId:st.id,revision:st.revision},...extra};f.lastInput=input;try{f.response=await service.respond(input);tr.steps.push({input,response:f.response,state:await f.state()});if(ack)await service.internal({id:f.id,userId:f.userId,turnId:f.response.turn.turnId},'ack');return f.response;}catch(e){tr.steps.push({input,error:{code:e.code,message:e.message},state:await f.state()});throw e;}},async click(value){const button=f.response.answer.next[0]?.view.find(x=>x.guided.native.value===value);assert.ok(button,'offered '+value+' '+f.response.dialogue.questionId);return f.send(button.title,{guided:button.guided});},async resume(){const input={id:f.id,userId:f.userId,resume:true};f.response=await service.respond(input);tr.steps.push({input,response:f.response,state:await f.state()});return f.response;}};
 if(start)await f.send([prefix(stage),...reports].join('; '));return f;
}
const sourceNext=JSON.parse(p.components.NEXT);

check('BA25-AC15-UNBOUND-NEW-OPERATION','new unresolved operation holds current projection and subsequent literals cannot update old subject',async tr=>{const q=p.policy.predicates.find(x=>x.stageId==='money_writeoff'&&x.fieldId==='fssp_order_identified');for(const text of ['Это другое списание по тому же делу','Это другая операция по тому же делу','Неясно какое постановление']){const f=await fixture(tr,{stage:q.stageId,used:2,reports:[q.positive]});const before=(await f.state()).factLedger;await f.send(text);assert.deepEqual(p.scopedFacts(await f.state(),q.stageId),{});assert.match(f.response.answer.variantId,/general$/);await f.send(q.negative);assert.deepEqual((await f.state()).factLedger,before);assert.deepEqual(p.scopedFacts(await f.state(),q.stageId),{});assert.equal(f.response.presentation.questionsUsed,2);}});


for(const method of['button','literal'])check('BA25-AC17-PRIOR-DESTINATION-'+method,'new debit navigation cannot reuse earlier money-stage scope/facts even within same IP',async tr=>{const f=await fixture(tr,{stage:'money_writeoff',reports:[literal('bailiffs.money_writeoff.fssp_order_identified',true),literal('bailiffs.money_writeoff.funds_transferred_to_claimant',true)]});assert.match(f.response.answer.variantId,/fssp_transferred$/);await f.send(prefix('account_arrest'));if(method==='button')await f.click(true);else await f.send(literal('bailiffs.account_arrest.funds_debited_or_written_off',true));assert.equal(f.response.answer.variantId,'draft_ba3_money_writeoff_general');assert.equal(f.response.answer.next.length,0);assert.deepEqual(p.scopedFacts(await f.state(),'money_writeoff'),{});assert.ok((await f.state()).factLedger.some(x=>x.fieldKey==='bailiffs.money_writeoff.fssp_order_identified'&&x.value===true));const used=f.response.presentation.questionsUsed;await f.send('Помогите');assert.equal(f.response.answer.variantId,'draft_ba3_money_writeoff_general');assert.equal(f.response.answer.next.length,0);assert.equal(f.response.presentation.questionsUsed,used);});

check('BA25-AC07-PROPERTY-ROLE','protecting own property does not identify non-debtor third-party status',async tr=>{const f=await fixture(tr,{start:false,used:2});await f.send('Пристав арестовал обсуждаемую вещь; Я защищаю свою вещь в этом деле; Речь об одном исполнительном производстве; Обсуждаем вещь автомобиль');assert.equal(p.scopeFor(await f.state(),'property_arrest').role,'reported-property-interest');assert.equal(p.scopedFacts(await f.state(),'property_arrest').third_party_ownership_claimed,undefined);assert.match(f.response.answer.variantId,/general$/);});

for(const q of p.policy.predicates.filter(x=>x.existingNext))for(const[value,text]of [[true,'  да! '],[false,'нет'],[null,'не знаю']])check('BA25-AC04-TEXT-'+q.fieldKey+'-'+value,'bounded short text follows same scoped current receipt as native buttons',async tr=>{const n=sourceNext.all31nodes.find(x=>x.field_key===q.fieldKey),f=await fixture(tr,{stage:q.stageId,reports:n.history.map(h=>literal(h.field_key,h.value))});assert.equal(f.response.dialogue.questionId,n.id);await f.send(text);const r=(await f.state()).factLedger.findLast(x=>x.fieldKey===q.fieldKey);assert.equal(r.value,value);assert.equal(r.source.kind,'question_reply');assert.equal(r.source.message,text);assert.equal(Array.from(r.source.message).slice(...r.source.span).join(''),r.source.quote);assert.notEqual(f.response.dialogue.questionId,n.id);});

for(const n of sourceNext.all31nodes)for(const value of[true,false,null])check('BA25-AC04-TFU-'+n.id+'-'+value,'all31 original node aliases with actual current receipts',async tr=>{
 const f=await fixture(tr,{stage:n.field_key.split('.')[1],reports:n.history.map(h=>literal(h.field_key,h.value))});assert.equal(f.response.dialogue.questionId,n.id);assert.equal(f.response.answer.next[0].questionText,n.question);await f.click(value);const st=await f.state(),r=st.factLedger.findLast(x=>x.fieldKey===n.field_key);assert.equal(r.value,value);assert.equal(r.source.kind,'button');assert.equal(r.source.verified,false);assert.equal(r.source.canonicalContextWrite,false);assert.equal(r.source.evaluatorInput,false);assert.equal(Array.from(r.source.message).slice(...r.source.span).join(''),r.source.quote);assert.ok(caseQuestionsUsed(st)<=2);assert.notEqual(f.response.dialogue.questionId,n.id);
});
for(const [i,t]of sourceNext.all70paths.entries())check('BA25-AC02/17-PATH-'+i,'all70 cold paths through actual native service, terminal no restart',async tr=>{
 const stage=t.history[0].field_key.split('.')[1],f=await fixture(tr,{stage});for(const h of t.history){assert.equal(f.response.dialogue.questionId,h.question_id);await f.click(h.value);}assert.equal(f.response.answer.variantId,t.target);assert.equal(f.response.answer.next.length,0);assert.equal(f.response.presentation.questionsUsed,t.history.length);assert.deepEqual(f.response.answer.sections.laws,p.rowFor(t.target).row.payload.answer.laws);if(stage==='account_arrest'&&t.target_stage==='money_writeoff')assert.deepEqual(p.scopedFacts(await f.state(),'money_writeoff'),{});
});
for(const q of p.policy.predicates.filter(x=>x.existingNext))for(const value of[true,false,null])check('BA25-AC29-LITERAL-'+q.fieldKey+'-'+value,'finite observation positive/negative/unknown and nonasserted minimal pairs',async tr=>{
 const f=await fixture(tr,{stage:q.stageId,used:2});await f.send(literal(q.fieldKey,value));let st=await f.state(),r=st.factLedger.findLast(x=>x.fieldKey===q.fieldKey);assert.ok(r);assert.equal(r.value,value);assert.equal(Array.from(r.source.message).slice(...r.source.span).join(''),r.source.quote);
 for(const bad of ['Если '+q.positive,'Планирую: '+q.positive,'Возможно, '+q.positive,'«'+q.positive+'»','У друга '+q.positive,'Он '+q.positive,q.positive+'?','x'+q.positive,q.positive+'x','Это рассказ сестры.\n'+q.positive,'Не знаю; '+q.positive]){const before=(await f.state()).factLedger;await f.send(bad);assert.deepEqual((await f.state()).factLedger,before);}
});
for(const q of p.policy.predicates.filter(x=>x.existingNext))check('BA25-AC19/20-LIFE-'+q.fieldKey,'conflict/correction/retraction and scope changes preserve original observations',async tr=>{
 const f=await fixture(tr,{stage:q.stageId,used:2});await f.send(prefix(q.stageId)+'; '+q.positive);await f.send(prefix(q.stageId)+'; '+q.negative);assert.equal((await f.state()).factLedger.findLast(x=>x.fieldKey===q.fieldKey).status,'conflicted');assert.equal(p.scopedFacts(await f.state(),q.stageId)[q.fieldId],undefined);
 await f.send(prefix(q.stageId)+'; Исправляю: '+q.negative);assert.equal(p.scopedFacts(await f.state(),q.stageId)[q.fieldId],false);assert.equal(f.response.dialogue.specializationHeld,false);
 await f.send(prefix(q.stageId)+'; Отзываю: '+q.negative);assert.equal(p.scopedFacts(await f.state(),q.stageId)[q.fieldId],null);await f.send(prefix(q.stageId)+'; '+q.positive);assert.equal(p.scopedFacts(await f.state(),q.stageId)[q.fieldId],true);await f.send(prefix(q.stageId)+'; '+q.unknown);assert.equal(p.scopedFacts(await f.state(),q.stageId)[q.fieldId],true);
 await f.send('Это исполнительное производство другое');assert.equal(p.scopedFacts(await f.state(),q.stageId)[q.fieldId],undefined);assert.equal(f.response.presentation.questionsUsed,2);
});
for(const s of p.bundle.subcategories)for(const v of s.variants)check('BA25-AC01/03/30-ROW-'+v.variant_id,'current full selected bodies via ordinary bounded user statements, not request context',async tr=>{
 const reports=Object.entries(v.context).filter(([,x])=>x!==null).map(([k,value])=>literal('bailiffs.'+s.stage.id+'.'+k,value)),f=await fixture(tr,{stage:s.stage.id,used:2,reports}),selected=p.rowFor(f.response.answer.variantId).row;
 assert.equal(selected.variant_id,v.variant_id);assert.equal(f.response.dialogue.currentAnswerSha256,createHash('sha256').update(JSON.stringify(v.payload.answer)).digest('hex'));assert.deepEqual(f.response.answer.sections.laws,v.payload.answer.laws);assert.deepEqual(f.response.answer.sections.documents,v.payload.answer.where_to);assert.equal(f.response.answer.sections.documentActionsUnavailable,true);
});
check('BA25-AC05-BANK9','independent bank component in all9 payer-bank histories',async tr=>{for(const payer of[true,false,null])for(const bank of[true,false,null]){const f=await fixture(tr,{stage:'wage_garnishment',used:2,reports:[literal('bailiffs.wage_garnishment.withheld_by_payer',payer),literal('bailiffs.wage_garnishment.bank_additional_withholding',bank)]});assert.equal(p.scopedFacts(await f.state(),'wage_garnishment').bank_additional_withholding,bank);assert.match(f.response.answer.variantId,bank===true?(payer===true?/both$/:/bank$/):(payer===true?/payer$/:/general$/));}});
check('BA25-AC06-APPEAL','generic filing known actorunknown and otherparticipant, personalnonfiling notgenericfalse',async tr=>{const q=p.policy.predicates.find(x=>x.fieldId==='underlying_act_appealed');for(const text of q.positiveAliases){const f=await fixture(tr,{stage:q.stageId,used:2});await f.send(text);assert.equal(p.scopedFacts(await f.state(),q.stageId)[q.fieldId],true);const before=(await f.state()).factLedger;await f.send('Я лично не подавал жалобу');assert.deepEqual((await f.state()).factLedger,before);assert.match(f.response.answer.variantId,/appealed$/);}});
check('BA25-AC07/10/11-BOUNDARIES','party false notdebtor, representative own request, property claim notproof',async tr=>{const f=await fixture(tr,{stage:'complaint_bailiff',used:2,reports:[literal('bailiffs.complaint_bailiff.applicant_is_claimant',false),'Мой представитель подал от моего имени приставу письменное заявление о конкретном действии по этому делу']});assert.equal(p.scopedFacts(await f.state(),'complaint_bailiff').specific_action_request_submitted,true);assert.match(f.response.answer.variantId,/requested$/);const st=await f.state();assert.equal(st.factLedger.some(x=>/debtor|ownership|deadline|accepted|suspended/.test(x.fieldKey)),false);});
check('BA25-AC08/09/14-NEGATIVE-GUARDS','partial facts, bankOR, freezes and legal labels remain raw',async tr=>{const f=await fixture(tr,{stage:'money_writeoff',used:2});for(const text of ['Банк не подтвердил перевод','Я знаю номер исполнительного производства','Списали комиссию банка','Долг уже оплачен','Деньги социальные и поэтому защищены','У меня два списания, значит долг взыскали дважды','Я получил какое-то постановление ФССП']){const before=(await f.state()).factLedger;await f.send(text);assert.deepEqual((await f.state()).factLedger,before);}await f.send('ФССП подтвердила перевод этих списанных денег взыскателю');assert.equal(p.scopedFacts(await f.state(),'money_writeoff').funds_transferred_to_claimant,true);});
check('BA25-AC12/21-TIME','completed/cancelled sale holds stale pre-sale specialization without erasing scheduling',async tr=>{for(const [stage,key,text]of [['property_arrest','sale_scheduled','Продажа этой вещи состоялась'],['installment_suspension','urgent_enforcement_scheduled','Назначенное действие по этому делу отменено']]){const f=await fixture(tr,{stage,used:2,reports:[literal('bailiffs.'+stage+'.'+key,true)]});await f.send(text);assert.equal(p.scopedFacts(await f.state(),stage)[key],true);assert.match(f.response.answer.variantId,/general$/);assert.equal(f.response.dialogue.specializationHeld,true);assert.equal(f.response.answer.next.length,0);}});
check('BA25-AC15/16-OBJECT','scope changes bank/account/payment/payer/order/act/request/eventtime never donate facts or budget',async tr=>{const q=p.policy.predicates.find(q=>q.fieldId==='bank_additional_withholding'),f=await fixture(tr,{stage:q.stageId,used:2,reports:[q.positive]});for(const text of ['Мой банк Бета','Обсуждаем мой счёт другой','Обсуждаем мою выплату пенсии за октябрь','Мой плательщик другой работодатель','Обсуждаем постановление другое','Обсуждаем судебный акт другой','Обсуждаем моё заявление другое','Указанная дата события вчера']){await f.send(text);assert.equal(p.scopedFacts(await f.state(),q.stageId)[q.fieldId],undefined);assert.equal(f.response.presentation.questionsUsed,2);}assert.ok((await f.state()).factLedger.some(x=>x.value===true));});
check('BA25-AC18/22-KNOWN','known TFU and ledger-empty authentic answerednull do not reask; one shared budget',async tr=>{const f=await fixture(tr,{stage:'restrictions'}),first=f.response.dialogue.questionId;await f.click(null);assert.equal(f.response.presentation.questionsUsed,2);await f.click(false);await f.mutate(s=>{s.factLedger=[];});await f.send('Помогите');assert.notEqual(f.response.dialogue.questionId,first);assert.equal(f.response.answer.next.length,0);f.restart();await f.resume();assert.equal(f.response.presentation.questionsUsed,2);await f.send(prefix('property_arrest'));assert.equal(f.response.presentation.questionsUsed,2);assert.equal(f.response.answer.next.length,0);});
check('BA25-AC18-RECEIPT','answerednull known with remainingpair and emptied ledger',async tr=>{const n=sourceNext.all31nodes.find(x=>x.field_key==='bailiffs.restrictions.driving_restricted'),f=await fixture(tr,{stage:'restrictions',reports:[literal('bailiffs.restrictions.travel_restricted',true)]});assert.equal(f.response.dialogue.questionId,n.id);await f.click(null);await f.mutate(s=>{s.factLedger=[];});await f.send('Помогите');assert.equal(p.scopedFacts(await f.state(),'restrictions').driving_restricted,null);assert.equal(f.response.answer.next.length,0);});
check('BA25-AC24-STALE','caption/sibling/case/subject/field/receipt/version/source/semantic/nonce fail before write',async tr=>{const f=await fixture(tr),b=f.response.answer.next[0].view[0];for(const[key,value]of Object.entries({caseId:randomUUID(),subjectId:randomUUID(),fieldKey:'bailiffs.ip_opened.enforcement_fee_charged',questionId:'sibling',receiptId:randomUUID(),policyVersion:'old',sourceSha256:'0'.repeat(64),nextSha256:'0'.repeat(64),semanticRevision:'old',nonce:randomUUID()})){const before=await fs.readFile(f.file);await assert.rejects(()=>f.send(b.title,{guided:{native:{...b.guided.native,[key]:value}}}),/STALE_ACTION/);assert.deepEqual(await fs.readFile(f.file),before);}const before=await fs.readFile(f.file);await assert.rejects(()=>f.send('Нет',{guided:b.guided}),/STALE_ACTION/);assert.deepEqual(await fs.readFile(f.file),before);await f.click(true);await assert.rejects(()=>f.send(b.title,{guided:b.guided}),/STALE_ACTION/);});
check('BA25-AC25/26-REPLAY','same persisted turn replay, changedpayload conflict and outbox barrier',async tr=>{const f=await fixture(tr,{start:false});await f.send(prefix('ip_opened'),{},false);const request=f.lastInput,response=f.response,st=await f.state(),replay=await f.service().respond(request);tr.steps.push({input:request,response:replay,state:await f.state()});assert.equal(replay.turn.replayed,true);assert.equal(replay.presentation.responseId,response.presentation.responseId);assert.deepEqual((await f.state()).caseState,st.caseState);await assert.rejects(()=>f.service().respond({...request,question:'changed'}),/TURN_ID_CONFLICT/);await assert.rejects(()=>f.send('Помогите'),/HISTORY_DELIVERY_PENDING/);await f.service().internal({id:f.id,userId:f.userId,turnId:response.turn.turnId},'ack');});
check('BA25-AC26-ATOMIC','failed atomic rename leaves persisted facts/budget unchanged; retry commits once',async tr=>{const f=await fixture(tr,{start:false}),before=await fs.readFile(f.file),rename=fs.rename;fs.rename=async()=>{throw Object.assign(new Error('injected BA persist failure'),{code:'EIO'})};try{await assert.rejects(()=>f.send(prefix('ip_opened')),/injected BA persist failure/);}finally{fs.rename=rename;}assert.deepEqual(await fs.readFile(f.file),before);await f.send(prefix('ip_opened'));assert.equal(f.response.presentation.questionsUsed,1);});
check('BA25-AC25-CONCURRENCY','samechat serialized, otherowner isolated',async tr=>{const f=await fixture(tr,{start:false}),st=await f.state(),base={id:f.id,userId:f.userId,question:prefix('ip_opened'),conversation:{sessionId:st.id,revision:st.revision}},results=await Promise.allSettled([f.service().respond({...base,turnId:randomUUID()}),f.service().respond({...base,turnId:randomUUID()})]);tr.steps.push({inputs:base,results});assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(caseQuestionsUsed(await f.state()),1);const response=await f.service().respond({...base,userId:'20',turnId:randomUUID()});tr.steps.push({input:{...base,userId:'20'},response});assert.notEqual(response.conversation.sessionId,(await f.state()).id);});
check('BA25-AC27-RESUME','unknown source/policy predecessor and pending corruption fail without rewrite',async tr=>{const f=await fixture(tr);await f.mutate(s=>{s.baPolicyVersion='old';});const before=await fs.readFile(f.file);await assert.rejects(()=>f.resume(),/BA_POLICY_VERSION_UNAVAILABLE/);assert.deepEqual(await fs.readFile(f.file),before);});
check('BA25-AC23-NEWCASE','stage/account changes do not reset, explicit separate incident does',async tr=>{const f=await fixture(tr,{used:2});await f.send(prefix('property_arrest'));assert.equal(f.response.presentation.questionsUsed,2);await f.send('Это другой случай: '+prefix('ip_opened'));assert.equal(f.response.presentation.questionsUsed,1);assert.equal((await f.state()).caseHistory.length,1);});
check('BA25-AC28/32-DEFAULT','context/ID/article/oldDOCUMENT nofacts; optin only, 43raw fields',async tr=>{const f=await fixture(tr,{start:false,used:2});await f.send('Помогите',{variantId:'draft_ba3_ip_opened_fee',context:{enforcement_fee_charged:true},facts:{enforcement_fee_charged:true},verified:true,article:'all true',document:{payment:true}});assert.equal((await f.state()).factLedger.length,0);assert.equal(f.response.answer.variantId,'draft_ba3_ip_opened_general');assert.deepEqual(f.response.answer.next,[]);for(const field of p.policy.fields.filter(x=>x.status==='RAW_HOLD')){await f.send(prefix(field.stageId)+'; '+field.meaning);assert.equal(p.scopedFacts(await f.state(),field.stageId)[field.fieldId],undefined);}assert.equal((await f.state()).factLedger.length,0);await assert.rejects(()=>createConversationService({dataDir:root+'default-'+randomUUID(),getActive:async()=>({sha256:p.sourceSha256}),getBundle:async()=>p.bundle}).respond({id:f.id,userId:f.userId,turnId:randomUUID(),question:'Помогите'}),/DIALOGUE_BUNDLE_VERSION_UNAVAILABLE/);});
check('BA25-AC19/20-PROVENANCE','corruption of original value/operation/id/time/kind/span/deps is not rehabilitated by correction',async tr=>{const q=p.policy.predicates[0],f=await fixture(tr,{used:2,reports:[q.positive]}),original=await f.state();for(const mutate of [r=>r.value=false,r=>r.operation='correct',r=>r.id=randomUUID(),r=>r.observedAt='2999-01-01',r=>r.source.kind='assistant',r=>r.source.observationRecordedAt='2999-01-01',r=>r.dependencies=['fake'],r=>r.source.quote='foreign',r=>r.source.span=[0,1]]){await f.mutate(s=>{s.factLedger=structuredClone(original.factLedger);mutate(s.factLedger.at(-1));});await f.send('Исправляю: '+q.negative);assert.equal(p.scopedFacts(await f.state(),q.stageId)[q.fieldId],undefined);}});
check('BA25-AC20/30-AMBIGUOUS','ambiguous scope holds across generic help and no technicalID survey; useful help first',async tr=>{const q=p.policy.predicates[0],f=await fixture(tr,{used:2,reports:[q.positive]});await f.send('У меня два производства');assert.match(f.response.answer.variantId,/general$/);await f.send('Помогите');assert.equal(f.response.dialogue.specializationHeld,true);assert.equal(f.response.answer.next.length,0);assert.ok(f.response.answer.content);await f.send(prefix('ip_opened'));assert.equal(f.response.dialogue.specializationHeld,false);});
check('BA25-AC22-BUDGET','no third/fourth, no whole-case refill on restart',async tr=>{for(const used of[0,1,2,3]){const f=await fixture(tr,{used});assert.ok(f.response.presentation.questionsUsed<=Math.max(used,2));if(used>=2)assert.equal(f.response.answer.next.length,0);f.restart();await f.resume();assert.equal(f.response.presentation.questionsUsed,used>=2?used:used+1);}});

const partials=[
['ip_opened','other_person_identifiers','Я не согласен с собственным долгом'],
['ip_opened','enforcement_fee_charged','Мне только сообщили об основном долге'],
['account_arrest','funds_debited_or_written_off','Банк только заблокировал остаток'],
['account_arrest','fssp_order_identified','Я знаю номер исполнительного производства'],
['money_writeoff','fssp_order_identified','У меня есть письмо ФССП без указанного банком основания'],
['money_writeoff','funds_transferred_to_claimant','Банк не подтвердил перевод, про ФССП не знаю'],
['wage_garnishment','withheld_by_payer','Банк списал деньги после получения зарплаты'],
['wage_garnishment','bank_additional_withholding','Работодатель удержал часть зарплаты'],
['property_arrest','third_party_ownership_claimed','Я считаю арест незаконным из-за цены вещи'],
['property_arrest','sale_scheduled','У меня есть старое письмо про продажу'],
['restrictions','travel_restricted','У меня изъяли паспорт'],
['restrictions','driving_restricted','Суд лишил меня водительских прав за нарушение ПДД'],
['installment_suspension','underlying_act_appealed','Я лично не подавал жалобу'],
['installment_suspension','urgent_enforcement_scheduled','У меня есть письмо с неизвестной датой'],
['complaint_bailiff','applicant_is_claimant','Мне должны деньги'],
['complaint_bailiff','specific_action_request_submitted','Я приготовил проект заявления о конкретном действии']
];
for(const[stage,field,text]of partials)check('BA25-AC29-BOUNDARY-'+stage+'.'+field,'specific full-predicate/partial-report minimal pair in its actual stage',async tr=>{const f=await fixture(tr,{stage,used:2});await f.send(text);assert.equal(p.scopedFacts(await f.state(),stage)[field],undefined);assert.equal((await f.state()).factLedger.length,0);await f.send(literal('bailiffs.'+stage+'.'+field,true));assert.equal((await f.state()).factLedger.findLast(x=>x.fieldKey==='bailiffs.'+stage+'.'+field).value,true);});
check('BA25-AC24-RECEIPT-CORRUPTION','saved original question/offer cannot change while pending',async tr=>{const f=await fixture(tr),original=await f.state();for(const mutate of [s=>s.pending.question.text+=' changed',s=>s.caseState.served.at(-1).baEvidence.question.controls[0].value=false,s=>s.caseState.served.at(-1).baEvidence.policy='old']){await f.mutate(s=>{Object.assign(s,structuredClone(original));mutate(s);});const before=await fs.readFile(f.file);await assert.rejects(()=>f.send('Помогите'),/STALE_ACTION/);assert.deepEqual(await fs.readFile(f.file),before);}});
check('BA25-AC10-REQUEST-ISOLATION','reply/submitted/received remain distinct and later reply preserves filing',async tr=>{const q=p.policy.predicates.find(x=>x.fieldId==='specific_action_request_submitted'),f=await fixture(tr,{stage:q.stageId,used:2,reports:[q.positive]});await f.send('Ответ на это заявление получен');assert.equal(p.scopedFacts(await f.state(),q.stageId)[q.fieldId],true);await f.send('Обсуждаем моё заявление другое');assert.equal(p.scopedFacts(await f.state(),q.stageId)[q.fieldId],undefined);assert.equal(f.response.presentation.questionsUsed,2);});



// BA27: finite adversarial controls retained with full native traces.
const key='bailiffs.ip_opened.other_person_identifiers',q=p.policy.predicates.find(x=>x.fieldKey===key);
for(const [name,edit]of [
 ['parent-value',s=>s.factLedger[0].value=false],
 ['parent-source',s=>s.factLedger[0].source.kind='assistant'],
 ['parent-turn',s=>currentEpisode(s).baTurns.find(t=>t.turnId===s.factLedger[0].source.turnId).message='Подменённая реплика'],
 ['supersedes',s=>s.factLedger.at(-1).supersedes=[]],
 ['parent-observedAt',s=>s.factLedger[0].observedAt='2020-01-01T00:00:00.000Z']
])check('BA27-HISTORY-'+name,'later correction retains exact original parent evidence',async tr=>{
 const f=await fixture(tr,{used:2,reports:[q.positive]});await f.send('Исправляю: '+q.negative);assert.equal(p.known(await f.state(),key).value,false);
 await f.mutate(edit);tr.steps.push({mutation:name,state:await f.state()});await f.send('Помогите');
 assert.equal(p.known(await f.state(),key),null);assert.match(f.response.answer.variantId,/general$/);
 await f.send('Исправляю: '+q.positive);assert.equal(p.known(await f.state(),key),null);
});
for(const [name,edit]of [
 ['turnId',s=>s.caseState.served[0].turnId=randomUUID()],
 ['responseId',s=>s.caseState.served[0].responseId=randomUUID()],
 ['original-caption',s=>s.turns[s.caseState.served[0].turnId].response.answer.next[0].view[0].title='Иное значение'],
 ['original-value',s=>s.turns[s.caseState.served[0].turnId].response.answer.next[0].view[0].guided.native.value=false],
 ['original-question',s=>s.turns[s.caseState.served[0].turnId].response.answer.next[0].questionText='Иной вопрос'],
 ['original-nonce',s=>s.turns[s.caseState.served[0].turnId].response.answer.next[0].view[0].guided.native.nonce='bad']
])check('BA27-RECEIPT-'+name,'pending short TFU must bind actual originally displayed question',async tr=>{
 const f=await fixture(tr);await f.mutate(edit);tr.steps.push({mutation:name,state:await f.state()});const before=await fs.readFile(f.file);
 await assert.rejects(()=>f.send('да'),/STALE_ACTION/);assert.deepEqual(await fs.readFile(f.file),before);
});
for(const [label,phrase]of [
 ['bank','Мой банк Альфа и Бета'],
 ['account','Обсуждаем мой счёт зарплаты или пенсии'],
 ['payment','Обсуждаем мою выплату зарплату и пенсию'],
 ['payer','Мой плательщик работодатель Альфа или Бета']
])check('BA27-MULTI-'+label,'compound object cannot become one independently bound subject',async tr=>{
 const f=await fixture(tr,{stage:'wage_garnishment',used:2});
 const bank=p.policy.predicates.find(x=>x.fieldId==='bank_additional_withholding');
 await f.send(phrase+'; '+bank.positive);assert.deepEqual(p.scopedFacts(await f.state(),'wage_garnishment'),{});assert.equal((await f.state()).factLedger.length,0);
});
for(const text of ['Теперь речь о другом списании','Обсуждаем другую выплату','Теперь речь о другом исполнительном производстве','Обсуждаем другое постановление'])check('BA27-UNBOUND-'+text,'unbound changed object cannot keep prior material projection',async tr=>{
 const stage='money_writeoff',k='bailiffs.money_writeoff.fssp_order_identified',f=await fixture(tr,{stage,used:2,reports:[literal(k,true)]});
 await f.send(text);assert.deepEqual(p.scopedFacts(await f.state(),stage),{});await f.send(literal(k,false));assert.equal((await f.state()).factLedger.length,1);
});


for(const q of p.policy.predicates.filter(x=>x.existingNext))check('BA27-MATRIX-'+q.fieldKey,'finite unsupported frames and semantic minimal pairs retain original raw text without qualification',async tr=>{
 const f=await fixture(tr,{stage:q.stageId,used:2});
 const frames=[
 ['plan','Планирую; '+q.positive],['hypothesis','Допустим; '+q.positive],['quote','Цитата; '+q.positive],
 ['assistant','Ассистент; '+q.positive],['retrieval','Текст из поиска; '+q.positive],['foreign','Это рассказ друга; '+q.positive],
 ['pronoun','Он сообщил; '+q.positive],['negation','Неверно, что '+q.positive],['mixed-unknown','Не знаю; '+q.positive],
 ['mixed-negative',q.positive+'; но это не так'],['partial',q.positive.slice(0,Math.max(5,Math.floor(q.positive.length/2)))],
 ['typo',q.positive.slice(0,-1)+'X'],['question',q.positive+'?'],['past','В прошлом деле; '+q.positive],
 ['two-ip','Два производства; '+q.positive],['two-account','Два счёта; '+q.positive],
 ['two-person','По делам двух людей; '+q.positive],['different-debt','По другому долгу; '+q.positive],
 ['different-act','По другому судебному акту; '+q.positive],['unknown-time','Дата неизвестна; '+q.positive],
 ['nonasserted-or',q.positive+' или нет'],['nonasserted-and',q.positive+' и ещё что-то']
 ];
 for(const[label,text]of frames){const before=(await f.state()).factLedger;await f.send(text);assert.deepEqual((await f.state()).factLedger,before,label);assert.ok(currentEpisode(await f.state()).baRaw.some(r=>r.source.message===text),label);assert.equal(f.response.answer.next.length,0);}
 await f.send(prefix(q.stageId)+'; '+q.negative);assert.equal(p.scopedFacts(await f.state(),q.stageId)[q.fieldId],false);
 await f.send(prefix(q.stageId)+'; Исправляю: '+q.positive);assert.equal((await f.state()).factLedger.findLast(r=>r.fieldKey===q.fieldKey).value,true);
});
for(const field of p.policy.fields.filter(f=>f.status==='RAW_HOLD'))check('BA27-RAW43-'+field.fieldKey,'raw field retained and never admitted as positive or false legal producer',async tr=>{
 const f=await fixture(tr,{stage:field.stageId,used:2});
 for(const question of [field.meaning,'Это подтверждено: '+field.meaning,'Нет: '+field.meaning]){await f.send(question,{context:{[field.fieldId]:true},verified:true});assert.equal(p.scopedFacts(await f.state(),field.stageId)[field.fieldId],undefined);assert.equal((await f.state()).factLedger.length,0);assert.equal(f.response.answer.next.length,0);}
});
for(const [name,edit]of[
 ['turn-time',s=>currentEpisode(s).baTurns.at(-1).recordedAt='2999-01-01T00:00:00.000Z'],
 ['source-turnId',s=>s.factLedger.at(-1).source.turnId=randomUUID()],
 ['source-message',s=>s.factLedger.at(-1).source.message='Чужой текст'],
 ['source-case',s=>s.factLedger.at(-1).source.caseId=randomUUID()],
 ['source-episode',s=>s.factLedger.at(-1).source.episodeId=randomUUID()],
 ['source-policy',s=>s.factLedger.at(-1).source.policyVersion='unavailable'],
 ['source-hash',s=>s.factLedger.at(-1).source.sourceSha256='0'.repeat(64)],
 ['scope-person',s=>s.factLedger.at(-1).source.scope.person='another'],
 ['scope-role',s=>s.factLedger.at(-1).source.scope.role='another'],
 ['scope-ip',s=>s.factLedger.at(-1).source.scope.proceeding='another'],
 ['scope-order',s=>s.factLedger.at(-1).source.scope.order='another'],
 ['record-episode',s=>s.factLedger.at(-1).episodeId=randomUUID()],
 ['record-subject',s=>s.factLedger.at(-1).subjectId=randomUUID()],
 ['unicode-span',s=>s.factLedger.at(-1).source.span=[1,2]]
])check('BA27-ORIGINAL-'+name,'original proposition binding and later correction do not repair corrupted history',async tr=>{
 const q=p.policy.predicates[0],f=await fixture(tr,{used:2});await f.send(q.positive);await f.mutate(edit);tr.steps.push({mutation:name,state:await f.state()});
 await f.send('Помогите');assert.equal(p.known(await f.state(),q.fieldKey),null);await f.send('Исправляю: '+q.negative);assert.equal(p.known(await f.state(),q.fieldKey),null);
});
for(const sameIP of [true,false])for(const method of ['button','literal'])check('BA27-NAV-'+sameIP+'-'+method,'terminal debit retires destination only, retains unrelated history and case budget',async tr=>{
 const f=await fixture(tr,{used:0,reports:p.policy.predicates.filter(q=>q.stageId==='ip_opened').map(q=>q.positive)});
 const ipBefore=structuredClone(p.scopedFacts(await f.state(),'ip_opened'));
 await f.send(prefix('money_writeoff')+'; '+literal('bailiffs.money_writeoff.fssp_order_identified',true));
 const priorCount=(await f.state()).caseState.served.length; // old money-stage question/receipt exists.
 let start=prefix('account_arrest');if(!sameIP)start=start.replace('Речь об одном исполнительном производстве','Это исполнительное производство Бета');
 await f.send(start);if(method==='button'&&f.response.answer.next.length)await f.click(true);else await f.send(literal('bailiffs.account_arrest.funds_debited_or_written_off',true));
 assert.equal(f.response.answer.variantId,'draft_ba3_money_writeoff_general');assert.equal(f.response.answer.next.length,0);
 assert.deepEqual(p.scopedFacts(await f.state(),'money_writeoff'),{});assert.ok((await f.state()).factLedger.some(x=>x.fieldKey==='bailiffs.money_writeoff.fssp_order_identified'));
 if(sameIP)assert.deepEqual(p.scopedFacts(await f.state(),'ip_opened'),ipBefore);
 assert.ok(f.response.presentation.questionsUsed>=priorCount);const budget=f.response.presentation.questionsUsed;await f.send('Помогите');assert.equal(f.response.presentation.questionsUsed,budget);assert.equal(f.response.answer.next.length,0);
});
check('BA27-OLD-POLICY','BA26 sessions cannot silently acquire BA27 evidence semantics',async tr=>{
 const f=await fixture(tr);await f.mutate(s=>{s.baPolicyVersion='bailiffs.ba26.20261026.v1';s.policyVersion='bailiffs.ba26.20261026.v1';});const before=await fs.readFile(f.file);await assert.rejects(()=>f.resume(),/BA_POLICY_VERSION_UNAVAILABLE/);assert.deepEqual(await fs.readFile(f.file),before);
});
for(const value of ['да','нет','не знаю'])check('BA27-NO-PENDING-'+value,'bare TFU without current authentic question never creates a fact',async tr=>{
 const f=await fixture(tr,{used:2});await f.send(value);assert.equal((await f.state()).factLedger.length,0);assert.equal(f.response.answer.next.length,0);
});
check('BA27-BUTTON-CORRECTION-PARENT','valid button ancestor remains valid after explicit correction with immutable original offer',async tr=>{
 const q=p.policy.predicates[0],f=await fixture(tr);await f.click(true);await f.send('Исправляю: '+q.negative);assert.equal(p.known(await f.state(),q.fieldKey).value,false);assert.ok((await f.state()).factLedger.length>=2);
});

