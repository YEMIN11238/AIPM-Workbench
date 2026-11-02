import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync,readdirSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {LemoService} from './lemo-service.mjs'

function fixture(t,{script="console.log('1/1')",onUpdate}={}) {
  const base=mkdtempSync(join(tmpdir(),'aipm-lemo-test-')),root=join(base,'projects'),sourceRoot=join(base,'source'),runtimeRoot=join(base,'runtime')
  for(const p of ['styles/swiss-motion','core'])mkdirSync(join(sourceRoot,p),{recursive:true})
  for(const p of ['core/render','core/tts','bin'])mkdirSync(join(runtimeRoot,p),{recursive:true})
  writeFileSync(join(sourceRoot,'SOURCE.json'),JSON.stringify({repository:'https://github.com/lemomo-ai/lemo-opuscar',commit:'fixed',license:'MIT'}))
  for(const p of ['DIRECTOR.md','TECHNIQUE.md','styles/README.md','styles/swiss-motion/STYLE.md'])writeFileSync(join(sourceRoot,p),'Trusted source reference')
  writeFileSync(join(sourceRoot,'styles/swiss-motion/style.json'),JSON.stringify({en:'Swiss Motion',cn:'瑞士动效',category_cn:'图形'}))
  for(const p of ['video.mjs','still.mjs','events.mjs','readcheck.mjs'])writeFileSync(join(runtimeRoot,'core/render',p),script)
  for(const p of ['tts.py','tts_zh.py'])writeFileSync(join(runtimeRoot,'core/tts',p),"console.log('voice-local-test')")
  const probe=join(runtimeRoot,'bin/ffprobe')
  writeFileSync(probe,`#!${process.execPath}\nconsole.log(JSON.stringify({streams:[{codec_type:'video',width:320,height:180,r_frame_rate:'10/1'},{codec_type:'audio'}],format:{duration:'2.0'}}))`,{mode:0o755})
  writeFileSync(join(runtimeRoot,'runtime.json'),JSON.stringify({ready:true,node:process.execPath,python:process.execPath,ffmpeg:'/usr/bin/true',ffprobe:probe,browser:'/test/browser',kokoro:true}))
  const service=new LemoService({root,sourceRoot,runtimeRoot,onUpdate})
  t.after(async()=>{await service.close();rmSync(base,{recursive:true,force:true})})
  return{service,base,root,sourceRoot,runtimeRoot,prepare:input=>service.prepare({title:'影片',brief:'做一个动画',duration:2,width:320,height:180,fps:10,...input})}
}
async function finish(service,id){const until=Date.now()+5000;while(service.active.has(id)&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.equal(service.active.has(id),false,'local child did not finish');return service.job(id)}

test('prepares all visible modes; blank style and blank title work; technical context stays out of chat',t=>{
  const{service,prepare}=fixture(t)
  for(const mode of ['library','customize','blank']){
    const p=prepare({mode,title:'',brief:'制作米色漫画动画',...(mode==='blank'?{style:''}:{})})
    assert.equal(p.title,'制作米色漫画动画');assert.ok(p.prompt.length<250);assert.ok(!p.prompt.includes(p.cwd));assert.ok(p.instructions.includes(p.cwd));assert.ok(p.instructions.includes('window.READY'))
    assert.equal(service.contextForChat({id:'other'}),null)
    service.setChat(p.id,'chat-'+p.id)
    const context=service.contextForChat({id:'chat-'+p.id})
    assert.ok(context.system.includes(p.id));assert.ok(context.system.includes('宿主lemo-opuscar Skill'));assert.equal(readFileSync(join(p.cwd,'任务说明.md'),'utf8'),p.instructions)
  }
  const saved=service.saveStyle({name:'My motion',content:'# Personal style'})
  assert.equal(prepare({mode:'saved',style:saved.id}).style,saved.id)
})

test('old project prompt is preserved as bound system context',t=>{
  const{service,prepare}=fixture(t),p=prepare();const path=join(p.cwd,'.lemo-project.json'),meta=JSON.parse(readFileSync(path,'utf8'));delete meta.instructions;meta.prompt='Legacy full technical instructions';meta.chatId='old-chat';writeFileSync(path,JSON.stringify(meta));assert.equal(service.contextForChat({id:'old-chat'}).system,meta.prompt)
})

test('explicit duration updates preserve original source and reject changes while a local job is running',async t=>{
 const{service,prepare}=fixture(t,{script:"setInterval(()=>{},1000)"}),p=prepare(),source=readFileSync(join(p.cwd,'film.js'),'utf8')
 assert.equal(service.setDuration(p.id,3).duration,3);assert.match(service.get(p.id).instructions,/规格：3秒/);assert.equal(readFileSync(join(p.cwd,'film.js'),'utf8'),source);assert.throws(()=>service.setDuration(p.id,0),/1至3600秒/)
 service.run(p.id,{operation:'render'});assert.throws(()=>service.setDuration(p.id,4),/已有任务/);await service.cancel(p.id)
})

test('text reads are bounded and cannot traverse or follow links',t=>{
  const{service,prepare,base}=fixture(t),p=prepare();writeFileSync(join(base,'outside.md'),'private');symlinkSync(join(base,'outside.md'),join(p.cwd,'linked.md'))
  assert.throws(()=>service.read({projectId:p.id,path:'../outside.md'}));assert.throws(()=>service.read({projectId:p.id,path:'linked.md'}),/符号链接/)
  writeFileSync(join(p.cwd,'huge.md'),'x'.repeat(512001));assert.throws(()=>service.read({projectId:p.id,path:'huge.md'}),/大小/)
  assert.equal(service.read({path:'DIRECTOR.md'}).text,'Trusted source reference')
})

test('custom styles remain independent and overwrite preserves prior version',t=>{
  const{service,sourceRoot}=fixture(t),s=service.saveStyle({name:'Local style',content:'# One'})
  assert.equal(service.read({path:s.stylePath}).text,'# One');assert.throws(()=>service.saveStyle({name:'Local style',content:'# Two'}),/覆盖/)
  service.saveStyle({name:'Local style',content:'# Two',overwrite:true});assert.equal(service.read({path:s.stylePath}).text,'# Two');assert.equal(readdirSync(join(service.customRoot,'.history')).length,1);assert.equal(existsSync(join(sourceRoot,'styles/local-style')),false)
})

test('one corrupt or symlink project/job cannot block listing or cold start',async t=>{
  const{service,root,sourceRoot,runtimeRoot,prepare}=fixture(t),p=prepare(),bad=randomUUID();mkdirSync(join(root,bad));writeFileSync(join(root,bad,'.lemo-project.json'),'bad-json');symlinkSync(p.cwd,join(root,randomUUID()))
  const jobId=randomUUID(),jdir=join(p.cwd,'jobs',jobId);mkdirSync(jdir);writeFileSync(join(jdir,'job.json'),'bad');assert.equal(service.list().length,1);assert.ok(service.info().messages.some(m=>m.includes('跳过损坏')))
  const good=randomUUID(),dir=join(p.cwd,'jobs',good);mkdirSync(dir);writeFileSync(join(dir,'job.json'),JSON.stringify({id:good,projectId:p.id,status:'running',createdAt:new Date().toISOString()}))
  const cold=new LemoService({root,sourceRoot,runtimeRoot});assert.equal(cold.job(p.id).status,'interrupted');assert.equal(cold.active.size,0);assert.equal(readFileSync(join(root,bad,'.lemo-project.json'),'utf8'),'bad-json');await cold.close()
})

test('local managed jobs receive isolated environment, expected duration and shared render slot',async t=>{
  const script="console.log(JSON.stringify({secret:process.env.LEMO_TEST_SECRET||null,home:process.env.HOME,expected:process.env.LEMO_EXPECTED_DURATION,slots:process.env.RENDER_SLOT_DIR,offline:process.env.HF_HUB_OFFLINE}));console.log('1/1')"
  const{service,prepare,runtimeRoot}=fixture(t,{script});process.env.LEMO_TEST_SECRET='must-not-inherit';t.after(()=>delete process.env.LEMO_TEST_SECRET)
  const p=prepare(),job=service.run(p.id,{operation:'render'});assert.equal(job.status,'running');const done=await finish(service,p.id);assert.equal(done.status,'completed');const env=JSON.parse(done.log.split('\n')[0]);assert.equal(env.secret,null);assert.equal(env.expected,'2');assert.equal(env.offline,'1');assert.equal(env.slots,realpathSync(join(runtimeRoot,'render-slots')));assert.equal(env.home,join(p.cwd,'jobs',job.id));assert.ok(!done.log.includes('must-not-inherit'))
})

test('online voice requires human memory consent and never survives cold start',async t=>{
  const{service,prepare,root,sourceRoot,runtimeRoot}=fixture(t),p=prepare()
  assert.throws(()=>service.run(p.id,{operation:'voice',provider:'edge'}),/人工授权/)
  service.setOnlineVoiceConsent(p.id,true);assert.equal(service.get(p.id).onlineVoiceConsent,true);service.run(p.id,{operation:'voice',provider:'edge'});assert.equal((await finish(service,p.id)).status,'completed')
  assert.equal(JSON.parse(readFileSync(join(p.cwd,'.lemo-project.json'),'utf8')).onlineVoiceConsent,undefined)
  const cold=new LemoService({root,sourceRoot,runtimeRoot});assert.equal(cold.get(p.id).onlineVoiceConsent,false);await cold.close()
  assert.throws(()=>service.run(p.id,{operation:'asr',voices:'jobs'}),/不会自动联网下载/)
})

test('one active job per project; cancel and close wait for owned child exit',async t=>{
  const{service,prepare}=fixture(t,{script:"console.log('started');setInterval(()=>{},1000)"}),p=prepare()
  service.run(p.id,{operation:'render'});assert.throws(()=>service.run(p.id,{operation:'events'}),/已有任务/);const cancelled=await service.cancel(p.id);assert.equal(cancelled.currentJob.status,'cancelled');assert.equal(service.active.size,0)
  service.run(p.id,{operation:'render'});await service.close();assert.equal(service.active.size,0);assert.equal(service.job(p.id).status,'cancelled');assert.throws(()=>prepare(),/关闭/)
})

test('observer exceptions are contained and reported, not allowed to fail production',async t=>{
  const messages=[],old=console.error;console.error=(...args)=>messages.push(args.join(' '));t.after(()=>{console.error=old})
  const{service,prepare}=fixture(t,{onUpdate(){throw new Error('observer failed')}}),p=prepare();service.run(p.id,{operation:'render'});assert.equal((await finish(service,p.id)).status,'completed');assert.ok(messages.some(m=>m.includes('通知失败')))
})

test('deleting a running job folder is a contained failure and cannot hang close',async t=>{
  const messages=[],old=console.error;console.error=(...args)=>messages.push(args.join(' '));t.after(()=>{console.error=old})
  const{service,prepare}=fixture(t,{script:"setTimeout(()=>console.log('after-delete'),100);setTimeout(()=>process.exit(0),200)"}),p=prepare(),j=service.run(p.id,{operation:'render'});rmSync(join(p.cwd,'jobs',j.id),{recursive:true,force:true});await finish(service,p.id);await service.close();assert.equal(service.active.size,0);assert.ok(service.info().messages.some(m=>m.includes('归档失败')))
})

test('deleting the entire running project still permits cleanup of owned process',async t=>{
  const old=console.error;console.error=()=>{};t.after(()=>{console.error=old})
  const{service,prepare}=fixture(t,{script:"setInterval(()=>{},1000)"}),p=prepare();service.run(p.id,{operation:'render'});rmSync(p.cwd,{recursive:true,force:true});const result=await service.cancel(p.id);assert.equal(result.id,p.id);assert.equal(service.active.size,0);await service.close()
})

test('close reports cleanup rejection after attempting all active jobs',async t=>{
  const{service}=fixture(t);service.active.set('one',{});service.active.set('two',{});const attempted=[];service.cancel=async id=>{attempted.push(id);service.active.delete(id);throw new Error(id)};await assert.rejects(service.close(),AggregateError);assert.deepEqual(attempted.sort(),['one','two'])
})

test('output only promotes an owned probed MP4 matching project dimensions and time',t=>{
  const{service,prepare,base}=fixture(t),p=prepare();writeFileSync(join(p.cwd,'valid.mp4'),'probe-fixture');writeFileSync(join(base,'outside.mp4'),'outside');symlinkSync(join(base,'outside.mp4'),join(p.cwd,'linked.mp4'))
  const good=service.output(p.id);assert.equal(good.lastVideo.path,join(p.cwd,'valid.mp4'));assert.equal(good.lastVideo.audio,true);assert.equal(good.files.some(f=>f.name==='linked.mp4'),false)
  const path=join(p.cwd,'.lemo-project.json'),meta=JSON.parse(readFileSync(path,'utf8'));meta.width=640;writeFileSync(path,JSON.stringify(meta));const bad=service.output(p.id);assert.equal(bad.lastVideo,undefined);assert.ok(bad.diagnostics.some(x=>x.message.includes('规格')))
})

test('invalid operation arguments cannot escape project or cause arbitrary command execution',t=>{
  const{service,prepare}=fixture(t),p=prepare();assert.throws(()=>service.run(p.id,{operation:'shell',command:'echo no'}),/不支持/);assert.throws(()=>service.run(p.id,{operation:'stills',times:[Infinity]}),/时间/);assert.throws(()=>service.run(p.id,{operation:'render',q:'x\n--out /tmp/oops'}),/参数/);assert.throws(()=>service.run(p.id,{operation:'mux',video:'/etc/passwd',audio:'/etc/passwd'}),/当前工程/);assert.equal(service.active.size,0);assert.doesNotThrow(()=>service.get(p.id))
})
