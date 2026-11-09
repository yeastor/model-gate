import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

test("real HTTP runtime: MC focus, direct answer, stale button, resume, history",async t=>{
  const data=await fs.mkdtemp(path.join(os.tmpdir(),"mc-request-http-"));
  const probe=net.createServer();
  probe.listen(0,"127.0.0.1");await once(probe,"listening");
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const token=randomBytes(32).toString("hex");
  const keyFile=path.join(data,"test-keyring.json");
  await fs.writeFile(keyFile,JSON.stringify({active:"test",keys:{test:randomBytes(32).toString("base64")}}),{mode:0o600});
  const child=spawn(process.execPath,[fileURLToPath(new URL("../server.mjs",import.meta.url))],{
    cwd:process.cwd(),windowsHide:true,stdio:["ignore","pipe","pipe"],
    env:{...process.env,CHAT_RUNTIME_KEYS_FILE:keyFile,CATEGORY_PORT:String(port),CATEGORY_INTERNAL_TOKEN:token,CATEGORY_DATA_DIR:data},
  });
  let stderr="";
  child.stderr.on("data",chunk=>stderr+=chunk);
  t.after(async()=>{
    const ended=child.exitCode===null?once(child,"exit"):null;
    if(ended){child.kill();await ended;}
    assert(path.resolve(data).startsWith(path.resolve(os.tmpdir())+path.sep+"mc-request-http-"));
    await fs.rm(data,{recursive:true,force:true});
  });
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error("startup timeout "+stderr)),10000);
    child.stdout.on("data",chunk=>{if(String(chunk).includes("loopback")){clearTimeout(timer);resolve();}});
    child.once("exit",code=>{clearTimeout(timer);reject(Error("server exited "+code+" "+stderr));});
  });
  const base="http://127.0.0.1:"+port, id=randomUUID(), userId="81";
  const call=async(route,body,auth=true)=>{
    const r=await fetch(base+route,{method:"POST",headers:{"content-type":"application/json",...(auth?{"x-category-token":token}:{})},
      body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
    return {status:r.status,body:await r.json()};
  };
  assert.equal((await call("/respond",{},false)).status,403);
  const trace=[];
  let response;
  const send=async(question,extra={})=>{
    const r=await call("/respond",{protocolVersion:2,userId,id,categoryId:"management_company",
      // Matches the public Go gateway contract, which forwards launchHint.
      launchHint:{categoryId:"management_company",stageId:"reports"},
      question,turnId:randomUUID(),conversation:response?.conversation,...extra});
    assert.equal(r.status,200,JSON.stringify(r.body));
    response=r.body;trace.push({question,response});
    await call("/conversation/ack",{userId,id,turnId:response.turn.turnId});
    return response;
  };
  let r=await send("Нужны годовой отчёт и акты ремонта.");
  assert.match(r.answer.content,/Какой один запрос/u);
  assert.equal(r.answer.variantId,"management_company_reports_v01");
  r=await send("Акты ремонта за сентябрь в УК");
  const button=r.answer.next[0].view.find(x=>x.guided.native.value===true);
  assert.match(r.answer.next[0].questionText,/Акты ремонта за сентябрь в УК/u);
  r=await send("Да",{guided:button.guided});
  // Explicitly selected acts plus confirmed sending require the existing v08, not sent-only v04.
  assert.equal(r.answer.variantId,"management_company_reports_v08");
  assert.equal(r.answer.next.length,0);
  const stale=await call("/respond",{protocolVersion:2,userId,id,question:"Да",turnId:randomUUID(),
    conversation:r.conversation,guided:button.guided});
  assert.equal(stale.status,409);
  const resumed=await call("/respond",{protocolVersion:2,userId,id,resume:true});
  assert.equal(resumed.status,200);assert.deepEqual(resumed.body.answer,r.answer);
  if (process.env.MC_HTTP_TRACE_PATH) await fs.writeFile(process.env.MC_HTTP_TRACE_PATH,JSON.stringify({
    status:"PASS",local_ephemeral_server:true,production_restarted:false,source:"synthetic",
    trace,stale_status:stale.status,resume_unchanged:true,
  },null,2)+"\n");
});
