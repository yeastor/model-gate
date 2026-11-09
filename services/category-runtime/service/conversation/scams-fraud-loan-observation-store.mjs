// Persistence adapter for the authenticated conversation service's internal API.
import {collectLoanObservation,projectLoanObservation} from "./scams-fraud-loan-observation.mjs";
export async function loanObservationOperation({input,identity,file,read,atomic,now}) {
 const stored=await read(file);
 const at=now();
 if(stored?.deleted && input.observationAction!=="read")throw Error("DELETED_LOAN_OBSERVATION");
 const scope={userId:identity.userId,chatId:identity.chatId,loanId:input.loanId,accountId:input.accountId,at};
 if(input.observationAction==="read")return {revision:stored?.revision||0,...projectLoanObservation(stored?.state,scope)};
 if(input.observationAction!=="record" || input.categoryId!=="scams_fraud")throw Error("INVALID_LOAN_OBSERVATION_ACTION");
 if(!/^[0-9a-f-]{36}$/i.test(input.turnId||""))throw Error("TURN_ID_REQUIRED");
 const replay=stored?.state?.turns?.find(t=>t.turnId===input.turnId);
 if(!replay && input.expectedRevision!==(stored?.revision||0))throw Error("STALE_LOAN_OBSERVATION");
 const state=collectLoanObservation({userId:identity.userId,chatId:identity.chatId,turnId:input.turnId,text:input.question,recordedAt:at,previous:stored?.state});
 const revision=replay?stored.revision:(stored?.revision||0)+1;
 if(!replay)await atomic(file,{revision,state});
 return {revision,...projectLoanObservation(state,{...scope,at:replay?replay.recordedAt:at}),qualifiedVariantActivation:false};
}
