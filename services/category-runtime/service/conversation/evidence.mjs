// Small, conservative source/scope guards; not a general Russian parser.
export const normalize = (text) =>
  text.toLowerCase().replaceAll("ё", "е").trim();
export function turnEvidence(text) {
  let masked = text;
  if (
    /чита(?:ет|ют|ю|ем)|зачитыва|цитир|в заявлении|в протоколе|написано|сказал|говорит/iu.test(
      text,
    )
  ) {
    masked = masked.replace(/«[^»]*»|“[^”]*”|"[^"\n]*"/gu, (q) =>
      " ".repeat(q.length),
    );
    if (/«[^»]*$/u.test(masked))
      masked = masked.replace(/«[^»]*$/u, (q) => " ".repeat(q.length));
  }
  const boundary =
    /(?:^|[.!?])\s*(?:это\s+)?(?:сейчас\s+|теперь\s+)?(?:другой случай|другое происшествие|теперь про другого)\s*[:.!?,—-]?\s*/iu.exec(
      masked,
    );
  const offset = boundary ? boundary.index + boundary[0].length : 0;
  return {
    text: masked.slice(offset),
    quote: text.slice(offset),
    offset,
    newEpisode: !!boundary,
    newCase: !!boundary && /другой случай|другое происшествие/iu.test(boundary[0]) &&
      !/в (?:этой|той) же ситуации|тот же случай/iu.test(masked),
    maskedQuote: masked !== text,
  };
}
const police =
  /полицейск|сотрудник[а-я ]{0,12}полиции|сотрудник[а-я ]{0,12}ппс/iu;
const other =
  /(?:^|[^а-я])(?:охранник|врач|сосед|прохожий|продавец|сотрудник магазина)(?![а-я])/iu;
const force =
  /ударил[аи]?|ударили|бьет|бьют|толкнул[аи]?|толкнули|выкручи|заломил/iu;
export function forceActor(text) {
  if (!force.test(text)) return null;
  if (/не полицейск|не сотрудник полиции/iu.test(text) && other.test(text))
    return "other";
  const clauses = text
    .split(/[.!?;]+|,?\s+(?:а|но)\s+/iu)
    .filter((c) => force.test(c));
  for (const c of clauses) {
    if (police.test(c) && !other.test(c)) return "police";
    if (other.test(c) && !police.test(c)) return "other";
  }
  if (police.test(text) && other.test(text)) return "ambiguous";
  return null;
}
export function otherDocumentOwner(text) {
  return /(?:паспорт[а-я]*|документ[а-я]*)[^.!?;]{0,18}(?:(?:моего|моей|моих|нашего|нашей)\s+[а-я]+|коллеги|жены|мужа|ребенка|соседа|прохожего)/iu.test(
    text,
  );
}
export function conversationalIntent(text) {
  const t = normalize(text);
  if (
    /^(?:я )?не (?:понимаю|понял|поняла)(?: ваш| этот)? вопрос[.!?]*$|^что (?:значит|означает) (?:ваш |этот )?вопрос[.!?]*$/u.test(
      t,
    )
  )
    return "question_confusion";
  if (
    /^(?:помогите(?: мне)?|помощь|что (?:мне )?делать(?: сейчас| дальше| теперь)?|как (?:мне )?быть|(?:а )?что (?:дальше|теперь)|как (?:мне )?действовать(?: дальше| теперь)?)[.!?]*$/u.test(
      t,
    )
  )
    return "help_now";
  if (
    /^(?:мне (?:трудно|тяжело) дышать|я задыхаюсь|задыхаюсь|не могу (?:дышать|говорить)|теряю сознание)[.!?]*$/u.test(
      t,
    )
  )
    return "distress";
  return null;
}
