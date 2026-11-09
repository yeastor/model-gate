// G05 collects a dated user report; it never asserts independent bank verification.
import { createHash } from "node:crypto";
const digest = x => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const iso = x => typeof x === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
const unknown = () => ({loan_money_received_by_user:null,loan_receipt_period_fully_observed:null,received_loan_funds_not_moved:null});
export const G05_QUESTION = "Вы уже проверили выписку по счету получения именно этого займа за весь период от поступления до указанного момента? Укажите начало и конец проверки и отдельно — были ли снятия, переводы, траты или возвраты. Если проверить весь период не удалось, так и напишите.";
export function collectLoanObservation({userId,chatId,turnId,text,recordedAt,previous=null}) {
  if (![userId,chatId,turnId].every(x=>typeof x==="string"&&x.length>0&&x.length<=128) || typeof text!=="string" || text.length>10000 || !iso(recordedAt)) throw Error("INVALID_OBSERVATION");
  if (previous && (previous.userId!==userId || previous.chatId!==chatId)) throw Error("FOREIGN_OBSERVATION");
  const fingerprint=digest({text});
  const existing=previous?.turns?.find(x=>x.turnId===turnId);
  if(existing) {if(existing.fingerprint!==fingerprint)throw Error("TURN_ID_CONFLICT");return structuredClone(previous);}
  if(previous?.turns?.length>=1000)throw Error("OBSERVATION_LIMIT");
  if(previous?.turns?.at(-1)?.recordedAt>recordedAt)throw Error("OUT_OF_ORDER_OBSERVATION");
  const record={turnId,text,recordedAt,fingerprint,sourceKind:"user_report",independentlyVerified:false,scope:null,receiptAt:null,review:null,movement:null};
  // A deliberately bounded protocol: unsupported prose stays unknown. No article,
  // assistant output, bare yes, client flags, or ability statement supplies evidence.
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const receipt=lines[0]?.match(/^Я получил деньги по займу ([A-Za-z0-9_-]{1,64}) на счет ([A-Za-z0-9_-]{1,64}) в (\S+)\.$/u);
  const unsafe=/могу|смогу|собираюсь|планирую|не знаю|не помню|не уверен|если|возможно|ассистент|в статье|цитат|[«»"]/iu.test(text);
  if(receipt && !unsafe && iso(receipt[3]) && receipt[3]<=recordedAt) {
    record.scope={loanId:receipt[1],accountId:receipt[2]};
    record.receiptAt=receipt[3];
    const review=lines[1]?.match(/^Я уже проверил выписку по счету ([A-Za-z0-9_-]{1,64}) по займу ([A-Za-z0-9_-]{1,64}) за весь период с (\S+) по (\S+)\.$/u);
    if(review && review[1]===receipt[2] && review[2]===receipt[1] && iso(review[3]) && (review[4]==="сейчас" || iso(review[4])) && review[3]===receipt[3] && (review[4]==="сейчас" || (review[4]>=review[3] && review[4]<=recordedAt))) record.review={from:review[3],through:review[4]==="сейчас"?recordedAt:review[4],completed:true};
    const noMovement="За весь этот период я не снимал, не переводил, не тратил и не возвращал деньги этого займа.";
    const moved=lines[2]?.match(/^В этом периоде я (снял|перевел|потратил|вернул) деньги этого займа в (\S+)\.$/u);
    if(record.review && lines.length===3 && lines[2]===noMovement)record.movement={value:false};
    if(record.review && lines.length===3 && moved && iso(moved[2]) && moved[2]>=record.review.from && moved[2]<=record.review.through)record.movement={value:true,at:moved[2],kind:moved[1]};
    // Extra statements/contradictions cannot silently strengthen a report.
    if(lines.length!==3) {record.review=null;record.movement=null;}
  }
  return {schema:"scams-fraud-loan-observations/v1",userId,chatId,turns:[...(previous?.turns||[]),record],failed2HistoryReset:false};
}
export function projectLoanObservation(state,{userId,chatId,loanId,accountId,at}) {
  if(!iso(at))throw Error("INVALID_PROJECTION_TIME");
  const values=unknown(),last=state?.turns?.at(-1);
  if(!state || state.userId!==userId || state.chatId!==chatId || !last || last.recordedAt>at) return {values,status:"UNKNOWN",source:null};
  if(last.scope?.loanId!==loanId || last.scope?.accountId!==accountId) return {values,status:"UNKNOWN",source:null};
  values.loan_money_received_by_user=true;
  if(last.review && last.review.through===at) {
    values.loan_receipt_period_fully_observed=true;
    if(last.movement)values.received_loan_funds_not_moved=!last.movement.value;
  } else if(last.movement?.value===true) values.received_loan_funds_not_moved=false;
  return {values,status:"USER_REPORTED_NOT_BANK_VERIFIED",source:{turnId:last.turnId,recordedAt:last.recordedAt,quote:last.text,sha256:digest(last),review:last.review}};
}
