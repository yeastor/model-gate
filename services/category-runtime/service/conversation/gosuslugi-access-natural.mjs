// Bounded natural observations: every proposal retains the original clause.
// Role IDs are private references to explicitly reported objects, never real identifiers.
const n=s=>String(s).normalize('NFC').toLowerCase().replaceAll('ё','е').replaceAll('госуслги','госуслуги').trim().replace(/[.!]+$/u,'').replace(/^(?:(?:здравствуйте|добрый день)[,!]\s*|(?:исправляю|теперь|поправка):\s*|я ошиб(?:ся|лась)[,:]\s*)/u,'').trim();
const patterns={
 old_phone_unavailable:[/^(?:у меня )?(?:старый|прежний) (?:номер|телефон|сим-карта) (?:больше )?(?:недоступен|недоступна|не работает)$/u,/^(?:у меня )?(?:старый|прежний) (?:номер|телефон|сим-карта) (?:доступен|доступна|работает)$/u],
 old_phone_available:[/^(?:у меня )?(?:старый|прежний) (?:номер|телефон|сим-карта) (?:еще )?(?:доступен|доступна|работает)$/u,/^(?:у меня )?(?:старый|прежний) (?:номер|телефон|сим-карта) (?:больше )?(?:недоступен|недоступна|не работает)$/u],
 old_email_available:[/^(?:я )?(?:могу открыть старую почту|захожу в старую почту|старый почтовый ящик открывается)$/u,/^(?:я )?(?:не могу открыть старую почту|не могу зайти в старую почту|старый почтовый ящик не открывается)$/u],
 code_not_received:[/^(?:мне )?(?:код|смс с кодом|смс-код) (?:от госуслуг )?не (?:приходит|пришел)$/u,/^(?:мне )?(?:код|смс с кодом|смс-код) (?:от госуслуг )?(?:пришел|приходит)$/u],
 identity_data_match:[/^(?:я )?сверил(?:а)? паспорт и снилс с профилем(?: госуслуг)?, (?:все|данные) совпада(?:ет|ют)$/u,/^(?:я )?сверил(?:а)? паспорт и снилс с профилем(?: госуслуг)?, (?:есть|нашел|нашла) расхождение$/u],
 partner_bank_access_available:[/^(?:я )?(?:могу войти|захожу) в свой банковский аккаунт$/u,/^(?:я )?не могу войти в свой банковский аккаунт$/u],
 suspicious_actions:[/^(?:я )?(?:вижу|заметил|заметила|обнаружил|обнаружила) подозрительное действие в (?:своем аккаунте|своей учетной записи)(?: госуслуг)?$/u,/^(?:я )?проверил(?:а)? (?:свой аккаунт|свою учетную запись)(?: госуслуг)? и не нашел(?:ла)? подозрительных действий$/u],
 temporary_block_active:[/^(?:при входе )?(?:в госуслуг(?:и|ах) )?(?:мне )?(?:пишет|показано|появилось сообщение)(?:, что)? (?:о )?временн(?:ая|ой) (?:защитн(?:ая|ой) )?блокировк(?:а|е)(?: входа)?$/u,/^при входе (?:в госуслуги )?сообщения о временной блокировке нет$/u],
 access_lost:[/^(?:я )?(?:сейчас )?не могу (?:войти|зайти) (?:в свой аккаунт|в госуслуги|на госуслуги)$/u,/^(?:я )?(?:сейчас )?(?:могу войти|успешно вошел|успешно вошла) (?:в свой аккаунт|в госуслуги|на госуслуги)$/u],
 login_available:[/^(?:я )?(?:сейчас )?(?:могу войти|успешно вошел|успешно вошла) (?:в свой аккаунт|в госуслуги|на госуслуги)$/u,/^(?:я )?(?:сейчас )?не могу (?:войти|зайти) (?:в свой аккаунт|в госуслуги|на госуслуги)$/u],
 number_changed:[/^(?:в моем аккаунте(?: госуслуг)? )?(?:номер|телефон|почту|электронную почту) (?:поменяли|изменили) без меня$/u,/^(?:я )?проверил(?:а)? телефон и почту (?:в своем аккаунте|на госуслугах), без меня их не меняли$/u],
 loan_taken:[/^(?:я )?нашел(?:ла)? (?:один )?(?:кредит|заем) в (?:своем )?кредитном отчете$/u,/^(?:я )?проверил(?:а)? свой кредитный отчет, кредитов и займов в нем нет$/u],
 account_control_restored:[/^(?:я )?восстановил(?:а)? доступ к (?:своему аккаунту|госуслугам) и после этого успешно вошел(?:ла)?$/u,/^(?:я )?пока не восстановил(?:а)? доступ к (?:своему аккаунту|госуслугам)$/u],
 unauthorized_services_found:[/^(?:я )?нашел(?:ла)? (?:на госуслугах |в своем аккаунте )?(?:заявление|услугу), котор(?:ое|ую) не (?:подавал|подавала|оформлял|оформляла)$/u,/^(?:я )?проверил(?:а)? заявления и услуги в своем аккаунте, оформленных без меня нет$/u],
 change_notification_saved:[/^(?:я )?сохранил(?:а)? уведомление (?:об этой|о) смене (?:номера|почты|контактов)$/u,/^(?:я )?не сохранил(?:а)? уведомление (?:об этой|о) смене (?:номера|почты|контактов)$/u],
 unauthorized_action_pending:[/^(?:у этого|это) заявлени(?:я|е) (?:показан статус рассмотрения|сейчас на рассмотрении)$/u,/^у этого заявления сейчас нет статуса рассмотрения$/u],
 service_result_issued:[/^(?:по этому заявлению|у этой услуги) показан выданный результат$/u,/^(?:по этому заявлению|у этой услуги) выданного результата пока нет$/u],
 evidence_saved:[/^(?:я )?сохранил(?:а)? копию (?:этого заявления|этой записи) с датой и источником$/u,/^(?:я )?не сохранил(?:а)? копию (?:этого заявления|этой записи)$/u],
 credit_report_obtained:[/^(?:я )?получил(?:а)? (?:свой )?кредитный отчет (?:из бюро|из бки), в нем есть название бюро и дата$/u,/^(?:я )?(?:пока |еще )?не получил(?:а)? (?:свой )?кредитный отчет$/u],
 creditor_identified:[/^в этой (?:кредитной )?записи указано название (?:банка|мфо|кредитора)$/u,/^в этой (?:кредитной )?записи не указано название (?:банка|мфо|кредитора)$/u],
 unauthorized_inquiry_or_application_found:[/^(?:в моем кредитном отчете|в этом отчете) есть (?:запрос|заявка), котор(?:ый|ую) я не (?:делал|делала|подавал|подавала)$/u,/^(?:я )?проверил(?:а)? (?:свой |этот )?кредитный отчет, запросов и заявок без меня нет$/u],
 unauthorized_credit_contract_found:[/^(?:в моем кредитном отчете|в этом отчете) есть кредитный договор, который я не (?:заключал|заключала|оформлял|оформляла)$/u,/^(?:я )?проверил(?:а)? (?:свой |этот )?кредитный отчет, договоров без меня нет$/u],
 foreign_session_or_security_event_found:[/^(?:в истории безопасности моего аккаунта|в истории безопасности) (?:я )?(?:вижу|нашел|нашла) неизвестн(?:ый вход|ое действие)$/u,/^(?:я )?проверил(?:а)? историю безопасности, неизвестных входов и действий нет$/u],
 creditor_dispute_sent:[/^(?:я )?отправил(?:а)? возражение (?:этому |выбранному )кредитору по этой записи и сохранил(?:а)? подтверждение доставки$/u,/^(?:я )?еще не отправил(?:а)? возражение (?:этому |выбранному )кредитору по этой записи$/u],
 bank_recovery_refused:[/^(?:мне )?не удалось восстановить доступ (?:к госуслугам )?через (?:мой )?банк$/u,/^(?:я )?восстановил(?:а)? доступ (?:к госуслугам )?через (?:мой )?банк$/u],
 mfc_recovery_refused:[/^(?:мне )?не удалось восстановить доступ (?:к госуслугам )?через мфц$/u,/^(?:я )?восстановил(?:а)? доступ (?:к госуслугам )?через мфц$/u],
 identity_data_mismatch:[/^(?:при восстановлении|результат сверки) (?:мне )?(?:сообщили|показывает), что (?:паспортные данные|снилс) не совпада(?:ют|ет) с профилем$/u,/^результат сверки показывает, что паспортные данные и снилс совпадают с профилем$/u],
 password_changed:[/^(?:я )?(?:уже )?(?:сменил|сменила|поменял|поменяла) пароль (?:своего аккаунта |госуслуг )?после (?:этого )?инцидента$/u,/^(?:я )?еще не (?:менял|меняла|сменил|сменила) пароль после (?:этого )?инцидента$/u],
 two_factor_enabled:[/^(?:у меня )?(?:в настройках аккаунта )?(?:двухфакторная защита|дополнительное подтверждение входа) (?:уже )?включен(?:а|о)$/u,/^(?:у меня )?(?:в настройках аккаунта )?(?:двухфакторная защита|дополнительное подтверждение входа) выключен(?:а|о)$/u],
 recovery_contacts_verified:[/^(?:я )?проверил(?:а)? (?:и )?телефон и почту для восстановления (?:своего аккаунта|госуслуг)$/u,/^(?:я )?еще не проверил(?:а)? ни телефон, ни почту для восстановления (?:своего аккаунта|госуслуг)$/u],
 block_end_time_known:[/^в (?:этом )?сообщении о блокировке указано время (?:ее )?окончания$/u,/^в (?:этом )?сообщении о блокировке время (?:ее )?окончания не указано$/u],
 identity_verification_completed:[/^(?:я )?(?:уже )?завершил(?:а)? повторное подтверждение личности по (?:этой )?блокировке$/u,/^(?:я )?еще не завершил(?:а)? повторное подтверждение личности по (?:этой )?блокировке$/u],
 support_request_sent:[/^(?:я )?(?:уже )?отправил(?:а)? обращение в поддержку по (?:этой )?блокировке$/u,/^(?:я )?еще не отправил(?:а)? обращение в поддержку по (?:этой )?блокировке$/u],
};
export function naturalMatches(text,stage,policy){
 const original=n(text),unknown=original.startsWith('не знаю, '),c=unknown?original.slice('не знаю, '.length):original,found=[];
 for(const f of policy.fields.filter(f=>!stage||f.stageId===stage)){
  const pair=patterns[f.fieldId];if(!pair)continue;
  for(const [i,re]of pair.entries())if(re.test(c))found.push({field:f,value:unknown?null:i===0});
 }
 return found;
}
export function naturalFocusChange(text){
 const c=n(text);
 if(/^это другая попытка входа в мой аккаунт госуслуг$/u.test(c))return 'lost_access';
 if(/^это другая попытка восстановления моего аккаунта госуслуг$/u.test(c))return 'restore_mfc_bank';
 if(/^проверяю другую запись в своем кредитном отчете$/u.test(c))return 'credit_or_loans';
 if(/^это другое заявление в моем аккаунте госуслуг$/u.test(c))return 'unauthorized_services';
 return null;
}
export function naturalRoute(text,currentStage,policy){
 const c=n(text);
 if(naturalFocusChange(c))return naturalFocusChange(c);
 const observation=naturalUserObservations(c,currentStage)[0];if(observation)return observation.stageId;
 if(/^(?:это )?мой (?:основной |первый |другой |второй )?(?:аккаунт|профиль|личный кабинет)(?: на)? госуслуг(?:и|ах)?$/u.test(c))return currentStage||'lost_access';
 if(/^(?:я )?(?:сейчас )?не могу (?:войти|зайти) (?:в госуслуги|на госуслуги|в свой аккаунт госуслуг)$/u.test(c))return currentStage||'lost_access';
 if(/^восстанавливаю доступ к (?:своим )?госуслугам через (?:банк|мфц|банк или мфц)$/u.test(c))return 'restore_mfc_bank';
 if(/^проверяю безопасность (?:своего )?аккаунта госуслуг после инцидента$/u.test(c))return 'secure_account';
 if(/^проверяю (?:свой )?кредитный отчет$/u.test(c))return 'credit_or_loans';
 const matches=naturalMatches(c,null,policy),ids=new Set(matches.map(x=>x.field.fieldId));
 if(ids.has('bank_recovery_refused')||ids.has('mfc_recovery_refused'))return 'restore_mfc_bank';
 if(ids.has('number_changed'))return 'account_hacked';
 if(ids.has('temporary_block_active'))return 'temporary_block';
 if(ids.has('unauthorized_inquiry_or_application_found')||ids.has('unauthorized_credit_contract_found')||ids.has('credit_report_obtained'))return 'credit_or_loans';
 if(ids.has('unauthorized_services_found')&&!currentStage)return 'unauthorized_services';
 return currentStage||null;
}
export function naturalRoleKeys(text,stage,policy){
 const matches=naturalMatches(text,stage,policy);
 const observations=naturalUserObservations(text,stage);const roles=new Set([...matches.flatMap(x=>x.field.scopeKeys),...observations.flatMap(x=>x.scopeKeys)]);
 if(matches.length||observations.length||naturalRoute(text,null,policy))roles.add('focusId');
 if(naturalRoute(text,null,policy)) {
  for(const k of ['actorId','accountId','sourceId','timeId'])roles.add(k);
  // Anonymous question focus, not evidence that an object exists or a fact is true.
  // Only an actual user answer can populate the ledger; qualified producers stay held.
  for(const q of policy.questions.filter(q=>q.stageId===stage))
   for(const k of policy.fields.find(f=>f.fieldKey===q.fieldKey).scopeKeys)roles.add(k);
 }
 return roles;
}
export const naturalReference=(key,account='self-primary',focus='initial')=>key==='actorId'?'self':key==='accountId'?account:key==='focusId'?focus:'natural-'+account+'-'+focus+'-'+key;
export function naturalAccount(text,turnId){if(/другой (?:аккаунт|профиль|личный кабинет)/u.test(n(text)))return 'self-other-'+turnId;return /(?:второй) (?:аккаунт|профиль|личный кабинет)/u.test(n(text))?'self-secondary':'self-primary';}
export function naturalSourceRole(source,key,value,policy){
 if(source?.natural!==true||!source.naturalStage||!source.naturalAccount)return false;
 return naturalRoleKeys(source.quote,source.naturalStage,policy).has(key)&&value===naturalReference(key,source.naturalAccount,source.naturalFocus);
}
export {patterns as naturalPatterns};

// User reports remain observations; they do not certify foreign ownership or legal withdrawal.
export function naturalUserObservations(text,stage){
 const c=n(text),rules=[
  {kind:'unrecognized_active_session',stage:['account_hacked','secure_account'].includes(stage)?stage:'secure_account',keys:['sessionId'],positive:/^(?:я )?вижу (?:активный сеанс, который я не узнаю|незнакомый активный сеанс)$/u,negative:/^(?:я )?не вижу незнакомого активного сеанса$/u},
  {kind:'visible_withdrawal_control',stage:'unauthorized_services',keys:['serviceId','recordId','operationId'],positive:/^у этого заявления (?:есть|показана) кнопка (?:отзыва|отозвать)$/u,negative:/^у этого заявления (?:нет кнопки отзыва|не показана кнопка отзыва)$/u},
 ];return rules.filter(r=>r.positive.test(c)||r.negative.test(c)).map(r=>({kind:r.kind,stageId:r.stage,scopeKeys:['actorId','accountId','sourceId','timeId',...r.keys],value:r.positive.test(c),evidenceClass:'user_report_only'}));
}
