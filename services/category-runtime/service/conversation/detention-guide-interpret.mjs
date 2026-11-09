// Bounded observations for the pinned DT category. Unmatched language is not a fact.
import {choiceValue} from './questions.mjs';
export const normalizeDetention = t => t.toLowerCase().replaceAll('ё','е').trim();
export function detentionPendingValue(pending,text) {
  return pending?.kind==='next'||pending?.key==='actor' ? choiceValue(text) : null;
}

// Only finite current assertions enter the grammar. Quoted/modal/question clauses stay raw.
function assertionClauses(text) {
 if(/^(?:это гипотеза|это цитата|цитата из|в статье|в прошлом году|в другом эпизоде|боюсь, что)/u.test(normalizeDetention(text)))return [];
 const quoted=[...text.matchAll(/«[^»]*(?:»|$)|"[^"]*(?:"|$)/gu)].map(m=>[m.index,m.index+m[0].length]);
 return [...text.matchAll(/[^.!?;\n]+[.!?]?/gu)].filter(m=>!quoted.some(([a,b])=>m.index<b&&m.index+m[0].length>a)).map(match=>{const raw=match[0],quote=raw.trim(),offset=match.index+raw.indexOf(quote),c=normalizeDetention(quote);return {quote,c,span:[Array.from(text.slice(0,offset)).length,Array.from(text.slice(0,offset+quote.length)).length]}}).filter(({quote,c})=>quote&&(!/чтобы/u.test(c)||/(?:мне сейчас угрожают|на меня давят).*отвеча/u.test(c))&&!/[«»"?]/u.test(c)&&!/(?:^|[^а-я])(?:если|возможно|наверное|кажется|предположим|допустим|якобы|вероятно)(?:[^а-я]|$)|может быть|не уверен|не уверена|не помню|не знаю,|я не говорил[аи]?(?:[^а-я]|$)|не утверждаю|скажу|буду|сказал бы|сказала бы|может сказать|мог сказать|потребовал|неверно, что|он сказал|она сказала|не исключаю|будто|не факт|я отрицаю|обещал|пригрозил|говорит,? что я|говорят:|не означает|не значит|неправда|это гипотеза|это цитата|цитата из|в статье|в прошлом году|в другом эпизоде|боюсь, что|не у меня|хотел бы|хотела бы|собираюсь|планирую/u.test(c));
}
function observedStage(t,e,newCase=false) {
 let stage=null;
 if(/травм|заболеван|болезнь|лекарств|первая помощь|дышать|задыхаюсь/u.test(t))stage='first_words';
 else if(/адвокат/u.test(t)&&/не допуска|отказал в допуске|наедине|связаться|позвонить/u.test(t))stage='lawyer_and_call';
 else if(/против себя|показания|объяснение|статус свидетеля|статус подозреваемого|угрожают.*отвеча|давят.*отвеча|нет ни давления, ни угроз/u.test(t))stage='silence_51';
 else if(/досмотр|обыск|забрали.*(?:телефон|вещ)|(?:телефон|вещи).*забрали/u.test(t))stage='search_and_seizure';
 else if(/копи[юяи]|протокол|пустые графы|замечания/u.test(t))stage='protocols_and_copies';
 else if(/(?:^|[^а-я])час(?:а|ов)?(?:$|[^а-я])|точно знаю время.*впервые не дали уйти|точное время начала|время начала.*задержания|административное задержание|подозрению в преступлении|решение суда/u.test(t))stage='holding_time';
 else if(/основани|процедур|права.*разъясн|статус.*неяс/u.test(t))stage=e?.stageId==='detention_moment'&&!newCase&&!/основани|процедур|права/u.test(t)?'detention_moment':'status_and_basis';
 else if(/уйти|выход|движение|поехать добровольно/u.test(t))stage='detention_moment';
 else if(/попросил[аи]? адвоката/u.test(t))stage=['first_words','lawyer_and_call'].includes(e?.stageId)?e.stageId:'first_words';
 if(!stage&&(!e?.stageId||newCase)&&/полици[а-я]* (?:меня )?удержива[а-я]*|меня удержива[а-я]* полици/u.test(t))stage='detention_moment';

 return stage;
}

export function interpretDetention(s,text,turnId) {
 const e=s.episodes.find(e=>e.id===s.activeEpisodeId),clauses=assertionClauses(text),t=normalizeDetention(clauses.map(c=>c.quote).join('; '));
 const out={facts:[],source:{kind:'user_text',turnId,quote:text,span:[0,Array.from(text).length]},stage:null,actor:null};
 out.newCase=/^(?:это )?(?:другой случай|другое происшествие)[,.:; ]/u.test(t);
 out.stop=/^(?:стоп|остановись|не задавайте вопросы|без вопросов)[.!]*$/u.test(t);
 out.repeat=/^(?:покажи|покажите|повтори|повторите) (?:полную памятку|памятку|ответ)[.!]*$/u.test(t);
 out.documentRequest=/^(?:открой|откройте|подготовь|подготовьте) (?:документ|форму)[.!]*$/u.test(t);
 out.confused=/^(?:не понимаю вопрос|что значит вопрос)[.!?]*$/u.test(t);
 out.resume=/^(?:продолжим|продолжить)[.!]*$/u.test(t);
 out.excluded=clauses.length===0;
 if(out.excluded)return out;
 if(/не (?:полицейский|сотрудник полиции|полиция)|это охранник|это сотрудник магазина/u.test(t))out.actor='other';
 else if(/полицейск|полици/u.test(t))out.actor='police';
 out.ambiguousActor=/полицейск|полици/u.test(t)&&/охранник|врач|продавец/u.test(t);
 out.foreignSubject=/(?:моего|моей) (?:друга|подруги|жены|мужа|брата|соседа)|другого человека|чужой протокол/u.test(t);
 out.urgent=/^(?:.*[;.!] )?(?:мне нужна первая помощь|мне трудно дышать|я задыхаюсь|теряю сознание)(?:[.!; ]|$)/u.test(t);
 if(out.actor==='other'||out.ambiguousActor||out.foreignSubject)return out;
 out.subjectReference=/перв(?:ый|ому|ом) (?:мой )?протокол/u.test(t)?'first':/втор(?:ой|ому|ом) (?:мой )?протокол/u.test(t)?'second':null;
 out.ambiguousSubject=/копи[а-я]* (?:другого|не этого)|другой (?:мой )?протокол/u.test(t)||/перв(?:ый|ого|ом).*протокол/u.test(t)&&/втор(?:ой|ого|ом).*протокол/u.test(t);
 if(out.ambiguousSubject)return out;
 out.newRequest=/нов(?:ая|ую) просьб[ау] об адвокате|снова впервые попросил адвоката/u.test(t);
 out.newSearch=/другой досмотр|новый досмотр/u.test(t);
 out.stage=observedStage(t,e,out.newCase);
 const stage=out.stage||e?.stageId;
 const operation=/^(?:исправляю|я ошибся|я ошиблась|исправление)[: ,]/u.test(t)?'correct':/^(?:отзываю|не уверен в прежнем ответе)/u.test(t)?'withdraw':'assert';
 out.withdraw=operation==='withdraw';
 for(const {quote,c,span} of clauses){
  const stage=observedStage(c,{...e,stageId:out.stage||e?.stageId},out.newCase)||out.stage||e?.stageId;
  const source={kind:'user_text',turnId,quote,span};
  const add=(field,value,extra={})=>{if(/чтобы/u.test(c)&&field!=='pressure_or_threats')return;out.facts.push({fieldKey:'detention_guide.'+stage+'.'+field,value,operation,source,...extra})};
  const binary=(field,yes,no)=>{if(no.test(c))add(field,false);else if(yes.test(c))add(field,true)};
  if(stage==='detention_moment'){
   binary('free_to_leave_denied',/сотрудник (?:прямо )?сказал,? что (?:мне|вам) нельзя уйти|прямо запретил (?:мне )?уйти/u,/прямого запрета уйти не было|сотрудник не запрещал (?:мне )?уйти/u);
   binary('movement_physically_blocked',/выход (?:сейчас )?физически (?:перекрыт|блокируют)|движение физически блокируют/u,/выход (?:сейчас )?физически не перекрыт|физической преграды нет/u);
   binary('voluntary_trip_agreed',/я согласил(?:ся|ась) поехать добровольно/u,/я не соглашал(?:ся|ась) поехать/u);
  }
  if(['detention_moment','first_words'].includes(stage))binary('restriction_time_recorded',/я записал[аи]? время (?:первого |фактического )?ограничения/u,/я не записал[аи]? время ограничения/u);
  if(['detention_moment','status_and_basis'].includes(stage))binary('status_unclear',/мой статус (?:мне )?неясен|я не понимаю свой статус/u,/мой статус мне ясен/u);
  if(stage==='status_and_basis'){
   binary('grounds_explained',/сотрудник назвал основание (?:моего )?(?:удержания|ограничения)/u,/слышал[аи]? ответ.*основани[ея] (?:он |сотрудник )?не назвал/u);
   binary('procedure_type_explained',/сотрудник назвал (?:применяемую )?процедуру/u,/слышал[аи]? ответ.*процедуру не назвал/u);
  }
  if(['first_words','lawyer_and_call'].includes(stage)){
   binary('lawyer_requested',/я (?:уже |прямо )?попросил[аи]? (?:предоставить (?:мне )?)?адвоката/u,/я (?:еще )?не просил[аи]? (?:предоставить (?:мне )?)?адвоката/u);
   binary('minor_person',/мне (?:1[0-7]|[0-9]) лет|мне нет 18 лет/u,/мне (?:1[89]|[2-9][0-9]) лет|я совершеннолетн(?:ий|яя)/u);
  }
  if(stage==='first_words'){
   if(/у меня (?:есть )?(?:травма|заболевание|болезнь)|мне нужны лекарства/u.test(c))add('health_risk_present',true);
   if(/у меня нет (?:ни )?травмы,? (?:ни )?заболевания.*лекарства не нужны/u.test(c))add('health_risk_present',false);
   binary('close_relatives_notification_requested',/я попросил[аи]? уведомить (?:моих )?близких/u,/я не просил[аи]? уведомить близких/u);
  }
  if(stage==='silence_51'){
   binary('questions_about_self_or_relatives',/вопросы касаются (?:только )?меня самого/u,/вопросы не касаются ни меня, ни моих близких/u);
   binary('suspect_status_declared',/мне объявили статус (?:подозреваемого|обвиняемого)/u,/мне не объявляли статус подозреваемого или обвиняемого/u);
   binary('witness_status_declared',/мне объявили статус свидетеля/u,/мне не объявляли статус свидетеля/u);
   binary('lawyer_present',/мой адвокат сейчас присутствует/u,/мой адвокат сейчас отсутствует|адвоката сейчас нет/u);
   binary('pressure_or_threats',/мне сейчас угрожают.*отвеча|на меня давят.*отвеча/u,/сейчас нет ни давления, ни угроз/u);
   binary('statement_already_signed',/я подписал[аи]? (?:это )?(?:объяснение|показания)/u,/я не подписывал[аи]? (?:это )?(?:объяснение|показания)/u);
  }
  if(stage==='lawyer_and_call'){
   binary('lawyer_access_refused',/сотрудник прямо отказал в допуске адвоката/u,/прямого отказа в допуске адвоката не было/u);
   binary('private_meeting_refused',/мне прямо отказали в разговоре с адвокатом наедине/u,/в разговоре с адвокатом наедине не отказывали/u);
   binary('phone_blocked',/сотрудник не дает мне позвонить близким/u,/сотрудник разрешил мне позвонить близким/u);
   binary('close_relatives_notified',/мои близкие подтвердили,? что их уведомили/u,/мои близкие подтвердили,? что их не уведомили/u);
  }
  if(stage==='protocols_and_copies'){
   binary('document_signed',/я подписал[аи]? (?:этот |свой )?протокол/u,/я не подписывал[аи]? (?:этот |свой )?протокол/u);
   binary('blank_fields_present',/в (?:этом )?протоколе (?:вижу |есть )?пустые графы/u,/я прочитал[аи]? (?:этот )?протокол.*пустых граф нет/u);
   binary('remarks_refused',/сотрудник не дает внести мои замечания/u,/сотрудник разрешил внести мои замечания/u);
   out.copyRequested ||= /я попросил[аи]? копию (?:этого )?протокола/u.test(c);
   out.copyNotRequested ||= /я не просил[аи]? копию/u.test(c);
   if(/(?:запрошенную |эту )?копию (?:мне )?(?:пока )?не выдали/u.test(c))out.copyResult={value:true,source};
   else if(/мне выдали (?:именно )?запрошенную копию/u.test(c))out.copyResult={value:false,source};
  }
  if(stage==='search_and_seizure'){
   binary('same_sex_officer_present',/личный досмотр проводит сотрудник моего пола/u,/личный досмотр проводит сотрудник другого пола/u);
   binary('phone_seized',/(?:мой )?телефон забрали и оставили у сотрудников/u,/телефон не забирали|телефон ненадолго взяли и сразу вернули/u);
   binary('non_phone_items_seized',/(?:хотя бы одну вещь|вещи) кроме телефона забрали и оставили у сотрудников/u,/другие вещи не забирали|все другие вещи ненадолго взяли и сразу вернули/u);
   binary('grounds_explained',/сотрудник назвал основание (?:этого )?досмотра/u,/слышал[аи]? ответ.*основание досмотра не назвал/u);
   out.laterPhoneReturn ||= /телефон (?:теперь|позже) вернули/u.test(c);
   out.laterItemsReturn ||= /другие вещи (?:теперь|позже) вернули/u.test(c);
  }
  if(stage==='holding_time'){
   binary('administrative_detention_declared',/сотрудник (?:прямо )?объявил (?:мне )?административное задержание/u,/слышал[аи]? ответ.*административное задержание не объявляли/u);
   binary('criminal_suspicion_declared',/сотрудник (?:прямо )?сказал,? что меня задержали по подозрению в преступлении/u,/слышал[аи]? ответ.*о подозрении в преступлении не говорили/u);
   binary('detention_start_time_known',/я точно знаю время,? когда мне впервые не дали уйти/u,/я проверил[аи]? сведения.*точное время начала мне неизвестно/u);
  }
 }
 if(stage==='first_words'&&/у меня нет (?:ни )?травмы,? (?:ни )?заболевания[;,. ]+лекарства не нужны/u.test(t)&&!out.facts.some(f=>f.fieldKey.endsWith('.health_risk_present')))out.facts.push({fieldKey:'detention_guide.first_words.health_risk_present',value:false,operation,source:out.source});
 // Whole-message requests and their outcomes stay private until same-document linkage is established.
 if(operation==='withdraw'){out.withdrawFields=[...new Set(out.facts.map(f=>f.fieldKey))];out.facts=[];}
 out.urgentEnded=/первая помощь больше не нужна/u.test(t);
 return out;
}
