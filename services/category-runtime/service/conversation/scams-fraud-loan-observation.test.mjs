import test from "node:test";
import assert from "node:assert/strict";
import {collectLoanObservation as collect,projectLoanObservation as project} from "./scams-fraud-loan-observation.mjs";
const start="2026-10-31T10:00:00.000Z",now="2026-11-01T10:00:00.000Z";
const scope={userId:"u1",chatId:"c1",loanId:"L1",accountId:"A1",at:now};
const receipt=`Я получил деньги по займу L1 на счет A1 в ${start}.`;
const review=`Я уже проверил выписку по счету A1 по займу L1 за весь период с ${start} по сейчас.`;
const negative="За весь этот период я не снимал, не переводил, не тратил и не возвращал деньги этого займа.";
const text=[receipt,review,negative].join("\n");
const turn=(t=text,extra={})=>collect({userId:"u1",chatId:"c1",turnId:"t1",text:t,recordedAt:now,...extra});
test("completed same-loan full-interval report supports only dated user-reported values",()=>{
 const state=turn(),p=project(state,scope);
 assert.deepEqual(p.values,{loan_money_received_by_user:true,loan_receipt_period_fully_observed:true,received_loan_funds_not_moved:true});
 assert.equal(p.status,"USER_REPORTED_NOT_BANK_VERIFIED");assert.equal(state.turns[0].independentlyVerified,false);
});
test("ability, bare yes, hypothesis, quote, assistant and uncertainty never confirm a fact",()=>{
 for(const t of ["Да","Я могу проверить выписку",text+"\nНе уверен", "Если "+text,"В статье: "+text, "Ассистент: "+text,'«'+text+'»'])
 assert.deepEqual(Object.values(project(turn(t),scope).values),[null,null,null],t);
});
test("partial period, foreign account/loan, extra contradictory clause cannot prove complete negative",()=>{
 for(const t of [text.replace(review,review.replace(start,now)),text.replace("по счету A1 по займу L1","по счету A2 по займу L1"),text.replace("по счету A1 по займу L1","по счету A1 по займу L2"),text+"\nНо один перевод был."])
 assert.equal(project(turn(t),scope).values.received_loan_funds_not_moved,null,t);
});
test("past or future review does not assert continuous evidence up to the current time",()=>{
 assert.equal(project(turn(text.replace("по сейчас","по "+start)),scope).values.loan_receipt_period_fully_observed,null);
 assert.equal(project(turn(text.replace("по сейчас","по 2027-01-01T00:00:00.000Z")),scope).values.received_loan_funds_not_moved,null);
 const later={...scope,at:"2026-11-01T10:00:01.000Z"};
 assert.equal(project(turn(),later).values.received_loan_funds_not_moved,null);
});
test("actual movement yields false, and never becomes unmoved when a review gets stale",()=>{
 const state=turn([receipt,review,`В этом периоде я перевел деньги этого займа в ${start}.`].join("\n"));
 assert.equal(project(state,scope).values.received_loan_funds_not_moved,false);
 assert.equal(project(state,{...scope,at:"2026-11-02T10:00:00.000Z"}).values.received_loan_funds_not_moved,false);
});
test("foreign owner, different subject and invalid dates are rejected or unknown",()=>{
 const s=turn();
 assert.deepEqual(Object.values(project(s,{...scope,userId:"u2"}).values),[null,null,null]);
 assert.equal(project(s,{...scope,loanId:"L2"}).values.loan_money_received_by_user,null);
 assert.throws(()=>turn(text,{userId:"u2",previous:s}),/FOREIGN/);
 assert.equal(project(turn(text.replace(start,"2026-99-99T10:00:00.000Z")),scope).values.loan_money_received_by_user,null);
});
test("replay is stable, changed replay rejected, correction keeps raw history and clears projection",()=>{
 const s=turn(),replay=turn(text,{previous:s});
 assert.deepEqual(replay,s);assert.throws(()=>turn("Да",{previous:s}),/CONFLICT/);
 const corrected=turn("Не знаю, проверен ли весь период",{previous:s,turnId:"t2"});
 assert.equal(corrected.turns.length,2);assert.deepEqual(Object.values(project(corrected,scope).values),[null,null,null]);
 assert.equal(corrected.failed2HistoryReset,false);
});
