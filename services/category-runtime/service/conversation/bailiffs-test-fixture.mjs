import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createBailiffsProfile} from './bailiffs-profile.mjs';
import {createConversationService} from './service.mjs';
import {fresh,episode,newRound,atomic,identityKey,currentEpisode,caseQuestionsUsed} from './state.mjs';
const p=createBailiffsProfile(),root=process.env.BA_DM_TEST_ROOT,allowed='C:/Users/mujlo/Documents/Codex/2026-06-20/_work/bailiffs/hold-closure/20261026-v1/';
if(!root||!path.resolve(root).replaceAll('\\','/').startsWith(allowed))throw Error('BA_TEST_OUTPUT_REQUIRED');
await fs.mkdir(root,{recursive:true});const trace=path.join(root,'native-traces.jsonl');await fs.writeFile(trace,'');let records=0;
after(async()=>{await fs.writeFile(path.join(root,'native-trace-index.json'),JSON.stringify({records,file:trace,origin:'synthetic_dev_native_service_not_independent_holdout'})+'\n');});
function check(id,title,run){test(id+' '+title,async()=>{const tr={id,title,origin:'synthetic_dev_native_service',steps:[],status:'RUNNING'};try{await run(tr);tr.status='PASS';}catch(e){tr.status='FAIL';tr.error=e.stack;throw e;}finally{records++;await fs.appendFile(trace,JSON.stringify(tr)+'\n');}});}
const prefix=stage=>[p.policy.stages.find(s=>s.id===stage).phrase,'С меня взыскивают этот долг','Речь об одном исполнительном производстве',...({ip_opened:['Обсуждаем постановление о возбуждении'],account_arrest:['Мой банк Альфа','Обсуждаем мой счёт зарплаты'],money_writeoff:['Мой банк Альфа','Обсуждаем мой счёт зарплаты','Обсуждаем мою выплату зарплаты за сентябрь'],wage_garnishment:['Мой банк Альфа','Обсуждаем мой счёт зарплаты','Мой плательщик работодатель Альфа','Обсуждаем мою выплату зарплаты за сентябрь'],property_arrest:['Обсуждаем вещь автомобиль'],restrictions:['Обсуждаем постановление по текущим ограничениям'],installment_suspension:['Обсуждаем судебный акт решение по этому долгу'],complaint_bailiff:['Обсуждаем моё заявление о розыске счетов']}[stage])].join('; ');
const literal=(key,value)=>{const q=p.policy.predicates.find(x=>x.fieldKey===key);return value===true?q.positive:value===false?q.negative:q.unknown;};
async function fixture(tr,{stage='ip_opened',used=0,reports=[],start=true}={}){
 const dir=await fs.mkdtemp(path.join(root,'case-')),s=fresh('19',randomUUID(),p.sourceSha256);episode(s);p.prepareState(s);newRound(s,'synthetic-initial');s.caseState.baselineUsed=used;
 const file=path.join(dir,'conversation-sessions-v2',identityKey(s.userId,s.chatId)+'.json');await atomic(file,s);
 const options={dataDir:dir,getActive:async()=>({sha256:p.sourceSha256}),getBundle:async()=>p.bundle,categoryProfile:p};let service=createConversationService(options);
 const f={file,dir,id:s.chatId,userId:s.userId,state:async()=>JSON.parse(await fs.readFile(file,'utf8')),service:()=>service,restart(){service=createConversationService(options);},async mutate(fn){const st=await f.state();fn(st);await atomic(file,st);},async send(question,extra={},ack=true){const st=await f.state(),input={id:f.id,userId:f.userId,turnId:randomUUID(),question,conversation:{sessionId:st.id,revision:st.revision},...extra};f.lastInput=input;try{f.response=await service.respond(input);tr.steps.push({input,response:f.response,state:await f.state()});if(ack)await service.internal({id:f.id,userId:f.userId,turnId:f.response.turn.turnId},'ack');return f.response;}catch(e){tr.steps.push({input,error:{code:e.code,message:e.message},state:await f.state()});throw e;}},async click(value){const button=f.response.answer.next[0]?.view.find(x=>x.guided.native.value===value);assert.ok(button,'offered '+value+' '+f.response.dialogue.questionId);return f.send(button.title,{guided:button.guided});},async resume(){const input={id:f.id,userId:f.userId,resume:true};f.response=await service.respond(input);tr.steps.push({input,response:f.response,state:await f.state()});return f.response;}};
 if(start)await f.send([prefix(stage),...reports].join('; '));return f;
}
const sourceNext=JSON.parse(p.components.NEXT);

export {p,prefix,literal,fixture,check,assert,fs,path,randomUUID,currentEpisode};
