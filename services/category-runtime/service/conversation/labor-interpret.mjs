// Finite literal grammar. Unmatched speech stays raw, never a legal predicate.
export const normalizeLabor=text=>String(text).toLowerCase().replaceAll('ё','е').trim().replace(/[.!]+$/u,'');
export function interpretLabor(s,text,turnId,policy){
 const source={kind:'user_text',turnId,message:text,quote:text,span:[0,Array.from(text).length]};
 const out={source,stage:null,employer:null,period:null,object:null,job:null,relation:null,facts:[],excluded:false,foreign:false,ambiguous:false,urgent:false,newCase:false,withdraw:false,stop:false,repeat:false};
 const normalized=normalizeLabor(text);
 out.excluded=/[«»“”"?]|(?:^|[.;\n])\s*(?:не знаю\s*;|если|возможно|может быть|планирую|боюсь|допустим|цитата|ассистент|текст из|рассказ|это гипотеза|мой план)|(?:это |у |моя? )?(?:рассказ (?:друга|сестры)|у друга|у коллеги|у другого работника)/iu.test(text);
 out.foreign=/у (?:друга|коллеги|соседа)|рассказ (?:друга|сестры)|другой работник/iu.test(text);
 out.ambiguous=/^(?:он|она|они|ему|ей)\s|два работодателя|два случая|две работы|несколько запросов/iu.test(text);
 out.urgent=/срочно|прямо сейчас опасно|нужна медицинская помощь/iu.test(text);
 out.newCase=/^Это другой случай[.:]\s*/u.test(text);
 out.withdraw=/^Отзываю (?:предыдущее сообщение|это сообщение)[.!]?$/u.test(text);
 out.stop=/^(?:Не задавайте больше вопросов|Не хочу отвечать)[.!]?$/u.test(text);
 out.repeat=/^Повторите памятку[.!]?$/u.test(text);
 let offset=0,unsupported=false;
 for(const part of text.split(';')){
  const start=text.indexOf(part,offset);offset=start+part.length+1;let raw=part.trim(),lead=part.length-part.trimStart().length;
  const src={...source,quote:raw,span:[Array.from(text.slice(0,start+lead)).length,Array.from(text.slice(0,start+lead+raw.length)).length]};
  let body=raw.replace(/^Это другой случай[.:]\s*/u,''),operation='assert';
  if(/^Исправляю:\s*/u.test(body)){body=body.replace(/^Исправляю:\s*/u,'');operation='correct';}
  else if(/^Отзываю:\s*/u.test(body)){body=body.replace(/^Отзываю:\s*/u,'');operation='withdraw';}
  else if(/^Позже:\s*/u.test(body)){body=body.replace(/^Позже:\s*/u,'');operation='later';}
  const t=normalizeLabor(body);
  const route=policy.stages.find(st=>normalizeLabor(st.phrase)===t);if(route){if(out.stage&&out.stage!==route.id)out.ambiguous=true;out.stage=route.id;out.routeSource=src;}
  const employer=/^Мой работодатель ([\p{L}\p{N} -]{1,80})$/u.exec(body);if(employer){if(out.employer&&out.employer!==employer[1])out.ambiguous=true;out.employer=employer[1];out.employerSource=src;}
  const setScope=(key,value)=>{if(out[key]&&out[key]!==value)out.ambiguous=true;out[key]=value;out[key+'Source']=src;};
  const period=/^Обсуждаемый период (\d{4}-\d{2}(?:-\d{2})?(?: — \d{4}-\d{2}(?:-\d{2})?)?)$/u.exec(body);if(period)setScope('period',period[1]);
  const job=/^Моя работа ([\p{L}\p{N} -]{1,80})$/u.exec(body);if(job)setScope('job',job[1]);
  const relation=/^Мой договор от (\d{4}-\d{2}-\d{2})$/u.exec(body);if(relation)setScope('relation',relation[1]);
  const object=/^Обсуждаемый (запрос|приказ|случай|договор|уведомление|период работы|акт|отпуск|листок) от (\d{4}-\d{2}-\d{2})$/u.exec(body);if(object)setScope('object',object[1]+':'+object[2]);
  const stage=out.stage||s?.episodes?.find(e=>e.id===s.activeEpisodeId)?.stageId;
  let matchedFact=false;
  for(const q of policy.questions.filter(q=>q.stageId===stage)){
   let value;
   if([q.positive,...q.positiveAliases].some(x=>normalizeLabor(x)===t))value=true;
   else if([q.negative,...q.negativeAliases].some(x=>normalizeLabor(x)===t))value=false;
   else if(normalizeLabor(q.unknown)===t)value=null;
   else continue;
   matchedFact=true;out.facts.push({fieldKey:q.fieldKey,value:operation==='withdraw'?null:value,operation,source:src});
  }
  if(raw&&!route&&!employer&&!period&&!job&&!relation&&!object&&!matchedFact)unsupported=true;
 }
 // The finite grammar cannot detach a literal from unknown surrounding prose.
 // Retain the whole message raw instead of guessing who/what it describes.
 if(unsupported&&out.facts.length)out.excluded=true;
 // One unsupported modal/foreign/ambiguous clause excludes the whole bounded turn.
 if(out.excluded||out.foreign||out.ambiguous)out.facts=[];
 return out;
}
