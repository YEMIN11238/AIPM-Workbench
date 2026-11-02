/** The six-stage UI keeps a real chat and complete source library discoverable. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountStarter } from './starter-view.mjs'
import { starterCopy as c } from './starter-copy.mjs'

test('chat executes only on send, displays streamed results, original manuals and human review', async () => {
 const dom=new JSDOM('<div id="app"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document
 const p={id:'p',name:'会议助手',phase:0,status:'idle',messages:[],history:[],samples:[],ratings:{},files:[],preview:[],completed:false},calls=[];let update
 const api=async(name,...args)=>{calls.push([name,...args]);if(name==='starterList')return[p];if(name==='starterSources')return[];if(name==='starterGet')return p;if(name==='starterSend'){const next={...p,messages:[{role:'user',content:args[1]},{role:'assistant',content:'已生成 **PRD 草稿**，请确认'}]};update(next);return next}if(name==='starterLibrary')return[{name:'docs/手册/上线部署手册.md'}];if(name==='starterReadLibrary')return{name:args[0],content:'# 完整上线手册\n\n部署与收尾'};if(name==='starterReview')return{hash:'hash',report:{summary:'等待人工核对'}}}
 const container=document.querySelector('#app'),view=mountStarter({container,api,onUpdate:cb=>{update=cb;return()=>{}}});const button=label=>[...container.querySelectorAll('button')].find(b=>b.textContent===label);const settle=()=>new Promise(r=>setTimeout(r,20))
 try{await view.show();assert.match(container.textContent,/后端 MVP/);assert.match(container.textContent,/上线部署/);assert.equal(calls.some(([name])=>name==='starterSend'),false)
 const input=container.querySelector('.stk-composer textarea');input.value='帮我体检需求';input.dispatchEvent(new dom.window.Event('input'));container.querySelector('.stk-composer').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();assert.match(container.textContent,/PRD 草稿/);assert.equal(container.querySelector('.stk-composer textarea'),input)
 button(c.library).click();await settle();button('docs/手册/上线部署手册.md').click();await settle();assert.match(container.textContent,/部署与收尾/)
 button(c.review).click();await settle();assert.equal(container.querySelectorAll('.stk-check input').length,5);assert.equal(calls.some(([name])=>name==='starterAdvance'),false)
 }finally{view.destroy();dom.window.close();delete globalThis.window;delete globalThis.document}
})

test('a development pause preserves the phase, ratings and unsent draft, and resumes only with the existing stage action', async () => {
 const dom=new JSDOM('<div id="app"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document
 let p={id:'p',name:'会议助手',phase:2,status:'idle',messages:[{id:'u1',role:'user',content:'开发会议助手'},{id:'a1',role:'assistant',content:'已保存后端代码，测试尚未完成。'}],history:[{phase:0},{phase:1}],samples:[{id:'s1',input:'虚构会议记录',output:'待办结果'}],rubric:['任务覆盖'],ratings:{s1:{scores:{任务覆盖:2},unacceptable:false}},decisions:[{question:'输出方式',answer:'待确认',status:'pending'}],report:{summary:'后端仍待测试',unresolved:['需完成真实测试'],nextStep:'完成当前阶段'},files:[],preview:[],completed:false},update
 const calls=[],toasts=[],api=async(name,...args)=>{calls.push([name,...args]);if(name==='starterList')return[p];if(name==='starterSources')return[];if(name==='starterGet')return p;if(name==='starterSend'){p={...p,status:'running',pause:null,messages:[...p.messages,{id:'u2',role:'user',content:args[1]},{id:'a2',role:'assistant',content:''}]};update(p);return p}}
 const container=document.querySelector('#app'),view=mountStarter({container,api,onUpdate:cb=>{update=cb;return()=>{}},toast:text=>toasts.push(text)}),button=label=>[...container.querySelectorAll('button')].find(b=>b.textContent===label),settle=()=>new Promise(r=>setTimeout(r,20))
 try{
  await view.show();const input=container.querySelector('.stk-composer textarea');input.value='先等一下，我要补充需求';input.dispatchEvent(new dom.window.Event('input'));input.setSelectionRange(5,5)
  p={...p,status:'paused',error:null,pause:{reason:'本轮达到连续执行上限。',kind:'call_limit',usage:{calls:120,output_tokens:20000,input_tokens:800000},limits:{maxCalls:120,maxOutputTokens:120000}}};update(p);await settle()
  assert.match(container.querySelector('.stk-stage-banner').textContent,/2\. 后端 MVP已暂停，可继续/);assert.equal(container.querySelector('.stk-pause').getAttribute('role'),'status');assert.match(container.querySelector('.stk-pause').textContent,/不是 API 余额提示/);assert.match(container.querySelector('.stk-pause').textContent,/120 次 \/ 上限 120 次/);assert.equal(container.querySelectorAll('.bp-error').length,0)
  assert.equal(container.querySelector('.stk-composer textarea'),input);assert.equal(input.value,'先等一下，我要补充需求');assert.equal(input.selectionStart,5);assert.equal(container.querySelector('[aria-label="任务覆盖评分"]').value,'2');assert.equal(p.phase,2);assert.equal(p.decisions[0].status,'pending');assert.equal(p.history.length,2)
  assert.equal([...container.querySelectorAll('button')].filter(b=>b.textContent===c.next).length,1);assert.equal(calls.some(([name])=>['starterSend','starterReply','starterRate','starterAdvance'].includes(name)),false)
  button(c.next).click();await settle();assert.equal(input.value,'先等一下，我要补充需求');assert.equal(input.selectionStart,5);assert.match(toasts.at(-1),/未发送的内容，已保留/);assert.equal(calls.some(([name])=>name==='starterSend'),false)
  input.value='';input.dispatchEvent(new dom.window.Event('input'));button(c.next).click();await settle();const sent=calls.find(([name])=>name==='starterSend');assert.equal(sent[1],'p');assert.match(sent[2],/从上次暂停处继续/);assert.equal(p.phase,2);assert.equal(calls.some(([name])=>['starterReply','starterRate','starterAdvance'].includes(name)),false)
 }finally{view.destroy();dom.window.close();delete globalThis.window;delete globalThis.document}
})
