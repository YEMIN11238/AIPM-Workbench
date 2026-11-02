/** Host approval and validated state with a keyless synthetic worker protocol. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { StarterService } from './starter-service.mjs'
import { sharedModelApi } from './model-api.mjs'
const kitRoot=fileURLToPath(new URL('./integrations/ai-product-starter-kit',import.meta.url))
const fake=`import sys,json
r=json.loads(sys.stdin.readline())
def emit(**e): print(json.dumps(e),flush=True)
if r['prompt'].endswith('invalid'):
 emit(type='decisions',items=[{'question':7}])
else:
 command='python3 -c "import os; from pathlib import Path; Path(\\'approved.txt\\').write_text(\\'done\\'); print(bool(os.environ.get(\\'DEEPSEEK_API_KEY\\')),bool(os.environ.get(\\'VOLC_ACCESSKEY\\')))"'
 emit(type='request',kind='run_api',token='run-token',command=command,cwd='.',timeout=10)
 result=json.loads(sys.stdin.readline())
 emit(type='text',text=json.dumps(result))
 emit(type='result',reply='synthetic local command completed')
`
function setup(t,approved){
 const root=mkdtempSync(join(tmpdir(),'aipm-starter-host-')),workerPath=join(root,'worker.py');writeFileSync(workerPath,fake);let service,approvals=0
 service=new StarterService({root:join(root,'projects'),kitRoot,python:'/usr/bin/python3',workerPath,getApi:()=>sharedModelApi(()=>'fixture-shared-private-key'),getCloudCredentials:()=>({VOLC_ACCESSKEY:'fixture-cloud-private-key'}),onUpdate:p=>{if(p.pending){approvals++;service.reply(p.id,p.pending.token,approved)}}})
 t.after(async()=>{await service.close();rmSync(root,{recursive:true,force:true})});const p=service.create({name:'Approval fixture'}),file=join(service.root,p.id,'project.json'),meta=JSON.parse(readFileSync(file,'utf8'));meta.phase=4;writeFileSync(file,JSON.stringify(meta));return{service,id:p.id,approvals:()=>approvals}
}
test('deployment API commands wait for exact approval and inherit the pinned unified API/cloud environment',async t=>{
 const f=setup(t,true);f.service.send(f.id,'approved');await f.service.active.done;const p=f.service.get(f.id)
 assert.equal(f.approvals(),1);assert.equal(p.status,'idle');assert.equal(existsSync(join(f.service.folder(f.id),'approved.txt')),true);assert.equal(p.commands.length,1);assert.equal(p.commands[0].exitCode,0);assert.match(p.commands[0].output,/True True/);assert.equal(p.commands[0].usedSharedApi,true);assert.equal(JSON.stringify(p).includes('private-key'),false)
})
test('declined deployment commands never execute and malformed model state fails without corrupting the project',async t=>{
 const f=setup(t,false);f.service.send(f.id,'declined');await f.service.active.done;assert.equal(f.approvals(),1);assert.equal(existsSync(join(f.service.folder(f.id),'approved.txt')),false);assert.equal(f.service.get(f.id).commands.length,0)
 f.service.send(f.id,'invalid');await f.service.active.done;const p=f.service.get(f.id);assert.equal(p.status,'failed');assert.deepEqual(p.decisions,[]);assert.equal(p.pending,null)
})

test('development limits preserve phase and decisions and can resume without human acceptance',async t=>{
 const f=setup(t,true),worker=join(f.service.root,'..','worker.py')
 writeFileSync(worker,fake.replace("if r['prompt'].endswith('invalid'):","if r['prompt'].endswith('pause'):\n emit(type='limit',kind='call_limit',reason='本轮达到测试调用上限，已暂停',usage={'calls':120},limits={'maxCalls':120,'maxOutputTokens':120000})\n emit(type='error',message='SDK aborted')\n raise SystemExit(1)\nelif r['prompt'].endswith('invalid'):"))
 f.service.send(f.id,'pause');await f.service.active.done;let p=f.service.get(f.id)
 assert.equal(p.status,'paused');assert.equal(p.error,null);assert.equal(p.pause.kind,'call_limit');assert.equal(p.phase,4);assert.deepEqual(p.decisions,[]);assert.deepEqual(p.history,[]);assert.equal(f.approvals(),0)
 f.service.send(f.id,'approved');await f.service.active.done;p=f.service.get(f.id);assert.equal(p.status,'idle');assert.equal(p.pause,null);assert.equal(p.phase,4);assert.deepEqual(p.history,[]);assert.equal(f.approvals(),1)
})
