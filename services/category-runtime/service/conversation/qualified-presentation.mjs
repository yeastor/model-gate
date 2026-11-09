// Rendering and dialogue notices only: legal text is copied from the pinned answer, never generated.
export const qualifiedRuntimeVersion='children-qualified-runtime/20261024-v2';
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
  if(hold==='SAFETY_HELP_FIRST')return 'Сейчас приоритет — помощь при сообщённой непосредственной опасности. Остальные уточнения остановлены; документы и ответы на них не являются условием срочной помощи.';
  if(hold==='DOCUMENT_SOURCE_NOT_SUPPORTED')return stage==='alimony_debt'
    ? 'Пока не могу проверить, к какому именно расчёту пристава относится вопрос: источник расчёта не подтверждён. Несогласие или согласие с суммой не записано. Доступная памятка остаётся общей, не оценкой этого расчёта.'
    : 'Пока не могу проверить вид и издателя конкретного акта об отобрании ребёнка. Получение этого акта не подтверждено и не опровергнуто. Доступная памятка остаётся общей, не оценкой конкретного документа.';
  if(hold==='OWN_PRIOR_FILING_NOT_CONFIRMED')return 'Пока не установлено, что речь о вашем собственном ранее поданном заявлении. Намерение отозвать его не означает, что заявление подавали именно вы. Доступная памятка остаётся общей.';
  if(hold==='FREE_TEXT_NOT_PROJECTED')return 'Эта реплика не распознана достаточно надёжно. Я не записал её как «Да» или «Нет» и не применяю прежний вопрос к возможной новой ситуации. Уточнённый ответ по этой детали пока недоступен; прежняя памятка не подтверждает применимость к другому случаю.';
  if(hold==='RETRACTED_FACT_REQUIRES_VOLUNTARY_CORRECTION')return 'Прежнее сообщение отозвано. Зависящий от него вывод больше не применяется; повторно задавать тот же вопрос не буду. Остальные сведения сохранены.';
  if(hold==='HELP_RETENTION_NOT_PROVEN')return 'Переход к другому варианту остановлен: он может потерять помощь по уже известным обстоятельствам. Это не отказ в помощи и не подтверждение другого варианта.';
  return hold ?? null;
}
export function presentationRequest(text) {
  const normalized=text.trim();
  if(/^(?:спасибо|спасибо большое|благодарю|понятно|хорошо|ок)[.!]*$/iu.test(normalized))return 'ack';
  if(/^(?:покажи(?:те)?|повтори(?:те)?) (?:полную )?(?:памятку|ответ)(?: целиком| полностью)?[.!]*$/iu.test(normalized))return 'full';
  if(/^(?:повтори(?:те)?|покажи(?:те)?) вопрос[.!?]*$/iu.test(normalized))return 'question';
  return null;
}
