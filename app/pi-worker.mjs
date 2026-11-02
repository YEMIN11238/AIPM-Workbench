/** Isolated Pi SDK host. The desktop owns credentials, approvals, native tools and module APIs. */
import { join, resolve, basename } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { runLocalCommand } from './local-command.mjs'
import { createPiToolGate, validateDecisions, validateStageReport } from './pi-runtime-policy.mjs'
import { resolveExecutionLimits, executionPause } from './pi-execution-limits.mjs'
import { modelCapabilities } from './model-api.mjs'
import { createPiCostGuard } from './pi-cost-guard.mjs'

const wire=process.stdout, pending=new Map();let buffer='',config,resolveConfig,session,stopping=false,writeQueue=Promise.resolve(),failure
const ready=new Promise(r=>{resolveConfig=r})
const clean=value=>{let text=String(value);for(const secret of [config?.api?.apiKey,...Object.values(config?.cloudCredentials||{})])if(secret)text=text.split(secret).join('[已隐藏]');return text}
const emit=(type,data={})=>{const line=clean(JSON.stringify({type,...data}))+'\n';writeQueue=writeQueue.then(()=>new Promise((resolve,reject)=>wire.write(line,error=>error?reject(error):resolve())));return writeQueue}
async function finish(code){await writeQueue.catch(()=>{});process.exit(code)}
process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;if(buffer.length>5000000){failure||='Pi输入记录过大';void stop();return}let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;try{const m=JSON.parse(line);if(!config){config=m;resolveConfig(m)}else if(m.type==='cancel'){void stop()}else if(pending.has(m.token)){const p=pending.get(m.token);pending.delete(m.token);m.error?p.reject(new Error(m.error)):p.resolve(m.result)}}catch(error){emit('error',{message:'Pi通信记录无效'});void stop()}}})
process.stdin.on('end',()=>void stop());console.log=(...args)=>process.stderr.write(clean(args.join(' '))+'\n')
function ask(kind,data={}){if(stopping)return Promise.reject(new Error('已停止'));const token=randomUUID();return new Promise((resolve,reject)=>{pending.set(token,{resolve,reject});emit('request',{token,kind,...data})})}
async function stop(){if(stopping)return;stopping=true;for(const p of pending.values())p.reject(new Error('已停止'));pending.clear();try{await session?.abort();session?.dispose()}finally{await finish(130)}}
process.on('SIGTERM',()=>void stop())
const S={type:'string'},B={type:'boolean'},I={type:'integer'}
const supportsVision=()=>modelCapabilities(config?.api?.model).vision
const result=(value,allowImage=false)=>{
 let metadata=value,image
 if(allowImage&&value?.image){const{image:attachment,...rest}=value;metadata=rest;if(supportsVision()){if(!['image/png','image/jpeg','image/webp'].includes(attachment.mimeType)||typeof attachment.data!=='string'||attachment.data.length>2800000||!attachment.data.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(attachment.data))throw new Error('截图附件无效，图像尚未送入模型');image={type:'image',data:attachment.data,mimeType:attachment.mimeType}}}
 return{content:[{type:'text',text:clean(typeof metadata==='string'?metadata:JSON.stringify(metadata))},...(image?[image]:[])],details:{}}
}
const definition=(name,description,properties,required,execute)=>({name,label:name,description,parameters:{type:'object',properties,required},execute:async(_id,args,signal)=>{if(signal?.aborted)throw new Error('操作已停止');return result(await execute(args,signal),['computer','capture_preview'].includes(name))}})
function requestPayload(payload){
 if(!supportsVision()&&Array.isArray(payload?.messages))return{...payload,messages:payload.messages.map(message=>Array.isArray(message.content)?{...message,content:message.content.filter(part=>!['image','image_url','input_image'].includes(part.type)).concat(message.content.some(part=>['image','image_url','input_image'].includes(part.type))?[{type:'text',text:'当前Pro不接收图片，历史图像本轮未发送'}]:[])}:message)}
 return payload
}
function tracePayload(payload){return JSON.parse(JSON.stringify(payload,(key,value)=>typeof value==='string'&&value.startsWith('data:image/')?'[图像请求已记录于工具结果和Pi会话；sha256='+createHash('sha256').update(value).digest('hex')+']':value))}
function traceToolResult(value){
 const image=value?.structuredContent
 if(image?.type==='image'&&typeof image.data==='string')return{...value,structuredContent:{type:'image-reference',mimeType:image.mimeType,sha256:createHash('sha256').update(image.data).digest('hex'),source:'content中的image块；不重复记录同一base64'}}
 return value
}
function within(path){const target=resolve(config.workspace,path||'.');return target===config.workspace||target.startsWith(config.workspace+'/')}

async function main(){
 await ready
 const sdk=await import(pathToFileURL(join(config.piPackage,'dist/index.js')).href)
 if(!config.api?.apiKey||typeof config.workspace!=='string'||!config.sessionDir||!config.prompt)throw new Error('Pi启动配置无效')
 const runtimeDir=join(config.sessionDir,'runtime');mkdirSync(runtimeDir,{recursive:true,mode:0o700})
 const runtime=await sdk.ModelRuntime.create({authPath:join(runtimeDir,'auth.json'),modelsPath:null,modelsStorePath:join(runtimeDir,'models.json'),refreshOnCreate:false})
 if(config.api.baseUrl)runtime.registerProvider('deepseek',{baseUrl:config.api.baseUrl})
 await runtime.setRuntimeApiKey('deepseek',config.api.apiKey)
 const registeredModel=runtime.getModel('deepseek',config.api.model);if(!registeredModel)throw new Error('Pi未提供工作台统一配置的模型：'+config.api.model)
 if(supportsVision()&&!registeredModel.input.includes('image'))throw new Error('当前Pi运行环境未声明此模型的图像能力，尚未发送图片或模型请求')
 const limits=resolveExecutionLimits(config),budgetedVideo=limits.maxCostYuan!==undefined&&config.workerMode==='video-authoring'
 const requestOutputLimit=Math.min(registeredModel.maxTokens,budgetedVideo?20000:10000)
 const imageResize=budgetedVideo?{maxWidth:960,maxHeight:540,maxBytes:60000,jpegQuality:70}:{maxWidth:2000,maxHeight:2000,maxBytes:2000000,jpegQuality:80}
 const model={...registeredModel,contextWindow:Math.min(registeredModel.contextWindow,limits.contextWindowTokens),maxTokens:requestOutputLimit,...(supportsVision()?{inputLimits:{...registeredModel.inputLimits,images:{...registeredModel.inputLimits?.images,resize:imageResize}}}:{})}
 const costGuard=limits.maxCostYuan===undefined?null:createPiCostGuard({model:config.api.model,maxCostYuan:limits.maxCostYuan})
 const tools=[];let calls=0,usage={calls:0,input_tokens:0,output_tokens:0},pause,videoSubmission,videoHandedOff=false,handoffAbort
 const exhausted=()=>Boolean(pause||executionPause(usage,limits))
 const attachCost=()=>{if(costGuard){usage.cost=costGuard.snapshot();usage.cost_upper_yuan=usage.cost.accountedUpperBoundYuan}}
 const addUsage=(value,completed=true)=>{if(costGuard)costGuard.settle(value,{completed});usage={calls,input_tokens:usage.input_tokens+(value?.input||0)+(value?.cacheRead||0)+(value?.cacheWrite||0),output_tokens:usage.output_tokens+(value?.output||0)};attachCost();emit('usage',{usage})}
 const pauseExecution=()=>{const reached=pause||executionPause(usage,limits);if(!reached)return;if(!pause){pause=reached;failure||=pause.reason;emit('limit',{...pause,usage,limits})}void session.abort()}
 const starter=config.mode==='starter'
 const localBudgetActions=new Set(['capabilities','lemoInfo','lemoStyles','lemoRead','lemoGet','lemoList','lemoRun','lemoJob','lemoOutput','lemoCancel','motionSkillInfo','motionSkillRead','videoStudioGet','videoStudioRead','videoStudioOutput'])
 if(config.workerMode==='video-authoring'&&!starter)tools.push({name:'finish_video',label:'提交影片制作',description:'影片源码和声音已写好后，提交当前工程给工作台检查与本地渲染。成功提交会结束本轮模型写稿，不再反复打磨或清理临时文件；这不代表成片已经通过检查。',executionMode:'sequential',parameters:{type:'object',properties:{summary:{type:'string',maxLength:2000,description:'简述本轮已完成的影片内容与声音'}},required:[]},execute:async(_id,args,signal)=>{
  if(stopping||signal?.aborted)throw new Error('操作已停止')
  const submitted=await ask('video_submit',{summary:args.summary||''})
  if(stopping||signal?.aborted)throw new Error('操作已停止')
  if(!submitted||submitted.accepted!==true||typeof submitted.runId!=='string'||typeof submitted.projectId!=='string'||typeof submitted.lemoId!=='string'||typeof submitted.summary!=='string')throw new Error('影片提交未被工作台接受，请修复工程后再提交')
  videoSubmission=submitted
  return{...result(submitted),terminate:true}
 }})
 tools.push(definition('workbench','使用工作台原有功能。先用 action=capabilities 查看所有模块与参数，再调用具体 action；阶段确认和人工评分只能由用户完成。',{action:S,args:{type:'array',items:{}}},['action'],args=>{if(costGuard){
   if(!localBudgetActions.has(args.action))throw new Error('本轮设有影片制作费用预算，只调用本地影片与参考资料工具；其他可能收费的模块请在普通聊天中单独发起。')
   const ownedProject=basename(config.workspace),parameters=args.args||[]
   if(['lemoGet','lemoRun','lemoJob','lemoOutput','lemoCancel','videoStudioGet','videoStudioRead','videoStudioOutput'].includes(args.action)&&parameters[0]!==ownedProject&&parameters[0]!=='lemo:'+ownedProject)throw new Error('本轮只操作当前影片工程')
   if(args.action==='lemoRead'&&parameters[0]?.projectId&&parameters[0].projectId!==ownedProject)throw new Error('本轮只读取当前影片工程与本地风格资料')
   if(args.action==='lemoRun'&&parameters[1]?.provider==='edge')throw new Error('本轮只使用本地制作工具，不发起在线Edge配音请求')
  }return ask('workbench',args)}))
 if(!starter)tools.push(definition('computer','操作本机当前应用。先apps取得bundleId，再inspect读取该应用。click/type_text/press_key/scroll/click_at/drag每次都必须填写同一app和刚inspect返回的snapshotId原文；禁止省略、编造或复用动作前的旧快照。动作后必须重新inspect，确认真实结果再继续。工具报错表示未完成，不能声称已点击或已输入。每次只操作当前快照绑定的app，不对其他应用或未观察的界面执行动作。'+(supportsVision()?'当前Flash支持图像；capture成功返回真实图像附件和OCR，只有结果实际含图片时才能声称观察画面。':'Pro通过辅助功能/OCR读界面，截图供用户核对。')+'权限需用户在工作台授权。',{action:{type:'string',enum:['status','apps','launch','inspect','click','type_text','press_key','scroll','capture','click_at','drag'],description:'apps查bundleId，inspect取得当前界面及snapshotId；六种变更动作必须带最新snapshotId。'},app:{type:'string',description:'目标应用bundleId。变更动作必须与最近inspect快照绑定的app一致，只操作该应用。'},snapshotId:{type:'string',minLength:1,description:'click/type_text/press_key/scroll/click_at/drag必填。将刚刚inspect返回的snapshotId字符串原样填写，动作后重新inspect；缺少或过期即未执行。'},element:{type:'integer',description:'inspect返回的当前快照元素编号；必须与snapshotId属于同一次inspect。'},text:S,key:S,amount:I,x:{type:'number'},y:{type:'number'},toX:{type:'number'},toY:{type:'number'}},['action'],args=>{if(['click','type_text','press_key','scroll','click_at','drag'].includes(args.action)&&(!args.app||typeof args.snapshotId!=='string'||!args.snapshotId.trim()))throw new Error('电脑动作未执行：请先inspect目标app，再将返回的snapshotId原样传入本次动作，并填写相同app。');return ask('computer',args)}))
 tools.push(definition('run_with_api','运行当前产品真实模型测试，通过私有环境复用工作台API，不要打印环境或密钥。使用timeout秒，不能启动后台服务。',{command:S,cwd:S,timeout:{type:'number'}},['command'],args=>{if(costGuard)throw new Error('本轮设有影片制作费用预算，不通过额外API命令绕过预算；请使用当前模型完成写稿。');return ask('run_api',args)}))
 tools.push(definition('start_preview','启动工作台管理的本地预览服务。只能回环地址，不能在bash里用&后台启动。',{command:S,cwd:S,port:I,use_api:B},['command','port'],args=>{if(costGuard&&args.use_api)throw new Error('本轮设有费用预算，不向预览进程提供额外模型连接');return ask('preview',args)}))
 tools.push(definition('capture_preview',supportsVision()?'记录实际本地预览截图和页面文字；成功时向模型附上真实图片，最终效果仍由用户核对。':'记录实际本地预览截图和页面文字，视觉效果由用户核对。',{url:S,mobile:B},['url'],args=>ask('capture',args)))
 if(starter){
  tools.push(definition('record_decisions','记录决策，最多10项。默认建议不等于用户已确认。未来事项可deferred并给revisitPhase=2或4。自动同步项目状态，不能直接修改该文件。',{items:{type:'array',maxItems:10,items:{type:'object',properties:{question:S,answer:S,status:{type:'string',enum:['pending','confirmed','default','deferred']},revisitPhase:I},required:['question','answer','status']}}},['items'],args=>{validateDecisions(args.items);emit('decisions',args);return'已自动同步docs/项目状态.md'}))
  tools.push(definition('record_rubric','按产品类型设1至5个评分维度，真人每项1至3分并标不能接受。已有评分后不可擅改。',{dimensions:{type:'array',minItems:1,maxItems:5,items:S}},['dimensions'],args=>ask('rubric',args)))
  tools.push(definition('report_stage','提交当前阶段建议报告、是否表和当前必须解决的问题；不会自动推进。证据说明自动生成，截图必须真实捕获。',{summary:S,nextStep:S,unresolved:{type:'array',items:S},checks:{type:'array',minItems:1,items:{type:'object',properties:{item:S,status:{type:'string',enum:['yes','no','na','pending']},evidence:S},required:['item','status','evidence']}}},['summary','nextStep','unresolved','checks'],args=>{validateStageReport(args);emit('report',{report:args});return'阶段报告已保存；等待人工核对'}))
  tools.push(definition('model_samples','用统一API实际生成1至10条样例，不能伪造真人评分，不能代替产品端到端测试。',{system:S,prompts:{type:'array',minItems:1,maxItems:10,items:S}},['system','prompts'],async args=>{ if(costGuard)throw new Error('本轮设有费用预算，不启动额外样例模型请求'); const remainingCalls=Math.max(0,limits.maxCalls-calls-1);if(args.prompts.length>remainingCalls)throw new Error('样例调用超过本轮剩余执行次数，请减少数量或下一轮继续'); const r=await ask('samples',{...args,remainingCalls}); calls+=r.usage.calls; usage.calls=calls;usage.input_tokens+=r.usage.input_tokens;usage.output_tokens+=r.usage.output_tokens;emit('usage',{usage});if(r.error)throw new Error(r.error);return r.samples }))
  tools.push(definition('extract_document','提取已导入的PDF/Word/文本PRD。',{path:S},['path'],args=>ask('extract',args)))
 }
 const gate=(pi)=>{
  pi.on('tool_call',createPiToolGate({config,ask,isStopping:()=>stopping,exhausted}))
  pi.on('tool_result',e=>({content:JSON.parse(clean(JSON.stringify(supportsVision()?e.content:e.content.filter(block=>block.type!=='image')))),...(e.structuredContent===undefined?{}:{structuredContent:JSON.parse(clean(JSON.stringify(!supportsVision()&&e.structuredContent?.type==='image'?'当前Pro不接收图像，图片未发送':e.structuredContent)))})}))
  pi.on('before_provider_request',e=>{
   // The effective payload is recorded after Pi's prompt/tool transitions. Headers are excluded.
   const payload=requestPayload(e.payload)
   if(payload&&typeof payload==='object'&&!Array.isArray(payload))payload.max_tokens=Math.min(Number(payload.max_tokens)||requestOutputLimit,requestOutputLimit,Math.max(1,limits.maxOutputTokens-usage.output_tokens))
   if(!costGuard)emit('model_request',{model:config.api.model,payload:tracePayload(payload)})
   return payload
  })
 }
 tools.push(sdk.createBashToolDefinition(config.workspace,{exposeSessionEnvironment:false,operations:{exec:async(command,cwd,options)=>{
  const record=await runLocalCommand({command,cwd,workspace:config.workspace,timeout:options.timeout||180,signal:options.signal,restrictWrites:starter,onChild:pid=>emit('child',{pid})})
  emit('command',record);options.onData(Buffer.from(record.output));if(record.aborted)throw new Error('aborted');if(record.timedOut)throw new Error('timeout:'+String(options.timeout||180));return{exitCode:record.exitCode}
 }}}))
 const settings=sdk.SettingsManager.inMemory({defaultProvider:'deepseek',defaultModel:config.api.model,...(costGuard?{cacheWarming:'off'}:{}),retry:{enabled:false},compaction:{enabled:true,reserveTokens:Math.min(16384,Math.floor(model.contextWindow/4)),keepRecentTokens:Math.min(16000,Math.floor(model.contextWindow/3))}})
 const loader=new sdk.DefaultResourceLoader({cwd:config.workspace,agentDir:runtimeDir,settingsManager:settings,noExtensions:true,noThemes:true,noPromptTemplates:true,additionalSkillPaths:config.skillPaths||[],extensionFactories:[gate],systemPrompt:config.system,appendSystemPrompt:[],agentsFilesOverride:()=>({agentsFiles:config.contextFiles||[]})})
 await loader.reload()
 const sessionFile=join(config.sessionDir,'current.json'),saved=existsSync(sessionFile)?JSON.parse(readFileSync(sessionFile,'utf8')):null
 const manager=saved?.path&&existsSync(saved.path)?sdk.SessionManager.open(saved.path,config.sessionDir,config.workspace):sdk.SessionManager.create(config.workspace,config.sessionDir)
 // Bound creative output to delivered code, rather than spending its output allowance on reasoning.
 const thinkingLevel=budgetedVideo?'off':'medium'
 const created=await sdk.createAgentSession({cwd:config.workspace,agentDir:runtimeDir,modelRuntime:runtime,model,thinkingLevel,settingsManager:settings,resourceLoader:loader,sessionManager:manager,customTools:tools,tools:['read','bash','edit','write','grep','find','ls',...tools.map(t=>t.name)]})
 session=created.session
 // Pi summaries call this stream directly, outside regular request hooks and message events.
 const stream=session.agent.streamFunction
 session.agent.streamFunction=(requestModel,context,options={})=>{
  if(exhausted()){pauseExecution();throw new Error(failure)}
  const compact=options.sessionId!==manager.getSessionId()
  if(costGuard)return stream(requestModel,context,{...options,maxTokens:Math.min(options.maxTokens||requestOutputLimit,requestOutputLimit,Math.max(1,limits.maxOutputTokens-usage.output_tokens)),onPayload:async raw=>{
   const transformed=typeof options.onPayload==='function'?await options.onPayload(raw):raw,payload=requestPayload(transformed??raw)
   if(payload&&typeof payload==='object'&&!Array.isArray(payload))payload.max_tokens=Math.min(Number(payload.max_tokens)||requestOutputLimit,requestOutputLimit,Math.max(1,limits.maxOutputTokens-usage.output_tokens))
   try{costGuard.reserve(payload)}catch(error){if(error.kind==='cost_limit'){attachCost();pause={kind:'cost_limit',reason:error.message};failure||=pause.reason;emit('limit',{...pause,usage,limits,requiredUpperBoundYuan:error.requiredUpperBoundYuan,...(compact?{phase:'compaction'}:{})});void session.abort()}throw error}
   calls++;usage.calls=calls;attachCost();emit('usage',{usage});emit('model_request',{model:config.api.model,...(compact?{phase:'compaction'}:{}),payload:tracePayload(payload)});return payload
  }})
  calls++;usage.calls=calls;emit('usage',{usage})
  if(!compact)return stream(requestModel,context,options)
  return stream(requestModel,context,{...options,maxTokens:Math.min(options.maxTokens||requestOutputLimit,requestOutputLimit,Math.max(1,limits.maxOutputTokens-usage.output_tokens)),onPayload:raw=>{const payload=requestPayload(raw);emit('model_request',{model:config.api.model,phase:'compaction',payload:tracePayload(payload)});return payload}})
 }
 writeFileSync(sessionFile,JSON.stringify({path:manager.getSessionFile()}),{mode:0o600})
 let lastAssistantStop
 session.subscribe(e=>{
  if(e.type==='message_update'&&e.assistantMessageEvent.type==='text_delta'&&!starter)emit('delta',{text:e.assistantMessageEvent.delta})
  if(e.type==='message_end'&&e.message.role==='assistant'){
   lastAssistantStop=e.message.stopReason
   addUsage(e.message.usage,!['error','aborted'].includes(e.message.stopReason))
   const text=e.message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');if(starter&&text)emit('text',{text});if(['error','aborted'].includes(e.message.stopReason)&&!(videoHandedOff&&e.message.stopReason==='aborted'&&!stopping&&!pause)){failure||=e.message.errorMessage||'Pi模型运行中断';emit('error',{message:failure})}
   // Pi can compact an overflowing context and retry after an intermediate length stop.
   // Only an unrecovered final length stop should mark the whole round as failed.
   if(e.message.stopReason==='length')emit('progress',{message:'本次回复未完整返回，正在等待 Pi 处理'})
   const toolCalls=e.message.content.filter(block=>block.type==='toolCall')
   const finalVideoHandoff=config.workerMode==='video-authoring'&&!starter&&toolCalls.length===1&&toolCalls[0].name==='finish_video'
   if(exhausted()&&toolCalls.length&&!finalVideoHandoff)pauseExecution()
  }
  if(e.type==='tool_execution_start')emit('tool',{name:e.toolName,arguments:e.args,callId:e.toolCallId})
  if(e.type==='tool_execution_end'){
   emit('tool_result',{name:e.toolName,result:traceToolResult(e.result),isError:e.isError,callId:e.toolCallId})
   if(e.toolName==='finish_video'&&!e.isError&&videoSubmission&&!stopping&&!pause){videoHandedOff=true;handoffAbort=session.abort();void handoffAbort.catch(error=>{failure||='影片提交后结束写稿失败：'+error.message})}
  }
  if(e.type==='compaction_start')emit('progress',{message:'Pi正在整理长对话上下文'})
  if(e.type==='compaction_end'){if(e.result?.usage||costGuard)addUsage(e.result?.usage,!e.aborted&&!e.errorMessage);emit('compaction',{reason:e.reason,result:e.result,error:e.errorMessage,aborted:e.aborted});if(exhausted()&&session.isStreaming)pauseExecution()}
 })
 emit('engine',{name:'Pi Agent',version:'1.3.0',model:model.id,thinkingLevel:session.thinkingLevel,vision:supportsVision(),limits,effectiveContextWindow:model.contextWindow,tools:session.getActiveToolNames(),sessionFile:manager.getSessionFile()})
 await session.prompt(config.prompt)
 if(handoffAbort)await handoffAbort
 if(stopping)throw new Error('已停止')
 if(lastAssistantStop==='length')failure||='Pi回复被截断，请继续'
 if(failure)throw new Error(failure)
 emit('result',{reply:videoHandedOff?(videoSubmission.summary||'影片源码已提交，工作台正在检查与本地制作。'):session.getLastAssistantText()||'本轮已结束，请查看执行记录。',...(videoHandedOff?{videoSubmission}:{}),usage,sessionFile:manager.getSessionFile()})
 session.dispose();await finish(0)
}
main().catch(async error=>{failure||=error.message;emit('error',{message:clean(failure)});try{await session?.abort();session?.dispose()}finally{await finish(1)}})
