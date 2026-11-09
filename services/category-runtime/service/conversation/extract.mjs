// Bounded Russian extractor. Definitions come from the reviewed package;
// examples are test data and are never loaded here.
import { dialoguePackage } from "./package.mjs";
import { currentEpisode, project } from "./state.mjs";
import { otherDocumentOwner } from "./evidence.mjs";
const n = (s) =>
  s
    .toLowerCase()
    .replaceAll("ё", "е")
    .replaceAll("паспарт", "паспорт")
    .replaceAll("полицыи", "полиции")
    .replaceAll("сотруднк", "сотрудник");
const re = (p, t) => new RegExp(p, "u").test(t);
const unknown = (t) =>
  /не знаю|не помню|неизвест|не извест|непонят|не уверен|не понял.{0,35}(?:ли|отказ|причин|основан)/u.test(
    t,
  );
// An unspecified document needs confirmation before it becomes identity context.
export function documentTakingReport(text) {
  const t = n(text);
  if (!/паспорт|документ/.test(t) || otherDocumentOwner(t)) return null;
  if (
    /(?:^|[\s,«])если(?:\s|$)|имеет ли право|в фильме|в кино|в прошлом году|в другом эпизоде|^боюсь|^я боюсь|собирается|хочет забрать|угрожает|заберет/.test(
      t,
    )
  )
    return null;
  if (
    /(?:у |паспорт |документы )(?:моего друга|соседа|брата|прохожего)|я (?:сам )?(?:забрал|унес)|(?:паспорт|документы).{0,15}забрал я|у (?:сотрудника полиции|полицейского).{0,12}(?:забрал|забрали)|договор|протокол|документ.{0,20}(?:по делу|на квартиру)/.test(
      t,
    )
  )
    return null;
  const positive =
    /(?:^|[^а-я])(?<!не )(?:забрал(?:а|и)?|забира(?:ет|ют)|унес(?:ла|ли)?|унос(?:ит|ят))[^.!?;\n]{0,60}(?:паспорт[а-я]*|документ[а-я]*)|(?:паспорт[а-я]*|документ[а-я]*)[^.!?;\n]{0,60}(?<!не )(?:забрал(?:а|и)?|забира(?:ет|ют)|унес(?:ла|ли)?|унос(?:ит|ят))/u.test(
      t,
    );
  const negative = /(?:не забирал(?:а|и)?|не забрал(?:а|и)?)/.test(t);
  if (!positive && !negative) return null;
  const uncertain =
    unknown(t) || /возможно|может быть|забрал(?:а|и)? ли/.test(t);
  return {
    value: uncertain ? null : positive ? true : false,
    kind: /паспорт|документ.{0,30}(?:удостоверяющ|подтвержден).{0,15}личност/.test(
      t,
    )
      ? "identity"
      : "unspecified",
  };
}

// Keep each component bound to its reported actor and current time. A third
// party's restriction must not become a police fact through episode inheritance.
function restrictionClauses(t) {
  const clauses = t.split(/[;.!?]+|\s+но\s+|,\s*(?:а |однако |зато )|,\s*(?=теперь(?:\s|$)|сейчас(?:\s|$))/u);
  const hasCurrent = /теперь|сейчас/u.test(t);
  let otherActor = false;
  return clauses.filter(c => {
    if (/охранник|врач|сосед|продавец|сотрудник магазина/u.test(c)) {
      otherActor = true;
      return false;
    }
    if (/полицейск|сотрудник(?:а|и|ом)? полиции/u.test(c)) otherActor = false;
    if (otherActor) return false;
    return !(hasCurrent && /раньше|ранее|сначала|до этого/u.test(c));
  });
}

const rules = {
  reason_explained: (t, stage) => explanation(t, stage),
  grounds_explained: (t, stage) => explanation(t, stage),
  identity_document_requested: (t) =>
    decide(
      t,
      /паспорт|документ.{0,20}личност|документ не спрашивал/,
      /не (?:просил|запрашивал)|документ не спрашивал/,
      /(?:попросил|запросил|просит|просят|требует).{0,45}(?:паспорт|документ)/,
    ),
  recording_blocked: (t) =>
    decide(
      t,
      /запис|сним|съемк|камер/,
      /(?:не запрещает.{0,10}(?:и )?не мешает|разрешил снимать.{0,30}не мешает|съемке не мешает)/,
      /запрещает.{0,25}(?:сним|запис)|закрывает.{0,12}камер|мешает.{0,15}запис/,
    ),
  free_to_leave_denied: (t) => {
    if (!/уйти|уходить|удержива|не отпуска|выпуска|выход|держит/u.test(t)) return;
    const clauses = restrictionClauses(t);
    const certain = clauses.filter(c => !unknown(c));
    // A negative/unknown OR component does not negate another observed one.
    if (certain.some(c =>
      /не разреша[^;.!?]{0,35}(?:уйти|уходить)|(?<!не )запретил[^;.!?]{0,25}(?:уйти|уходить)|не (?:отпускает|отпускают|выпускает|выпускают)|(?<!не )удержива(?:ет|ют) (?:меня|за руку)|(?<!не )держит меня за руку|(?<!не )прегражда(?:ет|ют)[^;.!?]{0,20}(?:выход|путь)/u.test(c)
    )) return true;
    const explicitUnknown = clauses.some(c => unknown(c) && /уйти|уходить|удержива|держит|выпуска/u.test(c));
    const known = certain.join("; ");
    const permission = /(?<!не )разреш(?:ил[аи]?|ает|ают)[^;.!?]{0,60}уйти|(?<!не )могу[^;.!?]{0,35}уйти/u.test(known);
    const noPhysical = /(?:больше )?не (?:удержива(?:ет|ют)|держит)|фактически[^;.!?]{0,25}не удержива/u.test(known);
    const aggregateDeparture = /(?<!не )могу (?:сейчас )?свободно уйти|(?<!не )разреш(?:ил[аи]?|ает|ают)[^;.!?]{0,35}отказаться[^;.!?]{0,35}уйти/u.test(known);
    if (!explicitUnknown && permission && (noPhysical || aggregateDeparture)) return false;
    if (explicitUnknown) return null;
  },
  documents_present: (t) => {
    if (!/паспорт|документ/.test(t)) return;
    if (unknown(t)) return null;
    if (
      /ни паспорта,? ни (?:другого )?документ|нет.{0,12}(?:ни паспорта|документов).{0,35}личност/.test(
        t,
      )
    )
      return false;
    if (
      /(?:при себе есть|с собой (?:был|есть)|паспорт был со мной|со мной (?:есть|был)).{0,25}(?:паспорт|документ)|паспорт был со мной|есть другой документ для подтверждения личности/.test(
        t,
      )
    )
      return true;
  },
  taken_to_station_for_id: (t) =>
    decide(
      t,
      /личност|в отдел.{0,15}зачем/,
      /не везут|никуда не везут/,
      /(?:везут|везет).{0,40}для установления личности/,
    ),
  documents_taken_away: (t) => documentTakingReport(t)?.value,
  minor_person: (t) => {
    const age =
      /(?:мне|проверяемому|доставляемому|этому человеку)\s+(\d{1,3})\s*(?:лет|год)/.exec(
        t,
      );
    if (age) return Number(age[1]) < 18;
    return decide(
      t,
      /(?:не знаю.{0,20}возраст|возраст.{0,20}не знаю)|18 лет|совершеннолет|несовершеннолет/,
      /уже (?:есть )?18|совершеннолетний/,
      /еще нет 18|несовершеннолетний/,
    );
  },
  phone_taken: (t) =>
    decide(
      t,
      /телефон/,
      /не забирали|не забирал|его не забирал/,
      /(?:забрал|забрали|забирает).{0,20}(?:мой )?телефон/,
    ),
  voluntary_trip_agreed: (t) =>
    decide(
      t,
      /поездк|(?:ехать|поеха).{0,30}отдел|соглас.{0,25}поезд|добровольного согласия/,
      /не соглашался|согласия не давал|добровольного согласия не давал/,
      /добровольно согласил/,
    ),
  delivery_record_created: (t) =>
    decide(
      t,
      /доставлен|что это за документ/,
      /не оформили|не записали/,
      /документально оформили|оформил(?:и)?.{0,25}документально|доставлен.{0,20}записали в документ/,
    ),
  signature_on_explanation_requested: (t) => {
    if (/подписать протокол.{0,25}а не объяснение/.test(t)) return false;
    return decide(
      t,
      /подпис.{0,30}объяснен|объяснен.{0,30}подпис/,
      /не просят|не просит|отозвал просьбу/,
      /(?:просит|просят|требует).{0,35}подпис/,
    );
  },
  refusal_pressure: (t) => {
    if (!/объяснен|отказа писать/.test(t)) return;
    if (/не давит|не давят|прекратил давление|а не сотрудник полиции/.test(t))
      return false;
    if (/сейчас говорит.{0,50}если откажешься писать,? пожалеешь/.test(t))
      return true;
    return decide(
      t,
      /давит|давят|давление/,
      /не давит|не давят|прекратил давление/,
      /давит на меня|давят на меня|на меня давит/,
    );
  },
  copy_requested: (t) => {
    if (!/копи/.test(t) || !/объяснен/.test(t)) return;
    if (/копию протокола|копию другого объяснения/.test(t)) return;
    return decide(
      t,
      /копи/,
      /не просил|не запрашивал/,
      /(?:просил|попросил|запрашивал).{0,45}копи|копи.{0,35}(?:просил|попросил)/,
    );
  },
  copy_requested_and_refused: (t) => {
    if (!/копи|выдать.{0,20}объяснен/.test(t) || !/объяснен/.test(t)) return;
    if (unknown(t)) return null;
    if (/(?:^|[\s,;:.])(?:не отказывали|не отказал|ответа еще нет)/.test(t))
      return false;
    if (
      /(?:прямо )?отказал|отказали/.test(t) &&
      /после.*(?:прос|запрос)|просил.*отказ|попросил.*отказ/.test(t)
    )
      return true;
  },
  procedural_status_explained: (t) =>
    decide(
      t,
      /статус|качеств/,
      /не объяснил|не разъяснил/,
      /объяснил.{0,30}(?:качеств|статус)|разъяснил.{0,20}статус/,
    ),
  questions_about_self_or_relatives: (t) => {
    if (!/вопрос|спрашива/.test(t)) return;
    if (unknown(t)) return null;
    if (
      /не касаются ни меня|только постороннего|о дальнем знакомом.{0,60}вопросов нет/.test(
        t,
      )
    )
      return false;
    if (
      /спрашивает.{0,15}мою фамилию|спрашива.{0,25}о моих|спрашива.{0,25}моих собственных|вопрос.{0,20}(?:обо мне|супруге|близких родственниках)/.test(
        t,
      )
    )
      return true;
  },
  same_sex_officer_present: (t) => {
    if (!/пол|кто проводит/.test(t)) return;
    if (unknown(t)) return null;
    if (/проводит.{0,25}(?:другого|противоположного).{0,15}пола/.test(t))
      return false;
    if (
      /проводит.{0,40}(?:того же|одного).{0,10}пола|того же пола.{0,35}проводит/.test(
        t,
      )
    )
      return true;
  },
  witnesses_or_video_present: (t) => {
    if (!/понят|видео|камер/.test(t)) return;
    const noW = /понятых нет|нет (?:ни )?понятых|понятые ушли/.test(t);
    const noV =
      /ни видеозаписи|видео не ведется|видеозапись.{0,25}выключена/.test(t);
    if (noW && noV) return false;
    const yesW = /присутствуют понятые|есть понятые|с понятыми/.test(t) && !noW;
    const yesV =
      /(?:видеозапись ведется|ведется видеозапись|снимают на видео|с понятыми и видеозаписью)/.test(
        t,
      ) && !noV;
    if (yesW || yesV) return true;
    if (unknown(t)) return null;
  },
  bag_opened_by_officer: (t) => {
    if (!/сумк|рюкзак|откры/u.test(t)) return;
    if (unknown(t) && /откры/u.test(t)) return null;
    const clauses = t.split(/[;.!?]+|,|\s+но\s+/u)
      .filter(c => !/(?:друг|подруга|сосед) открыл|я (?:сам )?открыл/u.test(c));
    const own = clauses.join("; ");
    if (/сотрудник[^;.!?]{0,45}(?<!не )открывает[^;.!?]{0,35}(?:мою|мою первую|мою вторую) (?:сумку|рюкзак)/u.test(own)) return true;
    if (/не открывал[^;.!?]{0,70}(?:и сейчас не открывает|и не открывает)|сотрудник полиции ее не открывал|а открыл ее я сам|я открыл ее своими руками/u.test(t)) return false;
    if (/(?<!не )открыл[^;.!?]{0,50}(?:мою|мою первую|мою вторую|мою другую) (?:сумку|рюкзак)/u.test(own)) return true;
  },
  voluntary_show_agreed: (t) =>
    decide(
      t,
      /рюкзак|содержим|сумк/,
      /не давал|согласия.{0,45}не давал/,
      /добровольно согласил/,
    ),
  items_seized: (t) =>
    decide(
      t,
      /изъя|изым|вещ|ключи/,
      /ничего.{0,15}не изымали|изъятия не было|ничего не изъяли/,
      /изъял|изъяли/,
    ),
  search_protocol_created: (t) => {
    if (!/протокол|что это за документ/.test(t)) return;
    if (unknown(t)) return null;
    if (/не составляли|не составили|отдельного протокола нет/.test(t))
      return false;
    if (
      /оформили.{0,25}протоколом|оформил.{0,30}протоколом|составили.{0,25}протокол/.test(
        t,
      )
    )
      return true;
  },
  force_actually_used: (t) => {
    if (
      /не бил.{0,12}но толкнул|не бил.{0,12}а толкнул|перестал.{0,12}бить|прекратил.{0,12}бить/.test(
        t,
      )
    )
      return true;
    if (unknown(t) && /удар|бить|бьет|физическ.{0,8}сил/.test(t)) return null;
    if (
      /не применял.{0,20}(?:физическ.{0,6})?сил|не применяли.{0,20}(?:физическ.{0,6})?сил|не ударил.{0,20}только кричал/.test(
        t,
      )
    )
      return false;
    if (/не (?:бил|ударил|бьет)|никто не ударил/.test(t)) return;
    if (
      /(?:после применения ко мне силы|применил.{0,20}(?:физическ.{0,6})?сил|применяют.{0,20}сил|ударил|ударили|толкнул|толкнули|бьет|бьют|бил меня|били меня|выкручива.{0,15}рук)/.test(
        t,
      )
    )
      return true;
  },
  handcuffs_used: (t) =>
    decide(
      t,
      /наручник/,
      /не надевали|не надевал|на меня их не надевали/,
      /(?:надел|надевал|снял).{0,20}(?:меня|с меня).{0,15}наручник|надел на меня наручник/,
    ),
  warning_given: (t) =>
    decide(
      t,
      /предупред|предупрежд/,
      /не предупреждал|не предупреждали|до этого не предупреждал/,
      /предупредил|предупредили/,
    ),
  injuries_present: (t) => {
    if (!/травм|поврежден|синяк|болит|повреждени/.test(t)) return;
    if (/старый синяк.{0,30}до разговора/.test(t)) return;
    if (unknown(t)) return null;
    if (
      /нет травм и повреждений|травм и повреждений больше нет|прежние повреждения зажили/.test(
        t,
      )
    )
      return false;
    if (
      /появились травмы|есть травмы|вижу синяк|у меня травма|у меня.{0,20}(?:синяк|травм)|после удара.{0,25}синяк/.test(
        t,
      )
    )
      return true;
  },
  force_documented: (t) =>
    decide(
      t,
      /документ|запис/,
      /нигде не отразили|не отразили|не записали/,
      /записали применение|записал применение|отразили применение/,
    ),
  resident_consent_given: (t) => {
    if (!/соглас|впустить|дверь/.test(t)) return;
    if (
      /другой проживающий.{0,30}согласил|один из проживающих.{0,30}согласил/.test(
        t,
      )
    )
      return true;
    if (/никто из проживающих.{0,25}не давал согласия/.test(t)) return false;
    if (unknown(t)) return null;
  },
  search_court_order_shown: (t) => {
    if (!/судебн.{0,12}решен|постановление/.test(t)) return;
    if (unknown(t)) return null;
    if (/не предъявляли/.test(t) && /судебн/.test(t)) return false;
    if (/постановление сотрудника/.test(t)) return;
    if (
      /предъявил|предъявили/.test(t) &&
      /судебное решение/.test(t) &&
      /обыск/.test(t)
    )
      return true;
  },
  immediate_danger_present: (t) =>
    decide(
      t,
      /угроз|опасност|пожар/,
      /нет непосредственной угрозы|опасности жизни и имуществу больше нет/,
      /сейчас непосредственная угроза|внутри пожар и люди/,
    ),
  suspect_pursuit_present: (t) =>
    decide(
      t,
      /преследова|преследует|преследуют|преследование/,
      /никого.{0,20}не преследует|больше не преследуют|преследование прекратилось/,
      /сейчас преследует подозреваемого/,
    ),
  officer_stated_crime_suppression_basis: (t) =>
    decide(
      t,
      /пресечени.{0,8}преступлен/,
      /не называл|этого не говорил|о пресечении преступления не говорил/,
      /сказал.{0,70}для пресечения преступления/,
    ),
  forced_entry_used: (t) =>
    decide(
      t,
      /двер|вошли|вход|вошел/,
      /не применяли силу|вошли без силы/,
      /вскрыл дверь|вскрыли дверь|силой вош|вошли силой/,
    ),
  formal_search_started: (t) => {
    if (!/обыск/.test(t)) return;
    if (unknown(t)) return null;
    if (
      /еще не начали|не объявляли и не начинали|проводить его еще не начали/.test(
        t,
      )
    )
      return false;
    if (/начали.{0,12}обыск|обыск.{0,35}начал|уже начали именно обыск/.test(t))
      return true;
  },
  premises_inspection_started: (t) => {
    if (!/осмотр|смотрят/.test(t)) return;
    if (unknown(t)) return null;
    if (/не объявляли и не начинали|еще не начали/.test(t)) return false;
    if (
      /объявили осмотр.{0,30}начали|объявил и начал осмотр|уже проводят осмотр помещения/.test(
        t,
      )
    )
      return true;
  },
};
function decide(t, topic, no, yes) {
  if (!topic.test(t)) return;
  if (unknown(t)) return null;
  if (new RegExp("(?:^|[^а-яa-z])(?:" + no.source + ")", no.flags).test(t))
    return false;
  if (yes.test(t)) return true;
}
function explanation(t, stage) {
  const topics = {
    identity_check: "проверк|личност|документ",
    street_stop: "останов",
    delivery_to_station: "поездк|доставлен",
    personal_search: "досмотр",
    bag_search: "сумк|вещ|досмотр",
  };
  const clauses = t.split(/[;.]+|\s+но\s+/).filter((c) => re(topics[stage], c));
  const values = [];
  for (const c of clauses) {
    if (stage === "personal_search" && /сумк|вещ/.test(c)) continue;
    if (stage === "bag_search" && /личн.{0,10}досмотр/.test(c)) continue;
    if (unknown(c)) {
      values.push(null);
      continue;
    }
    if (
      /(?:^|[^а-я])не (?:объяснил|объяснили|назвал|называл(?:и)?|говорил|сообщили)/.test(
        c,
      )
    )
      values.push(false);
    else if (/объяснил|назвал|объяснили|назвали/.test(c)) values.push(true);
  }
  return values.length && new Set(values).size === 1 ? values[0] : undefined;
}
export function extractReviewed(s, text, out) {
  const t = n(text),
    e = currentEpisode(s),
    result = [],
    signals = [];
  const conditional =
    /(?:^|[\s,«])если(?:\s|$)|^если |^боюсь|^я боюсь|когда-нибудь|собирается|собираюсь|пока (?:только )?думаю|обещает|обещают|пригрозил|грозит|угрожает|в фильме|в кино|сказал.{0,30}(?:попросит|оформит|повезет|ударит)/.test(
      t,
    );
  const otherOnly =
    /свой (?:случай|разговор|досмотр).{0,30}не опис|свою (?:поездку|сумку).{0,30}не опис|мой разговор не описан|про свои.{0,30}не сообщ|о своем.{0,30}не говорил|про свое я не знаю|в прошлом году|в другом эпизоде|в другом месте|в другом районе|другой квартире|квартире знакомого|свою квартиру, не в мою|про нынешний случай.{0,15}не говорил/.test(
      t,
    );
  const ownFact =
    /вижу|попросил|просил|меня|мой|мою|моей|моем|мне|я |моих|моего|при мне|на мне|этой квартире|в этой ситуации|проживающ/.test(
      t,
    );
  const otherSubject =
    /(?:моего друга|моего брата|мою подругу|мою сестру|мой друг|прохожий|моему брату|знакомого|моему знакомому|другого человека|другому человеку|другого прохожего|у моего друга|мой знакомый|чужой сумки|другой сумки)/.test(
      t,
    );
  const explicitOwnDenial =
    /не мне|меня вообще не|о моем не говорил|о моей не сообщили|сотрудник полиции ее не открывал|а не сотрудник полиции|сотрудник этого не говорил/.test(
      t,
    );
  const suppressOther =
    (otherOnly && !unknown(t)) ||
    (otherSubject && !explicitOwnDenial && !unknown(t)) ||
    /о моем.{0,15}не сообщил/.test(t);
  const hypotheticalQuestion = /^(?:а )?если |имеет ли право/.test(t);
  const stages = new Set([out.stage, e?.stageId].filter(Boolean));
  if (documentTakingReport(t)?.kind === "identity")
    stages.add("identity_check");
  if (/личн.{0,10}досмотр/.test(t)) stages.add("personal_search");
  if (
    /(?:основан|причин).{0,30}проверк.{0,20}(?:паспорт|документ|личност)/.test(
      t,
    )
  )
    stages.add("identity_check");
  if (/досмотр.{0,15}(?:сумк|вещ)|сумк.{0,25}досмотр/.test(t))
    stages.add("bag_search");
  if (
    /(?:везут|поездк).{0,35}установлен.{0,5}личност|установлен.{0,10}личност/.test(
      t,
    )
  )
    stages.add("identity_check");
  if (/сил|удар|бьет|бить|наручник|травм|синяк/.test(t))
    stages.add("use_of_force");
  for (const f of dialoguePackage.fields) {
    if (f.semanticsStatus !== "REVIEWED" || !stages.has(f.stageId)) continue;
    if (out.ambiguousActor) continue;
    if (f.fieldId === "free_to_leave_denied" &&
        f.stageId !== (out.stage || e?.stageId)) continue;
    if (f.stageId === "bag_search" &&
        ["ambiguous", "foreign"].includes(out.itemResolution?.kind)) continue;
    if (hypotheticalQuestion || suppressOther) continue;
    if (
      f.fieldId === "recording_blocked" &&
      /прохожий|охранник/.test(t) &&
      /а не сотрудник полиции/.test(t)
    )
      continue;
    if (
      conditional &&
      !(f.fieldId === "refusal_pressure" && /сейчас говорит/.test(t))
    )
      continue;
    if (
      f.stageId === "use_of_force" &&
      f.fieldId === "force_actually_used" &&
      /я (?:ударил|толкнул|бил).{0,15}(?:сотрудника|полицейского|охранника)|к другому человеку|о других действиях я не сообщал/.test(
        t,
      )
    )
      continue;
    if (f.fieldId === "force_actually_used" && !/меня|мне|ко мне/.test(t))
      continue;
    if (f.fieldId === "items_seized" && /про своем не знаю/.test(t)) continue;
    const fieldText =
      f.fieldId === "refusal_pressure" &&
      /сейчас говорит/.test(n(out.rawSourceText || ""))
        ? n(out.rawSourceText)
        : f.fieldId.startsWith("copy_requested") &&
            e?.stageId === "explanation_request" &&
            /копи/.test(t) &&
            !/объяснен|протокол|другого|нового/.test(t)
          ? t + " объяснение"
          : t;
    let value = rules[f.fieldId]?.(fieldText, f.stageId);
    if (
      f.fieldId === "injuries_present" &&
      !conditional &&
      !unknown(t) &&
      /у меня (?:идет |течет )?кровь|у меня кровотечение|после удара[^.!?]{0,25}(?:идет |течет )?кровь/u.test(
        t,
      ) &&
      !/кровь[^.!?]{0,15}не (?:идет|течет)|до (?:удара|разговора|этого)|старое кровотечение|кровь (?:моего|моей|коллеги|друга)|кровь[^.!?]{0,12}(?:на одежде|на руках)/u.test(
        t,
      ) &&
      (out.facts?.some(
        (x) =>
          x.field === "use_of_force.force_actually_used" && x.value === true,
      ) ||
        result.some(
          (x) =>
            x.field === "use_of_force.force_actually_used" && x.value === true,
        ) ||
        project(s, "use_of_force")["pps.use_of_force.force_actually_used"] ===
          true)
    )
      value = true;
    if (value === undefined && f.fieldId === "free_to_leave_denied" &&
        f.stageId === (out.stage || e?.stageId) &&
        /теперь|сейчас/u.test(t) &&
        /(?<!не )разрешил[^.!?]{0,30}уйти/u.test(restrictionClauses(t).join("; "))) {
      const old = s.factLedger?.findLast(x => x.episodeId === e?.id &&
        x.subjectId === e?.personId && x.fieldKey === f.fieldKey &&
        x.status === "active" && x.value === true);
      const evidence = old ? [old.source, ...(old.supportingSources || [])]
        .map(x => n(x?.quote || "")).join("; ") : "";
      if (old) out.restrictionContinuity = true;
      // An explicit end of the only evidenced verbal prohibition removes that
      // basis. It does not prove absence of an unreported physical constraint.
      if (/не разреша[^;.!?]{0,35}(?:уйти|уходить)|(?<!не )запретил[^;.!?]{0,25}(?:уйти|уходить)/u.test(evidence) &&
          !/не (?:выпускает|отпускает)|(?<!не )удержива(?:ет|ют)|(?<!не )держит меня|прегражда/u.test(evidence)) {
        result.push({ field: f.fieldKey.slice(4), value: null, operation: "withdraw" });
        continue;
      }
    }
    if (value === undefined) continue;
    if (f.stageId === "bag_search" && out.withdraw && value === null) {
      // A withdrawal names a fact, not every field whose topic mentions a bag.
      const withdrawalTopics = {
        bag_opened_by_officer: /откры/u,
        grounds_explained: /основан|причин|объясн/u,
        voluntary_show_agreed: /согласи|согласил|доброволь/u,
        items_seized: /изъя|изым/u,
        search_protocol_created: /протокол/u,
        witnesses_or_video_present: /понят|видео/u,
      };
      if (!withdrawalTopics[f.fieldId]?.test(t)) continue;
    }
    if (
      f.fieldId === "warning_given" &&
      /предупредил другого человека, не меня/.test(t)
    )
      value = false;
    const operation =
      out.withdraw && value === null
        ? "withdraw"
        : out.correction
          ? "correct"
          : f.scope.temporalKind === "state" &&
              /теперь|больше не|прекратил|за([ж])или|закончилась|уже приехали/.test(
                t,
              )
            ? "change"
            : "assert";
    result.push({ field: f.fieldKey.slice(4), value, operation });
  }
  // Direct denial of the sole earlier reported hit disputes that evidence without
  // claiming that every other form of force was absent.
  if (
    !result.some((f) => f.field === "use_of_force.force_actually_used") &&
    /никто.{0,10}не ударил|он(?: меня)? не ударил/.test(t) &&
    !conditional
  ) {
    const old = s.factLedger?.findLast(
      (f) =>
        f.fieldKey === "pps.use_of_force.force_actually_used" &&
        f.episodeId === e?.id &&
        f.status === "active",
    );
    const evidence = old
      ? [old.source, ...(old.supportingSources || [])]
          .map((x) => n(x?.quote || ""))
          .join("; ")
      : "";
    if (
      old &&
      /удар|бьет/.test(evidence) &&
      !/толкнул|выкручи|заломил|наручник/.test(evidence)
    )
      result.push({
        field: "use_of_force.force_actually_used",
        value: null,
        operation: out.correction ? "withdraw" : "dispute",
      });
  }
  if (
    /вернул.{0,25}(?:мой )?телефон|телефон.{0,25}вернул/.test(t) &&
    !conditional
  )
    signals.push({ kind: "phone_returned" });
  if (
    /вернул.{0,25}(?:мой )?паспорт|паспорт.{0,25}вернул/.test(t) &&
    !conditional
  )
    signals.push({ kind: "document_returned" });
  if (
    /согласил.{0,40}(?:передумал|отозвал)|передумал.{0,20}поездк/.test(t) &&
    !conditional
  )
    signals.push({ kind: "consent_withdrawn" });
  return { facts: result, signals };
}
