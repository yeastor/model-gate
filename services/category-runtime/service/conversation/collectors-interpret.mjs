// Finite observation grammar; unmatched language is retained raw, never guessed.
export function interpretCollectors(text, turnId, policy, currentStage = null) {
  const source = {kind:'user_text', turnId, message:text, quote:text, span:[0,Array.from(text).length]};
  const result = {source, stage:null, explicitStage:false, observations:[], scopeChange:false, newCase:false, stop:false, repeat:false, held:false};
  const norm = s => s.trim().replace(/[.!]+$/u,'').toLowerCase().replaceAll('ё','е');
  const all = norm(text);
  const clauses = text.split(/[;\n]+/u);
  // Only these standalone requests may accompany an exact supported observation.
  // Their text stays raw; it is never used as evidence for a context fact.
  const helpQuestion = clause => /^(?:что (?:мне )?делать(?: сейчас| дальше)?|как сохранить доказательства)\?$/iu.test(clause.trim());
  if ((/[«»"]/u.test(text) || clauses.some(clause => clause.includes('?') && !helpQuestion(clause))) || /(?:^|[\s;])(?:если|возможно|наверное|допустим|планирую|когда-нибудь|вчера|завтра|у друга|у подруги|у соседа|рассказ|он|она|они)(?:[\s,;]|$)/iu.test(text)) {
    result.held = true; return result;
  }
  result.newCase = all === norm(policy.newCasePhrase);
  result.stop = all === norm(policy.stopPhrase);
  result.repeat = all === norm(policy.repeatPhrase);
  result.scopeChange = policy.scopeChangePhrases.some(p => all === norm(p));
  let cursor = 0;
  for (const clause of clauses) {
    const offset = text.indexOf(clause,cursor); cursor=offset+clause.length;
    const t=norm(clause), route=policy.stages.find(s=>norm(s.phrase)===t);
    if(route){ if(result.stage && result.stage!==route.id)result.held=true; result.stage=route.id; result.explicitStage=true; }
  }
  const stage=result.stage||currentStage;
  for (const clause of clauses) {
    let body=clause.trim(), operation='assert';
    if(/^Исправляю: /iu.test(body)){operation='correct';body=body.replace(/^Исправляю: /iu,'');}
    if(/^Отзываю: /iu.test(body)){operation='withdraw';body=body.replace(/^Отзываю: /iu,'');}
    const t=norm(body);
    for(const [field,variants]of Object.entries(policy.literals))for(const [kind,phrases]of Object.entries(variants))if(phrases.some(p=>norm(p)===t)){
      const selectedStage=stage||(field==='immediate_danger'?'threats_pressure':field==='attempted_forced_entry'?'home_visits':null);
      if(!selectedStage)continue;
      const fieldKey=`collectors.${selectedStage}.${field}`;
      if(!policy.fields.some(f=>f.field_key===fieldKey&&f.classification==='EXISTING_NEXT_OBSERVATION'))continue;
      const start=text.indexOf(clause),span=[Array.from(text.slice(0,start)).length,Array.from(text.slice(0,start+clause.length)).length];
      result.observations.push({fieldKey,value:operation==='withdraw'?null:kind==='positive'?true:kind==='negative'?false:null,operation,source:{...source,quote:clause,span}});
      result.stage ||= selectedStage;
    }
  }
  // A literal inside an otherwise unrecognised multi-clause story is not a fact.
  if(result.observations.length && clauses.some(c=>c.trim()&&!policy.stages.some(s=>norm(s.phrase)===norm(c))&&!result.observations.some(o=>o.source.quote===c)&&!helpQuestion(c)))result.held=true;
  if(result.held)result.observations=[];
  return result;
}
