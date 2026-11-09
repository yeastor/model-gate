// Topic labels only. These hints never create context facts or legal findings.
import {divorceTopic} from './divorce-profile.mjs';
import {inferMCStage} from './management-company.mjs';
import {debtsStageHint} from './debts-interpret.mjs';
// Refusal guard only: true forbids retrieval and selects no category or package.
export function unavailableLocalTopic(text){
 const t=String(text||'').toLowerCase().replaceAll('ё','е');
 return /шантаж|интимн.{0,20}фото|угрож.{0,30}(?:публикац|вылож|фото|переписк)|травл.{0,20}(?:сети|интернет)/u.test(t)
  ||(/мошенни/u.test(t)&&!/госуслуг|есиа|(?:взлом|доступ).{0,20}(?:аккаунт|почт)|(?:аккаунт|почт).{0,20}(?:взлом|доступ)/u.test(t));
}
export function localTopic(category,text){
 const t=String(text||'').toLowerCase().replaceAll('ё','е');
 if(category==='divorce_property')return divorceTopic(text);
 if(category==='management_company')return inferMCStage(text,{withinCategory:true});
 if(category==='debts')return debtsStageHint(text);
 const rules={
  children_alimony:[[/измен.{0,20}алимент|уменьш.{0,20}алимент|индексац/u,'alimony_change'],[/задолжен.{0,20}алимент|долг.{0,20}алимент/u,'alimony_debt'],[/взыск.{0,20}алимент|подать.{0,20}алимент|назнач.{0,20}алимент/u,'alimony_claim']],
  collectors:[[/угрож|насили/u,'threats_pressure'],[/родствен|работодател/u,'contact_relatives_work'],[/звон|сообщени|смс/u,'calls_messages']],
  digital_access:[[/сим.?карт|sim.?swap/u,'sim_swap'],[/почт.{0,15}взлом|взлом.{0,15}почт/u,'email_compromised'],[/мессенджер|телеграм|telegram|whatsapp/u,'messenger_takeover'],[/аккаунт.{0,15}взлом|взлом.{0,15}аккаунт/u,'account_hacked'],[/аккаунт.{0,15}заблок|заблок.{0,15}аккаунт/u,'account_blocked']],
  consumer_disputes:[[/некачествен|бракован|дефект|недостаток/u,'defective_goods']],
  neighbors:[[/шум|громк.{0,15}музык/u,'noise']],
  labor_disputes:[[/зарплат|заработн.{0,15}плат/u,'salary_delay'],[/травм.{0,20}работ|работ.{0,20}травм/u,'workplace_injury']],
 };
 return rules[category]?.find(([re])=>re.test(t))?.[1]||null;
}
