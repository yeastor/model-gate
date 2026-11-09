
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{status:409});};
const hash=b=>createHash('sha256').update(b).digest('hex');
const stable=o=>Array.isArray(o)?o.map(stable):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,stable(o[k])])):o;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const tfu=v=>v===true||v===false||v===null;
const processToken=randomUUID();
const normalize=p=>path.resolve(p).replaceAll('\\','/').toLowerCase();
async function bytes(file){try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())fail('STORE_UNSAFE_FILE');return await fs.readFile(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function decode(b,code){try{return JSON.parse(b.toString('utf8'));}catch{fail(code);}}
function descriptor(b){return b===null?{exists:false}:{exists:true,bytes:b.length,sha256:hash(b)};}
async function stage(file,data,suffix){const temp=file+'.'+randomUUID()+suffix;let handle;try{handle=await fs.open(temp,'wx');await handle.writeFile(data);await handle.sync();}finally{await handle?.close();}return temp;}
async function immutable(file,data,suffix='.publish-temp'){
 const temp=await stage(file,data,suffix);
 try{await fs.link(temp,file);}
 finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
function owner(file,context){return {schema:'children-store-lease/v1',pid:process.pid,processToken,leaseToken:randomUUID(),file:normalize(file),identity:context.identity,tuple:context.tuple};}
function dead(pid){
 try{process.kill(pid,0);return false;}
 catch(e){if(e.code==='ESRCH')return true;fail('STORE_OWNER_LIVENESS_UNPROVEN');}
}
function validOwner(value,file,context){
 if(value?.schema!=='children-store-lease/v1'||!Number.isSafeInteger(value.pid)||value.pid<=0
  ||typeof value.leaseToken!=='string'||typeof value.processToken!=='string'
  ||value.file!==normalize(file)||!equal(value.identity,context.identity)||!equal(value.tuple,context.tuple))fail('STORE_LOCK_OWNER_UNPROVEN');
}
async function releaseOwner(lock,expected){
 const current=await bytes(lock);
 if(!current||hash(current)!==hash(expected))fail('STORE_LOCK_OWNERSHIP_CHANGED');
 await fs.unlink(lock);
}
async function lease(file,context){
 const lock=file+'.lock',guard=lock+'.recovery',value=owner(file,context),encoded=Buffer.from(JSON.stringify(value));
 await fs.mkdir(path.dirname(file),{recursive:true});
 if(await bytes(guard))fail('STORE_RECOVERY_GUARD_UNPROVEN');
 try{await immutable(lock,encoded,'.lease-temp');return {release:()=>releaseOwner(lock,encoded)};}
 catch(e){if(e.code!=='EEXIST')throw e;}
 const previous=await bytes(lock);
 if(!previous)fail('SESSION_BUSY');
 const old=decode(previous,'STORE_LOCK_OWNER_UNPROVEN');validOwner(old,file,context);
 // A live PID, including a reused PID, never authorizes takeover.
 if(!dead(old.pid))fail('SESSION_BUSY');
 const recovery=Buffer.from(JSON.stringify(owner(file,context)));
 try{await immutable(guard,recovery,'.recovery-temp');}
 catch(e){if(e.code==='EEXIST')fail('STORE_RECOVERY_GUARD_UNPROVEN');throw e;}
 try{
  const actual=await bytes(lock);
  if(!actual||hash(actual)!==hash(previous)||!dead(old.pid))fail('STORE_LOCK_CHANGED_DURING_RECOVERY');
  await fs.unlink(lock);
  try{await immutable(lock,encoded,'.lease-temp');}
  catch(e){if(e.code==='EEXIST')fail('SESSION_BUSY');throw e;}
 }finally{await releaseOwner(guard,recovery);}
 return {release:()=>releaseOwner(lock,encoded)};
}
function bindingFor(statePath,state){
 const name='case-'+hash(JSON.stringify(stable([state.identity.userId,state.scope.caseId])))+'.binding.json';
 return {path:path.join(path.dirname(statePath),name),text:JSON.stringify({identity:state.identity,scope:state.scope,tuple:state.tuple})};
}
export function validateStoredState(s,context){
 if(!s||s.schema!=='qualified-session/v2'||s.runtimeVersion!==context.runtimeVersion
  ||!equal(s.identity,context.identity)||!equal(s.tuple,context.tuple))fail('SESSION_VERSION_UNAVAILABLE');
 if(context.scope&&!equal(s.scope,context.scope))fail('CASE_SCOPE_MISMATCH');
 if(!s.scope?.caseId||!s.scope.childId||!s.scope.subjectId)fail('STORE_SCOPE_CORRUPT');
 if(!Number.isInteger(s.revision)||s.revision<1||!Number.isInteger(s.used)||s.used<0||s.used>2
  ||!Array.isArray(s.ledger)||!Array.isArray(s.events)||!Array.isArray(s.asked)
  ||!Array.isArray(s.displayedFields)||!s.turns||typeof s.turns!=='object')fail('STORE_STATE_CORRUPT');
 const ids=new Map();
 for(const item of s.ledger){
  if(!item.id||ids.has(item.id)||!tfu(item.value)||!equal(item.scope,s.scope)||!equal(item.actor,s.identity))fail('STORE_LEDGER_CORRUPT');
  ids.set(item.id,item);
 }
 for(const item of s.ledger.filter(x=>x.status==='active')){
  for(const id of item.dependencies??[])if(ids.get(id)?.status!=='active')fail('STORE_ACTIVE_DEPENDENCY_CORRUPT');
 }
 if(s.projection){
  if(!tfu(s.projection.value)||!Array.isArray(s.projection.dependencies)
    ||s.projection.dependencies.some(id=>ids.get(id)?.status!=='active'))fail('STORE_PROJECTION_CORRUPT');
 }
 for(const turn of Object.values(s.turns)){
  const r=turn.response;
  if(!/^[0-9a-f]{64}$/.test(turn.hash??'')||r?.conversation?.sessionId!==s.id
   ||!equal(r.conversation.scope,s.scope)||!equal(r.conversation.tuple,s.tuple)
   ||r.conversation.revision>s.revision||r.questionsUsed>s.used||r.questionsUsed>2
   ||r.presentation?.runtimeVersion!==context.runtimeVersion)fail('STORE_TURN_JOURNAL_CORRUPT');
 }
 if(!s.lastResponse||s.lastResponse.conversation?.revision!==s.revision||s.lastResponse.questionsUsed!==s.used
  ||s.lastResponse.conversation.sessionId!==s.id)fail('STORE_LAST_RESPONSE_CORRUPT');
 if(s.engine?.presented>s.used)fail('STORE_BUDGET_CORRUPT');
 if(s.outbox){
  const turn=s.turns[s.outbox.turnId]?.response;
  if(!turn||turn.presentation.responseId!==s.outbox.messageId||s.outbox.responseId!==s.outbox.messageId
    ||turn.conversation.revision!==s.revision)fail('STORE_OUTBOX_CORRUPT');
 }
 return s;
}
async function ensureBinding(binding){
 const existing=await bytes(binding.path);
 if(existing){
  if(!equal(decode(existing,'STORE_CASE_BINDING_CORRUPT'),JSON.parse(binding.text)))fail('CASE_ALREADY_BOUND');
  return;
 }
 try{await immutable(binding.path,Buffer.from(binding.text),'.binding-temp');}
 catch(e){if(e.code!=='EEXIST')throw e;const actual=await bytes(binding.path);
  if(!actual||!equal(decode(actual,'STORE_CASE_BINDING_CORRUPT'),JSON.parse(binding.text)))fail('CASE_ALREADY_BOUND');
 }
}
export async function assertNewCaseUnbound(file,context){
 const binding=bindingFor(file+'.qualified.json',context),existing=await bytes(binding.path);
 if(!existing)return;
 if(!equal(decode(existing,'STORE_CASE_BINDING_CORRUPT'),JSON.parse(binding.text)))fail('CASE_ALREADY_BOUND');
 fail('CASE_STATE_MISSING_RECOVERY_REQUIRED');
}
function recordState(record,file,context){
 if(record?.schema!=='children-store-commit/v1'||record.decision!=='COMMIT'
  ||record.statePath!==normalize(file)||typeof record.transactionId!=='string'
  ||!record.after||typeof record.after.text!=='string')fail('STORE_JOURNAL_CORRUPT');
 const data=Buffer.from(record.after.text);
 if(data.length!==record.after.bytes||hash(data)!==record.after.sha256)fail('STORE_JOURNAL_AFTER_CORRUPT');
 const state=validateStoredState(decode(data,'STORE_JOURNAL_STATE_CORRUPT'),context);
 if(!equal(record.binding,bindingFor(file,state)))fail('STORE_JOURNAL_BINDING_CORRUPT');
 if(!record.before||typeof record.before.exists!=='boolean'
  ||record.before.exists&&(!Number.isInteger(record.before.bytes)||!/^[0-9a-f]{64}$/.test(record.before.sha256??'')))fail('STORE_JOURNAL_BEFORE_CORRUPT');
 return {state,data};
}
async function complete(record,file,recordPath,context,prepared=null){
 const {data}=recordState(record,file,context);
 const observed=await bytes(file),after={exists:true,bytes:record.after.bytes,sha256:record.after.sha256};
 if(!equal(descriptor(observed),record.before)&&!equal(descriptor(observed),after))fail('STORE_COMMIT_TARGET_DRIFT');
 await ensureBinding(record.binding);
 if(!equal(descriptor(observed),after)){
  const temp=prepared??await stage(file,data,'.tmp');
  try{await fs.rename(temp,file);}
  catch(error){
   const now=await bytes(file);
   if(!equal(descriptor(now),after))fail('STORE_COMMIT_PENDING_RECOVERY');
   // Rename returned an error after replacing the target. Observed exact bytes decide the outcome.
  }
 }
 const readback=await bytes(file);
 if(!equal(descriptor(readback),after))fail('STORE_COMMIT_READBACK_MISMATCH');
 const handle=await fs.open(file,'r+');
 try{await handle.sync();}finally{await handle.close();}
 const done=Buffer.from(JSON.stringify({schema:'children-store-done/v1',transactionId:record.transactionId,recordSha256:hash(Buffer.from(JSON.stringify(record))),after}));
 try{await immutable(recordPath+'.done',done,'.done-temp');}
 catch(e){if(e.code!=='EEXIST')throw e;const prior=await bytes(recordPath+'.done');if(!prior||hash(prior)!==hash(done))fail('STORE_DONE_CORRUPT');}
}

async function recover(file,context){
 const dir=file+'.journal';let names;
 try{names=await fs.readdir(dir);}catch(e){
  if(e.code!=='ENOENT')throw e;
  if(await bytes(file))fail('STORE_JOURNAL_REQUIRED');
  return;
 }
 const records=[];
 for(const name of names.filter(n=>/^[0-9a-f-]+\.json$/.test(n))){
  const recordPath=path.join(dir,name),raw=await bytes(recordPath),record=decode(raw,'STORE_JOURNAL_CORRUPT');
  recordState(record,file,context);
  if(name!==record.transactionId+'.json')fail('STORE_JOURNAL_CORRUPT');
  const done=await bytes(recordPath+'.done');
  if(done){
   const marker=decode(done,'STORE_DONE_CORRUPT');
   const expected={schema:'children-store-done/v1',transactionId:record.transactionId,
    recordSha256:hash(raw),after:{exists:true,bytes:record.after.bytes,sha256:record.after.sha256}};
   if(!equal(marker,expected))fail('STORE_DONE_CORRUPT');
  }
  records.push({record,recordPath,done:!!done});
 }
 for(const name of names.filter(n=>n.endsWith('.json.done')))
  if(!records.some(x=>path.basename(x.recordPath)+'.done'===name))fail('STORE_JOURNAL_CHAIN_CORRUPT');
 const current=await bytes(file);
 if(!records.length){if(current)fail('STORE_JOURNAL_REQUIRED');return;}
 // Complete journals form one immutable before -> after chain. File order and
 // mtime are not chronology. An earlier valid snapshot is not current state.
 const remaining=new Set(records),chain=[];
 let expected={exists:false};
 while(remaining.size){
  const next=[...remaining].filter(x=>equal(x.record.before,expected));
  if(next.length!==1)fail('STORE_JOURNAL_CHAIN_CORRUPT');
  const item=next[0];remaining.delete(item);chain.push(item);
  expected={exists:true,bytes:item.record.after.bytes,sha256:item.record.after.sha256};
 }
 const pending=chain.filter(x=>!x.done),tail=chain.at(-1);
 if(pending.length>1)fail('STORE_MULTIPLE_PENDING_COMMITS');
 if(pending.length && pending[0]!==tail)fail('STORE_JOURNAL_CHAIN_CORRUPT');
 const observed=descriptor(current);
 if(!equal(observed,expected) && !(pending.length && equal(observed,tail.record.before)))
  fail('STORE_COMMITTED_STATE_DRIFT');
 if(pending.length)await complete(tail.record,file,tail.recordPath,context);
 const verified=await bytes(file);
 if(!equal(descriptor(verified),expected))fail('STORE_COMMITTED_STATE_DRIFT');
 const state=validateStoredState(decode(verified,'STORE_STATE_CORRUPT'),context),binding=bindingFor(file,state);
 const bound=await bytes(binding.path);
 if(!bound||!equal(decode(bound,'STORE_CASE_BINDING_CORRUPT'),JSON.parse(binding.text)))fail('STORE_CASE_BINDING_CORRUPT');
}
export async function acquireStore(file,context){
 const acquired=await lease(file,context);
 try{await recover(file,context);return acquired;}
 catch(e){await acquired.release();throw e;}
}
export async function commitStore(file,state){
 const context={identity:state.identity,scope:state.scope,tuple:state.tuple,runtimeVersion:state.runtimeVersion};
 validateStoredState(state,context);
 const before=await bytes(file),after=Buffer.from(JSON.stringify(state));
 const temp=await stage(file,after,'.tmp');
 const transactionId=randomUUID(),dir=file+'.journal';
 await fs.mkdir(dir,{recursive:true});
 const record={schema:'children-store-commit/v1',decision:'COMMIT',transactionId,statePath:normalize(file),
  before:descriptor(before),after:{bytes:after.length,sha256:hash(after),text:after.toString('utf8')},binding:bindingFor(file,state)};
 const recordPath=path.join(dir,transactionId+'.json');
 await immutable(recordPath,Buffer.from(JSON.stringify(record)),'.record-temp');
 await complete(record,file,recordPath,context,temp);
}
export const durabilityContract=Object.freeze({
 version:'children-private-store/20261026-a50-v1',
 supported:'Node filehandle.sync + fs.link exclusive publication + fs.rename + exact readback; process-crash recovery only',
 powerLossCertified:false,directoryDurabilityCertified:false,productionReady:false,
 liveness:'process.kill(pid,0); only ESRCH authorizes stale-owner recovery; live/reused/unknown PID remains HOLD',
 recoveryGuard:'Exclusive fully-written marker; ambiguous/abandoned recovery guard remains a named HOLD, never age-deleted',
 authority:'Internal storage only; no caller fact/document/source/ID authority and no live application'
});
