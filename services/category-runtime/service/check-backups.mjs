import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { bytesHash, same } from './bundle/core.mjs'
import { q, allPoints } from './storage.mjs'
const directory=path.resolve(process.argv[2])
const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'))
const results=[]
for(const item of manifest.collections){
 const snapshot=await readFile(path.join(directory,item.name+'.snapshot'))
 const exported=await readFile(path.join(directory,item.name+'.json'))
 if(bytesHash(snapshot)!==item.snapshot_sha256||bytesHash(exported)!==item.export_sha256)throw new Error('Backup checksum mismatch: '+item.name)
 const collection='pps_restore_check_'+randomUUID().replaceAll('-','')
 const form=new FormData();form.append('snapshot',new Blob([snapshot]),item.name+'.snapshot')
 const response=await fetch(`http://127.0.0.1:6333/collections/${collection}/snapshots/upload?priority=snapshot`,{method:'POST',body:form})
 if(!response.ok)throw new Error(await response.text())
 const restored=await allPoints(collection);const expected=JSON.parse(exported).points
 const byId=values=>values.map(p=>({id:p.id,payload:p.payload,vector:p.vector})).sort((a,b)=>String(a.id).localeCompare(String(b.id)))
 if(!same(byId(restored),byId(expected)))throw new Error('Restored data differs: '+item.name)
 results.push({source:item.name,restored_collection:collection,count:restored.length,status:'PASS'})
 // This collection was created by this test and is not an alias target. The
 // verified native snapshot and JSON export remain available for recovery.
 await q('/collections/'+collection,undefined,'DELETE')
}
await writeFile(path.join(directory,'restore-test.json'),JSON.stringify({status:'PASS',results},null,2))
console.log(JSON.stringify(results,null,2))
