"""Build a fresh, protected Linux package from the reviewed v1 transfer.

The existing transfer stays immutable. Only named runtime overlays are allowed;
the v1 packager rebases paths and recalculates the transitive integrity pins.
"""

import argparse
import hashlib
import importlib.util
import json
import re
import shutil
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
CONVERSATION = "model-gate/services/category-runtime/service/conversation/"
OVERLAYS = (
    "state.mjs",
    "private-storage.mjs",
    "qualified-session.mjs",
    "children-site-sqlite-store.mjs",
)


def module(file):
    spec = importlib.util.spec_from_file_location("reviewed_dm_packager", file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def verified_transfer(source):
    for line in (source / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines():
        digest, relative = line.split(maxsplit=1)
        file = (source / relative.lstrip("*")).resolve(strict=True)
        if not file.is_relative_to(source) or hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise ValueError("invalid v1 transfer entry: " + relative)


def replace(text, old, new):
    if text.count(old) != 1:
        raise ValueError("expected one reviewed code anchor: " + old[:120])
    return text.replace(old, new, 1)


def core_import(target, exports, name):
    return f'import {{ {exports} }} from "file://{target}/{CONVERSATION}{name}";\n'


EXPIRY = """import fs from 'node:fs/promises';
import path from 'node:path';
import { atomic, identityKey, removeAtomicTemps } from './state.mjs';
import { deleteFeedback } from './feedback.mjs';

// Called only under the owned-conversation lock. Do not read expired ciphertext
// or keep the old state/outbox when replacing it with a minimal tombstone.
export async function expireFileConversation(dataDir, identity, file) {
  const { userId, chatId } = identity;
  const key = identityKey(userId, chatId) + '.json';
  const old = path.join(dataDir, 'explicit-sessions', key);
  const legacy = path.join(dataDir, 'sessions', key);
  const observation = path.join(dataDir, 'scams-loan-observations-v1', key);
  await deleteFeedback(dataDir, identity);
  for (const artifact of [old, old + '.v2-backup.json', legacy, observation]) {
    await fs.rm(artifact, { force: true });
    await removeAtomicTemps(artifact);
  }
  await atomic(file, { deleted: true });
  await removeAtomicTemps(file);
  return { ok: true };
}
"""


def protect_server(text, target):
    text = core_import(target, "requirePrivateStorage", "private-storage.mjs") + text
    text = replace(text, "const token=process.env.CATEGORY_INTERNAL_TOKEN;",
                   "requirePrivateStorage();\nconst token=process.env.CATEGORY_INTERNAL_TOKEN;")
    text = replace(text, "if(req.url==='/health')",
                   "if(req.method==='GET' && req.url==='/health')")
    text = replace(text, "production:false,categories:",
                   "production:false,chatStorageEncryption:'aes-256-gcm/v1',categories:")
    text = replace(text, "  let size=0;",
                   "  if(req.method!=='POST'){res.statusCode=405;res.end('{}');return;}\n  let size=0;")
    text = replace(text, "let result;\n  //",
                   "let result;\n  if(!input || Array.isArray(input) || typeof input!=='object')"
                   "{res.statusCode=400;res.end('{}');return;}\n  //")
    text = replace(text, "'/conversation/delete'].includes(req.url)",
                   "'/conversation/delete','/conversation/expire'].includes(req.url)")
    text = replace(text, "res.end(JSON.stringify({error:e.message}));",
                   "res.end(JSON.stringify({error:/^[A-Z][A-Z0-9_]{2,100}$/.test(e.message)"
                   "?e.message:'RUNTIME_REQUEST_FAILED'}));")
    return replace(text, "server.listen(Number(process.env.CATEGORY_PORT||18150),'127.0.0.1',()=>console.log('Local multi-category service: loopback'));",
                   """const host=process.env.CATEGORY_BIND_HOST || '127.0.0.1';
if(!['127.0.0.1','0.0.0.0'].includes(host))throw Error('CATEGORY_BIND_HOST_INVALID');
server.listen(Number(process.env.CATEGORY_PORT||18150),host);""")


def protect_dispatch(text, target):
    text = replace(text, "{atomic,read,identityKey}", "{atomic,read,identityKey,removeAtomicTemps}")
    start = text.index(" async function internal(input,operation)")
    end = text.index(" async function respond(input)", start)
    return text[:start] + """ async function internal(input,operation){return locked(identity(input),async()=>{
   const {key,b}=await binding(input);
   const removing=operation==='delete'||operation==='expire';
   if(b?.deleted){if(removing)await removeAtomicTemps(bindingFile(key));return operation==='pending'?{historyEnvelope:null}:{ok:true};}
   const e=entries.get(b?.category),service=b?.childrenScoped?e?.scopedService:e?.service;
   if(b?.childrenScoped&&!service)fail('CHILDREN_SCOPE_STORE_REQUIRED',503);
   if(removing){
    if(service&&!(await service.internal(input,'expire'))?.ok)fail('STATE_REMOVAL_UNCONFIRMED',503);
    await atomic(bindingFile(key),{deleted:true});
    await removeAtomicTemps(bindingFile(key));
    return {ok:true};
   }
   if(service)return service.internal(input,operation);
   if(operation==='pending')return{historyEnvelope:b?.outbox||null};
   if(operation==='ack'){if(b?.outbox?.turnId===input.turnId){b.outbox=null;await atomic(bindingFile(key),b)}return{ok:true}}
   fail('INVALID_INTERNAL_ACTION');
 });}
""" + text[end:]


def protect_core_service(text, target):
    text = core_import(target, "expireFileConversation", "protected-expiry.mjs") + text
    return replace(text, "      const file = stateFile(id),\n        s = ",
                   '      if (operation === "expire") return expireFileConversation(dataDir, id, stateFile(id));\n'
                   "      const file = stateFile(id),\n        s = ")


def protect_version_router(text, target):
    text = core_import(target, "openPrivateFile", "private-storage.mjs") + text
    text = replace(text, "'respond','pending','ack','delete'", "'respond','pending','ack','delete','expire'")
    text = replace(text, "   try{raw=await fs.readFile(file,'utf8')}",
                   "   if(operation==='expire'){\n"
                   "    const result=await legacy.internal(request,operation);\n"
                   "    if(result?.ok)assigned.delete(lockKey);\n"
                   "    return result;\n"
                   "   }\n"
                   "   try{raw=openPrivateFile(file,await fs.readFile(file,'utf8'))}")
    return text


def protect_scams(text, target):
    text = (core_import(target, "atomic, read as readState", "state.mjs")
            + core_import(target, "expireFileConversation", "protected-expiry.mjs") + text)
    text, count = re.subn(r"^async function atomic\(file,value\)\{[^\n]+\}\n", "", text, flags=re.M)
    if count != 1:
        raise ValueError("unrecognized private Scams writer")
    return replace(text, "const file=fileOf(id);let s=await read(file);",
                   "const file=fileOf(id);if(operation==='expire')return expireFileConversation(store,id,file);"
                   "let s=await readState(file);")


def build(source, output, target):
    verified_transfer(source)
    legacy = module(source / "prepare-linux.py")
    original_seed, original_portable = legacy.existing_seed, legacy.portable
    core = SCRIPTS.parent / "services" / "category-runtime" / "service" / "conversation"
    overlays = {CONVERSATION + name: (core / name).read_bytes() for name in OVERLAYS}

    def seed():
        files = original_seed()
        files[CONVERSATION + "private-storage.mjs"] = overlays[CONVERSATION + "private-storage.mjs"]
        files[CONVERSATION + "protected-expiry.mjs"] = EXPIRY.encode()
        return files

    changed_services = set()

    def portable(raw, name, install):
        if name in overlays:
            raw = overlays[name]
        raw = original_portable(raw, name, install)
        if name == "registry.linux.json":
            value = json.loads(raw)
            # This rollout intentionally cannot import legacy private sessions.
            value.pop("legacyBindings", None)
            value.pop("legacyConflicts", None)
            return legacy.dumps(value)
        if not name.endswith(".mjs") or not legacy.editable(name):
            return raw
        text = raw.decode("utf-8").replace("\r\n", "\n")
        if name == legacy.ENTRY:
            return protect_server(text, install).encode()
        if name == legacy.ENTRY.replace("local-server.mjs", "local-multi.mjs"):
            return protect_dispatch(text, install).encode()
        if 'async function internal(input, operation)' in text and 'const file = stateFile(id),' in text:
            changed_services.add(name)
            return protect_core_service(text, install).encode()
        if name.endswith(("versioned-bailiffs-consumer.mjs", "versioned-phone-consumer-site.mjs")):
            return protect_version_router(text, install).encode()
        if name.endswith(("scams-consumer.root-r3.mjs", "/scams-consumer.mjs")):
            return protect_scams(text, install).encode()
        return raw

    legacy.existing_seed, legacy.portable = seed, portable
    if output.exists():
        raise ValueError("output must not exist")
    legacy.build(output / "runtime", target + "/runtime")
    if len(changed_services) != 5:
        raise ValueError(f"unexpected service coverage: {sorted(changed_services)}")
    initializer = (source / "init-children-store.mjs").read_text(encoding="utf-8")
    (output / "init-children-store.mjs").write_bytes((
        "import { requirePrivateStorage } from './runtime/" + CONVERSATION + "private-storage.mjs';\n"
        "requirePrivateStorage();\n" + initializer
    ).encode())
    start = (source / "start.mjs").read_text(encoding="utf-8")
    (output / "start.mjs").write_bytes((
        "import { configurePeers } from './protected-dm-peers.mjs';\n"
        "configurePeers();\n" + start
    ).encode())
    shutil.copyfile(SCRIPTS / "protected-dm-peers.mjs", output / "protected-dm-peers.mjs")
    shutil.copyfile(SCRIPTS / "smoke-protected-dm.mjs", output / "smoke.mjs")
    dockerfile = f"""FROM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9
WORKDIR {target}
COPY . .
RUN sha256sum --quiet -c SHA256SUMS.txt && cd runtime/model-gate/services/category-runtime && npm ci --ignore-scripts --omit=dev --no-audit
USER node
ENTRYPOINT ["node", "start.mjs"]
"""
    (output / "Dockerfile").write_bytes(dockerfile.encode())
    release_file = output / "runtime" / "release.json"
    release = json.loads(release_file.read_bytes())
    release["protected_overlay_sha256"] = {
        name: hashlib.sha256(data).hexdigest() for name, data in overlays.items()
    }
    release["profile"] = "protected-linux-fresh-store/v2"
    release_file.write_bytes(legacy.dumps(release))
    sums = [hashlib.sha256(file.read_bytes()).hexdigest() + "  " + file.relative_to(output).as_posix()
            for file in sorted(output.rglob("*")) if file.is_file()]
    (output / "SHA256SUMS.txt").write_bytes(("\n".join(sums) + "\n").encode())


if __name__ == "__main__":
    args = argparse.ArgumentParser()
    args.add_argument("--source", type=Path, required=True)
    args.add_argument("--output", type=Path, required=True)
    args.add_argument("--install", required=True, help="Absolute Linux package directory")
    values = args.parse_args()
    build(values.source.resolve(), values.output.resolve(), values.install)
