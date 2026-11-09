// Finite literal observations only. Unsupported text is retained without facts.
export const normalizeThreats = t => t.trim().replace(/[.!]+$/u, '').toLowerCase().replaceAll('ё', 'е');
export function interpretThreats(text, turnId, policy) {
  const result = {text, turnId, facts: [], stage: null, self: false, item: null, newCase: false, repeat: false, stop: false, valid: true};
  let offset = 0;
  for (const raw of text.split(';')) {
    const part = raw.trim(), at = offset + raw.indexOf(part), span = [Array.from(text.slice(0, at)).length, Array.from(text.slice(0, at + part.length)).length];
    offset += raw.length + 1;
    const t = normalizeThreats(part);
    if (!t || ['помогите', 'спасибо', 'продолжим'].includes(t)) continue;
    if (t === 'это другой случай') { if(result.facts.length)result.valid=false; result.newCase = true; continue; }
    if (t === 'это происходит со мной') { if(result.facts.length)result.valid=false; result.self = true; continue; }
    if (t === 'покажите памятку полностью') { result.repeat = true; continue; }
    if (t === 'больше не задавайте вопросы') { result.stop = true; continue; }
    const stage = policy.stages.find(s => normalizeThreats(s.phrase) === t);
    if (stage) { if(result.facts.length)result.valid=false; if (result.stage && result.stage !== stage.id) result.valid = false; result.stage = stage.id; continue; }
    const item = /^обсуждаем материал: ([\p{L}\p{N} _.-]{1,80})$/u.exec(t);
    if (item && !/(?:^| )(?:и|или)(?: |$)/u.test(item[1])) { if(result.facts.length)result.valid=false; if (result.item && result.item !== item[1]) result.valid = false; result.item = item[1]; continue; }
    let operation = 'assert', literal = t;
    if (literal.startsWith('исправляю: ')) { operation = 'correct'; literal = literal.slice(11); }
    else if (literal.startsWith('отзываю: ')) { operation = 'withdraw'; literal = literal.slice(9); }
    const matches = policy.fields.filter(f => f.status === 'BOUNDED_USER_REPORT').flatMap(f => [['positive', true], ['negative', false], ['unknown', null]].filter(([k]) => normalizeThreats(f[k]) === literal).map(([kind, value]) => ({fieldKey:f.fieldKey, stageId:f.stageId, value:operation === 'withdraw' ? null : value, operation, literalKind:kind, source:{kind:'user_text',turnId,quote:part,span,message:text}})));
    if (matches.length) result.facts.push(...matches); else result.valid = false;
  }
  if (!result.valid) { result.facts = []; result.stage = null; result.self = false; result.item = null; result.newCase = false; }
  return result;
}
export function threatsReply(text) {
  const t = normalizeThreats(text);
  return t === 'да' ? {value:true} : t === 'нет' ? {value:false} : ['не знаю','не помню'].includes(t) ? {value:null} : null;
}
