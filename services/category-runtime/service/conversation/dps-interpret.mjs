// Deliberately bounded observation grammar. Unmatched prose is not a fact.
export const normalizeDpsText = text => text.toLowerCase().replaceAll('ё','е')
  .replace(/[«»“”".!?]+/gu,'').replace(/\s+/gu,' ').trim();
// Each pair denies/asserts the complete existing predicate, never a legal test.
export const observationLanguage = {
 'stop_reason.reason_initially_not_explained':['Вначале инспектор не назвал мне причину остановки','Вначале инспектор назвал мне причину остановки'],
 'stop_reason.reason_explanation_requested':['Я прямо попросил инспектора назвать причину остановки','Я не просил инспектора назвать причину остановки'],
 'stop_reason.reason_requested_and_refused':['После моей просьбы инспектор прямо отказался назвать причину остановки','После моей просьбы инспектор не отказывался назвать причину остановки'],
 'stop_reason.reason_later_explained':['Позже инспектор назвал мне причину остановки','Позже инспектор так и не назвал мне причину остановки'],
 'stop_reason.exit_proposed':['Инспектор предложил мне добровольно выйти из автомобиля','Инспектор не предлагал мне добровольно выйти из автомобиля'],
 'stop_reason.exit_demanded':['Инспектор прямо потребовал, чтобы я вышел из автомобиля','Инспектор не требовал, чтобы я вышел из автомобиля'],
 'document_check.documents_taken_for_check':['Я передал инспектору свои документы для обычной проверки','Я не передавал инспектору свои документы для обычной проверки'],
 'document_check.formal_seizure_declared':['Инспектор прямо сказал мне, что изымает документ','Инспектор не говорил мне, что изымает документ'],
 'document_check.documents_return_refused_after_check':['После окончания обычной проверки инспектор прямо отказался вернуть мои документы','После окончания обычной проверки инспектор не отказывался вернуть мои документы'],
 'document_check.documents_later_returned':['После этого отказа мне все-таки вернули документы','После этого отказа мне так и не вернули документы'],
 'protocol.document_signed':['Я подписал этот протокол','Я еще не подписал этот протокол'],
 'protocol.blank_fields_present':['В этом протоколе я вижу незаполненные поля','В этом протоколе я не вижу незаполненных полей'],
 'protocol.copy_received':['Я получил копию этого протокола','Я не получил копию этого протокола'],
 'protocol.copy_refused':['При оформлении этого протокола инспектор прямо отказал мне в выдаче копии','При оформлении этого протокола инспектор не отказывал мне в выдаче копии'],
 'protocol.objections_recorded':['Мои возражения записаны в этом протоколе','Мои возражения не записаны в этом протоколе'],
 'fine_resolution.copy_received':['Я получил копию этого постановления','Я не получил копию этого постановления'],
 'fine_resolution.copy_refused':['Мне прямо отказали в выдаче копии этого постановления','Мне не отказывали в выдаче копии этого постановления'],
 'fine_resolution.objection_stated':['У меня есть возражения против этого постановления','У меня нет возражений против этого постановления'],
 'fine_resolution.camera_fine':['В моем постановлении написано, что нарушение зафиксировала автоматическая камера','В моем постановлении написано, что нарушение не фиксировала автоматическая камера'],
 'alcohol_test.medical_exam_requested':['Инспектор направил меня на медицинское освидетельствование','Инспектор не направлял меня на медицинское освидетельствование'],
 'alcohol_test.medical_exam_refused':['В моих документах записано, что я отказался от медицинского освидетельствования','В моих документах не записан мой отказ от медицинского освидетельствования'],
 'alcohol_test.medical_exam_completed':['Медицинское освидетельствование, на которое меня направили, уже закончилось','Медицинское освидетельствование, на которое меня направили, еще не закончилось'],
 'alcohol_test.on_site_test_offered':['Мне предложили пройти проверку на опьянение на месте','Мне не предлагали пройти проверку на опьянение на месте'],
 'alcohol_test.on_site_test_completed':['Проверка на опьянение на месте уже закончилась','Проверка на опьянение на месте еще не закончилась'],
 'alcohol_test.witnesses_or_video_present':['Проверка на опьянение на месте проходила с двумя понятыми','Проверка на опьянение на месте проходила без двух понятых и без видеозаписи'],
 'vehicle_search.officer_opened_or_moved_contents':['Инспектор сам открывал отделения моего автомобиля','Инспектор не открывал отделения, не передвигал вещи и не обследовал содержимое моего автомобиля'],
 'vehicle_search.search_protocol_created':['По этим действиям составили протокол досмотра моего автомобиля','По этим действиям не составили протокол досмотра моего автомобиля'],
 'vehicle_search.items_seized':['Из моего автомобиля изъяли вещи','Из моего автомобиля не изымали ни вещи, ни документы'],
 'vehicle_search.grounds_explained':['Инспектор назвал мне основание досмотра автомобиля','Инспектор не назвал мне основание досмотра автомобиля'],
 'vehicle_search.witnesses_or_video_present':['Досмотр моего автомобиля проходил с понятыми','Досмотр моего автомобиля проходил без понятых и без видеозаписи'],
 'vehicle_search.voluntary_show_agreed':['Я согласился сам добровольно показать багажник','Я не соглашался сам добровольно показывать салон или багажник'],
 'vehicle_detention.vehicle_movement_started':['Эвакуатор уже поехал с моим автомобилем','Эвакуатор еще не поехал с моим автомобилем'],
 'vehicle_detention.return_authorization_received':['Я получил документ, в котором прямо разрешено вернуть этот автомобиль','Я не получил документ, в котором прямо разрешено вернуть этот автомобиль'],
 'vehicle_detention.vehicle_return_refused':['После получения документа, разрешающего возврат, мне отказали в выдаче автомобиля','После получения документа, разрешающего возврат, мне не отказывали в выдаче автомобиля'],
 'vehicle_detention.payment_required_before_return':['Перед возвратом автомобиля от меня требуют оплатить его перемещение','Перед возвратом автомобиля от меня не требуют оплачивать ни перемещение, ни хранение'],
 'vehicle_detention.detention_record_created':['О задержании моего автомобиля составили протокол','О задержании моего автомобиля не составили протокол и не сделали отметку'],
 'vehicle_detention.storage_location_known':['Я знаю, на какой специализированной стоянке находится мой автомобиль','Я не знаю, на какой специализированной стоянке находится мой автомобиль'],
 'vehicle_detention.grounds_explained':['Инспектор назвал мне конкретное основание задержания автомобиля','Инспектор не назвал мне конкретное основание задержания автомобиля'],
 'accident_processing.injuries_present':['В этом ДТП есть пострадавшие','В этом ДТП нет пострадавших'],
 'accident_processing.police_called':['О моем ДТП уже сообщили полиции','О моем ДТП еще не сообщили полиции'],
 'accident_processing.other_driver_left_scene':['Другой участник уехал с места моего ДТП','Другой участник не уезжал с места моего ДТП'],
 'accident_processing.vehicles_obstruct_traffic':['Автомобили после моего ДТП мешают проехать другим транспортным средствам','Автомобили после моего ДТП не мешают проехать другим транспортным средствам'],
 'accident_processing.scene_recorded_before_moving':['До перемещения автомобилей я зафиксировал место ДТП','До перемещения автомобилей я не фиксировал место ДТП'],
 'accident_processing.scheme_disputed':['Я не согласен со схемой моего ДТП','Я согласен со схемой моего ДТП'],
};
const stageSignals = [
 ['accident_processing',/дтп|авари[яию]/u],['fine_resolution',/постановлен/u],
 ['vehicle_detention',/эвакуатор|стоянк|задержани.{0,15}автомоб/u],
 ['alcohol_test',/освидетельств|опьянени/u],['vehicle_search',/досм(?:отр|атрива(?:ет|ют)).{0,18}(?:машин|автомоб)|багажник/u],
 ['document_check',/проверк.{0,15}документ|водительск.{0,8}документ|мои документы/u],
 ['protocol',/протокол/u],['stop_reason',/остановил|причин.{0,10}остановк/u],
];
export function interpretDps(s,text,turnId) {
 const t=normalizeDpsText(text),e=s.episodes.find(e=>e.id===s.activeEpisodeId);
 const source={kind:'user_text',turnId,quote:text,span:[0,Array.from(text).length],actor:e?.actor,subjectId:null,episodeId:e?.id};
 const result={source,facts:[],stage:null,actor:null,stageConfirmed:false,subjectConfirmed:false};
 // This grammar accepts direct observations only. Quoted/conditional blocks
 // cannot donate a later exact-matching clause to the current incident.
 if(/[«»“”"]/u.test(text)||/(?:^|[;:]\s*)(?:это (?:цитата|гипотеза)|цитата|в статье|если |а если |допустим|предположим)/u.test(t)){
  result.excluded='quoted_case';return result;
 }
 if (/^(?:если |а если |допустим|предположим|боюсь|в статье|статья|в фильме|цитата|у моего друга|у друга|в чужом|он сказал, что может|инспектор угрожает)/u.test(t)) {
  result.excluded=/стать|цитат|друг|чуж/u.test(t)?'quoted_case':/угрож|может/u.test(t)?'threat':'hypothesis';return result;
 }
 if(/(?:протокол другого человека|автомобиль моего друга|чужой автомобиль|это другой водитель)/u.test(t)){result.excluded='quoted_case';return result}
 result.stop=/^(?:стоп|остановись|закончим|спасибо, достаточно)$/u.test(t);
 result.decline=/^(?:не задавайте вопросы|больше без вопросов|пропустить|пропускаю)$/u.test(t);
 result.newCase=/^(?:это другой случай|это новое происшествие|начнем новый случай)(?:[,: ]|$)/u.test(t)||t==='теперь рассказываю о другой остановке на следующий день';
 result.operation=/^(?:я ошибся|исправляю|поправка)[,: ]/u.test(t)?'correct':'assert';
 result.withdraw=/^(?:отзываю|не подтверждаю) прежний ответ/u.test(t);
 if(/(?:не (?:инспектор (?:дпс|гибдд)|сотрудник (?:гибдд|госавтоинспекции))|сотрудник охраны|это охранник|частной парковки, не госавтоинспекции)/u.test(t))result.actor='other';
 else if(/(?:инспектор (?:дпс|гибдд)|сотрудник госавтоинспекции)/u.test(t))result.actor='traffic_police';
 const hits=stageSignals.filter(([,r])=>r.test(t));
 // More specific procedure mentions take precedence over a protocol mention.
 if(hits.length)result.stage=hits[0][0];
 const stage=result.stage||e?.stageId;
 const personal=/(?:мне|меня|мои|мое|моем|моего|мой|я |я$| со мной|это[тм] протокол|этого протокола|это постановление)/u.test(t);
 result.subjectConfirmed=personal||!!e?.dpsSubjects?.[stage];
 result.stageConfirmed=!!result.stage&&result.subjectConfirmed;
 if(stage==='accident_processing'&&/(?:мое дтп|моем дтп|моего дтп|я попал в (?:дтп|аварию))/u.test(t)){
  result.stageConfirmed=true;result.subjectConfirmed=true;
 }
 result.ambiguousReference=/^(?:он|они|его|ее|этот)(?: |$)/u.test(t)&&!e?.actor||/(?:инспектор и водитель эвакуатора).{0,40}(?:он|они)/u.test(t);
 if(result.ambiguousReference){result.stage=null;result.stageConfirmed=false;return result}
 const subjectMatches=[...t.matchAll(/(первый|первому|первом|второй|второму|втором|другой|новый) (?:мой )?(протокол|документ|автомобиль|акт|постановление|инспектор)/gu)];
 if(new Set(subjectMatches.map(m=>m[1].startsWith('перв')?'first':m[1].startsWith('втор')?'second':'new')).size>1){
  result.ambiguousSubject=subjectMatches.every(m=>['протокол','документ','акт','постановление'].includes(m[2]));
  result.ambiguousReference=!result.ambiguousSubject;
  result.stage=null;result.stageConfirmed=false;return result;
 }
 const subjectMatch=subjectMatches[0];
 result.subjectReference=subjectMatch?(subjectMatch[1].startsWith('перв')?'first':subjectMatch[1].startsWith('втор')?'second':'new'):null;
 if(!stage||!result.subjectConfirmed||((result.actor||e?.actor)!=='traffic_police'&&stage!=='accident_processing'))return result;
 const clauses=[...text.matchAll(/[^;\n]+/gu)].map(m=>{
  let raw=m[0],offset=m.index;
  const prefix=raw.match(/^\s*(?:я ошибся|исправляю|поправка)[,: ]+/iu);
  if(prefix){offset+=prefix[0].length;raw=raw.slice(prefix[0].length)}
  offset+=raw.length-raw.trimStart().length;raw=raw.trim();
  return {text:normalizeDpsText(raw),source:{...source,quote:raw,span:[Array.from(text.slice(0,offset)).length,Array.from(text.slice(0,offset+raw.length)).length]}};
 });
 if(stage==='protocol'){
  if(t==='я не уверен в своем прежнем ответе о подписи больше на него не опирайтесь')result.withdrawField='dps.protocol.document_signed';
  if(t==='отзываю прежний ответ о получении копии этого протокола')result.withdrawField='dps.protocol.copy_received';
  if(t==='я ошибся: копию этого протокола мне не выдавали')result.facts.push({fieldKey:'dps.protocol.copy_received',value:false,operation:'correct',source});
  if(t==='сначала мне прямо отказали в копии протокола сейчас копию выдали'){
   result.facts.push({fieldKey:'dps.protocol.copy_refused',value:true,operation:'assert',source},{fieldKey:'dps.protocol.copy_received',value:true,operation:'correct',source});
  }
 }
 for(const [key,pair] of Object.entries(observationLanguage)){
  if(!key.startsWith(stage+'.'))continue;
  for(let i=0;i<2;i++)for(const clause of clauses.filter(c=>c.text===normalizeDpsText(pair[i])))
   result.facts.push({fieldKey:'dps.'+key,value:i===0,operation:result.operation,source:clause.source});
 }
 // Small, separately explicit OR alternatives. Partial denial is never aggregate false.
 const alternatives={
  'vehicle_search.officer_opened_or_moved_contents':['инспектор сам передвигал вещи в моем автомобиле','инспектор обследовал содержимое моего автомобиля'],
  'vehicle_search.witnesses_or_video_present':['досмотр моего автомобиля проходил с видеозаписью'],
  'alcohol_test.witnesses_or_video_present':['проверка на опьянение на месте проходила с видеозаписью'],
  'vehicle_search.voluntary_show_agreed':['я согласился сам добровольно показать салон'],
  'vehicle_search.items_seized':['из моего автомобиля изъяли документы'],
  'vehicle_detention.payment_required_before_return':['перед возвратом автомобиля от меня требуют оплатить хранение'],
  'vehicle_detention.detention_record_created':['о задержании моего автомобиля сделали соответствующую отметку'],
 };
 for(const [key,values] of Object.entries(alternatives))if(key.startsWith(stage+'.'))for(const clause of clauses.filter(c=>values.includes(c.text)))
  result.facts.push({fieldKey:'dps.'+key,value:true,operation:result.operation,source:clause.source});
 // Explicit later receipt reports do not retract historical refusal.
 if(stage==='protocol')for(const clause of clauses.filter(c=>c.text==='позже я получил копию этого протокола'))result.facts.push({fieldKey:'dps.protocol.copy_received',value:true,operation:'correct',source:clause.source});
 return result;
}
export function dpsPendingValue(pending,text) {
 if(/[«»“”"]/u.test(text))return null;
 const t=normalizeDpsText(text);
 const c=pending?.question.controls?.find(c=>normalizeDpsText(c.label)===t);
 if(c)return {value:c.value};
 if(/^(?:не знаю|не помню|нужно проверить|не могу определить)$/u.test(t)&&pending?.fieldKey)return {value:null};
 return null;
}
