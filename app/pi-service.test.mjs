/** Process-host behavior with synthetic Pi JSONL; no provider calls or user files. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import sharp from 'sharp'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PiService, nodeExecutable } from './pi-service.mjs'
const fake=`import{writeFileSync}from'node:fs';import{join}from'node:path';let buf='',started=false;function emit(e){process.stdout.write(JSON.stringify(e)+'\\n')}process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{buf+=c;let i;while((i=buf.indexOf('\\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line)continue;const r=JSON.parse(line);if(started){if(r.type==='cancel')process.exit(0);continue}started=true;if(r.prompt==='slow'){emit({type:'delta',text:'已保存部分结果'});continue}if(r.prompt==='artifact'){const path=join(r.workspace,'report.md');writeFileSync(path,'Synthetic artifact');emit({type:'tool',name:'write',arguments:{path},callId:'write1'});emit({type:'tool_result',name:'write',callId:'write1',isError:false,result:{}})}for(let x=0;x<1000;x++)emit({type:'delta',text:'字'});if(r.prompt==='error')emit({type:'error',message:'失败 '+r.api.apiKey});else emit({type:'result',reply:'完成'});process.stdout.write('',()=>process.exit(0))}});process.on('SIGTERM',()=>process.exit(0));`
function setup(t,options={}){const root=mkdtempSync(join(tmpdir(),'aipm-pi-host-')),workerPath=join(root,'fake.mjs');writeFileSync(workerPath,fake);const updates=[];const service=new PiService({root:join(root,'sessions'),getApi:()=>({apiKey:'fixture-private-key',model:'deepseek-v4-pro'}),workerPath,workerExecutable:nodeExecutable,moduleCall:()=>{},onUpdate:p=>updates.push(p),...options});t.after(async()=>{await service.close();rmSync(root,{recursive:true,force:true})});return{service,root,updates}}
test('a research profile follows the same durable Pi conversation on every turn and is recorded without credentials',async t=>{
 let revision=1
 const{service}=setup(t,{getContext:chat=>({system:'公司调研项目 '+chat.id+' 修订'+revision,files:[{path:'/fixture/公司研究规范.md',content:'主体与来源必须核对'}]})}),chat=service.create({title:'公司调研 · 示例'})
 service.send(chat.id,'normal');await service.active.done;revision=2;service.send(chat.id,'normal');await service.active.done
 const result=service.get(chat.id);assert.equal(result.runs.length,2);assert.equal(result.messages.length,4)
 const requests=result.runs.map(run=>JSON.parse(readFileSync(join(service.root,chat.id,'runs',run.id,'request.json'),'utf8')))
 assert.match(requests[0].system,/修订1/);assert.match(requests[1].system,/修订2/);assert.equal(requests[1].sessionDir,requests[0].sessionDir);assert.deepEqual(requests[0].contextFiles,[{path:'/fixture/公司研究规范.md',content:'主体与来源必须核对'}]);assert.equal(JSON.stringify(requests).includes('fixture-private-key'),false)
})

test('a bounded project profile snapshots per-turn limits without changing ordinary chat defaults',async t=>{
 let budgeted=true;const {service}=setup(t,{getContext:()=>budgeted?{executionLimits:{maxCalls:16,maxOutputTokens:24000,maxCostYuan:2}}:null}),chat=service.create()
 service.send(chat.id,'normal');await service.active.done;budgeted=false;service.send(chat.id,'normal');await service.active.done
 const runs=service.get(chat.id).runs,requests=runs.map(run=>JSON.parse(readFileSync(join(service.root,chat.id,'runs',run.id,'request.json'))))
 assert.equal(requests[0].maxCostYuan,2);assert.equal(requests[0].maxCalls,16);assert.equal(runs[0].limits.maxCostYuan,2)
 assert.equal(requests[1].maxCostYuan,undefined);assert.equal(requests[1].maxCalls,120);assert.equal(service.executionLimits.maxCostYuan,undefined)
})

test('invalid project cost settings fail before any conversation or worker mutation',t=>{
 const {service}=setup(t,{getContext:()=>({executionLimits:{maxCostYuan:-1}})}),chat=service.create()
 assert.throws(()=>service.send(chat.id,'normal'),/费用上限/);const unchanged=service.get(chat.id);assert.equal(unchanged.runs.length,0);assert.equal(unchanged.messages.length,0);assert.equal(service.active,null)
})
test('delta checkpoints stay bounded, complete content persists and callback failure cannot break completion',async t=>{
 const{service,updates}=setup(t,{onUpdate:()=>{throw new Error('UI listener fault')}}),p=service.create();service.send(p.id,'normal');await service.active.done;const done=service.get(p.id);assert.equal(done.status,'idle');assert.equal(done.messages.at(-1).content.length,1000);assert.equal(service.active,null)
 const second=setup(t),q=second.service.create();second.service.send(q.id,'normal');await second.service.active.done;assert.ok(second.updates.length<30,'do not save/notify 1000 full snapshots');assert.equal(second.service.get(q.id).messages.at(-1).content.length,1000)
})
test('provider errors never claim completion, are redacted, and cancellation awaits exit-zero children',async t=>{
 const{service}=setup(t),p=service.create();service.send(p.id,'error');await service.active.done;let result=service.get(p.id);assert.equal(result.status,'failed');assert.equal(JSON.stringify(result).includes('fixture-private-key'),false)
 service.send(p.id,'slow');for(let i=0;i<300&&!service.active.p.messages.at(-1).content;i++)await new Promise(r=>setTimeout(r,10));assert.match(service.active.p.messages.at(-1).content,/部分结果/);result=await service.cancel(p.id);assert.equal(result.status,'cancelled');assert.equal(service.active,null);assert.match(result.messages.at(-1).content,/部分结果/)
})
test('linked conversation metadata is rejected before reading another file',async t=>{
 const{service,root}=setup(t),p=service.create(),file=join(service.root,p.id,'conversation.json'),copy=join(root,'outside.json');writeFileSync(copy,readFileSync(file));rmSync(file);symlinkSync(copy,file);assert.throws(()=>service.get(p.id),/链接/)
})

test('absolute write artifacts keep a canonical absolute path and a concise filename',async t=>{
 const{service}=setup(t),p=service.create();service.send(p.id,'artifact');await service.active.done;const artifact=service.get(p.id).artifacts[0];assert.equal(artifact.name,'report.md');assert.equal(artifact.path,join(service.folder(p.id),'report.md'))
})

test('an execution limit pauses durably without a provider failure and resumes the same conversation',async t=>{
 const{service,root}=setup(t),p=service.create()
 writeFileSync(join(root,'fake.mjs'),fake.replace('started=true;',`started=true;if(r.prompt==='limit'){emit({type:'usage',usage:{calls:2,input_tokens:500000,output_tokens:100}});emit({type:'limit',kind:'output_token_limit',reason:'本轮输出已达到测试上限，进度已保存',usage:{calls:2,input_tokens:500000,output_tokens:100},limits:{maxCalls:120,maxOutputTokens:100}});emit({type:'error',message:'subsequent SDK abort'});process.stdout.write('',()=>process.exit(1));return}`))
 service.send(p.id,'limit');await service.active.done;let done=service.get(p.id)
 assert.equal(done.status,'paused');assert.equal(done.error,null);assert.equal(done.pending,null);assert.equal(done.pause.kind,'output_token_limit');assert.equal(done.runs.at(-1).status,'paused');assert.equal(service.active,null)
 const request=JSON.parse(readFileSync(join(service.root,p.id,'runs',done.runs[0].id,'request.json')));assert.equal(request.maxCalls,120);assert.equal(request.maxOutputTokens,120000);assert.equal(request.maxTokens,undefined)
 service.send(p.id,'normal');await service.active.done;done=service.get(p.id);assert.equal(done.status,'idle');assert.equal(done.pause,null);assert.equal(done.messages.length,4);assert.equal(done.runs.length,2)
})

test('old cumulative-input failures become resumable while their historical run remains unchanged',async t=>{
 const{service}=setup(t),p=service.create(),file=join(service.root,p.id,'conversation.json'),old=JSON.parse(readFileSync(file))
 old.status='failed';old.error='达到本轮Pi预算，进度已保存，可以继续';old.runs=[{id:'historical-run',status:'failed',usage:{calls:6,input_tokens:394547,output_tokens:11633}}];writeFileSync(file,JSON.stringify(old));await service.close()
 const reopened=new PiService({root:service.root,getApi:()=>({apiKey:'fixture-private-key',model:'deepseek-v4-pro'})});t.after(()=>reopened.close());const migrated=reopened.get(p.id)
 assert.equal(migrated.status,'paused');assert.equal(migrated.error,null);assert.equal(migrated.pause.kind,'legacy_input_limit');assert.equal(migrated.runs[0].status,'failed');assert.deepEqual(migrated.runs[0].usage,old.runs[0].usage)
})

test('normal conversations have no total-runtime timer and remain manually stoppable',async t=>{
 for(const options of [{},{deadlineMs:null}]){
  const{service}=setup(t,options),p=service.create();service.send(p.id,'slow');const current=service.active
  assert.equal(service.deadlineMs,null);assert.equal(current.timer,undefined)
  for(let i=0;i<300&&!current.p.messages.at(-1).content;i++)await new Promise(r=>setTimeout(r,10))
  assert.match(current.p.messages.at(-1).content,/部分结果/);assert.equal(service.get(p.id).status,'running')
  const result=await service.cancel(p.id);assert.equal(result.status,'cancelled');assert.equal(result.runs.at(-1).timedOut,false);assert.equal(service.active,null)
  assert.throws(()=>process.kill(current.child.pid,0),e=>e.code==='ESRCH')
 }
})

test('an explicitly configured conversation deadline stops and awaits its owned worker',async t=>{
 const{service}=setup(t,{deadlineMs:150}),p=service.create();service.send(p.id,'slow');const current=service.active
 assert.ok(current.timer);await current.done;const result=service.get(p.id)
 assert.equal(result.status,'failed');assert.match(result.error,/时间上限/);assert.equal(result.runs.at(-1).timedOut,true);assert.equal(service.active,null)
 assert.throws(()=>process.kill(current.child.pid,0),e=>e.code==='ESRCH')
})

test('invalid conversation deadlines fail before they can become immediate or overflowing timers',t=>{
 const root=mkdtempSync(join(tmpdir(),'aipm-pi-invalid-deadline-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 for(const deadlineMs of [0,-1,Infinity,NaN,.5,2147483648,'30000'])assert.throws(()=>new PiService({root:join(root,'sessions'),getApi:()=>({}),deadlineMs}),/任务时限/)
})

test('host captures attach actual image bytes only for the run model snapshot, and a later selection affects the next turn',async t=>{
 const selected={apiKey:'fixture-private-key',model:'deepseek-flash'},image=await sharp({create:{width:80,height:40,channels:3,background:'#88aacc'}}).png().toBuffer()
 const{service,root}=setup(t,{getApi:()=>selected,computer:{execute:async(_args,{artifactRoot})=>{const file=join(artifactRoot,'actual-capture.png');writeFileSync(file,image);return{file,ocr:[{text:'当前窗口'}],snapshotId:'snapshot-fixture'}}}})
 const captureWorker=`import{writeFileSync}from'node:fs';import{join}from'node:path';let b='',cfg;const emit=v=>process.stdout.write(JSON.stringify(v)+'\\n');process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{b+=chunk;let i;while((i=b.indexOf('\\n'))>=0){const r=JSON.parse(b.slice(0,i));b=b.slice(i+1);if(!cfg){cfg=r;emit({type:'request',token:'capture',kind:'computer',action:'capture',app:'com.fixture.Test'})}else if(r.token==='capture'){writeFileSync(join(cfg.workspace,'host-result.json'),JSON.stringify(r.result));emit({type:'result',reply:'capture complete'});process.stdout.write('',()=>process.exit(0))}}});`
 writeFileSync(join(root,'fake.mjs'),captureWorker)
 const chat=service.create();service.send(chat.id,'capture');const first=service.active;selected.model='deepseek-v4-pro'
 assert.equal(service.get(chat.id).model,'deepseek-flash');assert.equal(service.get(chat.id).selectedModel,'deepseek-v4-pro')
 await first.done;const actual=JSON.parse(readFileSync(join(service.folder(chat.id),'host-result.json'),'utf8'))
 assert.equal(actual.vision.attached,true);assert.equal(actual.image.mimeType,'image/jpeg');assert.ok(actual.image.data.length>20);assert.deepEqual(actual.ocr,[{text:'当前窗口'}])
 let saved=service.get(chat.id);assert.equal(saved.runs[0].model,'deepseek-flash');const request=JSON.parse(readFileSync(join(service.root,chat.id,'runs',saved.runs[0].id,'request.json'),'utf8'));assert.match(request.system,/当前Flash支持图像/);assert.equal(request.api.model,'deepseek-flash')
 service.send(chat.id,'capture');await service.active.done
 const pro=JSON.parse(readFileSync(join(service.folder(chat.id),'host-result.json'),'utf8'));assert.equal(pro.image,undefined);assert.deepEqual(pro.ocr,[{text:'当前窗口'}]);saved=service.get(chat.id);assert.equal(saved.runs[1].model,'deepseek-v4-pro')
})


const submitWorker=`import{writeFileSync}from'node:fs';import{join}from'node:path';let b='',cfg;const emit=v=>process.stdout.write(JSON.stringify(v)+'\\n');process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{b+=chunk;let i;while((i=b.indexOf('\\n'))>=0){const r=JSON.parse(b.slice(0,i));b=b.slice(i+1);if(!cfg){cfg=r;emit({type:'request',token:'submit',kind:'video_submit',summary:'完成影片源码',runId:'forged-run'})}else if(r.type==='cancel')process.exit(0);else if(r.token==='submit'){writeFileSync(join(cfg.workspace,'submit-response.json'),JSON.stringify(r));emit({type:'result',reply:r.error?'未提交':'已提交',...(r.result?.accepted?{videoSubmission:r.result}:{})});process.stdout.write('',()=>process.exit(0))}}});`

test('the host accepts video submission only for the current video profile and supplies its actual run id',async t=>{
 const received=[];let mode='video-authoring'
 const{service,root}=setup(t,{getContext:()=>({workerMode:mode}),submitVideo:async(chatId,args)=>{received.push({chatId,...args});return{accepted:true,projectId:'lemo:owned-project',lemoId:'owned-project',runId:args.runId,summary:args.summary}}}),p=service.create()
 writeFileSync(join(root,'fake.mjs'),submitWorker);service.send(p.id,'submit');await service.active.done
 let result=service.get(p.id),run=result.runs.at(-1)
 assert.equal(result.status,'idle');assert.deepEqual(received,[{chatId:p.id,summary:'完成影片源码',runId:run.id}]);assert.equal(run.videoSubmission.lemoId,'owned-project')
 const saved=JSON.parse(readFileSync(join(service.root,p.id,'runs',run.id,'request.json')));assert.equal(saved.workerMode,'video-authoring');assert.equal(saved.api.apiKey,'[统一密钥，不落盘]')
 mode='untrusted-mode';service.send(p.id,'submit');await service.active.done;result=service.get(p.id);run=result.runs.at(-1)
 const response=JSON.parse(readFileSync(join(service.folder(p.id),'submit-response.json')));assert.match(response.error,/当前聊天不能提交影片/);assert.equal(received.length,1);assert.equal(run.videoSubmission,undefined)
 const ordinary=JSON.parse(readFileSync(join(service.root,p.id,'runs',run.id,'request.json')));assert.equal(ordinary.workerMode,undefined)
})

test('rejected host submission never writes an accepted receipt and the same chat can submit after correction',async t=>{
 let accept=false
 const{service,root}=setup(t,{getContext:()=>({workerMode:'video-authoring'}),submitVideo:async(_chat,args)=>accept?{accepted:true,projectId:'lemo:corrected',lemoId:'corrected',runId:args.runId,summary:args.summary}:{accepted:false}}),p=service.create()
 writeFileSync(join(root,'fake.mjs'),submitWorker);service.send(p.id,'submit');await service.active.done
 let response=JSON.parse(readFileSync(join(service.folder(p.id),'submit-response.json')));assert.match(response.error,/未被工作台接受/);assert.equal(service.get(p.id).runs.at(-1).videoSubmission,undefined)
 accept=true;service.send(p.id,'submit');await service.active.done;response=JSON.parse(readFileSync(join(service.folder(p.id),'submit-response.json')));assert.equal(response.result.accepted,true);assert.equal(service.get(p.id).runs.at(-1).videoSubmission.lemoId,'corrected')
})

test('cancellation during host video validation suppresses late acceptance and remains cancelled',async t=>{
 let enter,release;const entered=new Promise(resolve=>{enter=resolve}),validation=new Promise(resolve=>{release=resolve})
 const{service,root}=setup(t,{getContext:()=>({workerMode:'video-authoring'}),submitVideo:async(_id,args)=>{enter();await validation;return{accepted:true,projectId:'lemo:late',lemoId:'late',runId:args.runId,summary:args.summary}}}),p=service.create()
 writeFileSync(join(root,'fake.mjs'),submitWorker);service.send(p.id,'submit');await entered
 const cancelling=service.cancel(p.id);release();const result=await cancelling
 assert.equal(result.status,'cancelled');assert.equal(result.runs.at(-1).cancelled,true);assert.equal(result.runs.at(-1).videoSubmission,undefined);assert.equal(service.active,null)
})
