// Finite literal observations. This module does not evaluate law, dates or money.
const wordForms=new Map(Object.entries({получила:'получил',подала:'подал',подавала:'подавал',пострадала:'пострадал',пропустила:'пропустил',согласна:'согласен',пастановление:'постановление',пристов:'пристав'}));
export const normalizeBailiffs=text=>String(text).toLowerCase().replaceAll('ё','е').replace(/\p{L}+/gu,w=>wordForms.get(w)||w).replace(/\s+/gu,' ').trim().replace(/[.!]+$/u,'').replace(/^я (?:уже )?/u,'').replace(/^не помню,/u,'не знаю,');
export function interpretBailiffs(s,text,turnId,policy){
 const source={kind:'user_text',turnId,message:text,quote:text,span:[0,Array.from(text).length]};
 const out={source,stage:null,scope:{},scopeSources:{},facts:[],later:null,excluded:false,foreign:false,ambiguous:false,newCase:false,stop:false,repeat:false,withdraw:false};
 out.excluded=/[«»“”"]|(?:^|[.;\n])\s*(?:если|возможно|может быть|планирую|боюсь|допустим|цитата|ассистент|текст из|это гипотеза|мой план|не знаю\s*;)|это рассказ|рассказ (?:друга|сестры)/iu.test(text);
 out.foreign=/у (?:друга|соседа|коллеги)|чужая ситуация/iu.test(text);
 out.ambiguous=/^(?:он|она|они|ему|ей)\s|два производства|два сч[её]та|два банка|два платежа|две выплаты|другое производство|другой счёт|другая выплата|другое постановление|другое заявление|другой судебный акт|два заявления|два постановления|другое списание|другая операция|другая вещь|другое имущество|другой плательщик|другой работодатель|другое действие|неясно какое/iu.test(text);
 out.ambiguous||=/друг(?:ом|ого|ому|ую|ой|ие|их)\s+(?:исполнительн\p{L}*\s+производств|судебн\p{L}*\s+акт|производств|списан|операци|выплат|сч[её]т|банк|платеж|плательщик|работодател|постановлен|заявлен|действ|вещ|имуществ)/iu.test(text);
 out.newCase=/^Это другой случай[.:]\s*/u.test(text);
 out.stop=/^(?:Не задавайте больше вопросов|Не хочу отвечать)[.!]?$/u.test(text);
 out.repeat=/^Повторите памятку[.!]?$/u.test(text);
 out.withdraw=/^Отзываю (?:предыдущее сообщение|это сообщение)[.!]?$/u.test(text);
 // A separate help request does not negate a preceding assertion.
 // Question clauses never become observations or scope evidence.
 let offset=0,unsupported=false;
 for(const part of text.split(/;|\n|(?<=[.!])\s+/u)){
  const start=text.indexOf(part,offset);offset=start+part.length+1;
  const trimmed=part.trim(),help=/[,—]\s*(?:что (?:мне )?делать|как (?:мне )?быть)\s*[?!.]*$/iu;
  const raw=trimmed.replace(help,''),lead=part.length-part.trimStart().length;
  if(/^(?:что (?:мне )?делать|как (?:мне )?быть|помогите(?: пожалуйста)?|нужна помощь)[?!.]*$/iu.test(raw))continue;
  if(raw.includes('?')){unsupported=true;continue;}
  const src={...source,quote:raw,span:[Array.from(text.slice(0,start+lead)).length,Array.from(text.slice(0,start+lead+raw.length)).length]};
  let body=raw.replace(/^Это другой случай[.:]\s*/u,''),operation='assert';
  if(/^Исправляю:\s*/u.test(body)){body=body.replace(/^Исправляю:\s*/u,'');operation='correct';}
  else if(/^Отзываю:\s*/u.test(body)){body=body.replace(/^Отзываю:\s*/u,'');operation='withdraw';}
  const t=normalizeBailiffs(body);
  const accountAliases=['приставы заблокировали мою карту','приставы арестовали мою карту','карту арестовали приставы','карту ареставали приставы','банк арестовал мой счет по взысканию'];
  const route=policy.stages.find(st=>normalizeBailiffs(st.phrase)===t||(st.id==='account_arrest'&&accountAliases.includes(t)));
  if(route){if(out.stage&&out.stage!==route.id)out.ambiguous=true;out.stage=route.id;out.routeSource=src;}
  let scopeMatch=false;
  const set=(key,value)=>{scopeMatch=true;if(/(?:^|\s)(?:и|или|либо)(?:\s|$)|[,\n]/u.test(value))out.ambiguous=true;if(out.scope[key]&&out.scope[key]!==value)out.ambiguous=true;out.scope[key]=value;out.scopeSources[key]=src;};
  if(t==='с меня взыскивают этот долг'){set('person','user');set('role','reported-debtor');}
  if(t==='добиваюсь взыскания этого долга'){set('person','user');set('role','reported-creditor');}
  if(t==='защищаю свою вещь в этом деле'){set('person','user');set('role','reported-property-interest');}
  if(t==='представляю владельца этой вещи'){set('person','represented-owner');set('role','representative');}
  if(t==='речь об одном исполнительном производстве')set('proceeding','one-explicitly-reported-proceeding');
  const ip=/^(?:Это исполнительное производство|Производство по этому делу) ([\p{L}\p{N} /-]{1,80})$/iu.exec(body);if(ip)set('proceeding',ip[1]);
  const patterns={order:/^(?:Обсуждаем постановление|Речь о постановлении) (.+)$/iu,act:/^(?:Обсуждаем судебный акт|Речь о судебном акте) (.+)$/iu,bank:/^(?:Мой банк|Счёт открыт в банке) (.+)$/iu,account:/^(?:Обсуждаем мой счёт|Речь о моём счёте) (.+)$/iu,payer:/^(?:Мой плательщик|Мне платит) (.+)$/iu,payment:/^(?:Обсуждаем мою выплату|Речь о моей выплате) (.+)$/iu,asset:/^(?:Обсуждаем вещь|Речь о вещи) (.+)$/iu,request:/^(?:Обсуждаем моё заявление|Речь о моём заявлении) (.+)$/iu,recipient:/^Адресат моего заявления (.+)$/iu,delivery:/^Обсуждаем получение (.+)$/iu,eventTime:/^Указанная дата события (.+)$/iu,document:/^(?:Обсуждаем документ|Речь о документе) (.+)$/iu,territory:/^(?:Обсуждаем территорию|Речь о территории) (.+)$/iu};
  for(const [key,re]of Object.entries(patterns)){const m=re.exec(body);if(m&&m[1].length<=100)set(key,m[1]);}
  const stage=out.stage||s?.episodes?.find(e=>e.id===s.activeEpisodeId)?.stageId;let factMatch=false;
  for(const q of policy.predicates.filter(q=>q.stageId===stage)){
   let value;
   if([q.positive,...q.positiveAliases].some(x=>normalizeBailiffs(x)===t))value=true;
   else if([q.negative,...q.negativeAliases].some(x=>normalizeBailiffs(x)===t))value=false;
   else if(normalizeBailiffs(q.unknown)===t)value=null;else continue;
   factMatch=true;out.facts.push({fieldKey:q.fieldKey,value:operation==='withdraw'?null:value,operation,source:src});
  }
  const later=new Map([['Продажа этой вещи отменена','sale_cancelled'],['Продажа этой вещи состоялась','sale_completed'],['Назначенное действие по этому делу отменено','action_cancelled'],['Назначенное действие по этому делу уже совершено','action_completed'],['Ответ на это заявление получен','reply_received'],['Это ограничение отменено','restriction_cancelled']]);
  if(later.has(body)){if(out.later&&out.later.kind!==later.get(body))out.ambiguous=true;out.later={kind:later.get(body),stage,source:src};}
  if(raw&&!route&&!scopeMatch&&!factMatch&&!later.has(body)&&!['помогите','помогите пожалуйста','нужна помощь'].includes(t))unsupported=true;
 }
 // Keep interrogative short replies out of the shared yes/no parser.
 if(text.includes('?')&&!out.stage&&!Object.keys(out.scope).length&&!out.facts.length&&!out.later)out.excluded=true;
 if(unsupported&&out.facts.length)out.excluded=true;
 if(out.excluded||out.foreign||out.ambiguous)out.facts=[];
 return out;
}
