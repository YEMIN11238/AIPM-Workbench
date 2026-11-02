/** Unified conversations keep old files and only publish checked local production. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,symlinkSync,existsSync,utimesSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {LemoService} from './lemo-service.mjs'
import {VideoStudioService} from './video-studio-service.mjs'
const APP=dirname(fileURLToPath(import.meta.url))
const audioRuntime={ffmpeg:join(APP,'lemo-engine/bin/ffmpeg'),ffprobe:join(APP,'lemo-engine/bin/ffprobe')}
function tone(root){const path=join(root,'fixture-song.wav');execFileSync(audioRuntime.ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=330:duration=4','-c:a','pcm_s16le',path]);return path}
function fixture(t,options={}){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'video-studio-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const calls=[],updates=[],quick=new Map(),chats=new Map()
 const lemo=new LemoService({root:join(root,'lemo'),sourceRoot:join(APP,'integrations/lemo-opuscar-upstream'),runtimeRoot:join(APP,'lemo-engine')})
 lemo.output=id=>({files:[],diagnostics:[]})
 const video={root:join(root,'quick'),active:new Map(),list:()=>[...quick.values()].map(p=>({...p})),get:id=>{if(!quick.has(id))throw Error('不存在');return structuredClone(quick.get(id))},folder:id=>join(root,'quick',id),motionProjects:()=>[],addAssets(id,files){quick.get(id).assets.push(...files.map(f=>({...f,id:randomUUID()})));return this.get(id)},saveStoryboard(id,{storyboard}){quick.get(id).storyboard=structuredClone(storyboard)},send(){throw Error('旧收费生成不应被调用')},async cancel(id){calls.push(['quickCancel',id]);return this.get(id)}}
 mkdirSync(video.root)
 const pi={active:null,create({title,cwd}){const id=randomUUID(),chat={id,title,cwd,status:'idle',messages:[],runs:[],pending:null,model:'deepseek-flash'};chats.set(id,chat);calls.push(['create',id]);return structuredClone(chat)},get(id){if(!chats.has(id))throw Error('对话不存在');return structuredClone(chats.get(id))},send(id,text){if(this.active)throw Error('当前任务正在执行');const c=chats.get(id);c.messages.push({id:randomUUID(),role:'user',content:text,time:new Date().toISOString()},{id:randomUUID(),role:'assistant',content:'正在创作',time:new Date().toISOString()});c.runs.push({id:randomUUID(),startedAt:new Date().toISOString()});c.status='running';this.active={id};calls.push(['send',id,text]);return this.get(id)},reply(id,token,approved){calls.push(['reply',id,token,approved]);chats.get(id).pending=null;return this.get(id)},async cancel(id){calls.push(['piCancel',id]);chats.get(id).status='cancelled';this.active=null;return this.get(id)}}
 let beforeCounter=0,resultStatus='completed',deferred
 const production={capture(id){calls.push(['capture',id]);return{projectId:id,fingerprint:'before-'+(++beforeCounter),capturedAt:new Date().toISOString(),initialSources:{}}},async produce({projectId,before,signal}){calls.push(['produce',projectId,before?.fingerprint]);if(deferred)await deferred;const id=randomUUID(),folder=join(lemo.folder(projectId),'.video-studio-production',id);mkdirSync(folder,{recursive:true});const path=join(folder,'影片.mp4');writeFileSync(path,'real-fixture-owned-media');return{projectId,productionId:id,finishedAt:new Date().toISOString(),status:signal.aborted?'cancelled':resultStatus,message:resultStatus==='completed'?'已完成本地检查':'需要继续修改声音',steps:[],checks:{media:{passed:true}},...(resultStatus==='completed'?{output:{path,ownerProjectId:projectId,productionId:id,width:1920,height:1080,duration:10,fps:30,audio:true}}:{})}},async cancel(id){calls.push(['productionCancel',id])}}
 const studio=new VideoStudioService({root:join(root,'links'),lemoService:lemo,videoService:video,piService:pi,production,onUpdate:p=>updates.push(p),...options})
 function old(){const id=randomUUID(),folder=join(video.root,id);mkdirSync(folder);mkdirSync(join(folder,'assets'));const image=join(folder,'assets','screen.png');writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1cAAAAASUVORK5CYII=','base64'));const movie=join(folder,'old.mp4');writeFileSync(movie,'old-registered-movie');const p={schema:1,id,title:'已有工作台介绍',brief:'保留页面截图',duration:10,width:1920,height:1080,fps:30,style:'glass',projectDir:folder,status:'completed',assets:[{id:'screen',name:'页面.png',path:image}],storyboard:{title:'原分镜',scenes:[{id:'one',title:'已存在的文字'}]},messages:[{role:'user',content:'原来的用户要求',createdAt:'2026-10-20T00:00:00Z'},{role:'assistant',content:'原分镜解释',createdAt:'2026-10-20T00:00:01Z'}],versions:[{version:'v1',videoPath:movie,duration:10,width:1920,height:1080,fps:30,createdAt:'2026-10-20T00:00:02Z'}],budget:{trial:{spentUpperBoundYuan:.894735}}};quick.set(id,p);return p}
 async function finish(project,status='idle'){const c=chats.get(project.chatId);c.status=status;c.runs.at(-1).finishedAt=new Date().toISOString();c.runs.at(-1).exitCode=status==='idle'?0:1;c.runs.at(-1).status=status;c.error=status==='failed'?'失败':null;pi.active=null;studio.onPiUpdate(structuredClone(c));await Promise.all([...studio.tasks]);return studio.get(project.id)}
 return{root,lemo,video,pi,production,studio,calls,updates,quick,chats,old,finish,setResult:v=>resultStatus=v,setDeferred:v=>deferred=v}
}

test('new project prepares one unsent conversation and keeps complete methods as on-demand references',async t=>{
 const f=fixture(t),p=await f.studio.create({brief:'用黑色大字和米白底制作工作台介绍',title:'介绍'})
 assert.match(p.id,/^lemo:/);assert.equal(p.sourceId,p.id.slice(5));assert.equal(p.style,'swiss-motion');assert.equal(p.status,'idle');assert.equal(f.calls.filter(c=>c[0]==='send').length,0)
 const context=f.studio.contextForChat(f.pi.get(p.chatId));assert.ok(context.files.some(x=>x.content.includes('motion-design-prompt-generator/SKILL.md')));assert.ok(context.files.some(x=>x.content.includes('skills/lemo-opuscar/SKILL.md')));assert.ok(context.files.reduce((sum,x)=>sum+x.content.length,0)<5000);assert.match(context.system,/不因Motion.*自动改框架/);assert.match(context.system,/production.json/)
 assert.equal(f.studio.list().length,1);assert.equal(f.studio.folder(p.id),p.cwd)
 await f.studio.close();await f.lemo.close()
})

function paintedResult(options){
 const {cwd}=options,folder=join(cwd,'painted');mkdirSync(join(folder,'src/scenes'),{recursive:true});writeFileSync(join(folder,'ANIMATION_GUIDE.md'),'Full upstream guide');writeFileSync(join(folder,'src/scenes/film.js'),'(()=>{shots([[0,t=>paint(ellPts(20,20,10,10),{fill:"#405060"})]])})();')
 return{...options,engine:'painted-animation',scenePath:join(folder,'src/scenes/film.js'),configPath:join(folder,'src/config.js'),guidePath:join(folder,'ANIMATION_GUIDE.md'),markerPath:join(cwd,'.painted-animation.json'),initialSources:{'painted/src/scenes/film.js':'initial-hash'},runtime:{ready:true,source:{repository:'https://github.com/tuzhechen2005/opus-video-skills',commit:'59744a69c7b916cfbe4c4ec84006b0c2f5e2fde1'},versions:{p5:'2.3.3',brush:'2.2.3'}}}
}

test('painted creation prepares the complete owned engine and reopens the same conversation and video history',async t=>{
 const prepared=[],f=fixture(t,{preparePaintedProject:async options=>{prepared.push(options);return paintedResult(options)}}),p=await f.studio.create({title:'原声水彩MV',brief:'按既有分镜制作',visualEngine:'painted-animation',duration:27})
 assert.equal(prepared.length,1);assert.equal(prepared[0].cwd,p.cwd);assert.equal(prepared[0].replaceStarter,true);assert.equal(prepared[0].duration,27);assert.equal(p.visualEngine,'painted-animation');assert.equal(p.animationMethod.ready,true);assert.equal(p.animationMethod.name,'水彩角色动画');assert.equal(p.billing.executionBudgetYuan,2);assert.equal(p.style,'watercolor');assert.equal(f.studio.list()[0].visualEngine,'painted-animation');assert.equal(f.calls.some(row=>row[0]==='send'),false)
 const reopened=new VideoStudioService({root:join(f.root,'links'),lemoService:f.lemo,videoService:f.video,piService:f.pi,production:f.production,preparePaintedProject:()=>{throw Error('should not reprepare on read')}})
 assert.equal(reopened.get(p.id).chatId,p.chatId);assert.equal(reopened.get(p.id).animationMethod.source.commit,p.animationMethod.source.commit);assert.deepEqual(reopened.get(p.id).versions,p.versions);await reopened.close();await f.studio.close();await f.lemo.close()
})

test('new briefs can select painted automatically while explicit legacy and existing projects keep their drawing engine',async t=>{
 const prepared=[],f=fixture(t,{preparePaintedProject:async options=>{prepared.push(options);return paintedResult(options)}})
 const automatic=await f.studio.create({brief:'水彩插画形式，抒情感觉',visualEngine:'auto'});assert.equal(automatic.visualEngine,'painted-animation')
 const explicit=await f.studio.create({brief:'watercolor mood',style:'painted-animation'});assert.equal(explicit.visualEngine,'painted-animation')
 const legacy=await f.studio.create({brief:'水彩插画形式',visualEngine:'lemo'});assert.equal(legacy.visualEngine,'lemo');assert.equal(prepared.length,2)
 const old=f.old(),continued=await f.studio.send('quick:'+old.id,'把这个旧片改成水彩插画');assert.equal(continued.visualEngine,'lemo');assert.equal(prepared.length,2);await f.finish(continued)
 await assert.rejects(f.studio.create({visualEngine:'unknown'}),/引擎无效/);await f.studio.close();await f.lemo.close()
})

test('painted model context uses the actual p5 scene API and metered shared-model limits instead of legacy engine instructions',async t=>{
 const f=fixture(t,{preparePaintedProject:async options=>paintedResult(options)}),p=await f.studio.create({brief:'水彩插画的雨街',duration:3,width:320,height:180,fps:10})
 const storyboard={title:'雨街三秒',style:'抒情水彩',scenes:[{id:'rain',title:'雨滴',duration:3,prompt:'墨线雨滴在伞沿聚集'}]};f.studio.saveStoryboard(p.id,{storyboard});await f.studio.send(p.id,'按分镜完成创作',{intent:'create'})
 const context=f.studio.contextForChat(f.pi.get(p.chatId));assert.equal(context.workerMode,'video-authoring');assert.deepEqual(context.executionLimits,{maxCalls:40,maxOutputTokens:60000,contextWindowTokens:96000,maxCostYuan:2});assert.match(context.system,/p5\.js \+ p5\.brush/);assert.match(context.system,/paint\(\)\/inkLine\(\)/);assert.match(context.system,/painted\/src\/scenes\/film\.js/);assert.match(context.system,/雨街三秒/);assert.match(context.system,/finish_video/);assert.match(context.system,/不能把这次制作统称为0元/);assert.doesNotMatch(context.system,/采用Lemo Canvas\/Three\.js引擎/)
 assert.ok(context.files[0].content.includes('painted-animation-upstream/SKILL.md'));assert.ok(context.files[0].content.includes('painted/ANIMATION_GUIDE.md'));assert.ok(context.files[0].content.length<5000);await f.finish(p);assert.equal(f.studio.contextForChat(f.pi.get(p.chatId)).workerMode,undefined);await f.studio.close();await f.lemo.close()
})

test('painted runtime failures stay visible and cannot silently send a legacy generator request',async t=>{
 let ready=false;const f=fixture(t,{preparePaintedProject:async options=>{if(!ready)throw Error('缺少本地笔刷');return paintedResult(options)}})
 await assert.rejects(f.studio.create({brief:'水彩插画'}),/缺少本地笔刷/);const p=f.studio.list()[0];assert.equal(p.visualEngine,'painted-animation');assert.equal(p.status,'needs_work');assert.match(f.studio.get(p.id).error,/缺少本地笔刷/)
 await assert.rejects(f.studio.send(p.id,'生成这个视频',{intent:'create'}),/缺少本地笔刷/);assert.equal(f.calls.some(row=>row[0]==='send'),false)
 ready=true;await f.studio.send(p.id,'生成这个视频',{intent:'create'});assert.equal(f.studio.get(p.id).animationMethod.ready,true);await f.finish(p);await f.studio.close();await f.lemo.close()
})

test('closing during painted preparation retains files and never starts a late paid model request',async t=>{
 let release;const f=fixture(t,{preparePaintedProject:options=>new Promise(resolve=>{release=()=>resolve(paintedResult(options))})}),creating=f.studio.create({brief:'水彩插画'})
 await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');let ended=false;const closing=f.studio.close().then(()=>{ended=true});await Promise.resolve();assert.equal(ended,false);release();await assert.rejects(creating,/已关闭/);await closing;assert.equal(f.calls.some(row=>row[0]==='send'),false);const p=f.studio.list()[0];assert.ok(existsSync(join(f.studio.folder(p.id),'painted/src/scenes/film.js')));assert.match(f.studio.get(p.id).error,/已关闭/);await f.lemo.close()
})

test('imported song ranges are local, require explicit duration resize and stay bound to their original audio', {skip:!existsSync(audioRuntime.ffmpeg)}, async t=>{
 const f=fixture(t),p=await f.studio.create({title:'原声MV',brief:'按歌曲创作',duration:2,width:320,height:180,fps:10}),path=tone(f.root)
 let q=await f.studio.importAudio(p.id,{path,name:'原歌.wav'});assert.equal(q.audio.source.duration,4);assert.equal(q.audio.selection,null);assert.equal(q.status,'needs_work');assert.equal(f.calls.some(c=>c[0]==='send'),false)
 await assert.rejects(f.studio.send(p.id,'制作影片',{intent:'create'}),/选择.*音频片段/);assert.equal(f.calls.some(c=>c[0]==='send'),false)
 await assert.rejects(f.studio.selectAudio(p.id,{start:.5,end:3.5}),/明确勾选/);assert.equal(f.studio.get(p.id).duration,2)
 q=await f.studio.selectAudio(p.id,{start:.5,end:3.5,resizeVideo:true});assert.equal(q.duration,3);assert.equal(f.lemo.get(p.sourceId).duration,3);assert.equal(q.audio.selection.duration,3)
 const manifest=JSON.parse(readFileSync(join(p.cwd,'.video-audio.json'))),plan=JSON.parse(readFileSync(join(p.cwd,'production.json')))
 assert.equal(manifest.source.sha256,q.audio.source.sha256);assert.equal(plan.audio, q.audio.selection.path.slice(p.cwd.length+1));assert.ok(existsSync(path));assert.equal(f.studio.audioFile(p.id).duration,3);assert.equal(f.studio.audioFile(p.id,{source:true}).duration,4)
 assert.match(f.studio.contextForChat(f.pi.get(p.chatId)).system,/必须使用所选原声/);assert.equal(f.calls.some(c=>c[0]==='send'),false)
 writeFileSync(q.audio.selection.path,'changed');assert.throws(()=>f.studio.audioFile(p.id),/片段已变化/)
 await f.studio.close();await f.lemo.close()
})

test('Lemo storyboard prompts save as one continuous timeline and survive reopen without changing old versions', async t=>{
 const f=fixture(t),p=await f.studio.create({title:'分镜MV',brief:'有连续镜头',duration:3,width:320,height:180,fps:10}),storyboard={title:'高潮分镜',style:'水彩手绘',summary:'雨街到天空',scenes:[{id:'rain',title:'雨滴',duration:1,prompt:'水彩纸纹，雨滴落在窗上',transition:'雨滴扩为圆形倒影'},{id:'street',title:'雨街',start:1,duration:2,prompt:'倒影中出现街道，伞随旋律打开'}]}
 const q=f.studio.saveStoryboard(p.id,{storyboard});assert.equal(q.storyboard.scenes[1].start,1);assert.equal(q.storyboard.scenes[1].prompt,storyboard.scenes[1].prompt);assert.deepEqual(q.versions,p.versions)
 const original=readFileSync(join(p.cwd,'storyboard.json'),'utf8');assert.match(original,/水彩纸纹/);assert.match(f.studio.contextForChat(f.pi.get(p.chatId)).system,/高潮分镜/)
 assert.throws(()=>f.studio.saveStoryboard(p.id,{storyboard:{...storyboard,scenes:[{id:'bad',duration:2,prompt:'不够时长'}]}}),/总时长/);assert.equal(readFileSync(join(p.cwd,'storyboard.json'),'utf8'),original)
 assert.throws(()=>f.studio.saveStoryboard(p.id,{storyboard:{...storyboard,scenes:[{id:'bad',start:1,duration:3,prompt:'时间有空洞'}]}}),/时间线须连续/)
 const reopened=new VideoStudioService({root:join(f.root,'links'),lemoService:f.lemo,videoService:f.video,piService:f.pi,production:f.production});assert.equal(reopened.get(p.id).storyboard.scenes.length,2);await reopened.close();await f.studio.close();await f.lemo.close()
})

test('cancelling audio processing waits for the owned child and retains the former clip and duration', {skip:!existsSync(audioRuntime.ffmpeg)}, async t=>{
 const f=fixture(t),p=await f.studio.create({title:'停止音频',duration:2,width:320,height:180,fps:10}),path=tone(f.root)
 await f.studio.importAudio(p.id,{path});const first=await f.studio.selectAudio(p.id,{start:0,end:2}),marker=join(f.root,'audio-child.json'),fake=join(f.root,'ffmpeg')
 writeFileSync(fake,'#!'+process.execPath+'\n'+`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`,{mode:0o755})
 const info=f.lemo.info.bind(f.lemo);f.lemo.info=()=>{const value=info();return{...value,runtime:{...value.runtime,ffmpeg:fake}}}
 const operation=f.studio.selectAudio(p.id,{start:.5,end:3.5,resizeVideo:true});const rejected=assert.rejects(operation,e=>e.name==='AbortError');const until=Date.now()+4000;while(!existsSync(marker)&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.ok(existsSync(marker));assert.equal(f.studio.get(p.id).audioProcessing,true);assert.equal(f.studio.get(p.id).status,'preparing')
 await f.studio.cancel(p.id);await rejected;const child=JSON.parse(readFileSync(marker));assert.throws(()=>process.kill(child.pid,0),e=>e.code==='ESRCH');assert.equal(f.studio.get(p.id).duration,2);assert.equal(f.studio.get(p.id).audio.selection.path,first.audio.selection.path);assert.equal(f.studio.get(p.id).audioProcessing,false)
 await f.studio.close();await f.lemo.close()
})

test('old quick project upgrades on send, preserves its id, storyboard, files and history, and never calls the old generator',async t=>{
 const f=fixture(t),old=f.old(),id='quick:'+old.id,before=structuredClone(old)
 assert.equal(f.studio.get(id).chatId,undefined);assert.equal(f.studio.get(id).versions[0].version,'quick:v1')
 const p=await f.studio.send(id,'请按原分镜重做影片',{intent:'revise'})
 assert.equal(p.id,id);assert.ok(p.chatId);assert.equal(p.sourceId,old.id);assert.notEqual(p.linkedLemoId,old.id);assert.equal(p.status,'running');assert.equal(p.messages[0].content,'原来的用户要求');assert.ok(p.messages.some(m=>m.content==='请按原分镜重做影片'));assert.deepEqual(f.quick.get(old.id),before)
 const imported=p.assets[0];assert.notEqual(imported.path,old.assets[0].path);assert.deepEqual(readFileSync(imported.path),readFileSync(old.assets[0].path));const data=JSON.parse(readFileSync(join(p.cwd,'legacy-context.json')));assert.deepEqual(data.storyboard,old.storyboard);assert.equal(data.messages.length,2)
 assert.deepEqual(f.studio.list().map(x=>x.id),[id]);assert.equal(f.studio.get('lemo:'+p.linkedLemoId).id,id);assert.equal(f.studio.get({source:'quick',id:old.id}).id,id)
 const q=await f.finish(p);assert.equal(q.status,'completed');assert.equal(q.versions.length,2);assert.equal(q.output.lastVideo.source,'lemo');assert.ok(q.messages.some(m=>m.kind==='production'));assert.equal(f.calls.filter(c=>c[0]==='produce').length,1)
 f.studio.onPiUpdate(f.pi.get(p.chatId));await Promise.all([...f.studio.tasks]);assert.equal(f.calls.filter(c=>c[0]==='produce').length,1)
 await f.studio.send(id,'只解释这一版的设计',{intent:'ask'});assert.equal(f.calls.filter(c=>c[0]==='create').length,1);await f.finish(p);assert.equal(f.calls.filter(c=>c[0]==='produce').length,1)
 await f.studio.close();await f.lemo.close()
})

test('failed or informational Pi rounds do not automatically produce and failed production never replaces an older ready version',async t=>{
 const f=fixture(t),old=f.old(),id='quick:'+old.id
 let p=await f.studio.send(id,'生成新影片',{intent:'create'});await f.finish(p,'failed');assert.equal(f.calls.filter(c=>c[0]==='produce').length,0)
 p=await f.studio.send(id,'为什么这样设计？',{intent:'ask'});await f.finish(p);assert.equal(f.calls.filter(c=>c[0]==='produce').length,0)
 f.setResult('needs_sound');p=await f.studio.send(id,'修改开场',{intent:'revise'});const q=await f.finish(p);assert.equal(q.production.status,'needs_sound');assert.equal(q.output.lastVideo.version,'quick:v1');assert.equal(q.versions.length,1)
 await f.studio.close();await f.lemo.close()
})

test('bare Lemo render candidates are visible files, not quality-approved playable versions',async t=>{
 const f=fixture(t),p=await f.studio.create({title:'候选',brief:'测试'}),candidate=join(p.cwd,'candidate.mp4');writeFileSync(candidate,'fixture')
 f.lemo.output=()=>({files:[{kind:'video',path:candidate}],lastVideo:{path:candidate,width:1920,height:1080,duration:10,fps:30,audio:false}})
 const output=f.studio.output(p.id);assert.equal(output.files.length,1);assert.equal(output.lastVideo,undefined);assert.equal(output.versions.length,0)
 await f.studio.close();await f.lemo.close()
})

test('reopening persists the canonical link, full history and checked version without another prepare or paid request',async t=>{
 const f=fixture(t),old=f.old();const p=await f.studio.send('quick:'+old.id,'制作影片',{intent:'create'});await f.finish(p)
 const count=f.calls.length,reopened=new VideoStudioService({root:join(f.root,'links'),lemoService:f.lemo,videoService:f.video,piService:f.pi,production:f.production})
 const q=reopened.get(p.id);assert.equal(q.chatId,p.chatId);assert.equal(q.versions.length,2);assert.equal(q.output.lastVideo.version,q.versions.at(-1).version);assert.equal(reopened.list().length,1);assert.equal(f.calls.length,count)
 assert.equal(reopened.read(p.id,'legacy-context.json').kind,'text');assert.throws(()=>reopened.read(p.id,'../../outside.json'),/工程/)
 await reopened.close();await f.studio.close();await f.lemo.close()
})

test('double send prepares only one linked conversation and a closing capture cannot start a late model request',async t=>{
 const f=fixture(t),old=f.old();let release;f.production.capture=()=>new Promise(resolve=>{release=resolve})
 const sending=f.studio.send('quick:'+old.id,'制作影片',{intent:'create'});await new Promise(resolve=>setImmediate(resolve));await assert.rejects(f.studio.send('quick:'+old.id,'重复发送'),/执行/)
 let ended=false;const closing=f.studio.close().then(()=>{ended=true});await Promise.resolve();assert.equal(ended,false);release({fingerprint:'before'});await assert.rejects(sending,/未发送模型/);await closing;assert.equal(f.calls.filter(c=>c[0]==='send').length,0);assert.equal(f.calls.filter(c=>c[0]==='create').length,1)
 await f.lemo.close()
})

test('image imports reject linked files, retain manual storyboard editing, and route approvals to the owned chat',async t=>{
 const f=fixture(t),old=f.old(),id='quick:'+old.id;const p=await f.studio.upgrade(id)
 f.studio.saveStoryboard(id,{storyboard:{title:'保留原编辑能力',scenes:[]}});assert.equal(f.studio.get(id).storyboard.title,'保留原编辑能力');assert.equal(JSON.parse(readFileSync(join(p.cwd,'legacy-context.json'))).storyboard.title,'保留原编辑能力')
 f.studio.reply(id,'approval-token',true);assert.deepEqual(f.calls.at(-1),['reply',p.chatId,'approval-token',true])
 const fresh=await f.studio.create({title:'素材',brief:'图片'}),linked=join(f.root,'linked.png');symlinkSync(old.assets[0].path,linked);await assert.rejects(f.studio.addAssets(fresh.id,[{path:linked}]),/普通图片/)
 const foreign=join(f.root,'foreign.json');writeFileSync(foreign,'secret');symlinkSync(foreign,join(p.cwd,'linked.json'));assert.throws(()=>f.studio.read(id,'linked.json'),/工程|链接|ENOENT/)
 await f.studio.close();await f.lemo.close()
})

test('unrelated active Pi conversation is never cancelled or migrated by this studio',async t=>{
 const f=fixture(t),old=f.old(),foreign=f.pi.create({title:'其他任务',cwd:f.root});f.pi.active={id:foreign.id};await assert.rejects(f.studio.send('quick:'+old.id,'制作影片'),/当前聊天/);assert.equal(f.studio.links.size,0)
 await f.studio.cancel('quick:'+old.id);assert.equal(f.pi.active.id,foreign.id);assert.equal(f.calls.filter(c=>c[0]==='piCancel').length,0)
 await f.studio.close();assert.equal(f.pi.active.id,foreign.id);await f.lemo.close()
})

test('ordinary edit language, including a polite question, produces a revision while pure explanation stays informational',async t=>{
 const f=fixture(t),p=await f.studio.create({title:'语言意图',brief:'介绍'})
 for(const text of ['把标题改大一点','配色换米色','开头加一秒','能不能改成荧光黄？','删除最后一行字幕','缩短收尾']){await f.studio.send(p.id,text);assert.equal(f.studio.links.get(p.id).turn.intent,'revise',text);await f.finish(p)}
 const count=f.calls.filter(row=>row[0]==='produce').length
 for(const text of ['为什么选米白色？','如何修改颜色？','先不要渲染，只讨论脚本']){await f.studio.send(p.id,text);assert.equal(f.studio.links.get(p.id).turn.intent,'ask',text);await f.finish(p)}
 assert.equal(f.calls.filter(row=>row[0]==='produce').length,count)
 await f.studio.close();await f.lemo.close()
})

test('motion history keeps its existing checked output and becomes one canonical conversation when revised',async t=>{
 const f=fixture(t),id=randomUUID(),root=join(f.root,'动效工程'),cwd=join(root,id);mkdirSync(join(cwd,'out'),{recursive:true});const movie=join(cwd,'out','film.mp4');writeFileSync(movie,'motion-existing-film');writeFileSync(join(cwd,'.aipm-motion.json'),JSON.stringify({schema:1,id,title:'已有自由动效',brief:'原作品',duration:10,width:1920,height:1080,fps:30,status:'prepared',createdAt:'2026-10-20T00:00:00Z'}));writeFileSync(join(cwd,'original.tsx'),'original source kept');
 let probes=0;f.video.motionProjects=()=>[{id,title:'已有自由动效'}];f.video.motionOutput=()=>{probes++;return{projectId:id,status:'ready',videoPath:movie,duration:10,width:1920,height:1080,fps:30}};const row=f.studio.list()[0];assert.deepEqual([row.duration,row.width,row.height,row.fps],[10,1920,1080,30]);assert.equal(probes,0,'catalog must not probe media')
 const publicId='motion:'+id;assert.equal(f.studio.get(publicId).output.lastVideo.version,'motion:current');assert.equal(f.studio.get(publicId).status,'completed')
 const p=await f.studio.send(publicId,'修改开场',{intent:'revise'});assert.equal(p.id,publicId);assert.equal(f.studio.read(publicId,'original.tsx').content,'original source kept');assert.deepEqual(f.studio.list().map(x=>x.id),[publicId]);assert.equal(readFileSync(movie,'utf8'),'motion-existing-film');await f.finish(p)
 assert.equal(f.studio.get(publicId).versions.length,2);assert.equal(f.studio.get(publicId).messages.at(-1).kind,'production')
 await f.studio.close();await f.lemo.close()
})

test('a checked production file that changes or becomes a link is no longer preview-authorized',async t=>{
 const f=fixture(t),p=await f.studio.create({title:'版本归属',brief:'影片'});await f.studio.send(p.id,'制作影片',{intent:'create'});const done=await f.finish(p),path=done.output.lastVideo.videoPath;assert.equal(done.output.lastVideo.ready,true)
 writeFileSync(path,'changed media');assert.equal(f.studio.get(p.id).output.lastVideo,undefined);assert.equal(f.studio.get(p.id).versions.at(-1).ready,false)
 rmSync(path);const foreign=join(f.root,'outside.mp4');writeFileSync(foreign,'foreign');symlinkSync(foreign,path);assert.equal(f.studio.get(p.id).output.lastVideo,undefined)
 await f.studio.close();await f.lemo.close()
})

test('manual strict production is local-only and exposes checked output without another Pi request',async t=>{
 const f=fixture(t),p=await f.studio.create({title:'本地片',brief:'已经写好源码'}),sent=f.calls.filter(row=>row[0]==='send').length
 const started=await f.studio.render(p.id);assert.equal(started.status,'rendering');await Promise.all([...f.studio.tasks]);const done=f.studio.get(p.id);assert.equal(done.production.status,'completed');assert.ok(done.output.lastVideo);assert.equal(f.calls.filter(row=>row[0]==='send').length,sent);assert.equal(f.calls.filter(row=>row[0]==='capture').length,0)
 await f.studio.close();await f.lemo.close()
})

test('the old manual storyboard render stays local and returns its new version through the unified project',async t=>{
 const f=fixture(t),old=f.old(),id='quick:'+old.id
 f.video.render=sourceId=>{f.calls.push(['legacyRender',sourceId]);const p=f.quick.get(sourceId);p.status='rendering';const operation={done:Promise.resolve().then(()=>{const path=join(f.video.folder(sourceId),'new.mp4');writeFileSync(path,'new-local-render');p.versions.push({...p.versions[0],version:'v2',videoPath:path});p.status='completed';f.video.active.delete(sourceId)})};f.video.active.set(sourceId,operation);return f.video.get(sourceId)}
 const started=await f.studio.render(id,{storyboard:true});assert.equal(started.status,'rendering');await Promise.all([...f.studio.tasks]);const done=f.studio.get(id);assert.equal(done.versions.length,2);assert.equal(done.output.lastVideo.version,'quick:v2');assert.equal(f.studio.links.size,0);assert.equal(f.calls.filter(row=>row[0]==='send'||row[0]==='produce'||row[0]==='create').length,0)
 await f.studio.close();await f.lemo.close()
})

test('a stale project chat binding cannot send into a different workspace',async t=>{
 const f=fixture(t),target=f.lemo.prepare({title:'旧项目',brief:'保留'}),foreign=f.pi.create({title:'其他项目',cwd:f.root});f.lemo.setChat(target.id,foreign.id)
 await assert.rejects(f.studio.upgrade('lemo:'+target.id),/目录不一致/);assert.equal(f.calls.filter(row=>row[0]==='send').length,0);assert.equal(f.studio.links.size,0);await f.studio.close();await f.lemo.close()
})

test('a ready old video improves only the idle fallback and never masks a live chat or failed local production',async t=>{
 const f=fixture(t),old=f.old(),id='quick:'+old.id;f.quick.get(old.id).status='prepared';assert.equal(f.studio.get(id).status,'completed')
 const p=await f.studio.upgrade(id),chat=f.chats.get(p.chatId);chat.status='running';assert.equal(f.studio.get(id).status,'running');chat.status='failed';chat.error='真实错误';assert.equal(f.studio.get(id).status,'failed');chat.status='idle';chat.error=null
 const link=f.studio.links.get(id);for(const status of ['failed','needs_sound','needs_work','interrupted']){link.production={status,message:'没有完成'};assert.equal(f.studio.get(id).status,status)}
 link.production=null;f.quick.get(old.id).status='failed';assert.equal(f.studio.get(id).status,'failed');await f.studio.close();await f.lemo.close()
})


test('explicit source submission ends only the bound authored turn and lets the terminal event produce once',async t=>{
 const f=fixture(t),p=await f.studio.create({title:'提交源码',brief:'五秒水彩片',duration:5})
 assert.equal(f.studio.contextForChat(f.pi.get(p.chatId)).workerMode,undefined)
 await f.studio.send(p.id,'制作影片',{intent:'create'})
 const chat=f.chats.get(p.chatId),runId=chat.runs.at(-1).id
 f.production.capture=projectId=>({projectId,fingerprint:'authored-source',isInitial:false})
 const context=f.studio.contextForChat(f.pi.get(p.chatId));assert.equal(context.workerMode,'video-authoring');assert.match(context.system,/finish_video/);assert.match(context.system,/不要.*反复润色/)
 const accepted=await f.studio.submitForChat(p.chatId,{runId,summary:'五秒连续水彩雨景与原创配乐已写好'})
 assert.deepEqual(accepted,{accepted:true,projectId:p.id,lemoId:p.sourceId,runId,summary:'五秒连续水彩雨景与原创配乐已写好'})
 assert.equal(f.calls.filter(row=>row[0]==='produce'||row[0]==='piCancel').length,0)
 assert.deepEqual(await f.studio.submitForChat(p.chatId,{runId}),accepted)
 f.production.capture=projectId=>({projectId,fingerprint:'changed-after-handoff',isInitial:false});await assert.rejects(f.studio.submitForChat(p.chatId,{runId}),/源码已变化/);f.production.capture=projectId=>({projectId,fingerprint:'authored-source',isInitial:false})
 const persisted=JSON.parse(readFileSync(join(f.root,'links',`lemo-${p.sourceId}.json`),'utf8'));assert.equal(persisted.turn.submission.runId,runId);assert.equal(persisted.turn.submission.fingerprint,'authored-source')
 const done=await f.finish(p);assert.equal(done.status,'completed');f.studio.onPiUpdate(f.pi.get(p.chatId));await Promise.all([...f.studio.tasks]);assert.equal(f.calls.filter(row=>row[0]==='produce').length,1)
 assert.equal(f.studio.contextForChat(f.pi.get(p.chatId)).workerMode,undefined)
 await assert.rejects(f.studio.submitForChat(p.chatId,{runId}),/轮次/)
 await f.studio.close();await f.lemo.close()
})

test('submission refuses starter, unknown or stale turns, questions, approvals and foreign active conversations',async t=>{
 const f=fixture(t),p=await f.studio.create({title:'交接检查',brief:'五秒影片'})
 await assert.rejects(f.studio.submitForChat(randomUUID(),{}),/轮次/)
 await f.studio.send(p.id,'制作影片',{intent:'create'});const chat=f.chats.get(p.chatId),runId=chat.runs.at(-1).id
 f.production.capture=projectId=>({projectId,fingerprint:'starter',isInitial:true})
 await assert.rejects(f.studio.submitForChat(p.chatId,{runId}),/初始化示例/)
 await assert.rejects(f.studio.submitForChat(p.chatId,{runId:randomUUID()}),/轮次不一致/)
 await assert.rejects(f.studio.submitForChat(p.chatId,{}),/轮次不一致/)
 f.production.capture=projectId=>({projectId,fingerprint:'authored',isInitial:false})
 chat.pending={token:'manual-approval'};chat.status='waiting';await assert.rejects(f.studio.submitForChat(p.chatId,{runId}),/无需确认/);chat.pending=null;chat.status='running'
 f.pi.active={id:randomUUID()};await assert.rejects(f.studio.submitForChat(p.chatId,{runId}),/当前正在创作/);f.pi.active={id:p.chatId}
 chat.cwd=f.root;await assert.rejects(f.studio.submitForChat(p.chatId,{runId}),/目录不一致/);chat.cwd=p.cwd
 assert.equal(f.studio.links.get(p.id).turn.submission,undefined);await f.finish(p,'cancelled')
 await f.studio.send(p.id,'只解释，不要制作',{intent:'ask'});assert.equal(f.studio.contextForChat(f.pi.get(p.chatId)).workerMode,undefined);await assert.rejects(f.studio.submitForChat(p.chatId,{runId:chat.runs.at(-1).id}),/轮次/)
 await f.studio.close();await f.lemo.close()
})

test('a late source capture cannot submit after the active run changes or cancellation',async t=>{
 const f=fixture(t),p=await f.studio.create({title:'交接竞态',brief:'影片'});await f.studio.send(p.id,'制作影片',{intent:'create'});const runId=f.chats.get(p.chatId).runs.at(-1).id
 let release;f.production.capture=()=>new Promise(resolve=>{release=resolve})
 const submitting=f.studio.submitForChat(p.chatId,{runId});await Promise.resolve();await f.studio.cancel(p.id);release({projectId:p.sourceId,fingerprint:'written',isInitial:false})
 await assert.rejects(submitting,/失效/);assert.equal(f.studio.links.get(p.id).turn.submission,undefined);assert.equal(f.calls.filter(row=>row[0]==='produce').length,0)
 await f.studio.close();await f.lemo.close()
})


test('custom style remains reachable through the compact reference index without injecting its full guide',async t=>{
 const f=fixture(t),style=f.lemo.saveStyle({name:'Water Paper',content:'# My full watercolor design\nA distinct paper reference.'}),p=await f.studio.create({title:'自有风格',brief:'纸面插画',style:style.id})
 const context=f.studio.contextForChat(f.pi.get(p.chatId)),index=context.files.find(file=>file.path==='video-studio/reference-index.md')
 assert.ok(index.content.includes(join(f.lemo.customRoot,style.stylePath.slice(7))));assert.equal(index.content.includes('A distinct paper reference.'),false);assert.equal(f.lemo.read({path:style.stylePath}).text.includes('A distinct paper reference.'),true)
 await f.studio.close();await f.lemo.close()
})


test('a newer local film completes a cancelled or paused chat while later failed attempts remain current',async t=>{
 const f=fixture(t),p=await f.studio.create({title:'恢复成片',brief:'已经写好源码'})
 await f.studio.send(p.id,'制作影片',{intent:'create'});await f.finish(p,'cancelled')
 assert.equal(f.studio.get(p.id).status,'cancelled')
 await f.studio.render(p.id);await Promise.all([...f.studio.tasks]);let current=f.studio.get(p.id)
 assert.equal(current.status,'completed');assert.equal(current.recoveredChat,true);assert.equal(current.chat.status,'cancelled');assert.ok(current.output.lastVideo);assert.equal(f.studio.list().find(row=>row.id===p.id).status,'completed')
 const chat=f.chats.get(p.chatId),production=f.studio.links.get(p.id).production;production.finishedAt='2026-10-27T01:00:00.000Z';chat.runs.at(-1).finishedAt='2026-10-27T00:59:59.000Z'
 for(const status of ['paused','failed','interrupted']){chat.status=status;chat.error='旧轮次的错误';current=f.studio.get(p.id);assert.equal(current.status,'completed');assert.equal(current.error,undefined);assert.equal(current.chat.error,'旧轮次的错误')}
 await f.studio.send(p.id,'修改画面',{intent:'revise'});assert.equal(f.studio.get(p.id).status,'running');await f.finish(p,'failed');chat.runs.at(-1).finishedAt='2026-10-27T01:00:01.000Z'
 current=f.studio.get(p.id);assert.equal(current.status,'failed');assert.equal(current.error,'失败');assert.equal(current.recoveredChat,false);assert.ok(current.output.lastVideo,'previous successful video remains playable');assert.equal(f.studio.list().find(row=>row.id===p.id).status,'failed')
 chat.status='paused';assert.equal(f.studio.get(p.id).status,'paused');delete chat.runs.at(-1).finishedAt;assert.equal(f.studio.get(p.id).status,'paused','unknown finish ordering must not hide a newer pause')
 await f.studio.close();await f.lemo.close()
})


function existingCandidate(f,p,{old=false,audio=true}={}){
 const path=join(p.cwd,'already-muxed.mp4');writeFileSync(path,'owned candidate before quota pause')
 if(old)utimesSync(path,new Date('2026-01-01T00:00:00Z'),new Date('2026-01-01T00:00:00Z'))
 f.lemo.output=()=>({files:[{kind:'video',path}],lastVideo:{path,duration:p.duration,width:p.width,height:p.height,fps:p.fps,audio},diagnostics:[]})
 return path
}

test('a quota-paused authored video with a fresh existing film gets one local finish without another model request',async t=>{
 const f=fixture(t)
 for(const kind of ['call_limit','output_token_limit']){
  const p=await f.studio.create({title:'上限后的现有成片',brief:'真实影片已由本轮写好'});await f.studio.send(p.id,'制作影片',{intent:'create'});existingCandidate(f,p)
  f.studio.links.get(p.id).turn.before.capturedAt=new Date(Date.now()-1000).toISOString();f.production.capture=projectId=>({projectId,isInitial:false,fingerprint:'authored-'+projectId})
  const chat=f.chats.get(p.chatId);chat.pause={kind,reason:'执行上限'};const sent=f.calls.filter(row=>row[0]==='send').length,before=f.calls.filter(row=>row[0]==='produce').length
  let q=await f.finish(p,'paused');assert.equal(q.status,'completed');assert.equal(q.recoveredChat,true);assert.equal(q.chat.status,'paused');assert.ok(q.output.lastVideo);assert.equal(f.calls.filter(row=>row[0]==='send').length,sent);assert.equal(f.calls.filter(row=>row[0]==='produce').length,before+1)
  f.studio.onPiUpdate(f.pi.get(p.chatId));await Promise.all([...f.studio.tasks]);assert.equal(f.calls.filter(row=>row[0]==='produce').length,before+1);assert.equal(f.studio.links.get(p.id).turn.localRecovery.status,'finished')
 }
 await f.studio.close();await f.lemo.close()
})

test('quota recovery refuses missing, old, silent or starter candidates and unknown pause kinds',async t=>{
 const f=fixture(t)
 for(const variation of ['missing','old','silent','starter','unknown']){
  const p=await f.studio.create({title:variation,brief:'测试有限恢复'});await f.studio.send(p.id,'制作影片',{intent:'create'})
  f.studio.links.get(p.id).turn.before.capturedAt=new Date(Date.now()-1000).toISOString()
  if(variation==='missing')f.lemo.output=()=>({files:[],diagnostics:[]});else existingCandidate(f,p,{old:variation==='old',audio:variation!=='silent'})
  f.production.capture=projectId=>({projectId,isInitial:variation==='starter',fingerprint:'snapshot'})
  const chat=f.chats.get(p.chatId);chat.pause={kind:variation==='unknown'?'input_token_limit':'call_limit'};const before=f.calls.filter(row=>row[0]==='produce').length
  const q=await f.finish(p,'paused');assert.equal(q.status,'paused',variation);assert.equal(f.calls.filter(row=>row[0]==='produce').length,before,variation)
 }
 await f.studio.close();await f.lemo.close()
})

test('provider failures, cancellation and informational turns never automatically finish a candidate',async t=>{
 const f=fixture(t)
 for(const [status,intent] of [['failed','create'],['cancelled','create'],['paused','ask']]){
  const p=await f.studio.create({title:status+'-'+intent,brief:'已有候选'});await f.studio.send(p.id,intent==='ask'?'解释影片':'制作影片',{intent});existingCandidate(f,p)
  const link=f.studio.links.get(p.id);if(link.turn.before)link.turn.before.capturedAt=new Date(Date.now()-1000).toISOString();f.production.capture=projectId=>({projectId,isInitial:false,fingerprint:'authored'})
  f.chats.get(p.chatId).pause={kind:'call_limit'};const before=f.calls.filter(row=>row[0]==='produce').length
  const q=await f.finish(p,status);assert.equal(q.status,status);assert.equal(f.calls.filter(row=>row[0]==='produce').length,before)
 }
 await f.studio.close();await f.lemo.close()
})

test('failed local recovery shows its specific production issue and cannot hide a subsequent failed turn',async t=>{
 const f=fixture(t),p=await f.studio.create({title:'恢复失败',brief:'已有带声候选'});await f.studio.send(p.id,'制作影片',{intent:'create'});existingCandidate(f,p)
 f.studio.links.get(p.id).turn.before.capturedAt=new Date(Date.now()-1000).toISOString();f.production.capture=projectId=>({projectId,isInitial:false,fingerprint:'authored'});f.setResult('needs_sound');f.chats.get(p.chatId).pause={kind:'call_limit'}
 let q=await f.finish(p,'paused');assert.equal(q.status,'needs_sound');assert.equal(q.production.message,'需要继续修改声音');assert.equal(q.recoveredChat,true);assert.equal(q.output.lastVideo,undefined);assert.equal(existsSync(join(p.cwd,'already-muxed.mp4')),true)
 await f.studio.send(p.id,'修正音频',{intent:'revise'});q=await f.finish(p,'failed');assert.equal(q.status,'failed');assert.equal(q.error,'失败');assert.equal(q.recoveredChat,false)
 await f.studio.close();await f.lemo.close()
})


test('cancelling a late quota recovery capture stops before production and leaves no continue-quota state',async t=>{
 const f=fixture(t),p=await f.studio.create({title:'停止核对',brief:'已有影片'});await f.studio.send(p.id,'制作影片',{intent:'create'});existingCandidate(f,p)
 f.studio.links.get(p.id).turn.before.capturedAt=new Date(Date.now()-1000).toISOString();f.chats.get(p.chatId).pause={kind:'call_limit'}
 let release;f.production.capture=()=>new Promise(resolve=>{release=resolve});const finishing=f.finish(p,'paused');await Promise.resolve();assert.equal(typeof release,'function')
 await f.studio.cancel(p.id);release({projectId:p.sourceId,isInitial:false,fingerprint:'authored'})
 const q=await finishing;assert.equal(q.status,'cancelled');assert.equal(f.calls.filter(row=>row[0]==='produce').length,0);assert.equal(f.studio.controllers.size,0);assert.equal(f.studio.busy.size,0);assert.equal(existsSync(join(p.cwd,'already-muxed.mp4')),true)
 await f.studio.close();await f.lemo.close()
})

test('quota recovery does not race a live Lemo job or guess the order of unknown run timestamps',async t=>{
 const f=fixture(t),p=await f.studio.create({title:'未知状态',brief:'已有候选'});await f.studio.send(p.id,'制作影片',{intent:'create'});existingCandidate(f,p)
 f.studio.links.get(p.id).turn.before.capturedAt=new Date(Date.now()-1000).toISOString();f.production.capture=projectId=>({projectId,isInitial:false,fingerprint:'authored'});const chat=f.chats.get(p.chatId);chat.pause={kind:'call_limit'}
 const get=f.lemo.get.bind(f.lemo);f.lemo.get=id=>({...get(id),currentJob:{id:'still-active',status:'running'}})
 let q=await f.finish(p,'paused');assert.equal(q.status,'paused');assert.equal(f.calls.filter(row=>row[0]==='produce').length,0)
 f.lemo.get=get;await f.studio.send(p.id,'继续修改',{intent:'revise'});chat.status='paused';chat.runs.at(-1).finishedAt='invalid-time';chat.runs.at(-1).status='paused';f.pi.active=null;f.studio.onPiUpdate(f.pi.get(p.chatId));await Promise.all([...f.studio.tasks]);q=f.studio.get(p.id)
 assert.equal(q.status,'paused');assert.equal(f.calls.filter(row=>row[0]==='produce').length,0)
 await f.studio.close();await f.lemo.close()
})
