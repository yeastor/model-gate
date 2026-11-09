import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createDigitalAccessProfile} from './digital-access-profile.mjs';
import {interpretDigitalAccess,stagePhrases} from './digital-access-interpret.mjs';
import {createConversationService} from './service.mjs';
import {fresh,episode,currentEpisode,newRound,atomic,identityKey,caseQuestionsUsed} from './state.mjs';
const p=await createDigitalAccessProfile(),root=process.env.DA_DM_TEST_ROOT,trace=process.env.DA_DM_TRACE_FILE;
if(!root||!trace)throw Error('DA_DM_TEST_ROOT and DA_DM_TRACE_FILE must be isolated assigned outputs');
await fs.mkdir(root,{recursive:true});await fs.mkdir(path.dirname(trace),{recursive:true});await fs.writeFile(trace,'');
let traceCount=0;after(async()=>{await fs.writeFile(trace+'.index.json',JSON.stringify({records:traceCount,kind:'synthetic_native_service_development_not_independent_holdout',file:trace})+'\n');});
function check(id,title,run){test(id+' '+title,async()=>{const tr={id,title,origin:'synthetic_native_service_development_not_real_users_not_independent_holdout',steps:[],status:'RUNNING'};try{await run(tr);tr.status='PASS';}catch(e){tr.status='FAIL';tr.error=e.stack;throw e;}finally{traceCount++;await fs.appendFile(trace,JSON.stringify(tr)+'\n');}});}
const fullRoles='Мой сервис пример; Моя сим-карта первая; Привязанный мне номер основной; Мой оператор оператор; Эта операция первая; Это моё обращение первое';
function expand(raw){const f={...raw};if(f.recovery_contacts_verified===true)for(const k of ['recovery_email_checked','recovery_email_owned','recovery_phone_checked','recovery_phone_owned'])f[k]=true;if(f.twofa_reset===true)for(const k of ['additional_factor_reset','backup_codes_supported','backup_codes_reset'])f[k]=true;delete f.recovery_contacts_verified;delete f.twofa_reset;return f;}
const defFor=(stage,field)=>p.policy.fields.find(f=>f.fieldKey==='digital_access.'+stage+'.'+field);
const literal=(stage,field,value)=>{const f=defFor(stage,field);assert.ok(f?.positive,'independent finite literal '+stage+'.'+field);return value===true?f.positive:value===false?f.negative:f.unknown;};
function textFor(stage,facts){const f=expand(facts),order=p.policy.fields.filter(d=>d.stageId===stage&&Object.hasOwn(f,d.fieldId));return order.map(d=>literal(stage,d.fieldId,f[d.fieldId])).join('; ');}
async function fixture(tr,{stage='account_hacked',used=0,facts={},start=true}={}){
 const dir=await fs.mkdtemp(path.join(root,'case-')),s=fresh('19',randomUUID(),p.sourceSha256);episode(s);p.prepareState(s);newRound(s,'synthetic-explicit-observation');s.caseState.baselineUsed=used;
 const file=path.join(dir,'conversation-sessions-v2',identityKey(s.userId,s.chatId)+'.json');await atomic(file,s);
 const options={dataDir:dir,getActive:async()=>({sha256:p.sourceSha256}),getBundle:async()=>p.bundle,categoryProfile:p};let service=createConversationService(options);
 const f={file,id:s.chatId,userId:s.userId,state:async()=>JSON.parse(await fs.readFile(file,'utf8')),svc:()=>service,restart(){service=createConversationService(options);},async mutate(fn){const st=await f.state();fn(st);await atomic(file,st);},async send(question,extra={},ack=true){const st=await f.state(),input={id:s.chatId,userId:s.userId,turnId:randomUUID(),question,conversation:{sessionId:st.id,revision:st.revision},...extra};f.lastInput=input;f.response=await service.respond(input);tr.steps.push({input,response:f.response,state:await f.state()});if(ack)await service.internal({id:s.chatId,userId:s.userId,turnId:f.response.turn.turnId},'ack');return f.response;},async click(value){const b=f.response.answer.next[0]?.view.find(b=>b.guided.native.value===value);assert.ok(b,'expected offered '+value);return f.send(b.title,{guided:b.guided});},async resume(){f.response=await service.respond({id:s.chatId,userId:s.userId,resume:true});tr.steps.push({resume:f.response,state:await f.state()});return f.response;}};
 if(start)await f.send([stagePhrases[stage],fullRoles,textFor(stage,facts)].filter(Boolean).join('; '));return f;
}
const accepted=JSON.parse(p.components.accepted_bindings),proof=JSON.parse(p.components.full_evidence);
for(const [i,b]of accepted.current_target_bindings.entries())check('AC03-native-use-'+i,'accepted occurrence actual native TFU/provenance/currenttarget',async tr=>{
 const stage=p.rowFor(b.selected_id).stage.stage.id,parts=b.node.slice(('q_da_'+stage+'_').length).split('_then_'),current=parts.at(-1),previous=parts.slice(0,-1),base=expand(b.full_after_facts),prefix=Object.fromEntries(previous.map(k=>[k,base[k]]));
 delete base[current];for(const k of previous)delete base[k];
 // These are independently stipulated reader reports in a synthetic case, not source-mask admission.
 const f=await fixture(tr,{stage,facts:base});
 for(const k of previous){assert.equal(f.response.answer.next[0]?.view[0].guided.native.fieldKey,'digital_access.'+stage+'.'+k);await f.click(prefix[k]);}
 assert.equal(f.response.dialogue.questionId,b.node);assert.deepEqual(f.response.answer.next[0].view.map(x=>[x.title,x.guided.native.value]),[['Да',true],['Нет',false],['Не знаю',null]]);
 await f.click(b.value);const s=await f.state(),rec=s.factLedger.findLast(x=>x.fieldKey==='digital_access.'+stage+'.'+current);
 assert.equal(rec.value,b.value);assert.equal(rec.source.kind,'button');assert.equal(rec.source.questionId,b.node);assert.equal(rec.source.quote,b.label);assert.equal(rec.source.sourceSha256,p.sourceSha256);assert.equal(Array.from(rec.source.message).slice(...rec.source.span).join(''),rec.source.quote);assert.equal(f.response.answer.variantId,b.selected_id);assert.ok(caseQuestionsUsed(s)<=2);
});
for(const def of p.policy.fields.filter(f=>f.status==='BOUNDED_OBSERVATION'))for(const value of [true,false,null])check('AC05/06-literal-'+def.fieldKey+'-'+value,'native literal plus finite negative minimal pairs',async tr=>{
 const initial={};if(def.fieldId.endsWith('_owned'))initial[def.fieldId.replace(/_owned$/u,'_checked')]=true;
 const f=await fixture(tr,{stage:def.stageId,used:2,facts:initial}),text=literal(def.stageId,def.fieldId,value);await f.send(text);
 const s=await f.state(),rec=s.factLedger.findLast(r=>r.fieldKey===def.fieldKey);assert.ok(rec);assert.equal(rec.value,value);assert.equal(rec.source.quote,text);assert.equal(Array.from(text).slice(...rec.source.span).join(''),text);
 for(const bad of ['Если '+text,'Возможно, '+text,'«'+text+'»','У друга '+text,'Он изменил '+text,text+'?','Планирую: '+text,'x'+text,text+'x','Это рассказ сестры.\n'+text,'Не знаю; '+text]){const before=(await f.state()).factLedger;await f.send(bad);assert.deepEqual((await f.state()).factLedger,before);}
});
for(const [i,d]of proof.current2529.entries())check('AC04-native-display-'+i,'actual native current dynamic display bound to accepted full body',async tr=>{
 const f=await fixture(tr,{stage:'secure_after',used:2,facts:d.trusted_current_case_fixture_facts}),s=await f.state(),body=p.currentDisplay('secure_after',p.scopedFacts(s,'secure_after'));
 assert.equal(f.response.answer.variantId,d.variant_id);assert.deepEqual(body.answer,d.full_current_display_answer);assert.deepEqual(f.response.answer.sections.laws,d.full_current_display_answer.laws);assert.deepEqual(f.response.answer.sections.documents,d.full_current_display_answer.where_to);
});
check('AC01/24-default-entry','opt-in default and clientfacts/entry are not evidence',async tr=>{
 const f=await fixture(tr,{start:false,used:2});await f.send('Помогите',{variantId:'digital_access_account_hacked_v128',facts:{access_lost:true},context:{service_is_google:true},article:'all true',document:{access_lost:true}});assert.equal((await f.state()).factLedger.length,0);assert.equal(f.response.answer.variantId,undefined);
 await assert.rejects(()=>createConversationService({dataDir:path.join(root,'default-'+randomUUID()),getActive:async()=>({sha256:p.sourceSha256}),getBundle:async()=>p.bundle}).respond({id:f.id,userId:f.userId,turnId:randomUUID(),question:'Помогите'}),/DIALOGUE_BUNDLE_VERSION_UNAVAILABLE/);
});
check('AC08-screen','beforeloss criterion separate from open screen/weakPIN and commandresult',async tr=>{
 const f=await fixture(tr,{stage:'lost_device',used:2});
 for(const t of ['Экран был открыт при потере','У меня короткий PIN','Я нажму удалённое стирание','Сервис сообщил о завершении команды этого устройства'])await f.send(t);
 assert.equal(p.scopedFacts(await f.state(),'lost_device').device_unprotected,undefined);assert.equal(p.scopedFacts(await f.state(),'lost_device').remote_lock_completed,undefined);
 await f.send(literal('lost_device','device_unprotected',true));assert.equal(p.scopedFacts(await f.state(),'lost_device').device_unprotected,true);await f.send(literal('lost_device','remote_lock_completed',true));assert.equal(p.scopedFacts(await f.state(),'lost_device').remote_lock_completed,true);
 await f.send('Команда этого устройства ожидает подключения');assert.ok(currentEpisode(await f.state()).daEvents.some(e=>e.kind==='command_status'&&e.value==='queued_offline'));
});
check('AC09-contacts','ownership prerequisite settingchanges and nolegacyfanout',async tr=>{
 const f=await fixture(tr,{stage:'secure_after',used:2});await f.send(literal('secure_after','recovery_email_owned',true));assert.equal(p.scopedFacts(await f.state(),'secure_after').recovery_email_owned,undefined);
 await f.send(literal('secure_after','recovery_email_checked',true));await f.send(literal('secure_after','recovery_email_owned',true));assert.equal(p.scopedFacts(await f.state(),'secure_after').recovery_email_owned,true);
 await f.send('Адрес почты восстановления этого аккаунта изменился');assert.equal(p.scopedFacts(await f.state(),'secure_after').recovery_email_owned,undefined);assert.equal(p.scopedFacts(await f.state(),'secure_after').recovery_email_checked,undefined);
 await f.mutate(s=>s.factLedger.push({fieldKey:'digital_access.secure_after.recovery_contacts_verified',value:true,status:'active',caseId:s.caseState.id,episodeId:s.activeEpisodeId}));assert.equal(p.scopedFacts(await f.state(),'secure_after').recovery_phone_checked,undefined);
});
check('AC10-focus','independentfactor capability N/A conflict and focused2',async tr=>{
 const f=await fixture(tr,{stage:'secure_after',used:2});await f.send(literal('secure_after','additional_factor_reset',true));await f.send(literal('secure_after','backup_codes_supported',false));assert.equal(f.response.dialogue.applicability.backup_codes,'NOT_APPLICABLE');await f.send(literal('secure_after','backup_codes_reset',true));assert.equal(f.response.dialogue.specializationHeld,true);assert.ok(f.response.answer.content);
 const g=await fixture(tr,{start:false});await g.send(stagePhrases.secure_after+'; '+fullRoles+'; Проверяю почту восстановления этого аккаунта');assert.equal(g.response.answer.next[0].view[0].guided.native.fieldKey,'digital_access.secure_after.recovery_email_checked');await g.click(true);await g.click(null);assert.equal(g.response.answer.next.length,0);assert.equal(g.response.presentation.questionsUsed,2);
});
check('AC11-GoogleOR','alternate rawtrigger retains accessunknown; otherprovider generic',async tr=>{
 const f=await fixture(tr,{stage:'email_compromised',used:2});await f.send(literal('email_compromised','service_is_google',true));await f.send(literal('email_compromised','recovery_contacts_changed',true));assert.equal(f.response.answer.variantId,'digital_access_email_compromised_v06');assert.equal(p.scopedFacts(await f.state(),'email_compromised').access_lost,undefined);await f.send('Исправляю: '+literal('email_compromised','service_is_google',false));assert.equal(f.response.answer.variantId,'digital_access_email_compromised_v04');
});
check('AC13/14-qualified','unprovedspecialization raw and help first / compound moneyguards',async tr=>{
 const f=await fixture(tr,{used:2});for(const d of p.policy.fields.filter(x=>x.status==='HELD_QUALIFIED_PRODUCER')){await f.send(d.positive);assert.equal(p.scopedFacts(await f.state(),d.stageId)[d.fieldId],undefined);}assert.ok(currentEpisode(await f.state()).daRaw.length);assert.ok(f.response.answer.content);
 for(const t of ['Деньги исчезли','Это криптоприложение','Проверенное устройство чистое','Аккаунт был платным, значит я потребитель']){const before=(await f.state()).factLedger;await f.send(t);assert.deepEqual((await f.state()).factLedger,before);}
});
check('AC16-global','sharedwholecase2/knownnullreceipts/stageaccountswitch no reset',async tr=>{
 const f=await fixture(tr);assert.equal(f.response.presentation.questionsUsed,1);const q=f.response.dialogue.questionId;await f.send('Спасибо');assert.equal(f.response.presentation.questionsUsed,1);assert.equal(f.response.dialogue.questionId,q);await f.click(null);assert.equal(f.response.presentation.questionsUsed,2);await f.click(null);await f.mutate(s=>{s.factLedger=[];});await f.send('Помогите');assert.notEqual(f.response.dialogue.questionId,q);assert.equal(f.response.answer.next.length,0);await f.send(stagePhrases.secure_after+'; Мой аккаунт другой');assert.equal(f.response.presentation.questionsUsed,2);assert.equal(f.response.answer.next.length,0);f.restart();await f.resume();assert.equal(f.response.presentation.questionsUsed,2);
});
check('AC17/18/19-history','unknown conflict correction withdraw later and invalidation',async tr=>{
 const f=await fixture(tr,{used:2});const d=defFor('account_hacked','access_lost');await f.send(d.positive);await f.send(d.unknown);assert.equal(p.scopedFacts(await f.state(),'account_hacked').access_lost,true);await f.send(d.negative);assert.ok((await f.state()).factLedger.some(x=>x.status==='conflicted'));await f.send('Исправляю: '+d.negative);assert.equal(p.scopedFacts(await f.state(),'account_hacked').access_lost,false);await f.send('Исправляю: '+d.unknown);assert.equal(p.scopedFacts(await f.state(),'account_hacked').access_lost,null);
 await f.send('Исправляю: '+d.positive);await f.send('Я снова вошёл в этот аккаунт');assert.equal(p.scopedFacts(await f.state(),'account_hacked').access_lost,false);assert.ok((await f.state()).factLedger.some(x=>x.value===true));await f.send('Отзываю своё последнее сообщение');assert.equal(p.scopedFacts(await f.state(),'account_hacked').access_lost,null);
 const g=await fixture(tr,{stage:'secure_after',used:2});await g.send(literal('secure_after','recovery_email_checked',true)+'; '+literal('secure_after','recovery_email_owned',true));const old=(await g.state()).factLedger;await g.send('Отзываю своё последнее сообщение');assert.deepEqual((await g.state()).factLedger,old);await g.send('Исправляю: '+literal('secure_after','recovery_email_checked',false));assert.ok((await g.state()).factLedger.some(x=>x.status==='invalidated'));assert.equal(p.scopedFacts(await g.state(),'secure_after').recovery_email_owned,undefined);
});
check('AC07/20-scope-stale','actual accountisolation stale native and forgedsource reject beforewrite',async tr=>{
 const f=await fixture(tr);const button=f.response.answer.next[0].view[0];
 for(const patch of [{nonce:'x'},{revision:999},{sessionId:randomUUID()},{questionId:'x'},{receiptId:'x'},{fieldKey:'x'},{policyVersion:'x'},{sourceSha256:'x'},{nextSha256:'x'},{modelFingerprint:'x'},{scopeDigest:'x'},{subjectId:'x'},{caseId:'x'},{episodeId:'x'},{roundId:'x'}]){const before=await fs.readFile(f.file,'utf8');await assert.rejects(()=>f.send(button.title,{guided:{native:{...button.guided.native,...patch}}}),/STALE_ACTION/);assert.equal(await fs.readFile(f.file,'utf8'),before);}
 await f.click(true);const before=await fs.readFile(f.file,'utf8');await assert.rejects(()=>f.send(button.title,{guided:button.guided}),/STALE_ACTION/);assert.equal(await fs.readFile(f.file,'utf8'),before);
 await f.send('Мой аккаунт другой');assert.equal(p.scopedFacts(await f.state(),'account_hacked').access_lost,undefined);assert.ok((await f.state()).factLedger.length);assert.equal(f.response.presentation.questionsUsed,2);
});
check('AC21/22-transaction','atomic replay outbox restart concurrency unknownversion',async tr=>{
 const f=await fixture(tr,{start:false});await f.send(stagePhrases.account_hacked,{},false);const input=f.lastInput,r=f.response,replay=await f.svc().respond(input);assert.equal(replay.presentation.responseId,r.presentation.responseId);assert.equal(replay.turn.replayed,true);await assert.rejects(()=>f.svc().respond({...input,question:'Другое'}),/TURN_ID_CONFLICT/);await assert.rejects(()=>f.send('Помогите',{},false),/HISTORY_DELIVERY_PENDING/);f.restart();assert.equal((await f.resume()).presentation.responseId,r.presentation.responseId);await f.svc().internal({id:f.id,userId:f.userId,turnId:r.turn.turnId},'ack');
 const s=await f.state(),b=f.response.answer.next[0].view[2],i={id:f.id,userId:f.userId,turnId:randomUUID(),question:b.title,guided:b.guided,conversation:{sessionId:s.id,revision:s.revision}},rs=await Promise.all([f.svc().respond(i),f.svc().respond(i)]);assert.equal(rs[0].presentation.responseId,rs[1].presentation.responseId);assert.equal(caseQuestionsUsed(await f.state()),2);await f.svc().internal({id:f.id,userId:f.userId,turnId:i.turnId},'ack');
 await f.mutate(s=>s.daPolicyVersion='unmapped');const before=await fs.readFile(f.file,'utf8');await assert.rejects(()=>f.send('Помогите'),/DA_POLICY_VERSION_UNAVAILABLE/);assert.equal(await fs.readFile(f.file,'utf8'),before);
});
check('AC23-newcase','only explicit separate incident grants freshbudget',async tr=>{
 const f=await fixture(tr,{used:2});const old=(await f.state()).caseState.id;await f.send('Это другой случай: '+stagePhrases.account_hacked+'; Мой аккаунт новый');assert.notEqual((await f.state()).caseState.id,old);assert.equal((await f.state()).caseHistory.length,1);assert.equal(f.response.presentation.questionsUsed,1);
});
check('AC27-document','documentfacts unavailable without dropping help',async tr=>{
 const f=await fixture(tr,{used:2});const old=(await f.state()).factLedger;await f.send('Открой документ',{document:{facts:true}});assert.match(f.response.answer.content,/пока недоступны/);assert.deepEqual((await f.state()).factLedger,old);
});


// DA18 persisted-evidence and scope regression controls.
for(const [name,mutate] of [
 ['value',r=>r.value=false],
 ['kind',r=>r.source.kind='assistant'],
 ['turn',r=>r.source.turnId='unobserved-turn'],
 ['unsupported-frame',r=>{r.source.message='Это слова другого человека; '+r.source.quote;r.source.span=[Array.from('Это слова другого человека; ').length,Array.from(r.source.message).length];}],
 ['future-time',r=>r.source.observationRecordedAt='2999-01-01T00:00:00.000Z']
])check('DA18-provenance-'+name,'persisted exact-span alone must not certify independent observation',async tr=>{
 const f=await fixture(tr,{used:2,facts:{access_lost:true}});await f.mutate(s=>mutate(s.factLedger.find(r=>r.fieldKey==='digital_access.account_hacked.access_lost')));
 await f.send('Повторите памятку');assert.equal(p.scopedFacts(await f.state(),'account_hacked').access_lost,undefined);
 assert.notEqual(f.response.answer.variantId,'digital_access_account_hacked_v66');
});
check('DA18-receipt-content','matching question and receipt IDs cannot authenticate altered answer value',async tr=>{
 const f=await fixture(tr);const key=f.response.answer.next[0].view[0].guided.native.fieldKey;await f.click(true);
 await f.mutate(s=>{s.factLedger=[];const r=s.caseState.served.find(r=>r.fieldKey===key&&r.status==='answered');r.answer.value=false;});
 await f.send('Повторите памятку');assert.equal(p.scopedFacts(await f.state(),'account_hacked')[key.split('.').at(-1)],undefined);
});
check('DA18-scope-evidence','unobserved edited scope evidence cannot confer known facts',async tr=>{
 const f=await fixture(tr,{used:2,facts:{access_lost:true}});
 await f.mutate(s=>{currentEpisode(s).daScopes.account_hacked.evidence.subjectId={kind:'assistant',turnId:'fiction',message:'В моём аккаунте обнаружен чужой доступ',quote:'В моём аккаунте обнаружен чужой доступ',span:[0,44]};});
 await f.send('Повторите памятку');assert.equal(p.scopedFacts(await f.state(),'account_hacked').access_lost,undefined);assert.ok(f.response.answer.content);
});
check('DA18-postposed-observed-scope','literal fact preceding a changed object is ambiguous and must not migrate',async tr=>{
 const f=await fixture(tr,{used:2});await f.send('Мой аккаунт первый');
 await f.send('Я полностью потерял доступ к этому аккаунту; Мой аккаунт второй');
 assert.equal(p.scopedFacts(await f.state(),'account_hacked').access_lost,undefined);
 assert.equal(p.scopeFor(await f.state(),'account_hacked').subjectId,'account:первый');
});
check('DA18-receipt-ownership-dependency','ownership receipt alone cannot outlive a corrected check',async tr=>{
 const f=await fixture(tr,{start:false});await f.send(stagePhrases.secure_after+'; '+fullRoles+'; Проверяю почту восстановления этого аккаунта');await f.click(true);await f.click(true);
 await f.send('Исправляю: '+literal('secure_after','recovery_email_checked',false));
 await f.mutate(s=>s.factLedger=s.factLedger.filter(x=>!x.fieldKey.endsWith('_owned')));
 await f.send('Повторите памятку');assert.equal(p.scopedFacts(await f.state(),'secure_after').recovery_email_owned,undefined);
});
check('DA18-no-rehabilitate','correction cannot rehabilitate altered literal value in saved history',async tr=>{
 const f=await fixture(tr,{used:2,facts:{access_lost:true}});await f.mutate(s=>s.factLedger.at(-1).value=false);
 const before=(await f.state()).factLedger;await f.send('Исправляю: '+literal('account_hacked','access_lost',true));
 assert.deepEqual((await f.state()).factLedger,before);assert.equal(p.scopedFacts(await f.state(),'account_hacked').access_lost,undefined);
});


