// Bounded current observations; no inference from source masks or assistant text.
export const normalizeDigitalAccess=t=>String(t).normalize('NFC').toLowerCase().replaceAll('ё','е').trim().replace(/[.!]+$/u,'').trim();
export const stagePhrases=Object.freeze({
 account_hacked:'В моём аккаунте обнаружен чужой доступ',account_blocked:'Мой аккаунт заблокирован',sim_swap:'Проверяю перевыпуск моей SIM',email_compromised:'В моём почтовом ящике обнаружен чужой доступ',messenger_takeover:'В моём мессенджере обнаружен чужой доступ',lost_device:'Я утратил моё устройство',device_malware:'Проверяю подозрительное ПО на моём устройстве',secure_after:'Проверяю защиту моего аккаунта после происшествия'
});
const routeNames=new Map(Object.entries(stagePhrases).map(([k,v])=>[normalizeDigitalAccess(v),k]));
const rolePatterns=[
 ['subjectId',/^мой аккаунт ([\p{L}\p{N}_-]{1,48})$/u,'account:'],['subjectId',/^мой почтовый ящик ([\p{L}\p{N}_-]{1,48})$/u,'mailbox:'],['subjectId',/^мо[её] устройство ([\p{L}\p{N}_-]{1,48})$/u,'device:'],['subjectId',/^мой номер ([\p{L}\p{N}_-]{1,48})$/u,'number:'],
 ['providerId',/^мой сервис ([\p{L}\p{N}_-]{1,48})$/u,''],['operatorId',/^мой оператор ([\p{L}\p{N}_-]{1,48})$/u,''],['SIMId',/^моя сим-карта ([\p{L}\p{N}_-]{1,48})$/u,''],['numberId',/^привязанный мне номер ([\p{L}\p{N}_-]{1,48})$/u,''],['operationId',/^эта операция ([\p{L}\p{N}_-]{1,48})$/u,''],['requestId',/^это мо[её] обращение ([\p{L}\p{N}_-]{1,48})$/u,''],['eventId',/^это происшествие ([\p{L}\p{N}_-]{1,48})$/u,'']
];
export function interpretDigitalAccess(s,text,turnId,policy){
 const message=String(text),n=normalizeDigitalAccess(message),source={kind:'user_text',turnId,message,quote:message,span:[0,Array.from(message).length]};
 const out={source,facts:[],scope:{},scopeEvidence:{},stage:null,rawEvents:[],excluded:false,foreign:false,ambiguous:false};
 out.stop=['стоп','без вопросов','не задавайте вопросы'].includes(n);out.repeat=['повторите памятку','покажите памятку'].includes(n);out.confused=['не понимаю вопрос','что означает вопрос'].includes(n);out.document=['подготовь документ','открой документ','откройте форму'].includes(n);out.newCase=n.startsWith('это другой случай:');out.withdraw=n==='отзываю свое последнее сообщение';
 if(/[«»"?\x60]/u.test(message)||/(?:^|[\s;])(?:если|возможно|кажется|допустим|гипотеза|цитата|планирую)(?:[\s,:;]|$)|в статье|ассистент сказал|боюсь, что|в прошлом году/u.test(n)){out.excluded=true;return out;}
 if(/у друга|у подруги|у сестры|чужой аккаунт|не мой аккаунт|аккаунт другого человека/u.test(n)){out.foreign=true;return out;}
 if(/он изменил|она изменила|первый и второй|мо[йя] и чуж/u.test(n)){out.ambiguous=true;return out;}
 const neutral=new Set(['помогите','что делать сейчас','спасибо','понятно','хорошо','стоп','без вопросов','не задавайте вопросы','повторите памятку','покажите памятку','не понимаю вопрос','что означает вопрос','подготовь документ','открой документ','откройте форму','отзываю свое последнее сообщение','да','нет','не знаю']);
 let stage=s.episodes?.find(e=>e.id===s.activeEpisodeId)?.stageId;const stages=new Set(),unsupported=[],clauses=[...message.matchAll(/[^;.\n]+/gu)];
 if(clauses.length>1&&clauses.some(m=>normalizeDigitalAccess(m[0])==='не знаю')){out.excluded=true;return out;}
 for(const match of clauses){
  const quote=match[0].trim(),start=match.index+match[0].indexOf(quote),span=[Array.from(message.slice(0,start)).length,Array.from(message.slice(0,start+quote.length)).length],src={kind:'user_text',turnId,message,quote,span};
  let clause=normalizeDigitalAccess(quote),operation='assert',matched=false;
  if(clause.startsWith('это другой случай:'))clause=clause.slice('это другой случай:'.length).trim();
  if(clause.startsWith('исправляю:')){clause=clause.slice('исправляю:'.length).trim();operation='correct';}else if(clause.startsWith('теперь:')){clause=clause.slice('теперь:'.length).trim();operation='later';}
  const route=routeNames.get(clause);if(route){stage=route;out.stage=route;stages.add(route);out.routeSource=src;continue;}
  for(const [key,re,prefix]of rolePatterns){const m=clause.match(re);if(!m)continue;const value=prefix+m[1];if(out.facts.length&&value!==(out.scope[key]??s.episodes?.find(e=>e.id===s.activeEpisodeId)?.daScopes?.[stage]?.values?.[key]))out.ambiguous=true;if(Object.hasOwn(out.scope,key)&&out.scope[key]!==value)out.ambiguous=true;out.scope[key]=value;out.scopeEvidence[key]=src;if(key==='providerId'&&['гугл','google'].includes(m[1])&&['account_hacked','email_compromised'].includes(stage))out.facts.push({fieldKey:'digital_access.'+stage+'.service_is_google',value:true,operation,source:src});matched=true;}if(matched)continue;
  const focusMap={'проверяю почту восстановления этого аккаунта':'recovery_email','проверяю номер восстановления этого аккаунта':'recovery_phone','проверяю контакты восстановления этого аккаунта':'recovery_contacts','проверяю второй фактор этого аккаунта':'second_factor','проверяю резервные коды этого аккаунта':'backup_codes'};
  if(focusMap[clause]){out.focus=focusMap[clause];continue;}
  if(['адрес почты восстановления этого аккаунта изменился','номер восстановления этого аккаунта изменился'].includes(clause)){out.rawEvents.push({kind:clause.startsWith('адрес')?'email_setting_changed':'phone_setting_changed',source:src});continue;}
  const commandStatus={'команда этого устройства ожидает подключения':'queued_offline','сервис сообщил об ошибке команды этого устройства':'failed','сервис сообщил о доставке команды этому устройству':'delivered','сервис сообщил о завершении команды этого устройства':'completed'};
  if(commandStatus[clause]){out.rawEvents.push({kind:'command_status',value:commandStatus[clause],source:src});continue;}
  if(['я снова вошёл в этот аккаунт','я снова вошел в этот аккаунт'].includes(clause)){const f=policy.fields.find(f=>f.stageId===stage&&f.fieldId==='access_lost');if(f){out.facts.push({fieldKey:f.fieldKey,value:false,operation:'later',source:src});continue;}}
  for(const f of policy.fields.filter(f=>f.stageId===stage&&f.positive)){
   let value;if(clause===normalizeDigitalAccess(f.positive))value=true;else if(clause===normalizeDigitalAccess(f.negative))value=false;else if(clause===normalizeDigitalAccess(f.unknown))value=null;else continue;
   out.facts.push({fieldKey:f.fieldKey,value,operation,source:src});matched=true;
  }
  if(!matched&&!neutral.has(clause)&&/[\p{L}\p{N}]/u.test(clause))unsupported.push({quote,operation});
 }
 if(stages.size>1)out.ambiguous=true;
 const kinds={account_hacked:['account:'],account_blocked:['account:'],email_compromised:['mailbox:','account:'],messenger_takeover:['account:'],secure_after:['account:'],lost_device:['device:'],device_malware:['device:'],sim_swap:['number:']};
 if(out.scope.subjectId&&stage&&!(kinds[stage]||[]).some(kind=>out.scope.subjectId.startsWith(kind)))out.ambiguous=true;
 if(unsupported.length||out.ambiguous){out.unresolvedCorrection=unsupported.some(x=>x.operation==='correct');out.excluded=unsupported.length>0;out.facts=[];out.rawEvents=[];out.scope={};out.scopeEvidence={};out.stage=null;out.focus=null;out.routeSource=null;}
 return out;
}

