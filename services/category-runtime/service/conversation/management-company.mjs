import {createDocumentOffers} from './management-company-documents.mjs';
import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {createScopedQuestionCatalog,choiceValue} from './questions.mjs';
import {fail} from './errors.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const pinned=p=>{const b=fs.readFileSync(p.path);if(b.length!==p.bytes||sha(b)!==p.sha256)fail('MC_SOURCE_INTEGRITY',503);return JSON.parse(b)};
export const mcPolicy=JSON.parse(fs.readFileSync(new URL('./policy/management-company.v1.json',import.meta.url),'utf8'));
export const mcBundle=pinned(mcPolicy.category);
const originalNext=pinned(mcPolicy.next);
const documentOffers=createDocumentOffers(mcPolicy.documents);
const current=s=>s.requestDialogue.cases.find(c=>c.id===s.requestDialogue.caseId);
const selected=c=>c.requests.find(r=>r.id===c.selectedId);
const active=(s,c,r,field)=>s.factLedger.findLast(f=>f.caseId===c.id&&f.subjectId===r.id&&f.field===field&&f.status==='active');
const unsafe=t=>/неправда|неверно|не подтверждаю|не утверждаю|если|допустим|например|возможно|наверное|кажется|сосед|со слов|в статье|цитат|он сказал|она сказала|[«"]я /iu.test(t);
const uncertain=t=>/не знаю|не помню|не уверен|не уверена|неизвестно|предполагаю|вроде|может быть/iu.test(t);
const pastState=t=>/вчера|раньше|на прошлой|в прошлом|тогда|была угроза|была опасность/iu.test(t)&&!/сейчас|до сих пор|по-прежнему/iu.test(t);
const currentStateFields=new Set(['immediate_danger_present','people_injured_or_trapped','service_interruption_present','service_violation_ongoing']);
const correction=t=>/исправляю|уточняю:|ошиб(?:ся|лась)/iu.test(t);
// These bounded factual predicates supplement the existing NEXT buttons. They
// never turn retrieval, an article mask or legal evaluation into user evidence.
export const mcPredicates={
 written_request_sent:['я (?:уже )?(?:отправил|направил)[а]? (?:письменн[а-я]+ )?обращение','я (?:ещ[её] )?не (?:отправлял|направлял)[а]? обращение'],
 delivery_confirmed:['получение (?:моего )?обращения подтверждено','получение (?:моего )?обращения не подтверждено'],
 request_rejected_without_review:['мо[её] обращение (?:закрыли без проверки|отказались регистрировать)','мо[её] обращение зарегистрировали и рассмотрели'],
 response_received:['я получил[а]? ответ (?:от УК|по (?:этому |моему )?обращению)','я (?:ещ[её] )?не получил[а]? ответ'],
 immediate_danger_present:['(?:сейчас |непосредственная )?(?:есть |возникла )?(?:непосредственная угроза (?:людям|жизни|здоровью|имуществу)|угроза жизни|опасность для людей)|людям угрожает опасность','(?:непосредственной )?(?:угрозы|опасности) (?:людям |жизни |здоровью |имуществу )?нет'],
 service_interruption_present:['(?:вода|электричество|отопление|газ) (?:отключен[аоы]?|отсутствует)|нет (?:воды|электричества|отопления|газа)','перерыва в (?:услуге|подаче) нет'],
 service_violation_documented:['(?:нарушение|перерыв|качество услуги) (?:уже )?зафиксирован[ао]? (?:актом|измерениями)','(?:нарушение|перерыв|качество услуги) (?:ещ[её] )?не зафиксирован[ао]?'],
 service_violation_ongoing:['(?:перерыв|нарушение качества) (?:услуги )?продолжается','(?:перерыв|нарушение качества) (?:услуги )?(?:закончился|прекратилось|прекратился)'],
 defect_documented:['дефект (?:уже )?зафиксирован','дефект (?:ещ[её] )?не зафиксирован'],
 written_repair_request_sent:['я (?:уже )?(?:отправил|направил)[а]? (?:письменн[а-я]+ )?заявку на ремонт','я (?:ещ[её] )?не (?:отправлял|направлял)[а]? заявку на ремонт'],
 specific_damage_already_caused:['из-за (?:этого )?дефекта (?:уже )?повреждено (?:мо[её] |конкретное )?имущество','из-за (?:этого )?дефекта имущество не повреждено'],
 applicant_owned_premises_at_meeting:['я (?:был[а]?|являлся|являлась) собственник[а-я]* (?:помещения |квартиры )?на (?:момент|дату) собрания','я не (?:был[а]?|являлся|являлась) собственник[а-я]* на (?:момент|дату) собрания'],
 meeting_notice_received:['я получил[а]? (?:извещение|уведомление) о (?:этом )?собрании','я не получил[а]? (?:извещение|уведомление) о (?:этом )?собрании'],
 protocol_or_vote_register_received:['я получил[а]? (?:копию )?(?:протокола|протокол|реестр голосов) (?:этого )?собрания','я не получил[а]? ни (?:копию протокола|протокол),? ни реестр голосов (?:этого )?собрания'],
 vote_or_signature_mismatch:['(?:запись моего голоса|моя подпись) в (?:протоколе|материалах собрания) (?:не совпадает|расходится)','(?:запись моего голоса|моя подпись) в (?:протоколе|материалах собрания) совпадает'],
 decision_already_implemented:['решение (?:этого )?собрания (?:уже )?исполнено','решение (?:этого )?собрания (?:ещ[её] )?не исполнено'],
 people_injured_or_trapped:['(?:есть пострадавшие|люди не могут безопасно выйти|люди заблокированы)','пострадавших нет[ ,]+все (?:люди )?могут безопасно выйти'],
 emergency_service_contacted:['я (?:уже )?(?:позвонил|обратился|обратилась)[а]? (?:в )?(?:112|АДС|аварийную службу)','я (?:ещ[её] )?не (?:звонил|обращался|обращалась)[а]? ни в 112,? ни в АДС,? ни в аварийную службу'],
 uk_ignored_emergency:['УК (?:прямо )?(?:отказалась реагировать|проигнорировала (?:сообщение об )?аварии?)','УК не игнорировала сообщение об аварии'],
 creating_hoa:['в решении (?:собственников )?указано создание ТСЖ','в решении (?:собственников )?указан выбор новой УК'],
 repeated_breaches_documented:['повторные нарушения (?:УК )?зафиксированы','повторные нарушения (?:УК )?не зафиксированы'],
 meeting_decision_adopted:['решение (?:о смене УК )?(?:собрания |собственников )?принято','решение (?:о смене УК )?(?:собрания |собственников )?(?:ещ[её] )?не принято'],
 old_manager_notified:['прежняя УК (?:уже )?уведомлена','прежняя УК (?:ещ[её] )?не уведомлена'],
 handover_refused:['прежн[а-я]+ (?:УК|управляющий) (?:прямо )?отказал[а-я]* (?:передать|в передаче) (?:документы|документов|ключи|ключей)','отказа (?:прежней УК )?в передаче (?:документов|ключей) не было'],
};
export function prepareMC(s,input,profile){
 const c=current(s),stage=profile.stage.stage.id,old=c.activeStage||'reports';
 c.stageSelections||={};
 if(old!==stage){c.stageSelections[old]=c.selectedId;c.selectedId=c.stageSelections[stage]||null;s.pending=null;c.stopped=false;}
 c.activeStage=stage;s.requestDialogue.activeStage=stage;s.requestDialogue.categoryRuntimeVersion=mcPolicy.version;
 if(stage==='reports')return;
 if(!selected(c)||selected(c).stageId!==stage){let r=c.requests.find(r=>r.stageId===stage&&!r.customSubject);if(!r){r={id:randomUUID(),stageId:stage,label:profile.stage.stage.name,sources:[],asked:[],qualifications:{}};c.requests.push(r)}c.selectedId=r.id;}
}
export function stageFacts(s,profile){const c=current(s),r=selected(c),facts={};if(!r)return facts;for(const f of profile.stage.context_fields){const a=active(s,c,r,f.id);if(a)facts[f.id]=a.value}return facts}
function observeQualifications(s,c,r,text,source,record){
 r.qualifications||={};const q=r.qualifications;
 const choice=text.match(/(?:мы |я |собственники )?выбрали (?:новую )?УК\s*[«"]([^»"]+)[»"]/iu);
 if(choice){if(q.manager!==choice[1]){delete q.licence;delete q.licenceSource;for(const f of s.factLedger.filter(f=>f.caseId===c.id&&f.subjectId===r.id&&f.field==='licensed_new_uk_selected'))f.status='superseded';}q.manager=choice[1];q.selected=true;q.selectionSource=source;}
 if(/новую УК (?:ещ[её] )?не выбрали/iu.test(text)){q.selected=false;q.selectionSource=source;record(s,c,r,'licensed_new_uk_selected',false,source,correction(text));return;}
 const named=[...text.matchAll(/УК\s*[«"]([^»"]+)[»"]/giu)].map(m=>m[1]);
 if(q.selected===true&&q.manager&&(!named.length||named.every(n=>n===q.manager))){
  if(/(?:лицензии (?:у (?:этой |выбранной )?УК )?нет|УК (?:не имеет лицензии|без лицензии))/iu.test(text))q.licence=false;
  else if(/(?:у (?:этой |выбранной )?УК|УК\s*[«"][^»"]+[»"]) есть лицензия|лицензия (?:у этой УК )?есть/iu.test(text))q.licence=true;
  else return;
  q.licenceSource=source;record(s,c,r,'licensed_new_uk_selected',q.licence,source,correction(text));
 }
}
function applyStage(s,input,profile,{record,newCase}){
 const text=input.question.trim();let c=current(s);
 if(/^новый случай\s*:/iu.test(text)){newCase(s);prepareMC(s,input,profile);c=current(s)}
 let r=selected(c);const p=s.pending,choice=choiceValue(text),source={kind:'user_text',turnId:input.turnId,quote:text};
 if(p?.kind==='request_fact'&&choice){record(s,c,r,p.field,choice.value,{...source,questionId:p.id});s.pending=null;return;}
 if(p?.kind==='request_focus'&&p.purpose==='manager_selection'){
   if(/(?:не выбрали|не выбрана)/iu.test(text)){r.qualifications.selected=false;r.qualifications.selectionSource=source;record(s,c,r,'licensed_new_uk_selected',false,source,correction(text));}
   else if(!choice&&!unsafe(text)&&!uncertain(text)&&!/(?:никакую|никого|нет выбора|не определились)/iu.test(text)&&!/[?<>]/u.test(text)&&text.length<=180){r.qualifications.manager=text;r.qualifications.selected=true;r.qualifications.selectionSource={...source,questionId:p.id};}else r.qualifications.selectionUnknown=true;
   s.pending=null;
 }
 if(unsafe(text)||uncertain(text))return;
 if(profile.stage.stage.id==='emergency_house_condition' && /я (?:уже )?звонил[а]? в обслуживающую (?:наш |этот )?дом АДС/iu.test(text) && /несрочн[а-я]+ письменн[а-я]+/iu.test(text) && /(?:сейчас )?опасности нет/iu.test(text))r.qualifications.adsWrittenFollowup={source};
 const parts=text.match(/[^.!?]+[.!?]?/gu)||[];
 const withdrawal=/отзываю (?:свои )?слова/iu.test(text);
 for(const part of parts){if(part.includes('?')||unsafe(part)||uncertain(part))continue;
  for(const field of profile.materialFields){if(currentStateFields.has(field)&&pastState(part))continue;const rules=mcPredicates[field];if(!rules)continue;const yes=new RegExp(rules[0],'iu').test(part),no=new RegExp(rules[1],'iu').test(part);if(!yes&&!no)continue;if(yes&&!no&&/(?:не возникла|не было|не существует|не обнаружено|не подтвердил[а-я]*)/iu.test(part))continue;
   if(withdrawal){for(const f of s.factLedger.filter(f=>f.caseId===c.id&&f.subjectId===r.id&&f.field===field))f.status='withdrawn';continue;}
   record(s,c,r,field,no?false:true,{...source,quote:part.trim()},correction(text));
  }
  if(profile.stage.stage.id==='change_uk')observeQualifications(s,c,r,part,source,record);
 }
 s.pending=null;c.stopped=false;r.sources.push(source);
}
function planStage(s,profile){
 const c=current(s),r=selected(c);if(s.pending||c.used>=profile.normalBudget||c.stopped)return;
 const known=stageFacts(s,profile),conflicted=new Set(s.factLedger.filter(f=>f.caseId===c.id&&f.subjectId===r.id&&f.status==='conflicted').map(f=>f.field));
 for(const q of profile.questions){if(Object.hasOwn(known,q.field)||r.asked.includes(q.field)||conflicted.has(q.field))continue;
  if(q.field==='licensed_new_uk_selected'&&!(r.qualifications?.selected===true&&r.qualifications?.manager)){
   if(r.qualifications?.selectionUnknown||r.asked.includes('private.manager_selection')||known.creating_hoa===true)continue;
   r.asked.push('private.manager_selection');c.used++;s.pending={id:randomUUID(),kind:'request_focus',purpose:'manager_selection',caseId:c.id,requestId:r.id,questionId:'mc.change_uk.manager_selection',text:'Какую конкретную новую УК выбрали собственники? Укажите её название; если пока не выбрали или не знаете, так и напишите.'};return;
  }
  c.used++;r.asked.push(q.field);s.pending={id:randomUUID(),kind:'request_fact',caseId:c.id,requestId:r.id,field:q.field,questionId:q.id,text:q.text+(q.hint?'\n'+q.hint:'')};return;
 }
}
export function withMCStage(reports,stageId){
 const stage=mcBundle.subcategories.find(s=>s.stage.id===stageId);if(!stage)fail('REQUEST_STAGE_UNSUPPORTED',409);
 const spec=mcPolicy.stages.find(s=>s.stageId===stageId);
 const profile={...reports,stage,documentOffers,prepare:prepareMC,materialFields:spec.materialFields,categoryRuntimeVersion:mcPolicy.version};
 if(stageId!=='reports')Object.assign(profile,{questions:spec.questions,fields:{shared:[],sent:null,refused:null},stageAdapter:{facts:stageFacts,applyText:applyStage,plan:planStage},focusQuestion:{id:'mc.'+stageId+'.scope',text:'Какое обстоятельство сейчас разбираем?'}});
 createScopedQuestionCatalog(profile);
 return profile;
}

export function inferMCStage(text, {withinCategory=false}={}) {
 if(typeof text!=='string'||/сосед.*(?:затопил|шумит)|алименты|ДПС|ППС/iu.test(text))return null;
 const housing=withinCategory||/\bУК\b|управляющ[а-я]+ компан|управляющ[а-я]+ организац|ТСЖ/iu.test(text)||/(?:^|\s)УК(?:[\s,.!?]|$)/iu.test(text);
 if(!housing)return null;
 if(/авари|угроза жизни|пострадавш|заблокирован/iu.test(text))return 'emergency_house_condition';
 if(/смен[а-я]* УК|новую УК|создани[а-я]* ТСЖ|передач[а-я]* (?:документ|ключ)/iu.test(text))return 'change_uk';
 if(/собрани|голосован|протокол/iu.test(text))return 'meetings_protocol';
 if(/начислен|квитанци|плат[её]ж|перерасч[её]т/iu.test(text))return 'bills_wrong';
 if(/акт|отч[её]т|документ[а-я]* о (?:выполненн|работ)|запрос[а-я]* документ/iu.test(text))return 'reports';
 if(/качеств[а-я]* (?:услуг|вод)|нет (?:воды|отопления)|перерыв.*услуг/iu.test(text))return 'poor_services';
 if(/дефект|подъезд|крыша|общ[а-я]+ имуществ|ремонт/iu.test(text))return 'common_property';
 if(/не отвеча|без ответ|обращени/iu.test(text))return 'no_response';
 return null;
}
