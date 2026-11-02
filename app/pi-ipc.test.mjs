/** The native gateway must expose real full manuals without allowing model-side human acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerPi } from './pi-ipc.mjs'

test('three original manuals read through the actual gateway and human acceptance remains separate', {skip:process.platform!=='darwin'}, async t=>{
 const directory=fileURLToPath(new URL('.',import.meta.url)),workspace=mkdtempSync(join(tmpdir(),'aipm-pi-gateway-')),handlers=new Map();let research=null,studio=null
 const host=registerPi({directory,workspace,handle:(name,action)=>handlers.set(name,action),moduleActions:handlers,getApi:()=>({model:'deepseek-v4-pro',apiKey:'not-used'}),getResearch:()=>research,getStudio:()=>studio,starter:{capturePage:()=>{},service:{list:()=>[]}},products:{list:()=>[]},blueprint:{list:()=>[]},geo:{list:()=>[]},store:{list:async()=>[]},publish:()=>{}})
 t.after(async()=>{await host.close();rmSync(workspace,{recursive:true,force:true})})
 const manifest=JSON.parse(readFileSync(join(directory,'integrations/product-manuals/2026-10-21/SOURCE.json'),'utf8'))
 for(const name of Object.keys(manifest.files)){
  const actual=handlers.get('piManualRead')(name)
  assert.equal(actual.content,readFileSync(join(directory,'integrations/product-manuals/2026-10-21',name),'utf8'))
  assert.equal(actual.name,name)
 }
 assert.throws(()=>handlers.get('piManualRead')('../credential.bin'),/手册名称/)
 await assert.rejects(async()=>host.service.submitVideo('chat-fixture',{runId:'run-fixture'}),/尚未就绪/)
 studio={submitForChat:async(chatId,args)=>({chatId,...args}),list:()=>[]}
 assert.deepEqual(await host.service.submitVideo('chat-fixture',{runId:'run-fixture',summary:'提交源码'}),{chatId:'chat-fixture',runId:'run-fixture',summary:'提交源码'});studio=null
 const catalog=await handlers.get('piCatalog')();assert.equal(catalog.capabilities.filter(c=>c.id==='starter').length,1)
 const status=handlers.get('piStatus')();assert.equal(status.execution.deadlineMs,null);assert.equal(status.execution.maxCalls,120)
 assert.ok(host.service.skillPaths.some(path=>path.endsWith('motion-design-prompt-generator')))
 const motion=handlers.get('motionSkillInfo')();assert.equal(motion.designSystems.length,7)
 assert.match(handlers.get('motionSkillRead')('SKILL.md').content,/Stage 5/)
 const prepared=handlers.get('motionPrepare')({title:'未发送的动效',brief:'以动态字体介绍工作台',duration:10,designSystem:'swiss-kinetic'})
 assert.equal(host.service.get(prepared.chatId).cwd,prepared.cwd);assert.equal(host.service.get(prepared.chatId).messages.length,0);assert.equal(host.service.get(prepared.chatId).runs.length,0)
 await assert.rejects(host.service.moduleCall('motionPrepare',[{brief:'模型不得自行建立额外聊天'}]),/人工确认/)
 await assert.rejects(host.service.moduleCall('starterAdvance',['x']),/人工确认/)
 await assert.rejects(host.service.moduleCall('confirm',['x']),/人工确认/)
 handlers.set('companySearch',(id,query)=>({id,query}));assert.deepEqual(await host.service.moduleCall('companySearch',['company-fixture','公开资料']),{id:'company-fixture',query:'公开资料'})
 handlers.set('companyGet',()=>({id:'company-fixture',subject:'示例',chat:{messages:[{content:'nested history must stay out'}],runs:[{tools:[{result:{large:true}}]}]},sources:[],materials:[],versions:[]}));const modelProject=await host.service.moduleCall('companyGet',['company-fixture']);assert.equal(modelProject.subject,'示例');assert.equal(JSON.stringify(modelProject).includes('nested history'),false);assert.equal(modelProject.chat,undefined)
 handlers.set('companyExport',()=>{throw new Error('must not be model accessible')});await assert.rejects(host.service.moduleCall('companyExport',['company-fixture']),/人工确认/)
 let networkAborted=false;research={projectIdForChat:id=>id==='research-chat'?'research-project':null,cancel:async id=>{assert.equal(id,'research-project');networkAborted=true;return{chat:{id:'research-chat',status:'cancelled'}}}}
 assert.deepEqual(await handlers.get('piCancel')('research-chat'),{id:'research-chat',status:'cancelled'});assert.equal(networkAborted,true)
})
