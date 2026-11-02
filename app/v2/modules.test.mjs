/** Domain migration keeps saved data and complete capabilities without reviving the old app shell. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountModules } from './modules.mjs'
import { mountModelSelectors } from './model-selector.mjs'

const settle=()=>new Promise(resolve=>setTimeout(resolve,15))
function fixture(t,overrides={}){
 const dom=new JSDOM('<main id="tools"></main>');dom.window.HTMLMediaElement.prototype.pause=function(){};globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.FormData=dom.window.FormData
 const calls=[],toasts=[],listeners={};let project={id:'d1',name:'已有产品',stage:0,confirmed:[],review:true,completed:false,documents:[{name:'01-需求池.md',stage:0}],evidence:[{id:'e1',code:'E01',title:'用户访谈',content:'真实反馈',source:'用户提供',kind:'provided'}],messages:[{role:'user',stage:0,content:'原始需求'},{role:'assistant',stage:0,content:'原有回答'}]},content='# 当前需求\n\n已有正文\n',hash='h1'
 const data={motionProjects:()=>[],boot:()=>({projects:[project],model:'deepseek-v4-pro'}),project:()=>project,readDocument:()=>({content,hash}),listVersions:()=>[{id:'v1',createdAt:'2026-10-20T00:00:00.000Z'}],readVersion:()=>({id:'v1',createdAt:'2026-10-20T00:00:00.000Z',content:'# 历史正文\n'}),saveDocument:(_id,input)=>{assert.equal(input.hash,hash);content=input.content+'\n';hash='h2';return project},confirm:()=>{project={...project,stage:1,confirmed:[0],review:false};return project},copyText:()=>{},openFolder:()=>{},blueprintChatContexts:()=>[{scope:{kind:'task',id:'t1'},title:'原有酒水助手'}],blueprintChatGet:()=>({messages:[{role:'user',content:'旧版需求'},{role:'assistant',content:'旧版方案解释',demo:true}],context:{summary:'原有资料完整保留'}}),blueprintLibrary:()=>[{name:'使用引导.md'},{name:'s17_goal_loop/README.md'}],blueprintProductStatus:()=>({revision:'test-revision'}),blueprintProducts:()=>[{id:'b1',name:'原有Blueprint产品',version:2}],blueprintProductJobs:()=>[],blueprintProductGet:()=>({id:'b1',name:'原有Blueprint产品',version:2,files:[{name:'PRD.md'}]}),blueprintProductRead:()=>({name:'PRD.md',content:'# 已有PRD',hash:'bp-hash'}),blueprintLibraryRead:(_name)=>({name:_name,content:'# 原版使用引导\n所有组件均保留。'}),starterList:()=>[{id:'s1',name:'先前开发项目'},{id:'s2',name:'所选开发项目'}],starterSources:()=>[],starterGet:id=>({id,name:id==='s2'?'所选开发项目':'先前开发项目',phase:0,status:'idle',messages:[],history:[],samples:[],ratings:{},files:[],preview:[]}),geoList:()=>[{id:'g1',name:'已有GEO客户',status:'draft'}],geoStatus:()=>({configured:true}),geoGet:()=>({id:'g1',profile:{brand:'已有GEO客户'},keywords:[],variants:{},article:null,reviewed:false,status:'draft',usage:{calls:0,inputTokens:0,outputTokens:0}}),blueprintStatus:()=>({available:true,configured:true,model:'deepseek-v4-pro'}),blueprintList:()=>[{id:'t1',title:'原有方案',mode:'plan',status:'completed',reports:[{name:'方案.md'}]}],blueprintGet:()=>({id:'t1',title:'原有方案',mode:'plan',status:'completed',reports:[{name:'方案.md'}]}),blueprintReadReport:()=>({name:'方案.md',content:'# 已保存方案'}),piStatus:()=>({manuals:[{name:'1.通用技术栈手册.md'},{name:'2.前端手册.md'},{name:'3.上线部署手册.md'}]}),piManualRead:name=>({name,content:'# 用户提供的完整手册'}),...overrides}
 const api=async(name,...args)=>{calls.push([name,...args]);if(!data[name])throw new Error('Unexpected API '+name);return data[name](...args)}
 const events=new Proxy({},{get:(_target,name)=>callback=>{listeners[name]=callback;return()=>delete listeners[name]}})
 const view=mountModules({lemoFactory:null,container:document.querySelector('#tools'),api,events,toast:m=>toasts.push(m),discuss:text=>calls.push(['discuss',text]),openChat:(id,draft)=>calls.push(['openChat',id,draft])})
 const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label)
 t.after(()=>{view.destroy();dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.FormData})
 return{dom,view,calls,toasts,listeners,button,api}
}

test('all migrated tools open their saved data without starting model jobs; full component library and old discussions remain reachable',async t=>{
 const {view,calls,button}=fixture(t)
 await view.open({kind:'blueprint',id:'b1'});assert.match(document.body.textContent,/原有Blueprint产品/);assert.match(document.body.textContent,/已有PRD/)
 await view.open({kind:'blueprint',mode:'library'});assert.match(document.body.textContent,/s17_goal_loop/);assert.match(document.body.textContent,/运行离线题库/);assert.match(document.body.textContent,/导出/)
 await view.open({kind:'blueprint',mode:'archive'});button('原有酒水助手').click();await settle();assert.match(document.body.textContent,/旧版需求/);assert.match(document.body.textContent,/旧版方案解释/)
 await view.open({kind:'starter',id:'s2'});assert.match(document.body.textContent,/所选开发项目/);assert.equal(calls.filter(([name])=>name==='starterGet').at(-1)[1],'s2')
 button('三份手册 · 同一个开发流程').click();await settle();assert.match(document.body.textContent,/一项完整开发功能/);button('3.上线部署手册.md').click();await settle();assert.match(document.body.textContent,/用户提供的完整手册/)
 await view.open({kind:'geo',id:'g1'});await settle();assert.match(document.body.textContent,/已有GEO客户/)
 assert.equal(calls.some(([name])=>['blueprintStart','blueprintProductStart','geoGenerate','starterSend','send'].includes(name)),false)
})

test('document draft blocks navigation, versions load as drafts and stage progression requires explicit human check',async t=>{
 const {view,button,calls,toasts,dom}=fixture(t)
 await view.open({kind:'discovery',id:'d1'});assert.match(document.body.textContent,/已有正文/)
 button('编辑源码').click();const editor=document.querySelector('[aria-label="阶段文档源码"]');editor.value='# 新需求';editor.dispatchEvent(new dom.window.Event('input'))
 assert.equal(view.canLeave(),false);assert.equal(await view.open({kind:'geo'}),false);assert.match(toasts.at(-1),/未保存/);assert.equal(editor.value,'# 新需求')
 button('检查并保存').click();button('确认保存这个版本').click();await settle();assert.deepEqual(calls.find(([name])=>name==='saveDocument').slice(1),['d1',{content:'# 新需求',hash:'h1',stage:0}]);assert.equal(view.canLeave(),true)
 button('版本历史').click();await settle();[...document.querySelectorAll('.v2-module-auxiliary button')].find(n=>n.textContent.includes('2026')).click();await settle();button('载入历史版本为草稿').click();assert.equal(document.querySelector('[aria-label="阶段文档源码"]').value,'# 历史正文\n');assert.equal(view.canLeave(),false)
 button('放弃草稿').click();await settle();const check=document.querySelector('[aria-label="我已核对当前阶段文档与证据"]');check.checked=true;button('确认并进入下一阶段').click();await settle();assert.match(document.body.textContent,/竞品分析 · 进行中/);assert.equal(calls.filter(([name])=>name==='confirm').length,1)
})

test('a delayed document response cannot replace a newly typed draft',async t=>{
 let resolveRead,count=0
 const {view,button,dom}=fixture(t,{readDocument:()=>{count++;if(count===1)return{content:'# 原文',hash:'h1'};return new Promise(resolve=>{resolveRead=resolve})}})
 await view.open({kind:'discovery',id:'d1'});button('编辑源码').click();button('01-需求池.md').click();await Promise.resolve();const area=document.querySelector('[aria-label="阶段文档源码"]');area.value='# 尚未保存的新输入';area.dispatchEvent(new dom.window.Event('input'));resolveRead({content:'# 迟到的正文',hash:'h0'});await settle();assert.equal(area.value,'# 尚未保存的新输入');assert.equal(view.canLeave(),false)
})

test('task progress preserves plan form drafts, saved report reading is safe, and starting is explicit',async t=>{
 const {view,button,listeners,dom,calls}=fixture(t)
 await view.open({kind:'task',id:'t1'});const input=document.querySelector('[aria-label="产品想法与已有需求"]');input.value='尚未提交的想法';input.dispatchEvent(new dom.window.Event('input'))
 listeners.onBlueprintUpdate({id:'t1',title:'原有方案',status:'completed',stage:'审稿',reports:[{name:'方案.md'}]});assert.equal(document.querySelector('[aria-label="产品想法与已有需求"]'),input);assert.equal(input.value,'尚未提交的想法')
 button('方案.md').click();await settle();assert.match(document.body.textContent,/已保存方案/);assert.equal(calls.some(([name])=>name==='blueprintStart'),false)
})

test('the unified video workspace opens original projects and protects inline chat drafts without starting work',async t=>{
 const saved={id:'quick:video1',source:'quick',title:'已有AIPM介绍视频',brief:'介绍真实产品界面',duration:10,width:1920,height:1080,status:'idle',chat:{status:'idle',messages:[],runs:[]},messages:[],storyboard:null,versions:[],assets:[],output:{files:[]}}
 const {view,calls,button,dom,toasts}=fixture(t,{videoStudioList:()=>[saved],videoStudioGet:()=>saved})
 await view.open({kind:'video',id:'quick:video1'});assert.match(document.body.textContent,/已有AIPM介绍视频/)
 assert.equal(button('用 Pi 继续讨论'),undefined);assert.ok(document.querySelector('video[controls]'));assert.equal(calls.some(([name])=>name==='videoStudioSend'),false)
 const input=document.querySelector('textarea[aria-label="视频制作对话"]');input.value='尚未发送的修改';input.dispatchEvent(new dom.window.Event('input'))
 assert.equal(view.canLeave(),false);assert.equal(await view.open({kind:'geo'}),false);assert.match(toasts.at(-1),/未发送或未保存/);assert.equal(input.value,'尚未发送的修改')
})

test('saved Motion history continues in the same video conversation instead of opening a second plugin or main chat',async t=>{
 const saved={id:'motion:old',source:'motion',legacy:true,title:'原有动效工程',duration:10,width:1920,height:1080,status:'idle',chat:{status:'idle',messages:[],runs:[]},messages:[{role:'assistant',content:'原有工程说明与成片记录'}],assets:[],versions:[],output:{files:[]}}
 const {view,calls,dom}=fixture(t,{videoStudioList:()=>[saved],videoStudioGet:()=>saved,videoStudioSend:(_id,text)=>({...saved,messages:[...saved.messages,{role:'user',content:text}]})})
 await view.open({kind:'video',id:'motion:old'});assert.match(document.body.textContent,/原有工程说明与成片记录/);assert.equal(document.querySelectorAll('.vs-hub-tab,.lemo-studio').length,0)
 const input=document.querySelector('textarea[aria-label="视频制作对话"]');input.value='解释一下这支视频';input.dispatchEvent(new dom.window.Event('input'));document.querySelector('.sv-composer').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle()
 assert.deepEqual(calls.find(([name])=>name==='videoStudioSend'),['videoStudioSend','motion:old','解释一下这支视频']);assert.equal(calls.some(([name])=>name==='openChat'),false)
})

test('preserved product, development, GEO, task and stage composers receive the same live global model menu',async t=>{
 let model='deepseek-v4-pro';const choices=[{id:'deepseek-v4-pro',label:'Pro'},{id:'deepseek-flash',label:'Flash（V4.1）'}]
 const f=fixture(t,{modelStatus:()=>({schema:1,model,choices}),modelSelect:value=>({schema:1,model:model=value,choices})})
 const menus=mountModelSelectors({container:document.querySelector('#tools'),api:f.api});t.after(()=>menus.destroy());await menus.ready
 for(const[selection,target]of[[{kind:'discovery',id:'d1'},'[data-model-composer]'],[{kind:'blueprint',id:'b1'},'.bpf-create'],[{kind:'starter',id:'s2'},'.stk-composer'],[{kind:'geo',id:'g1'},'.geo-body+span'],[{kind:'task'},'.v2-task-form']]){
  await f.view.open(selection);await settle();const picker=document.querySelector(target+' select[aria-label="模型选择"]');assert.ok(picker,selection.kind);assert.equal(picker.value,model)
  picker.value='deepseek-flash';picker.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));await settle();assert.equal(model,'deepseek-flash')
  assert.equal(document.querySelector('.v2-document-editor .v2-model-picker,.bpf-reader .v2-model-picker'),null)
 }
 assert.equal(f.calls.some(([name])=>['piSend','send','starterSend','blueprintStart','blueprintProductStart','geoGenerate'].includes(name)),false)
})
