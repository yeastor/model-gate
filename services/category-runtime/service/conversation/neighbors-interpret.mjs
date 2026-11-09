// Deliberately finite original-message grammar. Retrieval and assistant prose are never inputs.
export const normalizeNeighbors = text => text.trim().toLowerCase().replaceAll('ё', 'е').replace(/[.!?]+$/u, '');
export function neighborsReply(text, question) {
  if (/\?/u.test(text)) return null;
  const t = normalizeNeighbors(text);
  const controls = question?.controls || [];
  return controls.find(c => normalizeNeighbors(c.label) === t)
    || (/^не (?:знаю|помню)$/u.test(t) ? controls.find(c => c.value === null) : null);
}
const stages = {
  'шум':'noise', 'ремонт':'repairs', 'дым и запах':'smells_smoking',
  'животное':'pets', 'угрозы':'threats_conflict', 'общие зоны':'common_areas',
  'камеры':'cameras_access', 'санитарные условия':'sanitary_conditions',
};
// Each row defines one observed predicate, not a legal assessment.
const literals = [
  ['sanitary_conditions','inspection_requested','обследование этого помещения уже запрашивали','обследование этого помещения еще не запрашивали'],
  ['sanitary_conditions','inspection_blocked','отказ в доступе помешал провести это обследование','отказ в доступе не помешал провести это обследование'],
  ['sanitary_conditions','pests_spreading','насекомые распространяются в другие помещения дома','насекомые не распространяются в другие помещения дома'],
  ['sanitary_conditions','waste_accumulated','в этом помещении длительно накапливается мусор','в этом помещении не накапливается мусор'],
  ['sanitary_conditions','acute_health_signs','я наблюдаю резкое ухудшение самочувствия','я не наблюдаю резкого ухудшения самочувствия'],
  ['sanitary_conditions','fire_danger_signs','я вижу огонь в этом помещении','я не вижу огня в этом помещении'],
  ['sanitary_conditions','child_present','в этом помещении живет ребенок','в этом помещении не живет ребенок'],
  ['sanitary_conditions','helpless_person_present','в этом помещении живет человек, которому нужна помощь в уходе','в этом помещении не живет человек, которому нужна помощь в уходе'],
  ['noise','noise_repeated','шум от этого источника повторялся','шум от этого источника не повторялся'],
  ['noise','source_is_repairs','источник шума — ремонтные работы','источник шума не ремонтные работы'],
  ['noise','source_is_commercial_premises','шум исходит из кафе','шум не исходит из нежилого помещения'],
  ['noise','police_called','я уже вызывал полицию во время этого шума','я еще не вызывал полицию во время этого шума'],
  ['repairs','property_damage','после начала работ появились повреждения в моей квартире','после начала работ повреждений в моей квартире нет'],
  ['repairs','redevelopment_approved','сосед показал документ о согласовании перепланировки','сосед не показал документ о согласовании перепланировки'],
  ['smells_smoking','smoking_in_common_area','сосед курит в подъезде','сосед не курит в общей зоне'],
  ['smells_smoking','source_inside_neighbor_flat','дым поступает из квартиры соседа','дым не поступает из квартиры соседа'],
  ['smells_smoking','ventilation_defect_suspected','я наблюдаю обратную тягу вентиляции','я не наблюдаю признаков неисправности вентиляции'],
  ['smells_smoking','private_persistent_specific_impact','в этой комнате мне ощутимо мешает повторяющийся дым','в этой комнате мне не мешают дым и запах'],
  ['pets','immediate_danger','животное прямо сейчас угрожает людям','животное сейчас не угрожает людям'],
  ['pets','bite_or_injury','животное уже укусило меня','животное никого не укусило и не травмировало'],
  ['pets','sanitary_conditions','из-за животного остаются загрязнения','из-за животного нет загрязнений и стойкого запаха'],
  ['pets','cruelty_suspected','я вижу конкретные признаки жестокого обращения с животным','я не наблюдаю признаков жестокого обращения с животным или оставления без помощи'],
  ['pets','private_animal_property_damage','после действий животного я заметил повреждение вещей','после действий животного повреждений вещей и помещения нет'],
  ['threats_conflict','immediate_danger','сосед угрожает причинить вред прямо сейчас','сейчас непосредственной угрозы нет'],
  ['threats_conflict','weapon_present','сосед демонстрирует предмет и угрожает им причинить вред','сосед не демонстрирует оружие или предмет для угрозы'],
  ['threats_conflict','physical_assault','сосед уже применил ко мне физическую силу','сосед не применял ко мне физическую силу'],
  ['threats_conflict','property_damage','мои вещи повреждены, я связываю это с действиями соседа','повреждений моих вещей нет'],
  ['threats_conflict','stalking_repeated','конфликт с этим соседом повторялся','конфликт с этим соседом не повторялся'],
  ['threats_conflict','private_concrete_threats','сосед произносил конкретные угрозы в мой адрес','сосед не произносил конкретных угроз и не совершал угрожающих действий'],
  ['common_areas','evacuation_blocked','выход из дома сейчас перекрыт вещами','выход из дома и проход к нему сейчас свободны'],
  ['common_areas','unauthorized_structure','в общей зоне установили перегородку','в общей зоне нет двери, перегородки или кладовой'],
  ['common_areas','exclusive_use','сосед препятствует другим собственникам пользоваться этой общей зоной','сосед не препятствует другим собственникам пользоваться этой общей зоной'],
  ['common_areas','owners_consent_exists','мне показали решение общего собрания об этой конструкции','мне не показали решение общего собрания об этой конструкции'],
  ['cameras_access','captures_inside_home','камера захватывает внутреннее пространство моей квартиры','камера не захватывает внутреннее пространство моей квартиры'],
  ['cameras_access','audio_recording','я знаю, что эта камера записывает звук','я знаю, что эта камера не записывает звук'],
];
export function interpretNeighbors(message, turnId, policy) {
  const result = {valid:false, stage:null, premises:null, newObject:false, newCase:false,
    operation:'assert', observations:[], command:null, focus:false, raw:message};
  if (typeof message !== 'string') return result;
  const t = normalizeNeighbors(message);
  const commands = new Map([
    ['не хочу отвечать','decline'], ['продолжить','resume'],
    ['повторить вопрос об обследовании','retry_request'],
    ['повторить вопрос об отказе в доступе','retry_blocked'],
    ['вернуться к предыдущей теме','return'], ['повторить памятку','repeat'],
  ]);
  if (commands.has(t)) return {...result, valid:true, command:commands.get(t)};
  let body = message.trim(), offset = message.indexOf(body);
  for (const [prefix,operation] of [['исправляю:','correct'],['отзываю:','withdraw']]) {
    if (normalizeNeighbors(body).startsWith(prefix)) {
      const n = prefix.length; offset += n; body = body.slice(n);
      offset += body.length - body.trimStart().length; body = body.trimStart();
      result.operation = operation;
    }
  }
  // An unknown/foreign/hypothetical clause rejects the complete proposal, including adjacent clauses.
  if (/[«»"`?]|(?:^|\s)(?:если|возможно|наверное|представим|допустим|он|она)(?:\s|,)|в чужом случае|ассистент|мне сказали|планирую|боюсь, что/iu.test(body)) return result;
  const fragments = body.split(';');
  let cursor = offset;
  for (const fragment of fragments) {
    const clause = fragment.trim(), value = normalizeNeighbors(clause);
    const start = cursor + fragment.indexOf(clause); cursor += fragment.length + 1;
    if (!value) return result;
    if (value === 'новый отдельный случай') {result.newCase = true; continue;}
    if (value === 'другое помещение') {result.newObject = true; continue;}
    if (value.startsWith('тема: ')) {
      const stage = stages[value.slice(6)];
      if (!stage || result.stage && result.stage !== stage) return result;
      result.stage = stage; continue;
    }
    if (value.startsWith('помещение: ')) {
      const premise = clause.slice(clause.indexOf(':')+1).trim();
      if (!premise || premise.length > 200 || result.premises && result.premises !== premise) return result;
      result.premises = premise; continue;
    }
    const literal = literals.find(([, , yes,no]) => value === yes || value === no);
    if (!literal) return result;
    const [stage,field,yes] = literal, fieldKey = `neighbors.${stage}.${field}`;
    if (policy.blockedFields.includes(fieldKey)) return result;
    const quote = message.slice(start,start+clause.length);
    result.observations.push({fieldKey, stageId:stage, value:value===yes,
      operation:result.operation, source:{kind:'user_text',turnId,message,quote,
        span:[Array.from(message.slice(0,start)).length,Array.from(message.slice(0,start+clause.length)).length]}});
    if (field.startsWith('inspection_')) result.focus = true;
  }
  const inferred = [...new Set(result.observations.map(o=>o.stageId))];
  if (inferred.length > 1 || result.stage && inferred.length && inferred[0] !== result.stage) return result;
  result.stage ||= inferred[0] || null;
  result.valid = true;
  return result;
}
