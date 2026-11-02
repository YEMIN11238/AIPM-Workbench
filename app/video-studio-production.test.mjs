import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,symlinkSync,realpathSync,utimesSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {createVideoStudioProduction} from './video-studio-production.mjs'

function fixture(t,options={}){
  const cwd=realpathSync(mkdtempSync(join(tmpdir(),'studio-production-'))),id=randomUUID(),calls=[],updates=[],jobs=[]
  const project={id,cwd,title:'测试影片',duration:3,width:320,height:180,fps:10,jobs};mkdirSync(join(cwd,'jobs'))
  writeFileSync(join(cwd,'index.html'),'<canvas></canvas><script src="film.js"></script>')
  writeFileSync(join(cwd,'film.js'),'window.DUR=3;window.render=t=>drawOriginalScene(t);window.READY=true;')
  const service={
    get(pid){assert.equal(pid,id);return{...project,currentJob:jobs.at(-1)||null}},info(){return{runtime:{}}},
    run(pid,args){assert.equal(pid,id);calls.push(args);const jobId=randomUUID(),dir=join(cwd,'jobs',jobId);mkdirSync(dir)
      const job={id:jobId,operation:args.operation,status:options.hang===args.operation?'running':'completed',createdAt:new Date().toISOString(),exitCode:0,log:'OK text fully visible',files:[]};jobs.push(job)
      const file=(name,content,kind)=>{const path=join(dir,name);writeFileSync(path,content);job.files.push({path,name,kind});return path}
      if(args.operation==='stills')file('t_0.jpg','real-fixture-still','image')
      if(args.operation==='events')file('events.json',JSON.stringify({dur:3,ev:options.events??[{t:.5,type:'ding',gain:.15}]}),'text')
      if(args.operation==='render')file('video.mp4','decoded-fixture-video','video')
      if(args.operation==='audio')file('mix.wav','nonzero-fixture-audio','audio')
      if(args.operation==='mux')file('film.mp4','fixture-final-mux-'+jobId,'video')
      if(args.operation==='readcheck'&&options.readFail){job.status='failed';job.exitCode=1;job.log='BAD title need 3.5s got 1s'}
      options.onRun?.(job,args,project)
      return structuredClone(job)
    },job(pid,jid){return jobs.find(j=>j.id===jid)},async cancel(){const job=jobs.at(-1);if(job?.status==='running'){job.status='cancelled';job.exitCode=null}return this.get(id)},
    output(){return{files:jobs.flatMap(j=>j.files),...(options.recent?{lastVideo:options.recent(project,jobs)}:{})}}
  }
  const inspect={media:async path=>({path,duration:3,width:320,height:180,fps:10,audio:options.noAudio!==true}),motion:async()=>({passed:options.static!==true,sampledFrames:12,maxMeanDifference:options.static?0:20}),sound:async()=>({passed:options.silent!==true,maxDb:options.silent?null:-12})}
  const production=createVideoStudioProduction({lemoService:service,onUpdate:r=>updates.push(r),inspect})
  t.after(async()=>{await production.close();rmSync(cwd,{recursive:true,force:true})})
  return{cwd,id,service,production,calls,updates,jobs,change(){writeFileSync(join(cwd,'film.js'),'window.DUR=3;window.render=t=>drawNewOriginalScene(t);window.READY=true;')}}
}

test('one authored source produces checked version and retains actual job evidence',async t=>{
  const f=fixture(t),before=f.production.capture(f.id);f.change();const result=await f.production.produce({projectId:f.id,before})
  assert.equal(result.status,'completed');assert.deepEqual(f.calls.map(x=>x.operation),['stills','readcheck','render','events','audio','mux']);assert.equal(result.output.ownerProjectId,f.id);assert.equal(result.output.productionId,result.id);assert.ok(existsSync(result.output.path));assert.ok(result.checks.readability.passed);assert.ok(result.checks.motion.passed);assert.ok(result.checks.sound.passed);assert.equal(result.jobs.length,6);assert.ok(f.updates.some(r=>r.status==='running'));assert.ok(existsSync(join(f.cwd,'.video-studio-production',result.id,'source','film.js')))
})

test('simultaneous and repeated production of a source is exactly once, including cold instance reuse',async t=>{
  const f=fixture(t),before=f.production.capture(f.id);f.change();const a=f.production.produce({projectId:f.id,before}),b=f.production.produce({projectId:f.id,before});assert.equal(a,b);const result=await a;assert.equal(result.status,'completed');assert.equal((await f.production.produce({projectId:f.id,before})).reused,true);assert.equal(f.calls.length,6)
  const cold=createVideoStudioProduction({lemoService:f.service,inspect:{media:async path=>({...result.output,path})}});const reused=await cold.produce({projectId:f.id,before});assert.equal(reused.status,'completed');assert.equal(reused.reused,true);assert.equal(reused.output.projectPath,result.output.projectPath);assert.equal(f.calls.length,6);await cold.close()
})

test('a finished movie is reused without rendering while a movie older than source edits is rebuilt',async t=>{
  for(const stale of [false,true]){
    const f=fixture(t,{recent:project=>({path:join(project.cwd,'existing.mp4')})}),before=f.production.capture(f.id)
    f.change();writeFileSync(join(f.cwd,'existing.mp4'),'existing real candidate')
    const now=Date.now()/1000
    before.capturedAt=new Date((now-30)*1000).toISOString()
    utimesSync(join(f.cwd,'index.html'),now-20,now-20)
    utimesSync(join(f.cwd,'film.js'),stale?now-5:now-20,stale?now-5:now-20)
    utimesSync(join(f.cwd,'existing.mp4'),now-10,now-10)
    const result=await f.production.produce({projectId:f.id,before})
    assert.equal(result.status,'completed')
    assert.deepEqual(f.calls.map(x=>x.operation),stale?['stills','readcheck','render','events','audio','mux']:['stills','readcheck'])
    assert.equal(result.warnings.some(w=>w.includes('复用了本轮聊天')),!stale)
  }
})

test('a new edit gets a new immutable version and preserves the former ready film',async t=>{
  const f=fixture(t);f.change();mkdirSync(join(f.cwd,'assets'));writeFileSync(join(f.cwd,'assets','footage.mp4'),'source footage');const first=await f.production.produce({projectId:f.id});const before=f.production.capture(f.id);writeFileSync(join(f.cwd,'film.js'),'window.render=t=>newerScene(t);window.READY=true');const second=await f.production.produce({projectId:f.id,before});assert.equal(second.status,'completed');assert.notEqual(second.id,first.id);assert.ok(existsSync(first.output.path));assert.match(readFileSync(join(first.output.projectPath,'film.js'),'utf8'),/drawNewOriginalScene/);assert.match(readFileSync(join(second.output.projectPath,'film.js'),'utf8'),/newerScene/);assert.equal(readFileSync(join(first.output.projectPath,'assets','footage.mp4'),'utf8'),'source footage');assert.notEqual(readFileSync(first.output.path,'utf8'),readFileSync(second.output.path,'utf8'))
})

test('known untouched initialization template is never offered as a completed film',async t=>{
  const f=fixture(t);writeFileSync(join(f.cwd,'film.js'),'const C={"title":"LEMO"};ctx.fillText(C.title,w/2,h*.57);const bar=w*.6*Math.min(1,t/.8);ctx.translate(w*.85,h*.2);ctx.rotate(t)');const before=f.production.capture(f.id);assert.equal(before.isInitial,true);const result=await f.production.produce({projectId:f.id,before});assert.equal(result.status,'needs_work');assert.equal(result.output,undefined);assert.equal(f.calls.length,0);writeFileSync(join(f.cwd,'film.js'),readFileSync(join(f.cwd,'film.js'),'utf8').replace('LEMO','My product'));const renamed=await f.production.produce({projectId:f.id,before});assert.equal(renamed.status,'needs_work');assert.equal(f.calls.length,0)
})

test('painted projects reject their own starter and accept authored scenes even when the unused Lemo starter is retained',async t=>{
  const f=fixture(t);mkdirSync(join(f.cwd,'painted','src','scenes'),{recursive:true});const scene=join(f.cwd,'painted/src/scenes/film.js'),initial='shots([[0,paintedStarter]]);';writeFileSync(scene,initial)
  writeFileSync(join(f.cwd,'film.js'),'const C={"title":"LEMO"};ctx.fillText(C.title,w/2,h*.57);const bar=w*.6*Math.min(1,t/.8);ctx.translate(w*.85,h*.2);ctx.rotate(t)')
  writeFileSync(join(f.cwd,'.painted-animation.json'),JSON.stringify({schema:1,engine:'painted-animation',initialSources:{'painted/src/scenes/film.js':createHash('sha256').update(initial).digest('hex')}}))
  const before=f.production.capture(f.id);assert.equal(before.isInitial,true);assert.equal((await f.production.produce({projectId:f.id,before})).status,'needs_work');assert.equal(f.calls.length,0)
  writeFileSync(scene,'shots([[0,originalRainStory],[1,originalUmbrellaStory]]);');assert.equal(f.production.capture(f.id).isInitial,false)
  const result=await f.production.produce({projectId:f.id,before});assert.equal(result.status,'completed');assert.ok(existsSync(join(result.output.projectPath,'.painted-animation.json')))
})

test('no source change after a consultation does not trigger local rendering',async t=>{
  const f=fixture(t),before=f.production.capture(f.id),result=await f.production.produce({projectId:f.id,before});assert.equal(result.status,'skipped');assert.equal(f.calls.length,0)
})

test('readability failure keeps keyframes and real BAD report, without rendering or fake pass',async t=>{
  const f=fixture(t,{readFail:true});f.change();const result=await f.production.produce({projectId:f.id});assert.equal(result.status,'needs_work');assert.equal(result.checks.readability.passed,false);assert.match(result.checks.readability.output,/BAD title/);assert.equal(result.output,undefined);assert.deepEqual(f.calls.map(x=>x.operation),['stills','readcheck']);assert.ok(existsSync(result.posterPath));const again=await f.production.produce({projectId:f.id});assert.equal(again.reused,true);assert.equal(f.calls.length,2)
})

test('static and silent candidates fail gates and are never promoted to ready output',async t=>{
  for(const issue of ['static','silent']){const f=fixture(t,{[issue]:true});f.change();const result=await f.production.produce({projectId:f.id});assert.equal(result.status,issue==='static'?'needs_work':'needs_sound');assert.equal(result.output,undefined)}
})

test('literal no-text receipt is not applicable while an unexplained empty-text exit still blocks production',async t=>{
  for(const declared of [true,false]){
    const f=fixture(t,{onRun(job,args){if(args.operation==='readcheck'){job.status='failed';job.exitCode=2;job.log=(declared?'AIPM_READABILITY '+JSON.stringify({status:'not_applicable',reason:'literal-empty-text-function',renderedFrames:0})+'\n':'')+'readcheck: NOT CHECKED — no text'}}})
    const result=await f.production.produce({projectId:f.id})
    assert.equal(result.status,declared?'completed':'needs_work')
    assert.equal(result.checks.readability.passed,declared?null:false)
    assert.equal(result.checks.readability.applicable,declared?false:undefined)
    if(declared)assert.equal(result.steps.find(step=>step.operation==='readcheck').status,'not_applicable')
    assert.equal(f.calls.some(c=>c.operation==='render'),declared)
  }
})

test('explicit local production retries a cancelled attempt without deleting its previous record',async t=>{
  const options={hang:'render'},f=fixture(t,options),controller=new AbortController()
  const pending=f.production.produce({projectId:f.id,signal:controller.signal})
  const until=Date.now()+2000;while(!f.calls.some(c=>c.operation==='render')&&Date.now()<until)await new Promise(r=>setTimeout(r,5))
  controller.abort();const cancelled=await pending;assert.equal(cancelled.status,'cancelled')
  options.hang=null
  const next=await f.production.produce({projectId:f.id})
  assert.equal(next.status,'completed');assert.notEqual(next.id,cancelled.id)
  assert.equal(JSON.parse(readFileSync(join(f.cwd,'.video-studio-production',cancelled.id,'production.json'))).status,'cancelled')
})

test('absent supported sound does not create fake music or a silent success',async t=>{
  const f=fixture(t,{events:[{t:.2,type:'custom-paper-fold'}]});f.change();const result=await f.production.produce({projectId:f.id});assert.equal(result.status,'needs_sound');assert.equal(result.output,undefined);assert.equal(f.calls.some(c=>c.operation==='audio'),false);assert.ok(result.warnings.some(w=>w.includes('custom-paper-fold')))
})

test('authored same-source audio is used directly while unknown external audio paths are rejected',async t=>{
  const f=fixture(t,{events:[]});writeFileSync(join(f.cwd,'score.wav'),'original-score');writeFileSync(join(f.cwd,'production.json'),JSON.stringify({audio:'score.wav'}));const result=await f.production.produce({projectId:f.id});assert.equal(result.status,'completed');assert.equal(f.calls.some(c=>c.operation==='audio'),false);assert.equal(f.calls.find(c=>c.operation==='mux').audio,join(f.cwd,'score.wav'))
  const g=fixture(t);writeFileSync(join(g.cwd,'production.json'),JSON.stringify({audio:'/etc/passwd'}));const failed=await g.production.produce({projectId:g.id});assert.equal(failed.status,'failed');assert.equal(failed.output,undefined);assert.match(failed.error,/当前影片工程/)
})

function hostSong(f){
  const dir=join(f.cwd,'assets');mkdirSync(dir);const source=join(dir,'source.mp3'),clip=join(dir,'selected.wav'),other=join(dir,'other.wav')
  writeFileSync(source,'original source song');writeFileSync(clip,'selected chorus audio');writeFileSync(other,'another selected chorus')
  const stamp=path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),bytes:readFileSync(path).length})
  const audio={schema:1,source:{...stamp(source),name:'用户歌曲.mp3',duration:30},selection:{...stamp(clip),start:2,end:5,duration:3,sampleRate:48000,channels:2}}
  writeFileSync(join(f.cwd,'.video-audio.json'),JSON.stringify(audio));return{audio,clip,other,stamp}
}

test('a user-selected original track overrides model music and its selection is part of the version fingerprint',async t=>{
  const f=fixture(t),song=hostSong(f);writeFileSync(join(f.cwd,'wrong-score.wav'),'wrong model music');writeFileSync(join(f.cwd,'production.json'),JSON.stringify({audio:'wrong-score.wav'}))
  const first=await f.production.produce({projectId:f.id})
  assert.equal(first.status,'completed');assert.deepEqual(f.calls.map(x=>x.operation),['stills','readcheck','render','mux']);assert.equal(f.calls.find(x=>x.operation==='mux').audio,song.clip)
  assert.equal(first.checks.sourceAudio.sha256,song.audio.selection.sha256);assert.ok(existsSync(join(first.output.projectPath,'.video-audio.json')))
  const before=f.production.capture(f.id);song.audio.selection={...song.audio.selection,...song.stamp(song.other)};writeFileSync(join(f.cwd,'.video-audio.json'),JSON.stringify(song.audio))
  const next=await f.production.produce({projectId:f.id,before})
  assert.equal(next.status,'completed');assert.notEqual(next.id,first.id);assert.equal(f.calls.filter(x=>x.operation==='mux').at(-1).audio,song.other)
  writeFileSync(song.other,'changed after selection');const changed=await f.production.produce({projectId:f.id});assert.equal(changed.status,'failed');assert.equal(changed.output,undefined);assert.match(changed.error,/片段已变化/)
})

test('an existing picture with other sound is remuxed with the user track without rendering the picture again',async t=>{
  const f=fixture(t,{recent:project=>({path:join(project.cwd,'candidate.mp4')})}),song=hostSong(f),before=f.production.capture(f.id);f.change();writeFileSync(join(f.cwd,'candidate.mp4'),'candidate with wrong soundtrack')
  const now=Date.now()/1000;before.capturedAt=new Date((now-30)*1000).toISOString();utimesSync(join(f.cwd,'candidate.mp4'),now+5,now+5)
  const result=await f.production.produce({projectId:f.id,before});assert.equal(result.status,'completed');assert.deepEqual(f.calls.map(x=>x.operation),['stills','readcheck','mux']);assert.equal(f.calls.at(-1).audio,song.clip)
})

test('an imported but unselected recording never silently falls back to generated music',async t=>{
  const f=fixture(t),song=hostSong(f);song.audio.selection=null;writeFileSync(join(f.cwd,'.video-audio.json'),JSON.stringify(song.audio));const result=await f.production.produce({projectId:f.id})
  assert.equal(result.status,'failed');assert.equal(result.output,undefined);assert.equal(f.calls.length,0);assert.match(result.error,/选择.*音频片段/)
})

test('cancellation stops the owned local step and does not run later steps',async t=>{
  const f=fixture(t,{hang:'render'}),controller=new AbortController();const pending=f.production.produce({projectId:f.id,signal:controller.signal});const until=Date.now()+2000;while(!f.calls.some(c=>c.operation==='render')&&Date.now()<until)await new Promise(r=>setTimeout(r,5));assert.ok(f.calls.some(c=>c.operation==='render'));controller.abort();const result=await pending;assert.equal(result.status,'cancelled');assert.equal(f.jobs.at(-1).status,'cancelled');assert.equal(f.calls.some(c=>c.operation==='mux'),false);assert.equal(result.output,undefined)
})

test('a source mutation during production cannot mix versions or replace prior film',async t=>{
  const f=fixture(t,{onRun(job,args,p){if(args.operation==='readcheck')writeFileSync(join(p.cwd,'film.js'),'racing edit')}});const result=await f.production.produce({projectId:f.id});assert.equal(result.output,undefined);assert.match(result.error,/工程在制作中发生变化/);assert.equal(f.calls.some(c=>c.operation==='render'),false)
})

test('modified cached output is rejected, not silently reused or re-rendered',async t=>{
  const f=fixture(t),result=await f.production.produce({projectId:f.id});writeFileSync(result.output.path,'changed');const later=await f.production.produce({projectId:f.id});assert.equal(later.status,'failed');assert.equal(later.output,undefined);assert.equal(f.calls.length,6)
})

test('symlink assets are rejected before executing local jobs',async t=>{
  const f=fixture(t);symlinkSync('/etc/passwd',join(f.cwd,'linked.txt'));const result=await f.production.produce({projectId:f.id});assert.equal(result.status,'failed');assert.match(result.error,/符号链接/);assert.equal(f.calls.length,0)
})
