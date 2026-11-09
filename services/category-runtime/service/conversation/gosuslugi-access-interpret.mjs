import {naturalMatches,naturalRoute,naturalRoleKeys,naturalReference,naturalAccount,naturalFocusChange,naturalUserObservations} from './gosuslugi-access-natural.mjs';
// Finite current observations. Unrecognized or qualified assertions stay raw.
export const normalizeGosuslugi = text => String(text).normalize('NFC').toLowerCase().replaceAll('ё','е').trim().replace(/[.!]+$/u,'').trim();
export const scopeLabels = Object.freeze({
  accountId:'моя учетная запись',sourceId:'источник наблюдения',timeId:'момент наблюдения',
  oldPhoneId:'старый телефон',newPhoneId:'новый телефон',oldEmailId:'старый ящик',newEmailId:'новый ящик',
  recoveryId:'восстановление',attemptId:'попытка входа',deliveryId:'отправка кода',channelId:'канал получения',
  comparisonId:'сверка',documentId:'сравниваемый документ',bankId:'выбранный банк',bankAccountId:'банковская запись',
  bankAttemptId:'попытка банка',centerId:'выбранный центр',mfcAttemptId:'попытка мфц',
  securityEventId:'событие безопасности',deviceId:'устройство',noticeId:'уведомление',functionId:'ограниченная функция',
  changeId:'смена контактов',loanId:'кредитная запись',recordId:'выбранная запись',serviceId:'выбранная услуга',
  sessionId:'выбранная сессия',resultId:'результат услуги',operationId:'операция сервиса',reportId:'кредитный отчет',
  bureauId:'выбранное бюро',creditorId:'выбранный кредитор',applicationId:'выбранная заявка',contractId:'выбранный договор',
  requestId:'выбранное обращение',passwordActionId:'смена пароля',settingId:'настройка безопасности',
  contactCheckId:'сверка контактов',verificationId:'проверка личности',contactId:'официальный контакт',
});
const escapeRE = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function parseGosuslugiScope(text) {
  const scope={}, evidence={},spans={},conflicts=new Set();
  for (const [key,label] of Object.entries(scopeLabels)) {
    const re=new RegExp('^'+escapeRE(label)+' №([\\p{L}\\p{N}_-]{1,48})$','u');
    for (const part of String(text).matchAll(/[^;.\n]+/gu)) {
      const clause=part[0];
      const match=normalizeGosuslugi(clause).match(re);
      if (match) {
        if(scope[key]&&scope[key]!==match[1])conflicts.add(key);
        scope[key]=match[1];evidence[key]=clause.trim();
        const start=part.index+clause.indexOf(evidence[key]);
        spans[key]=[Array.from(String(text).slice(0,start)).length,Array.from(String(text).slice(0,start+evidence[key].length)).length];
      }
    }
  }
  if (scope.accountId) {scope.actorId='self';evidence.actorId=evidence.accountId;spans.actorId=spans.accountId;}
  return {scope,evidence,spans,ambiguous:conflicts.size>0};
}
export const stagePhrases=Object.freeze({
  lost_access:'Не получается войти в мою запись Госуслуг',
  account_hacked:'В моей записи Госуслуг обнаружен посторонний доступ',
  number_or_email_changed:'В моей записи Госуслуг изменились контакты',
  unauthorized_services:'В моей записи Госуслуг обнаружена незнакомая услуга',
  credit_or_loans:'Проверяю кредитные записи по моим данным',
  restore_mfc_bank:'Восстанавливаю мою запись Госуслуг через банк или центр',
  secure_account:'Проверяю безопасность моей записи Госуслуг после инцидента',
  temporary_block:'В моей записи Госуслуг показано ограничение',
});
export const auxiliaryObservations=Object.freeze({
  visible_loan_record:{text:'В этом источнике показана отдельная запись об этом кредите с его статусом',negative:'В этом источнике нет отдельной записи об этом кредите с его статусом',scopeKeys:['loanId','recordId']},
  source_report_contains_selected_record:{text:'В полученном отчете этого бюро содержится именно выбранная запись',negative:'В полученном отчете этого бюро нет выбранной записи',scopeKeys:['reportId','bureauId','recordId']},
  official_contact_verification_completed:{text:'Я открыл официальный сайт этого кредитора и сверил именно выбранный контакт',negative:'Я не открывал официальный сайт этого кредитора и не сверял выбранный контакт',scopeKeys:['creditorId','contactId','recordId']},
  application_current_status_no_disbursement:{text:'В источнике статуса этой заявки прямо указано, что одобрения и выдачи пока нет',negative:'В источнике статуса этой заявки указано, что одобрение или выдача уже есть',scopeKeys:['applicationId','recordId']},
});
export function interpretGosuslugi(s,text,turnId,policy) {
  const source={kind:'user_text',turnId,quote:String(text),message:String(text),span:[0,Array.from(String(text)).length]};
  const out={source,facts:[],auxiliary:[],observations:[],scope:{},scopeEvidence:{},stage:null,excluded:false,foreign:false,ambiguous:false};
  const normalized=normalizeGosuslugi(text);
  out.stop=['стоп','без вопросов','не задавайте вопросы'].includes(normalized);
  out.repeat=['повторите памятку','покажите памятку','повтори ответ'].includes(normalized);
  out.confused=['не понимаю вопрос','что означает вопрос'].includes(normalized);
  out.ack=['спасибо','понятно','хорошо','продолжим'].includes(normalized);
  out.document=['открой документ','подготовь документ','откройте форму'].includes(normalized);
  out.newCase=normalized.startsWith('это другой случай:');
  out.withdraw=normalized==='отзываю свое последнее сообщение';
  out.unresolvedCorrection=normalized.startsWith('исправляю:');
  // A quote, question or mixed foreign account story cannot manufacture scope.
  if (/[«»"?`]/u.test(text)||/(?:^|[\s;])(?:если|возможно|кажется|допустим|гипотеза|цитата)(?:[\s,:;]|$)|в статье|ассистент сказал|в прошлом году|боюсь, что/u.test(normalized)) {out.excluded=true;return out;}
  if (/у друга|у подруги|чужая учетная запись|запись другого человека|не моя запись/u.test(normalized)) {out.foreign=true;return out;}
  if (/моя и чужая|первая и вторая|другая запись без|он изменил|она изменила/u.test(normalized)) {out.ambiguous=true;return out;}
  const scope=parseGosuslugiScope(text);if(scope.ambiguous){out.ambiguous=true;return out;}out.scope=scope.scope;out.scopeEvidence=scope.evidence;
  out.scopeUnresolved=/^(?:(?:теперь|это|у меня) )?(?:другой|другая|другое|другую|новый|новая|новое|новую|еще один|еще одна|еще одно) [\p{L}\s]{0,35}(?:банк|мфц|запис|попытк|кредит|заявлен|договор|аккаунт|профил|отчет)/u.test(normalized);
  const routes=new Set(),unsupported=[];out.naturalRoles={};let account=s.episodes?.find(e=>e.id===s.activeEpisodeId)?.gaScopes?.[s.episodes?.find(e=>e.id===s.activeEpisodeId)?.stageId]?.values?.accountId||null;
  let focus=s.episodes?.find(e=>e.id===s.activeEpisodeId)?.gaScopes?.[s.episodes?.find(e=>e.id===s.activeEpisodeId)?.stageId]?.values?.focusId||'initial';const naturalContexts=new Set();
  const neutral=new Set(['помогите','спасибо','понятно','хорошо','продолжим','стоп','без вопросов','не задавайте вопросы','повторите памятку','покажите памятку','повтори ответ','не понимаю вопрос','что означает вопрос','открой документ','подготовь документ','откройте форму','отзываю свое последнее сообщение','сомневаюсь в предыдущем ответе','да','нет','не знаю']);
  let stage=s.episodes?.find(e=>e.id===s.activeEpisodeId)?.stageId;
  for (const match of String(text).matchAll(/[^;.\n]+[.]?/gu)) {
    const quote=match[0].trim().replace(/[.]$/u,'').trim();
    const start=match.index+match[0].indexOf(quote),span=[Array.from(text.slice(0,start)).length,Array.from(text.slice(0,start+quote.length)).length];
    let c=normalizeGosuslugi(quote),operation='assert';
    if (c.startsWith('это другой случай:')) c=c.slice('это другой случай:'.length).trim();
    if (c.startsWith('исправляю:')) {operation='correct';c=c.slice('исправляю:'.length).trim();}
    else if (/^(?:я ошиб(?:ся|лась)[,:]|поправка:)/u.test(c)) {operation='correct';c=c.replace(/^(?:я ошиб(?:ся|лась)[,:]|поправка:)\s*/u,'');}
    else if (c.startsWith('теперь:')) {operation='later';c=c.slice('теперь:'.length).trim();}
    const route=Object.entries(stagePhrases).find(([,v])=>normalizeGosuslugi(v)===c);
    if (route) {stage=route[0];out.stage=stage;routes.add(stage);continue;}
    let recognized=false;
    const src={kind:'user_text',turnId,quote,message:String(text),span};
    const naturalStage=naturalRoute(c,stage,policy),natural=naturalStage?naturalMatches(c,naturalStage,policy):[];
    const naturalKeys=naturalStage?naturalRoleKeys(c,naturalStage,policy):new Set();
    if(naturalStage&&(natural.length||naturalKeys.size)){
      if(!stage||naturalStage!==stage){stage=naturalStage;out.stage=stage;routes.add(stage);}
      const namedAccount=/мой (?:основной |первый |другой |второй )?(?:аккаунт|профиль|личный кабинет)/u.test(c);
      if(!account||namedAccount)account=naturalAccount(c,turnId);
      if(naturalFocusChange(c))focus='turn-'+turnId;
      if(namedAccount||naturalFocusChange(c)){out.scopeExplicit=true;out.scopeUnresolved=false;}
      naturalContexts.add(account+':'+focus);
      for(const key of naturalKeys){
        // Keep the prior explicit account reference when a later clause says "this".
        if(['actorId','accountId'].includes(key)&&out.naturalRoles[key]&&!namedAccount)continue;
        const value=naturalReference(key,account,focus);out.scope[key]=value;
        out.naturalRoles[key]={...src,natural:true,naturalStage:stage,naturalAccount:account,naturalFocus:focus,value};
      }
      for(const observation of naturalUserObservations(c,stage))out.observations.push({...observation,operation,source:src});
      for(const match of natural)out.facts.push({fieldKey:match.field.fieldKey,value:match.value,operation,source:src});
      recognized=true;
    }
    for (const f of policy.fields.filter(f=>f.stageId===stage)) {
      let value;
      if (c===normalizeGosuslugi(f.positive))value=true;
      else if(c===normalizeGosuslugi(f.negative))value=false;
      else if(c===normalizeGosuslugi(f.unknown))value=null;
      else continue;
      out.facts.push({fieldKey:f.fieldKey,value,operation,source:src});
      recognized=true;
    }
    for (const [need,def] of Object.entries(auxiliaryObservations)) {
      let value;
      if(c===normalizeGosuslugi(def.text))value=true;
      else if(c===normalizeGosuslugi(def.negative))value=false;
      else if(c===normalizeGosuslugi('Не знаю, '+def.text))value=null;
      else continue;
      out.auxiliary.push({need,value,operation,source:src});recognized=true;
    }
    if(!recognized&&!(neutral.has(c)&&(!['да','нет','не знаю'].includes(c)||c===normalized))&&!Object.values(scope.evidence).some(q=>normalizeGosuslugi(q)===c)&&/[\p{L}\p{N}]/u.test(c))unsupported.push({quote,operation});
  }
  // Exact clauses are meaningful only inside a completely understood frame.
  // An unrecognized introduction may make the following literal a quote or plan.
  if(unsupported.length||routes.size>1||naturalContexts.size>1){out.unresolvedCorrection=unsupported.some(x=>x.operation==='correct');out.excluded=unsupported.length>0;out.ambiguous=routes.size>1||naturalContexts.size>1;out.scopeUnresolved ||= naturalContexts.size>1;out.scopeExplicit=false;out.facts=[];out.auxiliary=[];out.observations=[];out.scope={};out.scopeEvidence={};out.naturalRoles={};out.stage=null;}
  return out;
}
