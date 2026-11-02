/** Stage gates require reviewable current files and actual execution evidence. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { StarterService } from './starter-service.mjs'
import { sharedModelApi } from './model-api.mjs'
const kitRoot = fileURLToPath(new URL('./integrations/ai-product-starter-kit', import.meta.url))
const fake = `import sys,json,time,signal
r=json.loads(sys.stdin.readline())
def emit(**e): print(json.dumps(e),flush=True)
if 'slow' in r['prompt']:
 signal.signal(signal.SIGTERM,lambda *_:sys.exit(0));time.sleep(30)
emit(type='text',text='本轮保存文档，等待人工验收')
emit(type='report',report={'summary':'当前阶段草稿','nextStep':'请人工核对','unresolved':[],'checks':[{'item':'需求已整理','status':'yes','evidence':'docs/PRD/PRD.md'}]})
emit(type='result',reply='完成')
`
function setup(t,options={}) { const dir = mkdtempSync(join(tmpdir(), 'aipm-starter-')); writeFileSync(join(dir,'worker.py'), fake); const service = new StarterService({ root: join(dir,'projects'), kitRoot, python:'/usr/bin/python3', getApi:()=>sharedModelApi(()=> 'private-test-key'), workerPath:join(dir,'worker.py'), ...options }); t.after(async()=>{ await service.close(); rmSync(dir,{recursive:true,force:true}) }); return service }
async function finish(s,id) { if(s.active?.id===id) await s.active.done; return s.get(id) }
const checks={scope:true,evidence:true,functional:true,secrets:true,persistence:true}
test('complete unchanged kit, conversations and hash-aware stage gates persist across six stages', async t => {
 const s=setup(t), p=s.create({name:'课堂示例',idea:'将会议记录变为待办'})
 assert.equal(s.library().length,10); assert.match(s.readLibrary('docs/手册/AI产品 Vibe Coding 通用上线部署手册.md').content,/veFaaS/i)
 assert.throws(()=>s.read(p.id,'../credential.bin')); assert.throws(()=>s.readLibrary('../README.md'))
 s.send(p.id,'开始当前阶段'); let result=await finish(s,p.id)
 assert.equal(result.messages[0].phase,0); assert.equal(result.status,'idle'); assert.equal(result.phase,0)
 let review=s.review(p.id); writeFileSync(join(s.folder(p.id),'docs/PRD/补充.md'),'用户新增需求')
 assert.throws(()=>s.advance(p.id,{confirmed:true,checks,expectedHash:review.hash}),/文件已变更/)
 review=s.review(p.id); assert.equal(s.advance(p.id,{confirmed:true,checks,expectedHash:review.hash}).phase,1)
 s.send(p.id,'适配');await finish(s,p.id);s.advance(p.id,{confirmed:true,checks,expectedHash:s.review(p.id).hash})
 s.send(p.id,'后端完成报告仍不能代表实际通过');await finish(s,p.id)
 assert.throws(()=>s.advance(p.id,{confirmed:true,checks,expectedHash:s.review(p.id).hash}),/测试记录/)
 const metadata=JSON.parse(readFileSync(join(s.root,p.id,'project.json'),'utf8')); assert.equal(metadata.history.length,2)
 assert.equal(readFileSync(join(s.folder(p.id),'AGENTS.md'),'utf8'),s.readLibrary('AGENTS.md').content)
})
test('cancel awaits worker even when SIGTERM exits zero and preserves partial work', async t=>{
 const s=setup(t),p=s.create({name:'停止测试'});s.send(p.id,'slow'); await new Promise(r=>setTimeout(r,100));const stopped=await s.cancel(p.id)
 assert.equal(stopped.status,'cancelled'); assert.equal(s.active,null); assert.equal(stopped.phase,0)
 assert.equal(JSON.stringify(stopped).includes('private-test-key'),false)
})

test('future decisions can defer to their phase, but real ratings, tests and both viewport records gate core development', async t=>{
 const s=setup(t),p=s.create({name:'闸门边界夹具'}),file=join(s.root,p.id,'project.json')
 s.send(p.id,'体检');await finish(s,p.id);let meta=JSON.parse(readFileSync(file,'utf8'));meta.decisions=[{question:'效果标准',answer:'阶段2真实样例后冻结',status:'deferred',revisitPhase:2}];writeFileSync(file,JSON.stringify(meta))
 assert.equal(s.advance(p.id,{confirmed:true,checks,expectedHash:s.review(p.id).hash}).phase,1)
 meta=JSON.parse(readFileSync(file,'utf8'));meta.phase=2;meta.decisions=[];meta.report={summary:'夹具报告',nextStep:'核对',unresolved:[],checks:[{item:'真实调用',status:'yes',evidence:'夹具'}]};meta.commands=[{phase:2,command:'python3 -m unittest test_app.py',exitCode:0,usedSharedApi:false},{phase:2,command:'python3 app.py --demo',exitCode:0,usedSharedApi:true}];meta.samples=Array.from({length:5},(_,i)=>({id:'s'+i,input:'测试输入',output:'测试输出',phase:2,source:'real_shared_api'}));writeFileSync(file,JSON.stringify(meta))
 assert.throws(()=>s.rate(p.id,'s0',{scores:{},unacceptable:false}),/逐项/)
 for(const sample of meta.samples)s.rate(p.id,sample.id,{scores:Object.fromEntries(meta.rubric.map(d=>[d,2])),unacceptable:false})
 assert.equal(s.advance(p.id,{confirmed:true,checks,expectedHash:s.review(p.id).hash}).phase,3)
 meta=JSON.parse(readFileSync(file,'utf8'));meta.report={summary:'前端夹具报告',nextStep:'核对',unresolved:[],checks:[{item:'页面',status:'yes',evidence:'夹具'}]};meta.commands.push({phase:3,command:'npm test',exitCode:0});writeFileSync(file,JSON.stringify(meta))
 assert.throws(()=>s.advance(p.id,{confirmed:true,checks,expectedHash:s.review(p.id).hash}),/桌面和移动端/)
 meta.evidence=[{phase:3,mobile:false},{phase:3,mobile:true}];writeFileSync(file,JSON.stringify(meta));assert.equal(s.advance(p.id,{confirmed:true,checks,expectedHash:s.review(p.id).hash}).phase,4)
 for(const phase of [4,5]){meta=JSON.parse(readFileSync(file,'utf8'));meta.report={summary:'部署/收尾夹具',nextStep:'核对',unresolved:[],checks:[{item:'已核对',status:'yes',evidence:'单元夹具，不代表真实云上线'}]};writeFileSync(file,JSON.stringify(meta));s.advance(p.id,{confirmed:true,checks,expectedHash:s.review(p.id).hash})}
 assert.equal(s.get(p.id).completed,true);assert.throws(()=>s.send(p.id,'继续'),/已收尾/)
})

test('development has no default total-runtime timer and can still be stopped by its user',async t=>{
 for(const options of [{},{deadlineMs:null}]){
  const s=setup(t,options),p=s.create({name:'无总时长截止测试'});s.send(p.id,'slow');const current=s.active
  assert.equal(s.deadlineMs,null);assert.equal(current.timer,undefined);await new Promise(r=>setTimeout(r,80));assert.equal(s.get(p.id).status,'running')
  const stopped=await s.cancel(p.id);assert.equal(stopped.status,'cancelled');assert.equal(Boolean(stopped.runs.at(-1).timedOut),false);assert.equal(stopped.phase,0);assert.equal(s.active,null)
  assert.throws(()=>process.kill(current.child.pid,0),e=>e.code==='ESRCH')
 }
})

test('an explicit development deadline awaits worker exit without advancing the project',async t=>{
 const s=setup(t,{deadlineMs:150}),p=s.create({name:'显式截止测试'});s.send(p.id,'slow');const current=s.active
 assert.ok(current.timer);await current.done;const result=s.get(p.id)
 assert.equal(result.status,'failed');assert.match(result.error,/时间上限/);assert.equal(result.runs.at(-1).timedOut,true);assert.equal(result.phase,0);assert.deepEqual(result.history,[]);assert.equal(s.active,null)
 assert.throws(()=>process.kill(current.child.pid,0),e=>e.code==='ESRCH')
})

test('invalid development deadlines cannot accidentally schedule immediate timers',t=>{
 const dir=mkdtempSync(join(tmpdir(),'aipm-starter-invalid-deadline-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 for(const deadlineMs of [0,-1,Infinity,NaN,.5,2147483648,'30000'])assert.throws(()=>new StarterService({root:join(dir,'projects'),kitRoot,python:'/usr/bin/python3',getApi:()=>({}),deadlineMs}),/任务时限/)
})
