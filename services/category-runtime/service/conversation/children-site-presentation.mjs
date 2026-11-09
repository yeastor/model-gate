// Rendering and dialogue notices only: legal text is copied from the pinned answer, never generated.
export const qualifiedRuntimeVersion='children-site-mvp/20261029-v1';
export const escapeQualifiedText=t=>String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function renderQualifiedAnswer(a) {
  const escape=escapeQualifiedText;
  const content=[a.now,...a.steps.map(t=>'• '+t),...a.dont.map(t=>'Не следует: '+t),...a.say.map(t=>'Можно сказать: '+t)].map(escape);
  content.push(...a.where_to.map(d=>`<a href="/documents/link/${encodeURIComponent(d.document_link_id)}">${escape(d.title)}</a>`));
  if(a.laws.length)content.push('Правовые основания:',...a.laws.map(l=>
    /^\/laws\/[a-zA-Z0-9_./#-]+$/u.test(l.url)
      ? `<a href="${escape(l.url)}">${escape(l.ref+' — '+l.title)}</a>`
      : escape(l.ref+' — '+l.title+' ('+l.url+')')));
  return content.join('\n\n');
}
export function qualifiedNotice(hold,stage) {
 if(hold==='DOCUMENT_SOURCE_NOT_SUPPORTED')return stage==='alimony_debt'?'Ниже — общие действия для проверки задолженности. Сверьте документ, период, начисления и платежи. Вывод о правильности конкретного расчёта здесь не сделан.':'Ниже — общие действия по ситуации с ребёнком. Вид документа, его издателя и содержание нужно сверить отдельно; сам рассказ о событии их не подтверждает.';
 if(hold==='FREE_TEXT_NOT_PROJECTED')return 'Ниже — общая памятка по выбранной теме. Новые детали не записаны как подтверждённые факты; применяйте только те условия памятки, которые относятся к вашей ситуации.';
 if(hold==='OWN_PRIOR_FILING_NOT_CONFIRMED')return 'Ниже — общая памятка о выезде ребёнка. Отзыв собственного заявления применяется только к заявлению, которое подавали вы сами.';
 if(hold==='EXPLICIT_CORRECTION_REQUIRED')return 'В сообщениях есть разные сведения о подаче заявления. Ниже сохранена доступная помощь; прежний факт изменяется только явным исправлением.';
 if(hold==='SAFETY_HELP_FIRST')return 'Сначала выполните действия для защиты ребёнка. Ответы на уточнения не являются условием срочной помощи.';
 if(hold==='RETRACTED_FACT_REQUIRES_VOLUNTARY_CORRECTION')return 'Учтено исправление прежних сведений. Ниже — помощь по оставшимся подтверждённым обстоятельствам.';
 if(hold==='HELP_RETENTION_NOT_PROVEN')return 'Ниже сохранена помощь по подтверждённым обстоятельствам.';
 return hold?'Ниже — доступная памятка по выбранной теме. Применяйте её с учётом указанных условий.':null;
}
export function presentationRequest(text) {
  const normalized=text.trim();
  if(/^(?:спасибо|спасибо большое|благодарю|понятно|хорошо|ок)[.!]*$/iu.test(normalized))return 'ack';
  if(/^(?:покажи(?:те)?|повтори(?:те)?) (?:полную )?(?:памятку|ответ)(?: целиком| полностью)?[.!]*$/iu.test(normalized))return 'full';
  if(/^(?:повтори(?:те)?|покажи(?:те)?) вопрос[.!?]*$/iu.test(normalized))return 'question';
  return null;
}
