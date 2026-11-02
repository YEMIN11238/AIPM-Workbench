/** Real installed Pi SDK against a local OpenAI-compatible fixture, without paid API calls. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nodeExecutable, piPackage } from './pi-service.mjs'
import sharp from 'sharp'
import {piRequestCostQuote} from './pi-cost-guard.mjs'
const workerPath=fileURLToPath(new URL('./pi-worker.mjs',import.meta.url))
const available=existsSync(join(piPackage,'dist/index.js'))
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function fixture(t,responses,options={}){
 const ownsRoot=!options.existingRoot,root=options.existingRoot||realpathSync(mkdtempSync(join(tmpdir(),'aipm-real-pi-'))),workspace=join(root,'workspace');mkdirSync(workspace,{recursive:true});await options.prepareWorkspace?.(workspace);const requests=[],events=[],model=options.model||'deepseek-v4-pro'
 const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;requests.push(JSON.parse(text));const next=responses.shift();if(!next){res.writeHead(500);res.end('unexpected request');return}res.writeHead(200,{'Content-Type':'text/event-stream'});if(next.hold){res.write('data: '+JSON.stringify({id:'local-held',object:'chat.completion.chunk',created:1,model,choices:[{index:0,delta:{role:'assistant',content:'partial'},finish_reason:null}]})+'\n\n');return}const toolCalls=(next.tools||(next.name?[next]:[])).map((item,index)=>({index,id:'call_'+requests.length+'_'+index,type:'function',function:{name:item.name,arguments:JSON.stringify(item.args)}})),tool=toolCalls.length>0;const base={id:'local_'+requests.length,object:'chat.completion.chunk',created:1,model};res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',reasoning_content:'',...(tool?{tool_calls:toolCalls}:{content:next.text||'完成'})},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:next.finishReason||(tool?'tool_calls':'stop')}],usage:next.usage||{prompt_tokens:20,completion_tokens:10,total_tokens:30}})+'\n\n');res.end('data: [DONE]\n\n')})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const api={provider:'DeepSeek',model,apiKey:'local-fixture-only',baseUrl:'http://127.0.0.1:'+server.address().port,anthropicBaseUrl:'http://127.0.0.1:'+server.address().port+'/anthropic'}
 if(options.history){
  const sdk=await import(join(piPackage,'dist/index.js')),manager=sdk.SessionManager.create(workspace,join(root,'sessions'))
  manager.appendModelChange('deepseek','deepseek-v4-pro')
  for(let i=0;i<4;i++){
   manager.appendMessage({role:'user',content:[{type:'text',text:`synthetic old turn ${i} `+'x'.repeat(60000)}],timestamp:Date.now()-10000+i*1000})
   manager.appendMessage({role:'assistant',content:[{type:'text',text:`saved synthetic answer ${i}`}],provider:'deepseek',model:'deepseek-v4-pro',api:'openai-completions',usage:{input:options.historyInputTokens??90000,output:20,cacheRead:0,cacheWrite:0,totalTokens:(options.historyInputTokens??90000)+20,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()-9500+i*1000})
  }
  writeFileSync(join(root,'sessions/current.json'),JSON.stringify({path:manager.getSessionFile()}),{mode:0o600})
 }
 const child=spawn(nodeExecutable,[workerPath],{cwd:workspace,env:{PATH:'/Users/example/.local/node/bin:/usr/bin:/bin',HOME:root,LANG:'en_US.UTF-8'},stdio:['pipe','pipe','pipe'],detached:true});let buffer='',stderr='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(line){const event=JSON.parse(line);events.push(event);if(event.type==='request'&&options.hostRequest)void Promise.resolve().then(()=>options.hostRequest(event,{child,workspace,root})).then(result=>{if(!child.stdin.destroyed)child.stdin.write(JSON.stringify({token:event.token,result})+'\n')}).catch(error=>{if(!child.stdin.destroyed)child.stdin.write(JSON.stringify({token:event.token,error:error.message})+'\n')})}}});child.stderr.on('data',c=>{stderr+=c});const done=new Promise((r,j)=>{child.once('error',j);child.once('close',code=>r({code,stderr}))});child.stdin.write(JSON.stringify({mode:'starter',phase:2,workspace,sessionDir:join(root,'sessions'),out:root,piPackage,api,system:'Execute only the synthetic local test tools requested. Do not access other directories.',prompt:'Run the isolated fixture.',maxCalls:10,...options})+'\n')
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await done}await new Promise(r=>server.close(r));if(ownsRoot)rmSync(root,{recursive:true,force:true})});return{root,workspace,requests,events,child,done,api}
}

test('actual Pi built-in write/bash/read, provider traces and final-at-limit completion work', {skip:!available},async t=>{
 const f=await fixture(t,[{name:'write',args:{path:'test_product.py',content:'import unittest\nclass Case(unittest.TestCase):\n def test_real(self):\n  self.assertEqual(2+2,4)\n'}},{name:'bash',args:{command:'python3 -m unittest test_product.py'}},{name:'read',args:{path:'test_product.py'}},{text:'真实本地测试通过'}],{maxCalls:4})
 const result=await f.done;assert.equal(result.code,0,result.stderr+JSON.stringify(f.events.filter(e=>e.type==='error')));assert.match(readFileSync(join(f.workspace,'test_product.py'),'utf8'),/test_real/)
 const command=f.events.find(e=>e.type==='command');assert.equal(command.exitCode,0);assert.equal(command.timedOut,false);assert.equal(command.usedSharedApi,false);assert.match(command.output,/Ran 1 test/)
 assert.equal(f.events.filter(e=>e.type==='model_request').length,4);assert.equal(f.events.filter(e=>e.type==='result').length,1);assert.equal(f.events.some(e=>e.type==='error'),false)
 assert.equal(f.requests[0].model,'deepseek-v4-pro');assert.ok(f.requests[0].max_tokens<=10000);assert.ok(f.events.some(e=>e.type==='engine'&&e.name==='Pi Agent'))
 const inspect=path=>{for(const entry of readdirSync(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())inspect(file);else assert.equal(readFileSync(file,'utf8').includes(f.api.apiKey),false,'runtime key persisted to '+entry.name)}};inspect(join(f.root,'sessions'))
})

test('the actual Pi extension gates phase-zero code and commands before execution', {skip:!available},async t=>{
 const f=await fixture(t,[{name:'write',args:{path:'forbidden.py',content:'print(1)'}},{name:'bash',args:{command:'touch forbidden.txt'}},{text:'当前阶段只整理文档'}],{phase:0})
 const r=await f.done;assert.equal(r.code,0,r.stderr);assert.equal(existsSync(join(f.workspace,'forbidden.py')),false);assert.equal(existsSync(join(f.workspace,'forbidden.txt')),false)
 assert.ok(f.requests.slice(1).some(r=>JSON.stringify(r.messages).includes('当前阶段只整理需求')));assert.ok(f.requests.slice(1).some(r=>JSON.stringify(r.messages).includes('本阶段只做环境检查')))
 assert.equal(f.events.some(e=>e.type==='command'),false)
})

test('abort waits for Pi bash process group and persists its aborted command record', {skip:!available},async t=>{
 const f=await fixture(t,[{name:'bash',args:{command:'python3 -c "import time; time.sleep(30)"'}}]);for(let i=0;i<300&&!f.events.some(e=>e.type==='child');i++)await pause(10)
 const child=f.events.find(e=>e.type==='child');assert.ok(child,'command child was started');f.child.stdin.write(JSON.stringify({type:'cancel'})+'\n');const result=await f.done;assert.equal(result.code,130,result.stderr);const record=f.events.find(e=>e.type==='command');assert.ok(record?.aborted)
 assert.throws(()=>process.kill(child.pid,0),e=>e.code==='ESRCH')
})

test('failed host sample attempts consume the model budget and expose the failure to the model', {skip:!available},async t=>{
 const f=await fixture(t,[{name:'model_samples',args:{system:'Synthetic test',prompts:['one local sample']}},{text:'样例服务失败，已保留预算记录'}],{maxCalls:3,hostRequest:e=>{assert.equal(e.kind,'samples');assert.equal(e.remainingCalls,1);return{samples:[],usage:{calls:1,input_tokens:0,output_tokens:0},error:'fixture sample provider failed'}}})
 const r=await f.done;assert.equal(r.code,0,r.stderr);assert.equal(f.events.filter(e=>e.type==='usage').at(-1).usage.calls,3);assert.ok(JSON.stringify(f.requests[1].messages).includes('fixture sample provider failed'))
})

test('computer mutations describe snapshot identity and never dispatch an action missing it', {skip:!available},async t=>{
 const f=await fixture(t,[{name:'computer',args:{action:'click',app:'com.apple.TextEdit',element:1}},{text:'缺少快照，尚未点击'}],{mode:'assistant'});const r=await f.done;assert.equal(r.code,0,r.stderr);assert.equal(f.events.some(e=>e.type==='request'&&e.kind==='computer'),false);assert.ok(f.events.some(e=>e.type==='tool_result'&&e.name==='computer'&&e.isError));assert.ok(JSON.stringify(f.requests[1].messages).includes('电脑动作未执行'));const schema=f.requests[0].tools.find(t=>t.function?.name==='computer').function.parameters;assert.match(schema.properties.snapshotId.description,/必填/);assert.match(schema.properties.app.description,/一致/)
})

test('a resumable call limit keeps its reason, counts actual requests and never executes the proposed tool', {skip:!available},async t=>{
 const f=await fixture(t,[{name:'write',args:{path:'budget.txt',content:'must not run'}}],{maxCalls:1});const r=await f.done;assert.equal(r.code,1,r.stderr);const errors=f.events.filter(e=>e.type==='error');assert.ok(errors.length);assert.ok(errors.every(e=>e.message.includes('达到 1 次执行上限')),JSON.stringify(errors));assert.equal(f.events.find(e=>e.type==='limit').kind,'call_limit');assert.equal(f.events.filter(e=>e.type==='usage').at(-1).usage.calls,1);assert.equal(existsSync(join(f.workspace,'budget.txt')),false);assert.equal(f.events.some(e=>e.type==='result'),false);assert.equal(f.requests.length,1)
})

test('a development run can process repeated input above 400k without pausing or reducing its next output allowance', {skip:!available},async t=>{
 const usage={prompt_tokens:60000,completion_tokens:10,total_tokens:60010},responses=Array.from({length:7},(_,i)=>({name:'write',args:{path:`part-${i}.txt`,content:'synthetic completed part'},usage}));responses.push({text:'all parts complete',usage})
 const f=await fixture(t,responses);const r=await f.done;assert.equal(r.code,0,r.stderr);assert.equal(f.requests.length,8);assert.ok(f.events.filter(e=>e.type==='usage').at(-1).usage.input_tokens>400000);assert.equal(f.events.some(e=>e.type==='limit'),false);assert.ok(f.requests.every(req=>req.max_tokens===10000))
})

test('output ceilings and explicitly configured cumulative ceilings pause before further local changes', {skip:!available},async t=>{
 for(const config of [{maxOutputTokens:10,expected:'output_token_limit'},{maxTokens:30,expected:'input_token_limit'}]){
  const f=await fixture(t,[{name:'write',args:{path:'not-written.txt',content:'must not run'}}],config);const r=await f.done;assert.equal(r.code,1,r.stderr);assert.equal(f.events.find(e=>e.type==='limit').kind,config.expected);assert.equal(existsSync(join(f.workspace,'not-written.txt')),false);assert.equal(f.requests.length,1)
 }
})

test('resuming old long history compacts through real Pi, logs summary requests and includes their usage', {skip:!available},async t=>{
 const f=await fixture(t,[{text:'Synthetic checkpoint. Preserve the original user task and saved file paths. No acceptance inferred.'},{text:'Resumed after compacting history.'}],{history:true})
 const r=await f.done;assert.equal(r.code,0,r.stderr+JSON.stringify(f.events.filter(e=>e.type==='error')));assert.equal(f.requests.length,2)
 const compact=f.events.find(e=>e.type==='compaction'&&e.result);assert.ok(compact,'a durable Pi compaction completed');assert.equal(compact.result.usage.output,10)
 assert.ok(f.events.some(e=>e.type==='model_request'&&e.phase==='compaction'));assert.equal(f.events.filter(e=>e.type==='model_request').length,2);assert.equal(f.events.filter(e=>e.type==='usage').at(-1).usage.calls,2);assert.equal(f.events.filter(e=>e.type==='usage').at(-1).usage.output_tokens,20)
 assert.equal(JSON.stringify(f.requests[1]).includes('synthetic old turn 0'),false);assert.ok(compact.result.estimatedTokensAfter<compact.result.tokensBefore,JSON.stringify({before:compact.result.tokensBefore,after:compact.result.estimatedTokensAfter}));assert.ok(f.requests.every(req=>req.max_tokens<=10000));assert.equal(f.events.find(e=>e.type==='engine').effectiveContextWindow,96000)
})

test('recoverable intermediate length followed by real overflow compaction and a complete reply succeeds', {skip:!available},async t=>{
 const f=await fixture(t,[
  {text:'截',finishReason:'length',usage:{prompt_tokens:184682,completion_tokens:1,total_tokens:184683}},
  {text:'Synthetic recovery checkpoint. Keep the user task and local evidence paths.',usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}},
  {text:'已自动恢复上下文，完整结论与文件位置均已说明。',usage:{prompt_tokens:200,completion_tokens:502,total_tokens:702}},
 ],{history:true,historyInputTokens:1000})
 const r=await f.done;assert.equal(r.code,0,r.stderr+JSON.stringify(f.events.filter(e=>e.type==='error')))
 assert.equal(f.requests.length,3)
 const compact=f.events.find(e=>e.type==='compaction'&&e.reason==='overflow'&&e.result);assert.ok(compact,'the installed Pi SDK actually compacted and retried the truncated response')
 assert.ok(f.events.some(e=>e.type==='model_request'&&e.phase==='compaction'))
 assert.equal(f.events.some(e=>e.type==='error'),false,'an intermediate length must not poison a recovered turn')
 const result=f.events.find(e=>e.type==='result');assert.match(result.reply,/已自动恢复上下文/);assert.equal(result.usage.calls,3);assert.equal(result.usage.output_tokens,533)
})

test('a genuinely final length stop still fails and never reports a completed result', {skip:!available},async t=>{
 const f=await fixture(t,[{text:'这是一份被截断的不完整答复',finishReason:'length',usage:{prompt_tokens:20,completion_tokens:10000,total_tokens:10020}}])
 const r=await f.done;assert.equal(r.code,1,r.stderr);assert.equal(f.requests.length,1)
 assert.equal(f.events.some(e=>e.type==='result'),false)
 assert.ok(f.events.some(e=>e.type==='error'&&e.message.includes('Pi回复被截断，请继续')))
 assert.equal(f.events.some(e=>e.type==='compaction'),false,'a response exhausting the intended output allowance is not recovered as overflow')
})

test('Flash built-in image read enters the real SDK provider request, while Pro stays text-only', {skip:!available},async t=>{
 for(const model of ['deepseek-flash','deepseek-v4-pro']){
  const f=await fixture(t,[{name:'read',args:{path:'picture.png'}},{text:'已根据实际工具结果说明'}],{model,prepareWorkspace:async workspace=>sharp({create:{width:40,height:20,channels:3,background:'#22aabb'}}).png().toFile(join(workspace,'picture.png'))})
  const done=await f.done;assert.equal(done.code,0,done.stderr+JSON.stringify(f.events.filter(e=>e.type==='error')))
  assert.equal(f.requests.length,2);assert.equal(f.requests[0].model,model)
  const wire=JSON.stringify(f.requests[1].messages)
  assert.equal(/data:image\//.test(wire),model==='deepseek-flash',wire.slice(-1000))
  assert.equal(f.events.find(e=>e.type==='engine').vision,model==='deepseek-flash')
  if(model==='deepseek-flash'){const read=f.events.find(e=>e.type==='tool_result'&&e.name==='read').result;assert.ok(read.content.some(block=>block.type==='image'));assert.equal(read.structuredContent.type,'image-reference');assert.equal(read.structuredContent.data,undefined);const trace=f.events.filter(e=>e.type==='model_request').at(-1);assert.equal(JSON.stringify(trace).includes('data:image/'),false);assert.match(JSON.stringify(trace),/sha256=/)}
  else assert.ok(f.events.some(e=>e.type==='tool_result'&&e.name==='read'&&e.isError))
 }
})

test('Flash computer capture forwards a real image content block instead of only a file path', {skip:!available},async t=>{
 const bytes=await sharp({create:{width:30,height:15,channels:3,background:'#ffe122'}}).png().toBuffer()
 const f=await fixture(t,[{name:'computer',args:{action:'capture',app:'com.fixture.Test'}},{text:'实际图像附件已返回'}],{mode:'assistant',model:'deepseek-flash',hostRequest:event=>{assert.equal(event.kind,'computer');return{file:'/fixture/capture.png',ocr:[],vision:{attached:true},image:{type:'image',mimeType:'image/png',data:bytes.toString('base64')}}}})
 const done=await f.done;assert.equal(done.code,0,done.stderr);assert.match(JSON.stringify(f.requests[1].messages),/data:image\/png;base64,/)
 const description=f.requests[0].tools.find(tool=>tool.function?.name==='computer').function.description;assert.match(description,/Flash支持图像/);assert.equal(description.includes('Pro通过'),false)
})


test('video authoring hands off to local production after one real SDK request and resumes its persisted tool result next turn', {skip:!available},async t=>{
 let submissions=0
 const accepted={accepted:true,projectId:'lemo:fixture-project',lemoId:'fixture-project',runId:'fixture-run',summary:'独立影片源码与声音事件已提交'}
 const f=await fixture(t,[{name:'finish_video',args:{summary:accepted.summary}}],{mode:'assistant',workerMode:'video-authoring',prepareWorkspace:workspace=>writeFileSync(join(workspace,'film.js'),'window.render=t=>t; window.EV=[{type:"tone",t:0}];'),hostRequest:event=>{assert.equal(event.kind,'video_submit');assert.match(readFileSync(join(f.workspace,'film.js'),'utf8'),/window.render/);submissions++;return accepted}})
 const done=await f.done;assert.equal(done.code,0,done.stderr+JSON.stringify(f.events.filter(e=>e.type==='error')))
 assert.equal(submissions,1);assert.equal(f.requests.length,1);assert.equal(f.events.filter(e=>e.type==='model_request').length,1);assert.equal(f.events.some(e=>e.type==='error'),false)
 const result=f.events.find(e=>e.type==='result');assert.deepEqual(result.videoSubmission,accepted);assert.equal(result.reply,accepted.summary)
 const tool=f.events.find(e=>e.type==='tool_result'&&e.name==='finish_video');assert.equal(tool.isError,false)
 const transcript=readFileSync(result.sessionFile,'utf8');assert.match(transcript,/finish_video/);assert.match(transcript,/fixture-project/)
 const resumed=await fixture(t,[{text:'保留原工程，继续同一个视频聊天'}],{mode:'assistant',existingRoot:f.root})
 const next=await resumed.done;assert.equal(next.code,0,next.stderr);assert.equal(resumed.events.find(e=>e.type==='result').sessionFile,result.sessionFile);assert.ok(resumed.requests[0].messages.some(message=>message.role==='tool'&&JSON.stringify(message).includes('fixture-project')))
})

test('a rejected or failed video submission remains a tool failure and can be corrected before a later accepted handoff', {skip:!available},async t=>{
 for(const failure of ['reject','throw']){
  let attempts=0
  const f=await fixture(t,[{name:'finish_video',args:{summary:'首次提交'}},{name:'write',args:{path:'film.js',content:'window.render=t=>t;'}},{name:'finish_video',args:{summary:'修复后提交'}}],{mode:'assistant',workerMode:'video-authoring',hostRequest:event=>{assert.equal(event.kind,'video_submit');attempts++;if(attempts===1){if(failure==='throw')throw new Error('工程尚未完成');return{accepted:false}}return{accepted:true,projectId:'lemo:corrected',lemoId:'corrected',runId:'corrected-run',summary:'修复后提交'}}})
  const done=await f.done;assert.equal(done.code,0,done.stderr+JSON.stringify(f.events.filter(e=>e.type==='error')));assert.equal(attempts,2);assert.equal(f.requests.length,3)
  const submissions=f.events.filter(e=>e.type==='tool_result'&&e.name==='finish_video');assert.equal(submissions.length,2);assert.equal(submissions[0].isError,true);assert.equal(submissions[1].isError,false)
  assert.ok(JSON.stringify(f.requests[1].messages).includes(failure==='throw'?'工程尚未完成':'影片提交未被工作台接受'));assert.equal(f.events.filter(e=>e.type==='result').length,1);assert.equal(f.events.find(e=>e.type==='result').videoSubmission.lemoId,'corrected')
 }
})

test('cancelling while the host validates video source never becomes a successful handoff', {skip:!available},async t=>{
 let entered,release;const waiting=new Promise(resolve=>{entered=resolve}),validation=new Promise(resolve=>{release=resolve})
 const f=await fixture(t,[{name:'finish_video',args:{summary:'提交中'}}],{mode:'assistant',workerMode:'video-authoring',hostRequest:async event=>{assert.equal(event.kind,'video_submit');entered();await validation;return{accepted:true,projectId:'lemo:cancelled',lemoId:'cancelled',runId:'cancelled-run',summary:'不得宣称成功'}}})
 await waiting;f.child.stdin.write(JSON.stringify({type:'cancel'})+'\n');release();const done=await f.done
 assert.equal(done.code,130,done.stderr);assert.equal(f.events.some(e=>e.type==='result'),false);assert.equal(f.requests.length,1)
})

test('ordinary chat never exposes the video handoff tool or dispatches a hallucinated submission', {skip:!available},async t=>{
 let invoked=false
 const f=await fixture(t,[{name:'finish_video',args:{}},{text:'当前只是普通聊天'}],{mode:'assistant',hostRequest:()=>{invoked=true;throw new Error('must not dispatch')}})
 const done=await f.done;assert.equal(done.code,0,done.stderr);assert.equal(invoked,false);assert.equal(f.requests[0].tools.some(tool=>tool.function?.name==='finish_video'),false);assert.equal(f.events.find(e=>e.type==='tool_result'&&e.name==='finish_video').isError,true);assert.equal(f.events.find(e=>e.type==='result').videoSubmission,undefined)
})


test('a sole video handoff at the exact call or output ceiling completes locally without another provider request', {skip:!available},async t=>{
 for(const ceiling of [{maxCalls:1},{maxOutputTokens:10}]){
  let submissions=0
  const f=await fixture(t,[{name:'finish_video',args:{summary:'源码已就绪'}}],{mode:'assistant',workerMode:'video-authoring',...ceiling,hostRequest:event=>{assert.equal(event.kind,'video_submit');submissions++;return{accepted:true,projectId:'lemo:at-limit',lemoId:'at-limit',runId:'limit-run',summary:'已交给本地制作'}}})
  const done=await f.done;assert.equal(done.code,0,done.stderr+JSON.stringify(f.events.filter(e=>e.type==='error')));assert.equal(submissions,1);assert.equal(f.requests.length,1);assert.equal(f.events.filter(e=>e.type==='model_request').length,1);assert.equal(f.events.some(e=>e.type==='limit'),false);assert.equal(f.events.find(e=>e.type==='result').videoSubmission.lemoId,'at-limit')
 }
})

test('a mixed write and video handoff at the ceiling cannot execute either local action', {skip:!available},async t=>{
 for(const reverse of [false,true]){
  let submissions=0
  const tools=[{name:'write',args:{path:'must-not-exist.txt',content:'blocked at ceiling'}},{name:'finish_video',args:{summary:'mixed submission'}}];if(reverse)tools.reverse()
  const f=await fixture(t,[{tools}],{mode:'assistant',workerMode:'video-authoring',maxCalls:1,hostRequest:()=>{submissions++;return{accepted:true}}})
  const done=await f.done;assert.equal(done.code,1,done.stderr);assert.equal(submissions,0);assert.equal(existsSync(join(f.workspace,'must-not-exist.txt')),false);assert.equal(f.requests.length,1);assert.equal(f.events.find(e=>e.type==='limit').kind,'call_limit');assert.equal(f.events.some(e=>e.type==='result'),false)
 }
})

test('rejected exact-ceiling video handoff pauses before any further provider request', {skip:!available},async t=>{
 for(const ceiling of [{maxCalls:1,kind:'call_limit'},{maxOutputTokens:10,kind:'output_token_limit'}]){
  let submissions=0
  const f=await fixture(t,[{name:'finish_video',args:{summary:'尚未完成'}}],{mode:'assistant',workerMode:'video-authoring',...ceiling,hostRequest:()=>{submissions++;return{accepted:false}}})
  const done=await f.done;assert.equal(done.code,1,done.stderr);assert.equal(submissions,1);assert.equal(f.requests.length,1);assert.equal(f.events.find(e=>e.type==='limit').kind,ceiling.kind);assert.equal(f.events.find(e=>e.type==='tool_result'&&e.name==='finish_video').isError,true);assert.equal(f.events.some(e=>e.type==='result'),false)
 }
})

test('an unaffordable first request is paused outside swallowed extension hooks before reaching the server', {skip:!available},async t=>{
 const f=await fixture(t,[{text:'must never be requested'}],{maxCostYuan:.001});const done=await f.done
 assert.equal(done.code,1,done.stderr);assert.equal(f.requests.length,0);assert.equal(f.events.filter(e=>e.type==='model_request').length,0)
 const limit=f.events.find(e=>e.type==='limit');assert.equal(limit.kind,'cost_limit');assert.equal(limit.usage.calls,0);assert.equal(limit.usage.cost.requests,0);assert.equal(f.events.some(e=>e.type==='result'),false)
})

test('paid input growth blocks the next request while valid cached usage settles below its reservation', {skip:!available},async t=>{
 const probe=await fixture(t,[],{maxCostYuan:.001});await probe.done;const firstQuote=probe.events.find(e=>e.type==='limit').requiredUpperBoundYuan
 const maxCostYuan=Math.ceil((firstQuote+.15)*1e6)/1e6
 const f=await fixture(t,[{name:'read',args:{path:'long.txt'},usage:{prompt_tokens:200,prompt_cache_hit_tokens:190,prompt_cache_miss_tokens:10,completion_tokens:10,total_tokens:210}},{text:'must not be requested'}],{maxCostYuan,prepareWorkspace:workspace=>writeFileSync(join(workspace,'long.txt'),('x'.repeat(99)+'\n').repeat(1500))})
 const done=await f.done;assert.equal(done.code,1,done.stderr);assert.equal(f.requests.length,1);assert.equal(f.events.find(e=>e.type==='limit').kind,'cost_limit')
 const cost=f.events.filter(e=>e.type==='usage').at(-1).usage.cost;assert.equal(cost.requests,1);assert.equal(cost.uncertainRequests,0);assert.ok(cost.spentUpperBoundYuan<.001);assert.equal(cost.reservedYuan,0)
})

test('automatic compaction reserves and settles its own provider request or stops before transmission', {skip:!available},async t=>{
 for(const maxCostYuan of [.001,5]){
  const f=await fixture(t,[{text:'Compact checkpoint with only the user goal.'},{text:'Resumed local task.'}],{history:true,maxCostYuan}),done=await f.done
  if(maxCostYuan===.001){assert.equal(done.code,1,done.stderr);assert.equal(f.requests.length,0);const limit=f.events.find(e=>e.type==='limit');assert.equal(limit.kind,'cost_limit');assert.equal(limit.phase,'compaction')}
  else {assert.equal(done.code,0,done.stderr+JSON.stringify(f.events.filter(e=>e.type==='error')));assert.equal(f.requests.length,2);assert.equal(f.events.filter(e=>e.type==='usage').at(-1).usage.cost.requests,2);assert.ok(f.events.some(e=>e.type==='model_request'&&e.phase==='compaction'))}
 }
})

test('zero or interrupted provider usage retains an unknown request reservation', {skip:!available},async t=>{
 const zero=await fixture(t,[{text:'no provider usage available',usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}],{maxCostYuan:2}),done=await zero.done
 assert.equal(done.code,0,done.stderr);const cost=zero.events.filter(e=>e.type==='usage').at(-1).usage.cost;assert.equal(cost.uncertainRequests,1);assert.ok(cost.spentUpperBoundYuan>.3)
 const held=await fixture(t,[{hold:true}],{maxCostYuan:2});for(let i=0;i<300&&!held.requests.length;i++)await pause(10)
 assert.equal(held.requests.length,1);held.child.stdin.write(JSON.stringify({type:'cancel'})+'\n');const stopped=await held.done;assert.equal(stopped.code,130,stopped.stderr)
 assert.ok(held.events.filter(e=>e.type==='usage').at(-1).usage.cost.accountedUpperBoundYuan>.3);assert.equal(held.events.some(e=>e.type==='result'),false)
})

test('a guarded painted turn refuses nested paid routes while owned local references remain usable', {skip:!available},async t=>{
 const responses=[
  {name:'run_with_api',args:{command:'must not dispatch'}},
  {name:'workbench',args:{action:'blueprintStart',args:[{input:'must not dispatch'}]}},
  {name:'workbench',args:{action:'motionPrepare',args:[{}]}},
  {name:'workbench',args:{action:'lemoRun',args:['other-project',{operation:'render'}]}},
  {name:'workbench',args:{action:'lemoRun',args:['workspace',{operation:'voice',provider:'edge'}]}},
  {name:'start_preview',args:{command:'server',port:9999,use_api:true}},
  {name:'workbench',args:{action:'lemoInfo',args:[]}},
  {text:'仅本地资料已读取'},
 ]
 const dispatched=[];const f=await fixture(t,responses,{mode:'assistant',workerMode:'video-authoring',maxCostYuan:2,hostRequest:event=>{dispatched.push(event);return{ready:true}}}),done=await f.done
 assert.equal(done.code,0,done.stderr);assert.equal(dispatched.length,1);assert.equal(dispatched[0].kind,'workbench');assert.equal(dispatched[0].action,'lemoInfo');assert.equal(f.events.filter(e=>e.type==='tool_result'&&e.isError).length,6)
})

test('a sole final video handoff can finish at its exact money ceiling without another provider request', {skip:!available},async t=>{
 const accepted={accepted:true,projectId:'lemo:fixture',lemoId:'fixture',runId:'fixture-run',summary:'交给本地制作'}
 const probe=await fixture(t,[{name:'finish_video',args:{summary:'已完成'}}],{mode:'assistant',workerMode:'video-authoring',maxCostYuan:5,hostRequest:()=>accepted});assert.equal((await probe.done).code,0)
 const quote=piRequestCostQuote(probe.requests[0],'deepseek-v4-pro'),maxCostYuan=quote.reservedMicroYuan/1e6
 const f=await fixture(t,[{name:'finish_video',args:{summary:'已完成'},usage:{prompt_tokens:quote.inputTokenUpperBound,completion_tokens:quote.outputTokenUpperBound,total_tokens:quote.inputTokenUpperBound+quote.outputTokenUpperBound}}],{mode:'assistant',workerMode:'video-authoring',maxCostYuan,hostRequest:()=>accepted}),done=await f.done
 assert.equal(done.code,0,done.stderr+JSON.stringify(f.events.filter(e=>e.type==='error')));assert.equal(f.requests.length,1);assert.equal(f.events.some(e=>e.type==='limit'),false);assert.equal(f.events.find(e=>e.type==='result').usage.cost.remainingYuan,0)
})

test('guarded Flash video authoring disables thinking in real SDK writes and handoff while ordinary chat keeps it enabled', {skip:!available},async t=>{
 const accepted={accepted:true,projectId:'lemo:fixture',lemoId:'fixture',runId:'fixture-run',summary:'交给本地制作'}
 const f=await fixture(t,[{name:'write',args:{path:'scene.html',content:'<!doctype html><title>Local video fixture</title>'}},{name:'finish_video',args:{summary:'源码已写入'}}],{model:'deepseek-flash',mode:'assistant',workerMode:'video-authoring',maxCostYuan:2,hostRequest:()=>accepted}),done=await f.done
 assert.equal(done.code,0,done.stderr+JSON.stringify(f.events.filter(e=>e.type==='error')));assert.equal(f.requests.length,2)
 assert.match(readFileSync(join(f.workspace,'scene.html'),'utf8'),/Local video fixture/)
 for(const request of f.requests){assert.deepEqual(request.thinking,{type:'disabled'});assert.equal(request.reasoning_effort,undefined)}
 assert.equal(f.events.find(e=>e.type==='engine').thinkingLevel,'off');assert.equal(f.events.filter(e=>e.type==='result').length,1)
 const ordinary=await fixture(t,[{text:'普通聊天'}],{model:'deepseek-flash',mode:'assistant',maxCostYuan:2});assert.equal((await ordinary.done).code,0)
 assert.deepEqual(ordinary.requests[0].thinking,{type:'enabled'});assert.notEqual(ordinary.events.find(e=>e.type==='engine').thinkingLevel,'off')
})

test('guarded video compaction also disables thinking when resuming older history', {skip:!available},async t=>{
 const f=await fixture(t,[{text:'Compressed local history.'},{text:'Resumed.'}],{model:'deepseek-flash',history:true,mode:'assistant',workerMode:'video-authoring',maxCostYuan:2}),done=await f.done
 assert.equal(done.code,0,done.stderr+JSON.stringify(f.events.filter(e=>e.type==='error')));assert.equal(f.requests.length,2)
 assert.ok(f.events.some(e=>e.type==='model_request'&&e.phase==='compaction'))
 for(const request of f.requests){assert.deepEqual(request.thinking,{type:'disabled'});assert.equal(request.reasoning_effort,undefined)}
 assert.equal(f.events.filter(e=>e.type==='usage').at(-1).usage.cost.requests,2)
})

test('guarded video requests may deliver 20k tokens but still respect remaining output and monetary preflight while ordinary chat stays at 10k', {skip:!available},async t=>{
 const accepted={accepted:true,projectId:'lemo:fixture',lemoId:'fixture',runId:'fixture-run',summary:'交给本地制作'}
 const f=await fixture(t,[{name:'write',args:{path:'bounded.txt',content:'fixture'},usage:{prompt_tokens:20,completion_tokens:20000,total_tokens:20020}},{name:'finish_video',args:{summary:'源码已保存'}}],{model:'deepseek-flash',mode:'assistant',workerMode:'video-authoring',maxCostYuan:2,maxOutputTokens:32000,hostRequest:()=>accepted}),done=await f.done
 assert.equal(done.code,0,done.stderr+JSON.stringify(f.events.filter(e=>e.type==='error')));assert.equal(f.requests.length,2)
 assert.equal(f.requests[0].max_tokens,20000);assert.equal(f.requests[1].max_tokens,12000)
 for(const request of f.requests){assert.deepEqual(request.thinking,{type:'disabled'});assert.ok(piRequestCostQuote(request,'deepseek-flash').reservedMicroYuan<2000000)}
 assert.equal(f.events.filter(e=>e.type==='usage').at(-1).usage.cost.requests,2)
 const blocked=await fixture(t,[{text:'must not transmit'}],{model:'deepseek-flash',mode:'assistant',workerMode:'video-authoring',maxCostYuan:.001}),stopped=await blocked.done
 assert.equal(stopped.code,1);assert.equal(blocked.requests.length,0);assert.equal(blocked.events.find(e=>e.type==='limit').kind,'cost_limit')
 for(const options of [{},{maxCostYuan:2}]){
  const ordinary=await fixture(t,[{text:'ordinary chat'}],{model:'deepseek-flash',mode:'assistant',...options});assert.equal((await ordinary.done).code,0);assert.equal(ordinary.requests[0].max_tokens,10000)
 }
})

test('guarded video sends three compressed real JPEGs within its money reservation while ordinary chat retains larger image inputs', {skip:!available},async t=>{
 const pixels=Buffer.alloc(1920*1080*3);let seed=123456789
 for(let i=0;i<pixels.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[i]=seed>>>24}
 const original=await sharp(pixels,{raw:{width:1920,height:1080,channels:3}}).jpeg({quality:95}).toBuffer()
 assert.ok(original.length>60000)
 const prepareWorkspace=workspace=>{for(let i=0;i<3;i++)writeFileSync(join(workspace,`frame-${i}.jpg`),original)}
 const accepted={accepted:true,projectId:'lemo:fixture',lemoId:'fixture',runId:'fixture-run',summary:'核对后提交'}
 const f=await fixture(t,[{tools:[0,1,2].map(i=>({name:'read',args:{path:`frame-${i}.jpg`}}))},{name:'finish_video',args:{summary:'已查看三帧'}}],{model:'deepseek-flash',mode:'assistant',workerMode:'video-authoring',maxCostYuan:2,prepareWorkspace,hostRequest:()=>accepted}),done=await f.done
 assert.equal(done.code,0,done.stderr+JSON.stringify(f.events.filter(e=>e.type==='error')));assert.equal(f.requests.length,2)
 const images=[...JSON.stringify(f.requests[1].messages).matchAll(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/g)].map(match=>match[1])
 assert.equal(images.length,3)
 for(const data of images){assert.ok(data.length<=60000,`encoded image ${data.length} bytes`);const dimensions=await sharp(Buffer.from(data,'base64')).metadata();assert.ok(dimensions.width<=960);assert.ok(dimensions.height<=540)}
 assert.ok(piRequestCostQuote(f.requests[1],'deepseek-flash').reservedMicroYuan<=2000000)
 for(const request of f.requests)assert.deepEqual(request.thinking,{type:'disabled'})
 assert.equal(f.events.some(e=>e.type==='limit'),false);assert.equal(f.events.filter(e=>e.type==='usage').at(-1).usage.cost.requests,2)
 for(let i=0;i<3;i++)assert.deepEqual(readFileSync(join(f.workspace,`frame-${i}.jpg`)),original)
 const ordinary=await fixture(t,[{name:'read',args:{path:'frame-0.jpg'}},{text:'保留普通聊天图片配置'}],{model:'deepseek-flash',mode:'assistant',prepareWorkspace}),normalDone=await ordinary.done
 assert.equal(normalDone.code,0,normalDone.stderr)
 const normal=[...JSON.stringify(ordinary.requests[1].messages).matchAll(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/g)].map(match=>match[1]);assert.equal(normal.length,1);assert.ok(normal[0].length>60000);assert.ok(normal[0].length<=2000000)
 const dimensions=await sharp(Buffer.from(normal[0],'base64')).metadata();assert.ok(dimensions.width>960);assert.ok(dimensions.width<=2000)
})
