import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadQualifiedPackage } from './qualified-package.mjs';

const inputs=process.env.CHILDREN_QUALIFIED_TEST_INPUTS;
test('private loopback server: real internal-token boundary, guided controls, outbox, default-operation isolation',
  {skip:!inputs,timeout:30000},async t=>{
    const pin=JSON.parse(await fs.readFile(inputs,'utf8')).packagePin;
    const pkg=await loadQualifiedPackage(pin);
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'children-qualified-http-'));
    let child;
    t.after(async()=>{
      if(child && child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
      assert(path.basename(dir).startsWith('children-qualified-http-'));await fs.rm(dir,{recursive:true,force:true});
    });
    const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
    const port=probe.address().port;await new Promise(r=>probe.close(r));
    const token=randomBytes(32).toString('hex');
    const keyFile=path.join(dir,'test-keyring.json');
    await fs.writeFile(keyFile,JSON.stringify({active:'test',keys:{test:randomBytes(32).toString('base64')}}),{mode:0o600});
    const cwd=fileURLToPath(new URL('../../',import.meta.url));
    child=spawn(process.execPath,['service/server.mjs'],{cwd,windowsHide:true,env:{...process.env,
      CHAT_RUNTIME_KEYS_FILE:keyFile,CATEGORY_PORT:String(port),CATEGORY_INTERNAL_TOKEN:token,
      CATEGORY_DATA_DIR:path.join(dir,'untouched-main-fixture'),
      CATEGORY_PRIVATE_DIALOGUE_DATA_DIR:path.join(dir,'private-synthetic'),
      CATEGORY_PRIVATE_DIALOGUE_PACKAGE_PIN:JSON.stringify(pin)}});
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('SERVER_START_TIMEOUT')),10000);
      child.stdout.on('data',b=>{output+=b;if(output.includes('Category bundle service: loopback')){clearTimeout(timer);resolve();}});
      child.stderr.on('data',()=>{});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('SERVER_EXIT_'+code));});
    });
    const post=(url,body,auth=token)=>fetch(`http://127.0.0.1:${port}${url}`,{method:'POST',headers:{'content-type':'application/json','x-category-token':auth},body:JSON.stringify(body)});
    const health=await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.privateQualifiedMode,true);assert.deepEqual(health.privateQualifiedTuple,pkg.tuple);
    assert.equal((await post('/respond',{},'wrong-test-token')).status,403);
    for(const endpoint of ['/import','/validate','/state','/conversation/delete'])assert.equal((await post(endpoint,{})).status,409);
    assert.equal((await post('/respond',{protocolVersion:1})).status,409);
    const identity={userId:'123',id:randomUUID()};
    const scope={caseId:randomUUID(),childId:'child',subjectId:'self',obligationId:'obligation',periodId:'period',objectId:'statement',objectVersion:'1'};
    const event={...identity,protocolVersion:2,turnId:randomUUID(),question:'Помогите разобраться.',
      guided:{context:{},native:{privateDialogue:{tuple:pkg.tuple,scope,stageId:'alimony_debt'}}}};
    const first=await post('/respond',event);assert.equal(first.status,200);const a=await first.json();
    assert.equal(a.answer.next[0].view.length,3);assert.equal(a.questionsUsed,1);
    const replay=await(await post('/respond',event)).json();assert.deepEqual(replay,a);
    const pending=await(await post('/conversation/pending',identity)).json();assert.deepEqual(pending.historyEnvelope,a._historyEnvelope);
    assert.equal((await post('/conversation/ack',{...identity,turnId:event.turnId})).status,200);
    const next={...identity,protocolVersion:2,turnId:randomUUID(),question:'Да',
      conversation:{sessionId:a.conversation.sessionId,revision:a.conversation.revision,nonce:a.conversation.nonce},
      guided:a.answer.next[0].view[0].guided};
    const second=await post('/respond',next);assert.equal(second.status,200);const b=await second.json();
    assert.equal(b.hold,'DOCUMENT_SOURCE_NOT_SUPPORTED');assert.equal(b.question,null);assert(b.answer.content);
    await assert.rejects(fs.access(path.join(dir,'untouched-main-fixture')),/ENOENT/);
  });
