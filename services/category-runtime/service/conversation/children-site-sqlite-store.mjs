
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {validateStoredState} from './children-site-state-validation.mjs';
import {openPrivate,privateStorageEnabled,sealPrivate} from './private-storage.mjs';
const fail=code=>{throw Object.assign(new Error(code),{status:409});};
const hash=b=>createHash('sha256').update(b).digest('hex');
const stable=o=>Array.isArray(o)?o.map(stable):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,stable(o[k])])):o;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const normalize=p=>path.resolve(p).replaceAll('\\','/').toLowerCase();
const leases=new Map();
const inside=(file,root)=>{const rel=path.relative(root,file);return rel && rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())fail('SQLITE_UNSAFE_FILE');}
function settings(db){
 const v=db.prepare('select sqlite_version() v').get().v.split('.').map(Number);
 if(v[0]<3 || v[0]===3&&(v[1]<51||v[1]===51&&v[2]<3))fail('SQLITE_VERSION_UNSUPPORTED');
 db.exec('PRAGMA synchronous=FULL; PRAGMA busy_timeout=0; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
 if(db.prepare('PRAGMA journal_mode').get().journal_mode!=='wal'||db.prepare('PRAGMA synchronous').get().synchronous!==2)fail('SQLITE_DURABILITY_MODE_MISMATCH');
}
export function initializePrivateStore(root){
 const encrypted=privateStorageEnabled();
 const full=path.resolve(root);
 if(!/^[a-z]:[\\/]/i.test(full)||full.startsWith('\\\\'))fail('LOCAL_STORE_REQUIRED');
 fs.mkdirSync(full,{recursive:true});
 if(fs.readdirSync(full).length)fail('NEW_EMPTY_STORE_REQUIRED');
 if(normalize(fs.realpathSync(full))!==normalize(full))fail('SQLITE_REPARSE_STORE');
 const file=path.join(full,'children-private.sqlite'),storeId=randomUUID();
 const db=new DatabaseSync(file,{timeout:0,allowExtension:false});
 try{
  db.exec('PRAGMA journal_mode=WAL;');settings(db);
  db.exec('BEGIN IMMEDIATE; CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT; CREATE TABLE bindings (case_key TEXT PRIMARY KEY,session_key TEXT NOT NULL,binding TEXT NOT NULL) STRICT; CREATE TABLE snapshots (seq INTEGER PRIMARY KEY AUTOINCREMENT,session_key TEXT NOT NULL,text TEXT NOT NULL,sha TEXT NOT NULL) STRICT; CREATE TABLE sessions (session_key TEXT PRIMARY KEY,seq INTEGER NOT NULL REFERENCES snapshots(seq),sha TEXT NOT NULL) STRICT;');
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('store_id',storeId);
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('schema','children-private-sqlite/v1');
  if(encrypted)db.prepare('INSERT INTO metadata VALUES (?,?)').run('storage_encryption','azchat/v1');
  db.exec('COMMIT;');
 }finally{db.close();}
 regular(file);
 return {root:full.replaceAll('\\','/'),database:file.replaceAll('\\','/'),storeId,schema:'children-private-sqlite/v1'};
}
function configured(file){
 let cfg;try{cfg=JSON.parse(process.env.CHILDREN_PRIVATE_SQLITE_STORE);}catch{fail('SQLITE_STORE_NOT_CONFIGURED');}
 if(!cfg?.storeId||cfg.schema!=='children-private-sqlite/v1'||normalize(cfg.database)!==normalize(path.join(cfg.root,'children-private.sqlite')))fail('SQLITE_STORE_CONFIG_INVALID');
 if(!inside(path.resolve(file),path.resolve(cfg.root)))fail('SQLITE_SESSION_OUTSIDE_STORE');
 if(normalize(fs.realpathSync(cfg.root))!==normalize(cfg.root))fail('SQLITE_REPARSE_STORE');
 const dir=path.dirname(file);if(fs.existsSync(dir)&&!inside(fs.realpathSync(dir),path.resolve(cfg.root))&&normalize(dir)!==normalize(cfg.root))fail('SQLITE_REPARSE_STORE');
 if(!fs.existsSync(cfg.database))fail('SQLITE_STORE_MISSING_NO_RESET');
 regular(cfg.database);
 for(const suffix of ['-wal','-shm'])if(fs.existsSync(cfg.database+suffix))regular(cfg.database+suffix);
 for(const suffix of ['', '.lock','.lock.recovery','.journal'])if(fs.existsSync(file+suffix))fail('LEGACY_STORE_REQUIRES_EXPLICIT_MIGRATION');
 return cfg;
}
function readIn(lease){
 const {db,key,scope,context}=lease;
 const row=db.prepare('SELECT s.seq,s.sha,p.text,p.sha AS snapshot_sha FROM sessions s JOIN snapshots p ON p.seq=s.seq AND p.session_key=s.session_key WHERE s.session_key=?').get(key);
 const latest=db.prepare('SELECT seq FROM snapshots WHERE session_key=? ORDER BY seq DESC LIMIT 1').get(key);
 if(!row){if(latest||db.prepare('SELECT 1 FROM sessions WHERE session_key=?').get(key))fail('SQLITE_STATE_MISSING_NO_RESET');return null;}
 if(!latest||row.seq!==latest.seq||row.sha!==row.snapshot_sha||hash(row.text)!==row.sha)fail('SQLITE_STATE_INTEGRITY');
 const state=JSON.parse(openPrivate(scope+'/snapshot/'+row.seq,row.text));
 validateStoredState(state,context);
 const ck=caseKey(state),bind=db.prepare('SELECT session_key,binding FROM bindings WHERE case_key=?').get(ck);
 if(!bind||bind.session_key!==key||!equal(JSON.parse(openPrivate(scope+'/binding/'+ck,bind.binding)),binding(state)))fail('SQLITE_CASE_BINDING_INTEGRITY');
 return state;
}
const caseKey=s=>hash(JSON.stringify([s.identity.userId,s.scope.caseId]));
const binding=s=>({identity:s.identity,scope:s.scope,tuple:s.tuple});
export async function acquireStore(file,context){
 const cfg=configured(file),key=normalize(file);
 if(leases.has(key))fail('SESSION_BUSY');
 let db;
 try{
  db=new DatabaseSync(cfg.database,{timeout:0,allowExtension:false});settings(db);
  if(db.prepare("SELECT value FROM metadata WHERE key='store_id'").get()?.value!==cfg.storeId
    ||db.prepare("SELECT value FROM metadata WHERE key='schema'").get()?.value!==cfg.schema)fail('SQLITE_STORE_ID_MISMATCH');
  const encryption=db.prepare("SELECT value FROM metadata WHERE key='storage_encryption'").get()?.value;
  if(encryption!==(privateStorageEnabled()?'azchat/v1':undefined))fail('SQLITE_STORAGE_ENCRYPTION_MISMATCH');
  db.exec('BEGIN IMMEDIATE;');
  const scope='runtime/sqlite/'+cfg.storeId+'/'+path.relative(normalize(cfg.root),key).replaceAll('\\','/');
  const lease={db,key,scope,context,committed:false};
  readIn(lease);leases.set(key,lease);
  return {release:async()=>{
   try{if(db.isTransaction)db.exec('ROLLBACK;');}finally{leases.delete(key);db.close();}
  }};
 }catch(e){
  if(db){try{if(db.isTransaction)db.exec('ROLLBACK;');}finally{db.close();}}
  if(e.errcode===5||e.errcode===6)fail('SESSION_BUSY');
  throw e;
 }
}
export function readStore(file){
 const lease=leases.get(normalize(file));if(!lease)fail('SQLITE_LEASE_REQUIRED');
 return readIn(lease);
}
export function expireStore(file){
 const lease=leases.get(normalize(file));if(!lease||!lease.db.isTransaction||lease.committed)fail('SQLITE_LEASE_REQUIRED');
 const {db,key}=lease;
 db.exec('PRAGMA secure_delete=ON;');
 db.prepare('DELETE FROM sessions WHERE session_key=?').run(key);
 db.prepare('DELETE FROM snapshots WHERE session_key=?').run(key);
 db.prepare('DELETE FROM bindings WHERE session_key=?').run(key);
 db.exec('COMMIT;');
 lease.committed=true;
 if(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy!==0)fail('SQLITE_RETENTION_CHECKPOINT_BUSY');
}
export async function assertNewCaseUnbound(file,context){
 const key=normalize(file+'.qualified.json'),lease=leases.get(key);if(!lease)fail('SQLITE_LEASE_REQUIRED');
 const found=lease.db.prepare('SELECT session_key,binding FROM bindings WHERE case_key=?').get(caseKey(context));
 if(found)fail(found.session_key===key?'CASE_STATE_MISSING_RECOVERY_REQUIRED':'CASE_ALREADY_BOUND');
}
export async function commitStore(file,state){
 const lease=leases.get(normalize(file));if(!lease||!lease.db.isTransaction||lease.committed)fail('SQLITE_LEASE_REQUIRED');
 validateStoredState(state,lease.context);
 const {db,key,scope}=lease,b=JSON.stringify(binding(state)),ck=caseKey(state);
 const old=db.prepare('SELECT session_key,binding FROM bindings WHERE case_key=?').get(ck);
 const bindingScope=scope+'/binding/'+ck;
 if(old&&(old.session_key!==key||!equal(JSON.parse(openPrivate(bindingScope,old.binding)),JSON.parse(b))))fail('CASE_ALREADY_BOUND');
 if(!old)db.prepare('INSERT INTO bindings VALUES (?,?,?)').run(ck,key,sealPrivate(bindingScope,b));
 // Assign the snapshot identity inside the transaction before sealing its payload.
 const seq=db.prepare("INSERT INTO snapshots (session_key,text,sha) VALUES (?,'','')").run(key).lastInsertRowid;
 const text=sealPrivate(scope+'/snapshot/'+seq,JSON.stringify(state)),sha=hash(text);
 db.prepare('UPDATE snapshots SET text=?,sha=? WHERE seq=?').run(text,sha,seq);
 db.prepare('INSERT INTO sessions VALUES (?,?,?) ON CONFLICT(session_key) DO UPDATE SET seq=excluded.seq,sha=excluded.sha').run(key,seq,sha);
 try{db.exec('COMMIT;');}catch(error){
  // No success for an ambiguous commit. The next request reads the durable
  // turn journal and either replays committed bytes or retries a rolled-back turn.
  throw error;
 }
 lease.committed=true;
 const saved=db.prepare('SELECT text,sha FROM snapshots WHERE seq=? AND session_key=?').get(seq,key);
 if(!saved||saved.text!==text||saved.sha!==sha)fail('SQLITE_COMMIT_READBACK_MISMATCH');
}
export const durabilityContract=Object.freeze({
 version:'children-private-sqlite/20261027-v1',backend:'node:sqlite',journalMode:'WAL',synchronous:'FULL',
 platform:'Local filesystem, SQLite native Windows VFS and OS flush contract; no network filesystem',
 successBoundary:'COMMIT returned successfully and exact snapshot readback',
 crashRecovery:'SQLite transaction rollback/recovery plus existing turn replay/outbox',
 powerLossHardwareExperiment:false,productionReady:false,automaticLegacyMigration:false
});
