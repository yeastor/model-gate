// Bounded current-observation grammar. Unrecognized language stays raw, never a Boolean.
export const normalizePhone = text => text.toLowerCase().replaceAll('ё','е').trim();
export function phonePendingValue(p,text){
 if(!p||!p.question.controls?.length)return null;
 const t=normalizePhone(text).replace(/[.!?]+$/u,'');
 return t==='да'?{value:true}:t==='нет'?{value:false}:/^не (?:знаю|помню)$/u.test(t)?{value:null}:null;
}
const stages=[
 ['return_and_complaint',/не возвраща|возврат|вернуть телефон|место хранения|письменн.{0,15}отказ/u],
 ['copying_data',/копир(?:уют|ует|ование|ования|овать)|копировани/u],
 ['account_access',/аккаунт|учетн.{0,6}запис|мессенджер/u],
 ['deletion_demand',/удал(?:ить|ения|яют|или|ены|ены)|резервн.{0,8}копи/u],
 ['recording_block',/запрет.{0,15}(?:съем|сним|запис)|запреща.{0,15}(?:сним|запис)|файл.{0,10}запис/u],
 ['phone_seizure',/изъят|изыма|забира.{0,10}телефон|телефон забрали/u],
 ['unlock_phone',/разблок|парол.{0,10}телефон|pin|пин|биометри/u],
 ['show_phone',/показать.{0,16}(?:телефон|содержим)|показ.{0,12}содержим/u],
];
// Affirm/deny whole observable only. OR fields need denial of both alternatives.
const rules={
 content_shown:[/я (?:уже )?показал[аи]? (?:сотруднику )?(?:содержимое|переписку|фотографии)/u,/я (?:еще )?ничего не показал[аи]?/u],
 password_disclosed:[/(?:я )?(?:уже )?сообщил[аи]? (?:сотруднику )?(?:пароль|pin|пин)(?: от (?:самого )?телефона)?/u,/(?:я )?(?:пароль|pin|пин)(?: от телефона)? не сообщ(?:ал|ил)[аи]?|не сообщ(?:ал|ил)[аи]? пароль/u],
 unlock_completed:[/телефон (?:уже |фактически )?разблокирован|я (?:уже )?разблокировал[аи]? телефон/u,/телефон (?:еще )?не разблокирован|не удалось разблокировать телефон/u],
 password_or_pin_requested:[/требу[ею]т назвать (?:пароль|pin|пин) (?:от )?(?:самого )?телефона/u,/пароль от телефона не требовали/u],
 biometric_unlock_requested:[/требу[ею]т (?:приложить палец|использовать лицо)/u,/ни палец,? ни лицо (?:для разблокировки )?не требовали/u],
 unlock_requested:[/требу[ею]т разблокировать телефон/u,/разблокировать телефон не требовали/u],
 phone_taken:[/телефон (?:уже )?забрали|забрал[аи]? (?:мой )?телефон/u,/телефон не забирали/u],
 deletion_requested:[/требу[ею]т удалить (?:данные|запись|фотографии)/u,/удалить (?:данные|запись) не требовали/u],
 data_already_deleted:[/данные (?:уже )?удалены|я (?:уже )?удалил[аи]? (?:эти )?данные/u,/данные (?:еще )?не удалены|данные я не удалял[аи]?/u],
 backup_available:[/резервная копия (?:этих данных )?(?:уже )?(?:была|существовала) до (?:этого )?события/u,/резервной копии (?:этих данных )?не было/u],
 deletion_demand_recorded:[/требование (?:об )?удалени[яе] (?:данных )?зафиксировано/u,/требование (?:об )?удалени[яе] (?:данных )?не зафиксировано/u],
 police_recording_targeted:[/требу[ею]т удалить запись действий полиции/u,/удаления записи полиции не требовали/u],
 grounds_explained:[/основание запрета (?:этой )?съемки (?:сотрудник )?назвал/u,/основание запрета (?:этой )?съемки не назвали/u],
 recording_file_preserved:[/файл (?:этой )?записи сохранился/u,/файл (?:этой )?записи не сохранился/u],
 copying_scope_named:[/сотрудник назвал (?:конкретные данные|конкретный объем копирования)/u,/сотрудник не назвал (?:конкретные данные|объем копирования)/u],
 cloud_data_accessed:[/(?:при копировании |сотрудник )?открывали облачные данные (?:этого|моего|текущего) аккаунта/u,/облачные данные (?:этого|моего|текущего) аккаунта не открывали/u],
 account_access_granted:[/вход в (?:этот |текущий )?аккаунт (?:фактически )?состоялся/u,/вход в (?:этот |текущий )?аккаунт не состоялся/u],
 password_or_code_requested:[/сотрудник просил (?:назвать|ввести) (?:пароль|код) (?:от )?(?:этого |текущего )?аккаунта/u,/сотрудник не просил (?:назвать|ввести) (?:пароль|код) (?:от )?(?:этого |текущего )?аккаунта/u],
 storage_location_known:[/я знаю,? где хранится (?:этот )?телефон|место хранения (?:этого )?телефона мне известно/u,/я не знаю,? где хранится (?:этот )?телефон|место хранения (?:этого )?телефона мне неизвестно/u],
 written_return_request_sent:[/я (?:уже )?(?:отправил[аи]?|подал[аи]?) письменное требование о возврате (?:этого )?телефона/u,/я (?:еще )?не (?:отправлял[аи]?|подавал[аи]?) письменное требование о возврате (?:этого )?телефона/u],
 written_refusal_received:[/я получил[аи]? письменный отказ(?: в возврате (?:этого )?телефона)?/u,/я не получал[аи]? письменного отказа/u],
 phone_damaged_or_lost:[/телефон поврежден|телефон утрачен/u,/телефон не поврежден и не утрачен/u],
 data_copying_started:[/данные (?:из телефона )?начали копировать/u,/данные (?:из телефона )?не начинали копировать/u],
 protocol_copy_received:[/я получил[аи]? копию (?:этого )?протокола/u,/копию (?:этого )?протокола я не получил[аи]?/u],
};
export const phoneRuleFields=Object.freeze([...Object.keys(rules),'force_or_threats_used','seizure_protocol_exists']);
function observationMatches(t,yes,no){
 const matches=rx=>[...t.matchAll(new RegExp(rx.source,'gu'))].filter(m=>!/[\p{L}\p{N}_]/u.test(t[m.index-1]||'')&&!/[\p{L}\p{N}_]/u.test(t[m.index+m[0].length]||''));
 const negatives=matches(no),positives=matches(yes).filter(y=>!negatives.some(n=>y.index>=n.index&&y.index+y[0].length<=n.index+n[0].length)&&!/(?:не|не я)\s+$/u.test(t.slice(0,y.index)));
 return [...positives.map(match=>({match,value:true})),...negatives.map(match=>({match,value:false}))].sort((a,b)=>a.match.index-b.match.index);
}
export function interpretPhone(s,text,turnId){
 const t=text.toLowerCase().replaceAll('ё','е'),source={kind:'user_text',turnId,quote:text,span:[0,Array.from(text).length]};
 const out={source,facts:[],text:t};
 out.newCase=/(?:^|[.;])\s*(?:это )?(?:другой случай|другое происшествие)(?:[.;:]|$)/u.test(t);
 out.excluded=/^(?:а )?если(?:\s|$)|имеет ли право|могут ли|предположим|в фильме|читаю статью|в статье|цитирую/u.test(t)||/[«»“”]/u.test(t)&&/(?:написано|прочитал|в статье)/u.test(t);
 out.excluded ||= /(?:^|\s)(?:если|предположим|возможно)(?:\s|,|$)/u.test(t)||/^[«“"]|[«»“”]/u.test(t)||/^я боюсь|^планирую|^собираюсь/u.test(t);
 out.excluded ||= !out.newCase&&/(?:^|\s)(?:вчера|раньше|в прошлом году|в другом случае)(?:\s|[,:;.]|$)/u.test(t);
 // A literal mention inside uncertainty, plans or another speaker's report is not an assertion.
 out.excluded ||= /(?:^|[\s.;:])(?:не знаю,? (?:произошло|было|составлялся)|не уверен[аы]?|не помню,? (?:было|произошло)|планирую|собираюсь|завтра|вдруг|может быть)(?:\s|[,:;.]|$)/u.test(t)||/["«»“”]/u.test(t)||/ассистент (?:написал|сказал)|мне посоветовали|знакомый рассказал|подруга рассказала/u.test(t);
 out.excluded ||= /неправда|не было такого|мне кажется|(?:^|\s)бы(?:\s|[,.!?]|$)|(?:^|\s)ли(?:\s|[,.!?]|$)/u.test(t);
 out.actor=/не сотрудник полиции|охранник|сосед|продавец/u.test(t)?'other':/полицейск|полици/u.test(t)?'police':null;
 out.ambiguousActor=out.actor==='other'&&/полицейск|полици/u.test(t)&&!/не сотрудник полиции/u.test(t);
 out.foreign=/другой (?:телефон|аккаунт|протокол)|другая запись|другие данные|другое требование|телефон (?:моего друга|моей подруги|соседа)|чужой телефон/u.test(t);
 out.ambiguousSubject=/оба телефона|тот телефон|его телефон|(?:^|[\s.;:])(?:он|она|они)(?:\s|[,:;.]|$)/u.test(t);
 out.stage=stages.find(([,rx])=>rx.test(t))?.[0]||null;
 // An existing topic is usable only from persisted user-established scope.
 const e=s.episodes?.find(e=>e.id===s.activeEpisodeId);if(e?.phStageConfirmed&&out.stage==='phone_seizure'&&e.stageId==='return_and_complaint'&&/протокол/u.test(t)&&!/забрали|изымают|забирают/u.test(t))out.stage=e.stageId;
 out.stage ||= !out.newCase&&e?.phStageConfirmed?e.stageId:null;
 const handset=/телефон\s+([абab12])(?![\p{L}\p{N}_])/iu.exec(text);out.handset=handset?.[1].toUpperCase();
 const action=/(?:действие|событие)\s+([абab12])(?![\p{L}\p{N}_])/iu.exec(text);out.action=action?.[1].toUpperCase();
 const account=/аккаунт\s+([абabxy12])(?![\p{L}\p{N}_])/iu.exec(text);out.account=account?.[1].toUpperCase();
 out.cloud=/облачная операция\s+([абab12])(?![\p{L}\p{N}_])/iu.exec(text)?.[1].toUpperCase();
 out.data=/данные\s+([абab12])(?![\p{L}\p{N}_])/iu.exec(text)?.[1].toUpperCase();
 out.recording=/запись\s+([абab12])(?![\p{L}\p{N}_])/iu.exec(text)?.[1].toUpperCase();
 out.record=/протокол\s+([абab12])(?![\p{L}\p{N}_])/iu.exec(text)?.[1].toUpperCase();
 out.request=/требование\s+([абab12])(?![\p{L}\p{N}_])/iu.exec(text)?.[1].toUpperCase();
 out.newAction=/новое (?:действие|копирование|требование|изъятие)/u.test(t);
 out.correct=/я ошиб(?:ся|лась)|исправляю|поправка/u.test(t);
 out.withdraw=/отзываю (?:свое |мо[её] )?сообщение/u.test(t);
 out.later=/теперь|позже|затем|после этого/u.test(t)&&!out.correct;
 out.returned=/телефон (?:позже |теперь )?вернули/u.test(t);
 out.returnCorrection=out.correct&&/телефон (?:позже |теперь )?не вернули/u.test(t);
 out.stop=/не задавайте (?:больше )?вопрос|хватит вопрос/u.test(t);
 out.repeat=/повторите памятку|покажите памятку/u.test(t);
 out.document=/откройте документ|скачать документ|выгрузить черновик|создать заявление/u.test(t);
 if(out.excluded||out.actor==='other'||out.foreign||out.ambiguousActor||out.ambiguousSubject)return out;
 // A report about a field of the established current action does not itself switch topics.
 // A new action or an explicit request to change topic still goes through stage routing.
 const currentStage=e?.phStageConfirmed&&!out.newCase&&!out.newAction?e.stageId:null;
 const appliesHere=field=>(s.categoryFieldKeys||[]).includes('phone_police.'+currentStage+'.'+field);
 const currentObservation=Object.entries(rules).some(([field,pair])=>appliesHere(field)&&pair.some(rx=>rx.test(t)))||appliesHere('force_or_threats_used')&&/сил|угроз|угрожал|ударил|толкнул/u.test(t)||appliesHere('seizure_protocol_exists')&&/протокол/u.test(t);
 if(currentObservation&&!/перейдем к|теперь речь о|теперь о другом/u.test(t))out.stage=currentStage;
 const stage=out.stage;if(!stage)return out;
 const operation=out.correct?'correct':'assert';
 const propose=(field,value,match,basis=null)=>{if(!match||!(s.categoryFieldKeys||[]).includes('phone_police.'+stage+'.'+field))return;const start=match.index;const quote=text.slice(start,start+match[0].length);out.facts.push({fieldKey:'phone_police.'+stage+'.'+field,value,operation,source:{...source,quote,span:[Array.from(text.slice(0,start)).length,Array.from(text.slice(0,start+match[0].length)).length],basis}})};
 for(const [field,[yes,no]]of Object.entries(rules)){
  // A phone password and refusal to return this phone are narrower than their shared words.
  if(field==='password_disclosed'&&/пароль (?:от|для) (?:аккаунт|учетн|почт|мессенджер|другого телефона)/u.test(t))continue;
  if(field==='written_refusal_received'&&/письменный отказ (?:в принятии|в регистрации|по другому|на другое)/u.test(t))continue;
  for(const m of observationMatches(t,yes,no))propose(field,m.value,m.match);
 }
 const noForce=/силы и угроз не было|ни силы,? ни угроз не было/u;
 const force=/применили физическую силу|сотрудник ударил|сотрудник толкнул|сотрудник (?:полиции )?(?:высказал угрозы|угрожал)/u;
 for(const m of observationMatches(t,force,noForce))propose('force_or_threats_used',m.value,m.match);
 const noncreation=/сотрудник (?:полиции )?(?:прямо )?(?:сказал|сообщил),? что протокол (?:по этому событию )?не составлялся/u;
 const exists=/я видел[аи]? протокол (?:изъятия )?(?:этого )?телефона/u;
 for(const m of observationMatches(t,exists,noncreation))propose('seizure_protocol_exists',m.value,m.match,m.value?'user_saw_specific_seizure_protocol':'attributed_officer_report_noncreation');
 return out;
}
