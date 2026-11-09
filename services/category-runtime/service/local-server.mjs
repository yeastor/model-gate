import http from 'node:http';
import fs from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {createLocalMulti} from './conversation/local-multi.mjs';
import {requirePrivateStorage} from './conversation/private-storage.mjs';
requirePrivateStorage();
const token=process.env.CATEGORY_INTERNAL_TOKEN;
if(!token||token.length<32)throw Error('CATEGORY_INTERNAL_TOKEN required');
const registryPin=JSON.parse(process.env.CATEGORY_LOCAL_REGISTRY_PIN||'null');
const conversation=await createLocalMulti({registryPin,dataDir:process.env.CATEGORY_LOCAL_DATA_DIR});
const server=http.createServer(async(req,res)=>{
 res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');
 try{
  if(req.url==='/health'){res.end(JSON.stringify({ok:true,service:'local-multi-category',production:false,chatStorageEncryption:'aes-256-gcm/v1',categories:conversation.catalog()}));return;}
  const got=Buffer.from(req.headers['x-category-token']||''),expected=Buffer.from(token);
  if(got.length!==expected.length||!timingSafeEqual(got,expected)){res.statusCode=403;res.end('{}');return;}
  let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>65536)throw Object.assign(Error('BODY_TOO_LARGE'),{status:413});chunks.push(c)}
  const input=JSON.parse(Buffer.concat(chunks).toString()||'{}');let result;
  if(req.url==='/respond')result=await conversation.respond(input);
  else if(['/conversation/pending','/conversation/ack','/conversation/delete','/conversation/expire'].includes(req.url))result=await conversation.internal(input,req.url.split('/').at(-1));
  else{res.statusCode=404;result={error:'NOT_FOUND'}}
  res.end(JSON.stringify(result));
 }catch(e){res.statusCode=e.status||500;res.end(JSON.stringify({error:e.message}));}
});
server.listen(Number(process.env.CATEGORY_PORT||18150),'127.0.0.1',()=>console.log('Local multi-category service: loopback'));
