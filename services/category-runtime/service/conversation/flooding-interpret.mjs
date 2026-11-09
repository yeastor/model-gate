// Finite observations for the accepted flooding predicates. Unmatched speech stays raw.
import {currentEpisode} from './state.mjs';
export const normalizeFlooding = text => text.toLowerCase().replaceAll('ё','е').trim().replace(/[.!]+$/u,'').trim();
const entries = [
 ['immediate_actions','electrical_hazard','вода попала на розетки','вода не попала ни на проводку, ни на розетки, ни на электрооборудование'],
 ['immediate_actions','emergency_stopped','поступление воды прекратилось','вода продолжает поступать'],
 ['immediate_actions','emergency_service_called','вызов по этому заливу передан в аварийную службу','ни аварийную службу, ни управляющую организацию по этому заливу не вызывали'],
 ['immediate_actions','upstairs_neighbor_unavailable','доступа в предполагаемую квартиру-источник нет','доступ в предполагаемую квартиру-источник есть'],
 ['immediate_actions','photo_video_saved','первичные последствия этого залива сняты на фото','первичные последствия этого залива не снимали ни на фото, ни на видео'],
 ['act_management','inspection_refused','управляющая организация прямо отказалась проводить осмотр по этому заливу','управляющая организация не отказывалась проводить осмотр по этому заливу'],
 ['act_management','act_copy_received','потерпевший получил копию этого акта','потерпевший не получил копию этого акта'],
 ['act_management','damage_incomplete','в доступной копии этого акта пропущено обнаруженное повреждение','доступный перечень этого акта сверен со всеми известными повреждениями, пропусков нет'],
 ['act_management','objections_recorded','замечания к этому акту изложены письменно','письменных замечаний к этому акту еще нет'],
 ['act_management','independent_evidence_available','есть фотографии по этому заливу','по этому заливу нет ни свидетелей, ни фото, ни видео, ни независимого акта осмотра'],
 ['accused_of_flooding','source_inside_apartment','по результатам осмотра источник протечки внутри моей квартиры','по результатам осмотра источник протечки вне моей квартиры'],
 ['accused_of_flooding','act_names_responsible','в доступном тексте этого акта я прямо указан ответственным за залив','доступный текст этого акта проверен, я не указан ответственным за залив'],
 ['accused_of_flooding','inspection_invitation_received','я получил уведомление об осмотре по этому заливу','уведомлений ни об осмотре, ни об оценке по этому заливу я не получал'],
 ['accused_of_flooding','contractor_worked_recently','перед заливом подрядчик выполнял сантехнические работы в этой системе','перед заливом подрядчик не выполнял сантехнических работ в этой системе'],
 ['who_responsible','act_made','составлен акт об этом заливе с описанием предполагаемой причины','акт об этом заливе с описанием предполагаемой причины не составляли'],
 ['who_responsible','expert_conclusion_available','есть заключение специалиста о причине этого залива','заключения специалиста о причине этого залива нет'],
 ['who_responsible','contractor_worked_recently','перед заливом подрядчик выполнял работы на этом объекте','перед заливом подрядчик не выполнял работ на этом объекте'],
 ['who_responsible','flat_rented_out','на момент залива этой квартирой пользовался наниматель по договору найма','на момент залива этой квартирой не пользовался наниматель'],
 ['damage_estimate','repairs_started','ремонт этих повреждений начали до завершения оценки','до завершения оценки ремонт этих повреждений не начинали'],
 ['damage_estimate','estimate_ready','независимая оценка этого ущерба подготовлена','ни независимая оценка этого ущерба, ни заключение еще не подготовлены'],
 ['damage_estimate','act_made','составлен акт об этом заливе с перечнем повреждений','акт об этом заливе с перечнем повреждений не составляли'],
 ['damage_estimate','hidden_damage_present','после высыхания обнаружены ранее невидимые повреждения','после высыхания новых повреждений не обнаружено'],
 ['damage_estimate','other_party_invited','стороне, к которой предъявлено требование, заранее передали приглашение на этот осмотр','сторону, к которой предъявлено требование, заранее не приглашали на этот осмотр'],
 ['damage_estimate','purchase_receipts_available','сохранились документы о стоимости этих поврежденных вещей','документов о стоимости этих поврежденных вещей нет'],
 ['pretrial_claim','claim_sent','эта письменная претензия направлена этому адресату','эта письменная претензия этому адресату еще не направлена'],
 ['pretrial_claim','delivery_confirmed','есть подтверждение получения этой претензии этим адресатом','подтверждения получения этой претензии этим адресатом нет'],
 ['pretrial_claim','partial_payment_received','получена частичная компенсация именно этого ущерба','частичная компенсация именно этого ущерба не получена'],
 ['pretrial_claim','responsible_is_company','лицо, которому предъявлено это требование, является юридическим лицом','лицо, которому предъявлено это требование, является физическим лицом'],
 ['court','cause_or_fault_disputed','этот ответчик оспаривает причину залива','известно, что этот ответчик не оспаривает ни причину залива, ни свою ответственность'],
 ['court','pretrial_claim_sent','досудебная претензия по этому заливу направлена этому ответчику','досудебную претензию по этому заливу этому ответчику не направляли'],
 ['court','act_made','составлен акт об этом заливе и повреждениях','акт об этом заливе и повреждениях не составляли'],
 ['court','defendant_is_company','этот ответчик является юридическим лицом','этот ответчик является физическим лицом'],
 ['insurance','financial_ombudsman_applied','обращение по этому страховому спору подано финансовому уполномоченному','обращение по этому страховому спору финансовому уполномоченному не подавали'],
 ['insurance','written_refusal_received','получен письменный отказ страховщика в выплате по этому заливу','письменного отказа страховщика в выплате по этому заливу не получали'],
 ['insurance','payment_understated','эта страховая выплата получена, ее размер оспариваю','страховой выплаты по этому заливу еще нет'],
];
export function floodingPendingValue(pending,text) {
 if(pending?.kind!=='next') return null;
 const t=normalizeFlooding(text),control=pending.question.controls.find(c=>normalizeFlooding(c.label)===t);
 return control?{value:control.value}:null;
}
const stageHint = t => /меня обвиняют в заливе/u.test(t)?'accused_of_flooding':/кто отвечает за залив|кто виноват в заливе/u.test(t)?'who_responsible':/страхов(?:щик|(?:ой|ому|ого|ым|ом) спор|(?:ая|ой|ую) выплат)/u.test(t)?'insurance':/суд|ответчик/u.test(t)?'court':/претензи/u.test(t)?'pretrial_claim':/оценк[аиу]|стоимост|скрытые повреждения/u.test(t)?'damage_estimate':/акт|осмотр/u.test(t)?'act_management':/залив|теч[ьие]|вод[аы]/u.test(t)?'immediate_actions':null;
// These labels identify a user-reported current object. They never establish its legal status.
const scopeNames={flatId:'квартира',sourceFlatId:'квартира-источник',componentId:'узел',actId:'акт',inspectionId:'осмотр',inspectionRequestId:'заявка на осмотр',organizationId:'управляющая организация',claimId:'претензия',addresseeId:'адресат',insurerId:'страховщик',insuranceClaimId:'страховой спор',paymentId:'выплата',recipientId:'получатель',damageId:'повреждения',assessmentId:'оценка',contractorId:'подрядчик',occupantId:'наниматель'};
export function interpretFlooding(s,text,turnId) {
 const e=currentEpisode(s),t=normalizeFlooding(text),source={kind:'user_text',turnId,quote:text,span:[0,Array.from(text).length]},facts=[],scope={};
 const nonasserted=/[«»“”"‘’]|(?:^|[^а-я])(?:если|возможно|наверное|кажется|якобы|допустим|предположим)(?:[^а-я]|$)|может быть|не уверен|не уверена|не знаю,|не помню,|сказал|сказала|говорит|говорят|хочу сказать|собираюсь|планирую|в статье|по ссылке|в прошлом году|вчера|в другом случае|в другом эпизоде|боюсь, что|(?:это )?только (?:мой |наш )?план|гипотетическ|ассистент (?:написал|ответил|рекомендует)|текст ассистента/u.test(t);
 const excluded=nonasserted||t.includes('?');
 const foreign=/залив.{0,15}(?:друга|подруги)|квартира (?:друга|подруги)|не моя квартира|чужой случай|залив у (?:соседа|соседки|друга|подруги)/u.test(t);let ambiguous=/^(?:он|она|они|его|ее|там)[ ,:]|^это про (?:него|нее|них)[ .,:]/u.test(t);
 const newCase=/^(?:другой|отдельный|новый) (?:случай|залив|происшествие)[ :]/u.test(t),explicitRoute=/^(?:теперь разберем|перейдем к|нужна помощь по)/u.test(t);
 const stage=(!e.floodStageConfirmed||explicitRoute||newCase)?stageHint(t):e.stageId;
 for(const [key,name]of Object.entries(scopeNames)){
  const matches=[...t.matchAll(new RegExp('(?:^|[ \n,;:.])'+name+' (?:с номером |номер |№\\s*)([a-zа-я0-9-]{1,20})(?=$|[ \n,;:.])','gu'))];
  if(new Set(matches.map(m=>m[1])).size>1){ambiguous=true;continue}
  const m=matches[0];
  if(m&&!['есть','нет','этот','эта','этом','получена','подготовлена','не','является','прямо','по','страховщика'].includes(m[1]))scope[key]=m[1];
 }
 if(/моя квартира|мою квартиру|моей квартир/u.test(t)&&!scope.flatId)scope.flatId=e.floodBase?.actorId==='self'&&e.floodBase?.flatId?e.floodBase.flatId:'own-reported-flat';
 const role=/я потерпевш|мою квартиру залило/u.test(t)?'injured':/меня обвиняют|я ответчик/u.test(t)?'respondent':null;

 // A request can select a help topic without asserting any context fact.
 const requestSafe=!foreign&&!ambiguous&&!nonasserted;
 const requestedStage=requestSafe&&/^(?:меня обвиняют в заливе(?:[.?!]|$)|что делать при заливе|что делать после залива|залив квартиры|нужна помощь по|теперь разберем|перейдем к)/u.test(t)?stageHint(t):null;
 const focus=requestSafe&&/доступ[ау]?|квартиру-источник/u.test(t)?'flooding.immediate_actions.upstairs_neighbor_unavailable':requestSafe&&/размер.{0,25}выплат|выплат.{0,25}размер/u.test(t)?'flooding.insurance.payment_understated':null;
 const operationFor=c=>/^я ошиб(?:ся|лась)[: ,]|^исправляю[: ,]/u.test(c)?'correct':/^теперь[: ,]|^позже[: ,]/u.test(c)?'later':'assert';
 let unsupportedFrame=false;
 if(!excluded&&!foreign&&!ambiguous){
  for(const match of text.matchAll(/[^.;\n]+(?:[.;]|$)/gu)){
   const raw=match[0].replace(/[.;]$/u,''),quote=raw.trim();if(!quote)continue;
   const start=match.index+raw.indexOf(quote),span=[Array.from(text.slice(0,start)).length,Array.from(text.slice(0,start+quote.length)).length];
   const before=facts.length;
   const operation=operationFor(normalizeFlooding(quote));
   let c=normalizeFlooding(quote).replace(/^(?:я ошибся|я ошиблась|исправляю|теперь|позже)[: ,]+/u,'');
   for(const [st,field,yes,no]of entries){if(st!==stage&&!(st==='immediate_actions'&&field==='electrical_hazard'))continue;const value=c===yes?true:c===no?false:undefined;if(value!==undefined)facts.push({fieldKey:'flooding.'+st+'.'+field,value,operation:operation==='later'&&!['emergency_stopped','upstairs_neighbor_unavailable'].includes(field)?'assert':operation,source:{...source,quote,span,basis:'bounded_exact_current_assertion'}})}
   if(stage==='insurance'&&['эта страховая выплата получена, ее размер не оспариваю','размер этой страховой выплаты не оспариваю'].includes(c))facts.push({fieldKey:'flooding.insurance.payment_understated',value:false,operation,source:{...source,quote,span,basis:'bounded_received_payment_no_amount_dispute'}});
   const scopeClause=Object.entries(scopeNames).some(([k,name])=>scope[k]&&new RegExp('^(?:моя |мой )?'+name+' (?:с номером |номер |№\\s*)'+scope[k]+'$','u').test(c));
   const supportedFrame=scopeClause||/^(?:по этому заливу )?я (?:потерпевший|потерпевшая|ответчик)$|^меня обвиняют в заливе$|^мою квартиру залило$|^(?:помогите|спасибо|хорошо|понятно)$/u.test(c)||stage==='insurance'&&['эта страховая выплата получена','размер этой выплаты оспариваю','размер этой страховой выплаты оспариваю'].includes(c);
   if(facts.length===before&&!supportedFrame)unsupportedFrame=true;
  }
 }
 // Never lift a familiar literal out of an otherwise unsupported message frame.
 if(facts.length&&unsupportedFrame){facts.length=0;ambiguous=true}
 return {text,source,stage,scope,role,facts,excluded,foreign,ambiguous,newCase,explicitRoute,requestedStage,focus,withdraw:/^отзываю свое (?:сообщение|утверждение)[.! ]*$/u.test(t),stop:/^(?:не задавайте вопросов|без вопросов|не хочу отвечать)[.! ]*$/u.test(t),repeat:/повторите (?:ответ|памятку)|помогите сейчас/u.test(t),document:/откройте форму|выгрузить документ|сгенерировать документ/u.test(t),ack:/^(?:спасибо|понятно|хорошо|ок)[.! ]*$/u.test(t),confused:/^не понимаю вопрос[.! ]*$/u.test(t)};
}
