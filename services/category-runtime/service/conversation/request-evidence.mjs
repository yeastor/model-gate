// Conservative extraction of explicitly described requests. Unsupported prose
// remains unbound; retrieval, article text and profile data are never consulted.
const norm = s => s.toLowerCase().replaceAll("ё", "е").replace(/[.!?,:;]+$/u, "").trim();
export const documentTypes = text => [
  /(?<![а-я])отч[её]т(?:а|у|ом|е|ы|ов|ам|ами|ах)?(?![а-я])/iu.test(text) ? "report" : null,
  /(?<![а-я])акт(?:а|у|ом|е|ы|ов|ам|ами|ах)?(?![а-я])/iu.test(text) ? "act" : null,
  /(?<![а-я])смет(?:а|ы|у|ой|е|ам|ами|ах)?(?![а-я])/iu.test(text) ? "estimate" : null,
  /(?<![а-я])договор(?:а|у|ом|е|ы|ов|ам|ами|ах)?(?![а-я])/iu.test(text) ? "contract" : null,
  /переч(?:ень|ня|ню|нем|не|ни|ней) работ/iu.test(text) ? "work_list" : null,
].filter(Boolean);
export const documentKinds = text => [...new Set(documentTypes(text).map(t => t === "report" ? "report" : "work"))];
const hypothetical = /(?:^|\s)(?:если|допустим|например|возможно|наверное|кажется)(?:\s|,)|сосед|знаком|муж|жена|супруг|брат|сестр|отец|(?<![а-я])мать(?![а-я])|сотрудник|председатель|друг(?:ой|ого|у)|пользователь|ассистент|в статье|представим/iu;
export const isCorrection = text => /исправляю|ошиб(?:ся|лась)|уточняю:|поправка:/iu.test(text);
export const isWithdrawal = text => /отзываю (?:свои )?слова|отменяю (?:своё |свое )?утверждение/iu.test(text);
export const isNewCase = text => /^новый случай\s*:/iu.test(text.trim());
export const focusIntent = text => /^(?:(?:сейчас|теперь)\s+)?(?:разбираем|разбер[её]м|выбираю|речь о)\s+/iu.test(text.trim());
export function scopeLabel(text) {
  return positiveRequestDescription(text).trim().replace(/^новый случай\s*:\s*/iu, "")
    .replace(/^(?:(?:сейчас|теперь)\s+)?(?:разбираем|разбер[её]м|выбираю|речь о)\s+/iu, "").trim();
}
export function unambiguous(text) {
  text = positiveRequestDescription(text);
  if (!text || text.length > 600 || hypothetical.test(text) || /[<>]/u.test(text)) return false;
  if (/не знаю,? (?:какой|о каком)|не помню,? (?:какой|о каком)|несколько|оба|обоих|два запроса|два обращения|разные запросы/iu.test(text)) return false;
  const combined = /(?:один|единый|общий) запрос|в одном (?:письме|запросе|обращении)/iu.test(text);
  const typeCount = documentTypes(text).length;
  if (requestScope(text).identityHolds.length || (!combined && requestScope(text).addresses.length>1)) return false;
  if (!combined && (requestScope(text).houses.length>1 || requestScope(text).titles.length>1)) return false;
  if (!combined && (typeCount > 1 || (text.match(/(?<![а-я])УК(?![а-я])/giu)||[]).length > 1 ||
    /дом[ауе]?\s+[^.,;]+\s+и\s+(?:дом|по адресу)/iu.test(text))) return false;
  const months = [...new Set((text.toLowerCase().match(/январ[а-я]*|феврал[а-я]*|март[а-я]*|апрел[а-я]*|ма[йяе]|июн[а-я]*|июл[а-я]*|август[а-я]*|сентябр[а-я]*|октябр[а-я]*|ноябр[а-я]*|декабр[а-я]*/gu) || []).map(x => x.slice(0,3)))];
  if (!combined && (months.length > 1 || new Set(text.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/gu) || []).size > 1 || /прежн[а-я]* УК.*нов[а-я]* УК|нов[а-я]* УК.*прежн[а-я]* УК/iu.test(text))) return false;
  if (!combined && /(?:повторн[а-я]*|ещ[её] один|второй|первый).*(?:запрос|обращени)/iu.test(text)) return false;
  return documentKinds(text).length > 0 || /(?:единственный|этот конкретный) запрос/iu.test(text);
}
function ownStatement(text) {
  if (/сказал|сообщил|цитат|[«"]\s*(?:я|мне)/iu.test(text)) return false;
  return /(?:^|\s)я\s+(?:(?:уже|ещ[её]|только|пока|сам|сама|не)\s+)*(?:отправил|отправлял|направил|направлял|послал|запросил|запрашивал|просил|попросил|получил|не знаю|не помню)/iu.test(text) ||
    /^(?:(?:уже|не)\s+)?(?:отправил|отправлял|направил|направлял|послал|запросил|запрашивал|просил|попросил|получил)[а]?\s/iu.test(text.trim()) ||
    /^(?:этот |мой )?запрос (?:актов|отч[её]та)(?: за [а-я]+)? (?:не отправлял|не отправил|не направлял|не направил|не отправлен)/iu.test(text.trim()) ||
    /(?:^|[.!]\s*)(?:не знаю|не помню),? (?:отправ|направ|посыл)/iu.test(text.trim()) ||
    /(?:этот запрос|это письмо) (?:я |уже )?(?:не )?(?:отправлен|отправил|отправлял|направил)/iu.test(text) ||
    /(?:мне (?:не |прямо )?отказали|отказа не было)/iu.test(text);
}
export function requestValue(text, field, scoped = false) {
  if (hypothetical.test(text)) return undefined;
  if (text.includes('?')) {
    const statements=text.match(/[^.!?]+[.!?]?/gu)||[];
    const known=statements.filter(s=>!s.includes('?')).map(s=>requestValue(s.trim(),field,scoped)).filter(v=>v!==undefined);
    const distinct=[...new Set(known)];
    return distinct.length===1?distinct[0]:undefined;
  }
  if (!ownStatement(text)) return undefined;
  const sending = field === "written_document_request_sent";
  if (!sending) return boundRefusal(text, scoped);
  if (scoped && /^(?:не знаю|не помню)[.!]*$/iu.test(text.trim())) return null;
  if (sending) {
    const ownNegative = /(?:^|\s)я\s+(?:(?:ещ[её]|пока)\s+)?не (?:отправ|направ|посыл)|^(?:запрос (?:актов|отч[её]та)(?: за [а-я]+)? )?не (?:отправ|направ|посыл)|этот запрос не (?:отправ|направ)|(?:я просил[а]?|^просил[а]?).{0,50}только устно/iu.test(text.trim());
    const ownSending = /(?:^|\s)я\s+(?:уже\s+)?(?:отправил|направил|послал|запросил)[а]?(?![а-я])|^(?:уже\s+)?(?:отправил|направил|послал|запросил)[а]?(?![а-я])/iu.test(text.trim());
    if (ownSending && ownNegative) return undefined;
    if (/(?:не знаю|не помню),? (?:отправлял|отправлен|направлял|направлен|посылал)/iu.test(text)) return null;
    if (ownNegative && /(?:не отправлял|не отправляла|не отправил|не отправила|не направлял|не направил|не отправлен|неотправленный черновик|черновик не отправлял|только устно)/iu.test(text)) return false;
    // Explicit first-person sending, or an unambiguous bound "этот запрос отправлен".
    if (ownSending && /(?:я\s+)?(?:уже\s+)?(?:отправил[а]?|направил[а]?|послал[а]?)\s+(?:этот\s+|письменный\s+|электронный\s+)?(?:запрос|письмо)|(?:запрос|письмо).{0,70}(?:я\s+)?(?:отправил[а]?|направил[а]?)|(?:я\s+)?запросил[а]?.{0,55}(?:письменно|по электронной почте)|(?:отч[её]т|акты).{0,30}запросил[а]? письменно/iu.test(text)) return true;
    if (scoped && /(?:этот запрос|это письмо) (?:уже )?отправлен[о]?/iu.test(text)) return true;
  } else {
    if (/(?:не знаю|не помню),? (?:был ли отказ|отказали ли)/iu.test(text)) return null;
    if (/(?:мне не отказали|отказа не было|отказ не получал|отказ не получила)/iu.test(text)) return false;
    if (/(?:мне (?:прямо )?отказали|(?:^|\s)я (?:уже )?получил[а]? (?:прямой )?отказ|^получил[а]? (?:прямой )?отказ)/iu.test(text)) return true;
  }
  return undefined;
}
export function sharedValues(text) {
  if (hypothetical.test(text) || !ownStatement(text) || /не (?:просил|запрашивал|запросил)/iu.test(text)) return {};
  if (!/(?:запросил|попросил|просил|отправил|направил)[а]?/iu.test(text) || /не (?:отправ|направ|посыл)/iu.test(text)) return {};
  const kinds = documentKinds(text);
  return Object.fromEntries([
    /(?:ежегодн[а-я]*|годов[а-я]*)\s+отч[её]т|отч[её]т[а-я]*\s+(?:об управлении домом\s+)?за\s+(?:19|20)\d{2}\s*год/iu.test(text) ? ["annual_report_requested", true] : null,
    kinds.includes("work") ? ["management_or_work_documents_requested", true] : null,
  ].filter(Boolean));
}
export function sameRequest(requests, label) {
  const exact = requests.filter(r => norm(r.label) === norm(label));
  if (exact.length === 1) return exact[0];
  // A short explicit choice can refer to one previously described document only.
  // Additional dates/recipients must never be discarded for a fuzzy match.
  if (/^(?:запрос )?(?:акты|отч[её]т|годовой отч[её]т|сметы|договор)$/iu.test(label.trim())) {
    const kinds = documentTypes(label);
    const matches = requests.filter(r => documentTypes(r.label).some(k => kinds.includes(k)));
    if (matches.length === 1) return matches[0];
  }
  return null;
}
export function explicitCandidates(text) {
  const label = scopeLabel(text);
  if (unambiguous(label)) return [label];
  return label.split(/[.;!?]\s*|\s*;\s*|\s+а\s+/u).map(x => x.trim())
    .filter(x => unambiguous(x) && Object.values({
      ...sharedValues(x),
      sent: requestValue(x, "written_document_request_sent"),
      refused: requestValue(x, "document_request_refused"),
    }).some(v => v !== undefined));
}

export function refersToSelected(text, label) {
  if (hypothetical.test(text) || /другой запрос|ещ[её] один|повторн[а-я]* запрос|новый запрос|несколько|оба/iu.test(text)) return false;
  const kinds = documentTypes(text), selectedKinds = documentTypes(label);
  if (kinds.some(k=>!selectedKinds.includes(k))) return false;
  // New dates, addresses or recipients require an explicit scope choice.
  if (/\d|сентябр|октябр|ноябр|декабр|январ|феврал|март|апрел|ма[йяе]|июн|июл|август|(?<![а-я])УК(?![а-я])|по адресу/iu.test(text)) return false;
  return /^этот запрос|^это письмо|^по этому запросу|^я (?:его|этот запрос)/iu.test(text) ||
    isCorrection(text) || isWithdrawal(text) ||
    (kinds.length===1 && /^(?:я |запрос )/iu.test(text)) ||
    /^(?:не знаю|не помню),? (?:отправлял|направлял)/iu.test(text);
}

// Identity strings are opaque user evidence, not an address/name certificate.
const identityKeys=['types','months','years','recipients','houses','titles','addresses','identityHolds'];
function addressEvidence(text) {
  const result=[];const holds=[];
  const re=/(?:по адресу\s*:?\s*|(?=(?:улица|ул\.|проспект|пр-т|переулок|пер\.|набережная|наб\.)\s))((?:(?:ул|д|пер|наб)\.|[^.!?;])+)/giu;
  for(const match of text.matchAll(re)) {
    let raw=match[1].trim().replace(/[,\s]+$/u,'');
    raw=raw.split(/\s+(?:(?:я|мне|но|однако)\s|(?:в|у|от)\s+(?:(?:прежн[а-я]*|нов[а-я]*)\s+)?(?:ук|тсж|кооператив)(?![а-я]))/iu)[0].trim().replace(/[,\s]+$/u,'');
    if(/^(?:улица|ул|д|дом|проспект|пер|переулок|наб|набережная)\.?$/iu.test(raw))holds.push('Address marker has no named identity.');
    if(raw)result.push(norm(raw).replace(/\s+/gu,' '));
    else holds.push('Address marker without a usable full description.');
  }
  return {addresses:[...new Set(result)],holds};
}
function recipientEvidence(text) {
  const result=[];const holds=[];
  const re=/(?<![а-я])(?:(?:прежн[а-я]*|стар[а-я]*|нов[а-я]*)\s+)?(?:ук|тсж|кооператив)(?![а-я])/giu;
  for(const marker of text.matchAll(re)) {
    let rest=text.slice(marker.index+marker[0].length).trimStart();let name='';
    if(/^[«"]/u.test(rest)) {
      const quoted=rest.match(/^[«"]([^»"]+)[»"]/u);
      if(quoted)name=quoted[1];else holds.push('Unclosed recipient name.');
    } else {
      name=rest.split(/[.!?;,]|\s+(?:за|по адресу|по дому|дом[ауе]?(?=\s*(?:№\s*)?\d)|я|мне|не|уже|отправил[а]?|направил[а]?|получил[а]?|просил[а]?|отказал[аи]?|и\s+(?:акт|смет|отч))/iu)[0];
      if(/^(?:за|по|я|мне|не|уже)(?:\s|$)|^дом[ауе]?\s*(?:№\s*)?\d/iu.test(name))name='';
    }
    const kind=norm(marker[0]).replace(/\s+/gu,' ');
    result.push(kind+(name.trim()?':'+norm(name).replace(/\s+/gu,' '):''));
  }
  return {recipients:[...new Set(result)],holds};
}
export function requestScope(text) {
  const lower=norm(scopeLabel(text)),address=addressEvidence(lower),recipient=recipientEvidence(lower);
  return {
    types:documentTypes(text),
    months:[...new Set((lower.match(/январ[а-я]*|феврал[а-я]*|март[а-я]*|апрел[а-я]*|ма[йяе]|июн[а-я]*|июл[а-я]*|август[а-я]*|сентябр[а-я]*|октябр[а-я]*|ноябр[а-я]*|декабр[а-я]*/gu)||[]).map(x=>x.slice(0,3)))],
    years:[...new Set(lower.match(/(?<![а-я\d])(?:19|20)\d{2}(?!\d)/gu)||[])],
    recipients:recipient.recipients,
    houses:[...new Set([...lower.matchAll(/дом[ауе]?\s*(?:№\s*)?\d+[а-я\d/-]*/gu)].map(m=>m[0]))],
    titles:[...new Set([...lower.matchAll(/(?:акт(?:ы|ов|а)?|смет(?:ы|а|у)?|отч[её]т(?:а)?|договор(?:а)?)\s+(ремонт[а-я]*|проверк[а-я]*|управлени[а-я]*|осмотр[а-я]*)/gu)].map(m=>m[1].slice(0,6)))],
    addresses:address.addresses,identityHolds:[...address.holds,...recipient.holds],
  };
}
export function requestIdentity(request,extra='') {
  const texts=[request.label,...(request.sources||[]).filter(s=>s.kind==='user_text').map(s=>s.quote),extra].filter(Boolean);
  const scope=Object.fromEntries(identityKeys.map(k=>[k,[...new Set(texts.flatMap(t=>requestScope(t)[k]||[]))]]));
  const namedRecipients=scope.recipients.filter(x=>x.includes(':'));
  const unified=/(?:один|единый|общий) запрос|в одном (?:письме|запросе|обращении)/iu.test(request.label);
  const ambiguous=scope.identityHolds.length>0||namedRecipients.length>1||(!unified&&scope.addresses.length>1);
  return {scope,ambiguous};
}
export function resolveRequest(requests,text,selectedRequest=null) {
  if(hypothetical.test(text)||/сказал|сообщил|цитат|[«"]\s*(?:я|мне)/iu.test(text))return{kind:'unresolved',reason:'Identity was not asserted for the current user request.'};
  const label=scopeLabel(text),incoming=requestScope(label);
  if(!incoming.types.length) {
    if(selectedRequest&&refersToSelected(label,selectedRequest.label)&&!requestIdentity(selectedRequest).ambiguous)return{kind:'unique',request:selectedRequest};
    return{kind:'unresolved',reason:'No unique explicit request identity.'};
  }
  const exact=requests.filter(r=>norm(r.label)===norm(label)&&!requestIdentity(r).ambiguous);
  if(exact.length===1)return{kind:'unique',request:exact[0]};
  if(incoming.identityHolds.length)return{kind:'unresolved',reason:'Incomplete named identity evidence.'};
  if(!isCorrection(text)&&!isWithdrawal(text)&&/(?:новый|ещ[её] один|повторный|второй) запрос/iu.test(label))return{kind:'new',scope:incoming,explicitNewOccurrence:true};
  const attrs=['months','years','recipients','houses','titles','addresses'];
  const plausible=requests.filter(r=>incoming.types.every(t=>requestIdentity(r).scope.types.includes(t)));
  const matches=plausible.filter(r=>{
    const identity=requestIdentity(r);if(identity.ambiguous)return false;const known=identity.scope;
    return attrs.every(k=>{
      if(!incoming[k].length||!known[k].length)return true;
      if(k!=='recipients')return incoming[k].every(v=>known[k].includes(v));
      const generic=v=>/^(?:ук|тсж|кооператив)$/u.test(v);
      const specific=known[k].filter(v=>!generic(v)||!known[k].some(x=>x!==v&&x.includes(v)));
      return incoming[k].every(v=>specific.some(x=>x===v||(generic(v)&&x.includes(v))||(generic(x)&&v.includes(x))));
    });
  });
  if(matches.length===1)return{kind:'unique',request:matches[0]};
  if(matches.length>1)return{kind:'ambiguous',candidates:matches.map(r=>r.id)};
  if(plausible.some(r=>requestIdentity(r).ambiguous)||isCorrection(text)||isWithdrawal(text))return{kind:'unresolved',reason:'Existing request identity is conflicting or does not uniquely match.'};
  return{kind:'new',scope:incoming};
}
export function mergeRequestScope(request,text){request.scope=requestIdentity(request,text).scope;}
const clauses=text=>text.split(/[.;!?]+|\s*,?\s+(?:но|однако|а)\s+/iu).map(t=>t.trim()).filter(Boolean);
const verb='(?:просил[а]?|попросил[а]?|запросил[а]?|запрашивал[а]?|отправил[а]?|направил[а]?|знаю|помню|получил[а]?|жду|ждал[а]?|хочу|хотел[а]?|видел[а]?)';
function predicateClauses(text) {
  const boundary=new RegExp('\\s+и\\s+(?=(?:я|он|она|они|мы|вы|мне)\\s+|не\\s+|(?:[А-ЯЁ][а-яё]+\\s+)?'+verb+')','u');
  return clauses(text).flatMap(t=>t.split(boundary)).flatMap(t=>t.split(/,\s*(?=(?:мне\s+)?(?:нуж(?:ны|ен|на)|не\s+нуж))/iu)).map(t=>t.trim()).filter(Boolean);
}
function foreignPredicate(text) {
  const stripped=text.replace(/^(?:исправляю|уточняю|поправка)\s*:\s*/iu,'').replace(/^(?:по этому запросу|на мой запрос|по моему запросу)\s+/iu,'');
  return /^(?:он|она|они|мы|вы|сосед[а-я]*|муж|жена)\s+/iu.test(stripped)||/^(?!(?:Я|Мне)\s)[А-ЯЁ][а-яё]+\s+(?:не\s+)?(?:просил[а]?|запросил[а]?|получил[а]?|отправил[а]?|отказал[аи]?)/u.test(stripped);
}
export function positiveRequestDescription(text) {
  const parts=predicateClauses(text);
  const isRejected=p=>/не нуж(?:ен|на|ны)|не (?:прошу|запрашиваю)/iu.test(p);
  if(!parts.some(isRejected))return text;
  const retained=parts.filter(p=>!isRejected(p));
  return retained.some(p=>documentTypes(p).length&&/(?:нуж(?:ны|ен|на)|прошу|запрашиваю|просил|запросил)/iu.test(p))?retained.join('. '):text;
}
export function documentObservations(text, {explicitFocus=false}={}) {
  if(hypothetical.test(text))return[];
  if(explicitFocus && /^(?:акты|акт|сметы|смета|договор|годовой отч[её]т|ежегодный отч[её]т)(?:\s|[.,]|$)/iu.test(text) && !/[?]|не знаю|не помню|не нужен|не нужны|не просил|сосед|он |она /iu.test(text))return documentTypes(text).filter(t=>t!=='report'||/годов|ежегодн/iu.test(text)).map(type=>({type,value:true,operation:'assert',quote:text}));
  if(isWithdrawal(text)) {
    if(/отправ|направ|отказ/iu.test(text))return[];
    return documentTypes(text).filter(t=>t!=='report'||/(?:годов|ежегодн)/iu.test(text)).map(type=>({type,operation:'withdraw',quote:text}));
  }
  const parts=predicateClauses(text);let ownPrior=false;
  return parts.flatMap(part=>{
    if(foreignPredicate(part))return[];
    const plain=part.replace(/^(?:исправляю|уточняю|поправка)\s*:\s*/iu,'');
    const uncertain=/^(?:я\s+)?не (?:знаю|помню)/iu.test(plain);
    const statedNeed=/(?:мне\s+)?(?:не\s+)?нуж(?:ен|на|ны)(?![а-я])|^(?:я\s+)?(?:прошу|запрашиваю)\s/iu.test(part);
    const owner=ownStatement(part)||statedNeed||(uncertain&&(ownPrior||/ли я/iu.test(part)));
    if(!owner||/не (?:отправ|направ|посыл)/iu.test(part))return[];
    ownPrior=true;
    const mentioned=documentTypes(part).filter(t=>t!=='report'||/(?:годов|ежегодн)/iu.test(part)||/за\s+(?:19|20)\d{2}\s*год/iu.test(part));
    if(!statedNeed&&!/(?:запросил|запрашивал|просил|попросил|отправил|направил)/iu.test(part))return[];
    const value=uncertain?null:/(?:^|\s)не (?:просил|запрашивал|запросил|попросил|нужен|нужна|нужны|прошу|запрашиваю)/iu.test(plain)?false:true;
    return mentioned.map(type=>({type,value,operation:isCorrection(text)?'correct':'assert',quote:part}));
  });
}
// The refusal object is taken from its own event, never from the whole message.
export function refusalEvidence(text,scoped=false) {
  const values=[],foreignObjects=[];
  for(const part of predicateClauses(text)) {
    const event=part.match(/отказ(?:ал[аи]?|ано|ан[ао]?|а)?/iu);
    if(!event||hypothetical.test(part)||foreignPredicate(part)||/сказал|сообщил|цитат|[«"]\s*(?:я|мне)/iu.test(part))continue;
    const localReference=/по этому запросу|этот запрос|на мой запрос|по моему запросу|запрошенн[а-я]* документ/iu.test(part);
    const own=ownStatement(part)||(/^(?:по этому запросу|на мой запрос)/iu.test(part)&&!foreignPredicate(part));
    if(!own)continue;
    const tail=part.slice(event.index+event[0].length).trim().replace(/^(?:мне\s+)?(?:в|на)\s+/iu,'');
    const objectText=tail.split(/\s+(?:для|ради|чтобы)\s/iu)[0];
    const genericDocument=/(?<![а-я])документ(?:а|ы|ов|у|ом|е|ам|ами|ах)?(?![а-я])/iu;
    const documentAction=/^(?:выдач[аеу]|выдать|предоставлени[ияе]|предоставить|передач[аеу]|передать|доступ[аеу]?)(?:\s|$)/iu.test(objectText)&&(documentTypes(objectText).length>0||genericDocument.test(objectText));
    const head=objectText.match(/^[а-яё]+/iu)?.[0]||'';
    const directDocument=documentTypes(head).length>0||genericDocument.test(head);
    const implicit=!tail||/^(?:не было|не получал[а]?|пока|уже|по этому запросу)(?:\s|[.!]|$)/iu.test(tail);
    const priorDocumentObject=implicit&&/(?:в выдаче|в предоставлении|выдать|предоставить).{0,45}(?:документ|акт|смет|отч[её]т|договор)/iu.test(part.slice(0,event.index));
    if(!documentAction&&!directDocument&&!(implicit&&(localReference||priorDocumentObject))) {
      if(tail&&!implicit)foreignObjects.push({quote:part,object:tail});
      continue;
    }
    if(/(?:не знаю|не помню).*отказ/iu.test(part))values.push(null);
    else if(/мне не отказали|отказа не было|отказ не получал|отказ не получила/iu.test(part))values.push(false);
    else if(/мне (?:прямо )?отказали|я (?:уже )?получил[а]? (?:прямой )?отказ|^получил[а]? (?:прямой )?отказ/iu.test(part))values.push(true);
  }
  const distinct=[...new Set(values)];return{value:distinct.length===1?distinct[0]:undefined,documentValues:values,foreignObjects};
}
function boundRefusal(text,scoped){return refusalEvidence(text,scoped).value;}