/** Mechanical, local-only production gates shared by the native video conversation. */
import {createHash,randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync,lstatSync,readdirSync,realpathSync,existsSync,renameSync,copyFileSync} from 'node:fs'
import {join,relative,resolve,isAbsolute,dirname,extname} from 'node:path'
import {spawn} from 'node:child_process'
import {checkedVideoAudioSelection} from './video-studio-audio.mjs'

const GENERATED=new Set(['jobs','node_modules','.git','.video-studio-production'])
const TERMINAL=new Set(['completed','failed','cancelled','interrupted'])
const CUES=new Set(['click','whoosh','thump','ding','pop','step','tone'])
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const aborted=()=>Object.assign(new Error('制作已取消，已保留工程与已有版本'),{name:'AbortError'})
function checkSignal(signal){if(signal?.aborted)throw aborted()}
function safe(root,input,{max=256*1024*1024,directory=false}={}){
  if(typeof input!=='string'||!input||input.includes('\0'))throw new Error('产物路径无效')
  const base=realpathSync(root),target=resolve(base,input),rel=relative(base,target)
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw new Error('产物须在当前影片工程内')
  let at=base;for(const name of rel.split('/')){at=join(at,name);if(lstatSync(at).isSymbolicLink())throw new Error('产物路径不能经过符号链接')}
  const stat=lstatSync(target)
  if(directory?!stat.isDirectory():!stat.isFile()||stat.size>max)throw new Error('产物类型或大小无效')
  return target
}
function atomic(path,value){const temp=path+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});renameSync(temp,path)}
function data(root,path,max=512000){return JSON.parse(readFileSync(safe(root,path,{max}),'utf8'))}
function sources(project){
  const entries=[];let total=0
  const walk=(directory,prefix='')=>{for(const e of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    if(GENERATED.has(e.name)||e.name.startsWith('.')&&!['.video-audio.json','.painted-animation.json'].includes(e.name)||e.name==='任务说明.md'||/\.log$/i.test(e.name))continue
    const path=join(directory,e.name),name=prefix+e.name
    if(e.isSymbolicLink())throw new Error('创作素材不能是符号链接：'+name)
    if(e.isDirectory())walk(path,name+'/')
    else if(e.isFile()){
      if(entries.length>=4000)throw new Error('工程文件过多，请移出无关文件')
      const stat=lstatSync(path);total+=stat.size
      if(stat.size>256*1024*1024||total>1024*1024*1024)throw new Error('创作文件超过本地自动检查范围')
      entries.push({path:name,sha256:sha(readFileSync(path)),bytes:stat.size})
    }
  }};walk(project.cwd)
  if(!entries.some(e=>e.path==='index.html'))throw new Error('工程缺少 index.html，尚不能生成影片')
  const spec={duration:project.duration,width:project.width,height:project.height,fps:project.fps}
  return{schema:1,projectId:project.id,capturedAt:new Date().toISOString(),fingerprint:sha(JSON.stringify({spec,entries})),spec,files:entries,initialSources:Object.fromEntries(entries.filter(e=>['index.html','film.js'].includes(e.path)).map(e=>[e.path,e.sha256]))}
}
function isStarter(project,current,before){
  if(existsSync(join(project.cwd,'.painted-animation.json'))){
    const marker=data(project.cwd,'.painted-animation.json'),path='painted/src/scenes/film.js',initial=marker.initialSources?.[path],actual=current.files.find(file=>file.path===path)
    if(marker.schema!==1||marker.engine!=='painted-animation'||!/^[a-f\d]{64}$/.test(initial||''))throw new Error('水彩动画初始化记录无效，未作为用户影片接受')
    return !actual||actual.sha256===initial
  }
  const original=before?.initialSources
  if(before?.isInitial&&original&&Object.keys(original).length&&current.files.filter(e=>/\.(?:js|mjs|html|css)$/i.test(e.path)).every(e=>original[e.path]===e.sha256))return true
  if(!existsSync(join(project.cwd,'film.js')))return false
  const code=readFileSync(safe(project.cwd,'film.js',{max:2000000}),'utf8')
  if(code.length>3000)return false
  const two=['ctx.fillText(C.title,w/2,h*.57)','w*.6*Math.min(1,t/.8)','ctx.translate(w*.85,h*.2)','ctx.rotate(t)']
  const three=['new THREE.BoxGeometry(1.8,1.8,1.8)',"color:'#e9c762'",'mesh.rotation.set(.2+t*.2,t*.65,0)','window.TEXTS=()=>[]']
  return two.every(x=>code.includes(x))||three.every(x=>code.includes(x))
}
function candidateFollowsSource(project,current,path){
  const movie=safe(project.cwd,path),modified=lstatSync(movie).mtimeMs
  return current.files.every(file=>{
    if(/\.(?:md|txt|srt)$/i.test(file.path)||/^(?:CREDITS|LICENSE|poster\.(?:png|jpe?g|webp))$/i.test(file.path))return true
    const input=safe(project.cwd,file.path)
    return input===movie||lstatSync(input).mtimeMs<=modified
  })
}
function delay(signal){return new Promise((resolve,reject)=>{const timer=setTimeout(done,80);function done(){signal?.removeEventListener('abort',stop);resolve()}function stop(){clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(aborted())}signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop()})}
function runLocal(command,args,{signal,maxBuffer=2000000,timeout=0}={}){
  checkSignal(signal)
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{env:{PATH:'/usr/bin:/bin',HOME:'/tmp',LANG:'en_US.UTF-8'},stdio:['ignore','pipe','pipe'],detached:true})
    const out=[],err=[];let bytes=0,error,timer
    const kill=()=>{if(Number.isSafeInteger(child.pid))try{process.kill(-child.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')error=e}}
    const stop=()=>{error=aborted();kill()};signal?.addEventListener('abort',stop,{once:true})
    if(timeout)timer=setTimeout(()=>{error=new Error('本地媒体探测超时');kill()},timeout)
    for(const [stream,target] of [[child.stdout,out],[child.stderr,err]])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBuffer){error=new Error('媒体检查输出过大');kill()}else target.push(chunk)})
    child.on('error',e=>{error=e})
    child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);if(error)return reject(error);const result={stdout:Buffer.concat(out),stderr:Buffer.concat(err).toString('utf8')};if(code!==0)return reject(new Error(result.stderr.slice(-2000)||'媒体检查失败'));resolve(result)})
    if(signal?.aborted)stop()
  })
}
async function inspectMedia(path,project,runtime,signal){
  const result=await runLocal(runtime.ffprobe,['-v','error','-show_streams','-show_format','-of','json',path],{signal,timeout:15000})
  const info=JSON.parse(result.stdout.toString('utf8')),video=info.streams?.find(s=>s.codec_type==='video'),[n,d]=String(video?.r_frame_rate||'0/1').split('/').map(Number),fps=n/d,duration=Number(info.format?.duration)
  if(video?.width!==project.width||video?.height!==project.height||Math.abs(fps-project.fps)>.01||!Number.isFinite(duration)||Math.abs(duration-project.duration)>Math.max(.15,2/project.fps))throw new Error('实际影片的时长、尺寸或帧率与当前工程不一致')
  return{path,duration,width:video.width,height:video.height,fps,audio:info.streams.some(s=>s.codec_type==='audio')}
}
async function inspectMotion(path,project,runtime,signal){
  const rate=12/project.duration
  const raw=await runLocal(runtime.ffmpeg,['-v','error','-i',path,'-an','-vf',`fps=${rate},scale=64:36`,'-frames:v','12','-f','rawvideo','-pix_fmt','gray','-'],{signal,maxBuffer:300000})
  const pixels=64*36,count=Math.floor(raw.stdout.length/pixels);if(count<2)throw new Error('影片没有足够的可解码帧')
  let maxMeanDifference=0,maxChangedFraction=0
  const first=raw.stdout.subarray(0,pixels)
  for(let frame=1;frame<count;frame++){let sum=0,changed=0;for(let i=0;i<pixels;i++){const d=Math.abs(raw.stdout[frame*pixels+i]-first[i]);sum+=d;if(d>4)changed++}maxMeanDifference=Math.max(maxMeanDifference,sum/pixels);maxChangedFraction=Math.max(maxChangedFraction,changed/pixels)}
  return{passed:maxMeanDifference>.8&&maxChangedFraction>.02,sampledFrames:count,maxMeanDifference,maxChangedFraction,description:'对成片均匀采样比较画面变化；这是静止画面检查，不代表审美评审'}
}
async function inspectSound(path,runtime,signal){
  const result=await runLocal(runtime.ffmpeg,['-hide_banner','-i',path,'-vn','-af','volumedetect','-f','null','-'],{signal,maxBuffer:500000})
  const value=result.stderr.match(/max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/i)?.[1],maxDb=value==='-inf'?-Infinity:Number(value)
  return{passed:Number.isFinite(maxDb)&&maxDb>-60,maxDb:Number.isFinite(maxDb)?maxDb:null,description:'真实音轨峰值检查；不把静音音轨作为有声完成'}
}

export function createVideoStudioProduction({lemoService,onUpdate=()=>{},inspect={}}){
  if(!lemoService)throw new Error('缺少本地影片服务')
  const active=new Map();let closed=false
  const notify=result=>{try{onUpdate(structuredClone(result))}catch(e){console.error('视频制作进度通知失败：'+String(e.message).slice(0,200))}}
  const projectFor=id=>{const project=lemoService.get(id);if(!project?.cwd||project.id!==id)throw new Error('影片工程无效');return project}
  const capture=id=>{const project=projectFor(id),snapshot=sources(project);return{...snapshot,isInitial:isStarter(project,snapshot,null)}}
  const probe=inspect.media||inspectMedia,motion=inspect.motion||inspectMotion,sound=inspect.sound||inspectSound
  function storage(project){const folder=join(project.cwd,'.video-studio-production');mkdirSync(folder,{recursive:true,mode:0o700});safe(project.cwd,folder,{directory:true});return folder}
  function records(project){const folder=storage(project),rows=[];for(const name of readdirSync(folder)){try{if(!/^[a-f\d-]{36}$/.test(name))continue;const record=data(project.cwd,join(folder,name,'production.json'),3000000);if(record.schema===1&&record.projectId===project.id)rows.push(record)}catch(e){console.error('跳过损坏的视频制作记录')}}return rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))}
  function persist(record,folder){atomic(join(folder,'production.json'),record);notify(record)}
  function unchanged(project,fingerprint){if(sources(project).fingerprint!==fingerprint)throw new Error('工程在制作中发生变化，已保留本次结果；请完成编辑后再生成，避免混用版本')}
  async function cancelOwned(op){if(!op.jobId)return;const job=lemoService.job(op.projectId,op.jobId);if(job&&!TERMINAL.has(job.status)){const current=lemoService.get(op.projectId).currentJob;if(current?.id===op.jobId)await lemoService.cancel(op.projectId)}}
  async function step(op,record,folder,operation,options={}){
    checkSignal(op.controller.signal);unchanged(op.project,record.fingerprint)
    const started=lemoService.run(op.projectId,{operation,...options});op.jobId=started.id
    record.steps.push({operation,jobId:started.id,status:'running'});record.message={stills:'正在检查真实关键帧',readcheck:'正在检查文字能否读完',render:'正在把创作工程渲染成影片',events:'正在读取画面里的声音节拍',audio:'正在合成与画面对应的声音',mux:'正在混音并检查最终影片'}[operation]||'正在本地制作';persist(record,folder)
    let job=started
    try{while(!TERMINAL.has(job.status)){checkSignal(op.controller.signal);await delay(op.controller.signal);job=lemoService.job(op.projectId,started.id);if(!job)throw new Error('本地任务记录丢失');record.progress={operation,ratio:job.progress?.ratio||0,message:job.progress?.message||record.message};notify(record)}}catch(e){await cancelOwned(op);throw e}
    finally{op.jobId=null}
    const summary=record.steps.at(-1);summary.status=job.status;summary.exitCode=job.exitCode;summary.log=String(job.log||'').slice(-6000);summary.files=job.files||[];record.jobs.push(job.id);persist(record,folder)
    checkSignal(op.controller.signal);unchanged(op.project,record.fingerprint)
    if(job.status!=='completed')throw Object.assign(new Error(job.error||job.log?.slice(-1500)||'本地制作步骤未完成'),{operation,job})
    return job
  }
  function fileFrom(job,extension){return(job.files||[]).find(f=>f.path?.toLowerCase().endsWith(extension))?.path}
  function cueList(project,eventJob,record,before){
    let exported;const file=fileFrom(eventJob,'events.json');if(file)exported=data(project.cwd,file)
    const events=Array.isArray(exported)?exported:exported?.ev
    let rows=events
    if(!Array.isArray(rows)||!rows.length){if(existsSync(join(project.cwd,'timeline.json'))){const timelineFile=currentFile=>before?.files?.find(f=>f.path===currentFile);const old=timelineFile('timeline.json');const timelinePath=safe(project.cwd,'timeline.json');if(before?.isInitial&&old?.sha256===sha(readFileSync(timelinePath)))return[];const timeline=data(project.cwd,'timeline.json');rows=timeline.events||timeline.ev}}
    if(!Array.isArray(rows)||!rows.length)return[]
    const unknown=[...new Set(rows.filter(e=>!CUES.has(e?.type)).map(e=>String(e?.type||'未命名')))]
    if(unknown.length)record.warnings.push('部分声音事件需原创混音提供：'+unknown.slice(0,12).join('、'))
    return rows.filter(e=>CUES.has(e?.type)&&Number.isFinite(e.t)&&e.t>=0&&e.t<project.duration&&e.gain!==0).slice(0,500).map(e=>({t:e.t,type:e.type,gain:Number.isFinite(e.gain)?Math.max(0,Math.min(1,e.gain)):.15}))
  }
  async function finish(op,record,folder,status,message,error){record.status=status;record.message=message;record.finishedAt=new Date().toISOString();if(error)record.error=String(error.message||error).slice(0,4000);try{persist(record,folder)}catch(e){record.warnings.push('制作记录无法保存：'+e.message);notify(record)}return structuredClone(record)}
  async function work(op,before){
    const project=op.project,hostAudio=existsSync(join(project.cwd,'.video-audio.json'))?data(project.cwd,'.video-audio.json'):null,selectedAudio=hostAudio?checkedVideoAudioSelection(project,hostAudio):null,current=sources(project),all=records(project),same=all.find(r=>r.fingerprint===current.fingerprint&&!(r.status==='cancelled'&&!before))
    if(same){
      if(same.status==='completed'&&same.output?.path){try{safe(project.cwd,same.output.path);if(sha(readFileSync(same.output.path))!==same.outputSha256)throw new Error('已有成片被修改');const actual=await probe(same.output.path,project,lemoService.info().runtime,op.controller.signal),projectPath=safe(project.cwd,same.output.projectPath||join(dirname(same.output.path),'source'),{directory:true});return{...same,reused:true,message:'已显示同一版本通过检查的影片，没有重复渲染',output:{...actual,projectPath,ownerProjectId:project.id,productionId:same.id}}}catch(e){if(e.name==='AbortError')throw e;return{...same,status:'failed',message:'已有成片已改变或不可读取，请修改后重新生成',error:e.message,output:undefined}}}
      return{...same,status:same.status==='running'?'needs_work':same.status,reused:true,output:undefined,message:same.status==='running'?'上次制作中断，已保留记录，没有自动重跑':same.message}
    }
    if(isStarter(project,current,before))return{schema:1,projectId:project.id,status:'needs_work',message:'目前仍是初始化示例，尚未创作用户影片；请继续完成实际内容后再生成',checks:{authored:{passed:false}},steps:[],jobs:[],warnings:[]}
    if(before?.fingerprint===current.fingerprint)return{schema:1,projectId:project.id,status:'skipped',message:'本轮没有修改影片工程，保留原有结果，没有重复渲染',checks:{authored:{passed:true}},steps:[],jobs:[],warnings:[]}
    const id=randomUUID(),folder=join(storage(project),id);mkdirSync(folder,{mode:0o700})
    const record={schema:1,id,productionId:id,projectId:project.id,fingerprint:current.fingerprint,status:'running',message:'正在检查创作工程',createdAt:new Date().toISOString(),sourceSnapshot:current,checks:{authored:{passed:true},method:{source:'DIRECTOR.md §5/7/11; TECHNIQUE.md §8',description:'关键帧、阅读时长、真实成片、声音和画面变化检查；不替代人工审美判断'}},steps:[],jobs:[],warnings:[]}
    const treatment=current.files.find(f=>f.path==='TREATMENT.md');record.checks.method.treatment=treatment?{path:'TREATMENT.md',sha256:treatment.sha256}:null;if(!treatment)record.warnings.push('工程没有导演方案文件；本次仅确认机械检查，未声称通过导演或审美评审');op.record=record;persist(record,folder)
    try{
      checkSignal(op.controller.signal)
      const snapshot=join(folder,'source');mkdirSync(snapshot)
      for(const file of current.files){const dest=join(snapshot,file.path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(safe(project.cwd,file.path),dest)}
      const times=[0,project.duration*.22,project.duration*.48,project.duration*.74,Math.max(0,project.duration-1/project.fps)].map(n=>Number(n.toFixed(4)))
      const stills=await step(op,record,folder,'stills',{times});record.posterPath=fileFrom(stills,'.jpg')||fileFrom(stills,'.png');record.checks.keyframes={passed:true,files:stills.files.filter(f=>f.kind==='image')}
      try{const reading=await step(op,record,folder,'readcheck');record.checks.readability={passed:true,exitCode:reading.exitCode,output:reading.log}}
      catch(e){
        if(e.name==='AbortError')throw e
        const receipts=String(e.job?.log||'').split('\n').filter(line=>line.startsWith('AIPM_READABILITY ')).flatMap(line=>{try{return[JSON.parse(line.slice('AIPM_READABILITY '.length))]}catch{return[]}})
        const empty=e.job?.exitCode===2&&receipts.length===1&&receipts[0].status==='not_applicable'&&receipts[0].reason==='literal-empty-text-function'&&receipts[0].renderedFrames===0
        record.checks.readability={passed:empty?null:false,...(empty?{applicable:false,reason:receipts[0].reason}:{}),exitCode:e.job?.exitCode,output:e.job?.log||e.message}
        if(empty)record.steps.at(-1).status='not_applicable'
        if(!empty)return finish(op,record,folder,'needs_work','文字显示时间或文字接口检查未通过；已保留关键帧，请在同一聊天继续修改',e)
      }
      const runtime=lemoService.info().runtime
      const recent=lemoService.output(project.id).lastVideo
      let videoPath,needsMux=false,audioPath=selectedAudio
      if(recent?.path&&before?.capturedAt&&lstatSync(safe(project.cwd,recent.path)).mtimeMs>=Date.parse(before.capturedAt)&&candidateFollowsSource(project,current,recent.path)){
        try{const candidate=await probe(recent.path,project,runtime,op.controller.signal),changes=await motion(recent.path,project,runtime,op.controller.signal);if(changes.passed&&selectedAudio){videoPath=recent.path;needsMux=true;record.checks.motion=changes;record.warnings.push('复用了已有画面，并重新配入用户所选原音频')}else if(changes.passed&&candidate.audio){const audible=await sound(recent.path,runtime,op.controller.signal);if(audible.passed){videoPath=recent.path;record.checks.motion=changes;record.checks.sound=audible;record.warnings.push('复用了本轮聊天已经生成的真实成片，未重复渲染')}}}catch(e){if(e.name==='AbortError')throw e;record.warnings.push('本轮已有视频未通过检查，改由真实工程重新制作：'+e.message)}
      }
      if(!videoPath){
        const render=await step(op,record,folder,'render');videoPath=fileFrom(render,'.mp4');if(!videoPath)throw new Error('渲染任务没有返回真实MP4');needsMux=true
        if(!selectedAudio){
          const events=await step(op,record,folder,'events')
          if(existsSync(join(project.cwd,'production.json'))){const plan=data(project.cwd,'production.json');if(plan.audio)audioPath=safe(project.cwd,plan.audio)}
          if(!audioPath&&before?.capturedAt){const jobs=lemoService.get(project.id).jobs||[];for(const job of [...jobs].reverse()){if(job.status==='completed'&&job.operation==='audio'&&Date.parse(job.createdAt)>=Date.parse(before.capturedAt)){const candidate=fileFrom(job,'mix.wav');if(candidate){audioPath=safe(project.cwd,candidate);break}}}}
          if(!audioPath){const cues=cueList(project,events,record,before);if(!cues.length)return finish(op,record,folder,'needs_sound','画面已渲染，但没有可用的声音时间线或原创混音；请在同一聊天补充声音后继续');const audio=await step(op,record,folder,'audio',{cues});audioPath=fileFrom(audio,'.wav');if(!audioPath)throw new Error('音效任务没有返回真实WAV')}
        }
      }
      if(needsMux){if(hostAudio)audioPath=checkedVideoAudioSelection(project,data(project.cwd,'.video-audio.json'));const mux=await step(op,record,folder,'mux',{video:safe(project.cwd,videoPath),audio:audioPath,grain:0});videoPath=fileFrom(mux,'.mp4');if(!videoPath)throw new Error('混音任务没有返回真实成片')}
      if(hostAudio)record.checks.sourceAudio={passed:true,name:hostAudio.source.name,start:hostAudio.selection.start,end:hostAudio.selection.end,duration:hostAudio.selection.duration,sha256:hostAudio.selection.sha256}
      unchanged(project,record.fingerprint);checkSignal(op.controller.signal)
      const actual=await probe(safe(project.cwd,videoPath),project,runtime,op.controller.signal)
      record.checks.media={passed:true,duration:actual.duration,width:actual.width,height:actual.height,fps:actual.fps,audio:actual.audio}
      if(!actual.audio)return finish(op,record,folder,'needs_sound','候选影片没有音轨；保留原有可预览版本，请补充声音')
      record.checks.motion ||=await motion(videoPath,project,runtime,op.controller.signal)
      if(!record.checks.motion.passed)return finish(op,record,folder,'needs_work','真实成片全程缺少足够的画面变化；这版未替换原有影片，请继续完成动态内容')
      record.checks.sound ||=await sound(videoPath,runtime,op.controller.signal)
      if(!record.checks.sound.passed)return finish(op,record,folder,'needs_sound','候选影片音轨为静音或声音过低；这版未替换原有影片，请继续修改声音')
      unchanged(project,record.fingerprint);checkSignal(op.controller.signal);const finalPath=join(folder,'影片.mp4');copyFileSync(safe(project.cwd,videoPath),finalPath)
      record.output={...actual,path:finalPath,projectPath:snapshot,ownerProjectId:project.id,productionId:id};record.videoPath=finalPath;record.outputSha256=sha(readFileSync(finalPath))
      return finish(op,record,folder,'completed',record.checks.readability.applicable===false?'影片已完成，画面变化与真实声音检查通过；没有画面文字，阅读时长检查不适用，可以在这里预览':'影片已完成，关键帧已保存，文字时长、画面变化和真实声音检查通过，可以在这里预览')
    }catch(e){if(e.name==='AbortError'||op.controller.signal.aborted)return finish(op,record,folder,'cancelled','制作已取消，工程与以前的影片均已保留',e);return finish(op,record,folder,'failed','这次制作未完成，已保留工程；可在同一聊天继续修改后重试',e)}
  }
  function produce({projectId,before,signal}={}){
    if(closed)return Promise.resolve({projectId,status:'failed',message:'视频制作服务已关闭'})
    if(active.has(projectId))return active.get(projectId).promise
    const controller=new AbortController(),op={projectId,controller,jobId:null};const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort()
    op.promise=Promise.resolve().then(()=>{checkSignal(controller.signal);op.project=projectFor(projectId);return work(op,before)}).catch(e=>({projectId,status:e.name==='AbortError'?'cancelled':'failed',message:e.name==='AbortError'?'制作已取消':'影片工程暂不能制作',error:e.message,steps:[],jobs:[],warnings:[]})).finally(()=>{signal?.removeEventListener('abort',abort);active.delete(projectId)})
    active.set(projectId,op);return op.promise
  }
  async function cancel(projectId){const op=active.get(projectId);if(!op)return null;op.controller.abort();await cancelOwned(op);return op.promise}
  async function close(){closed=true;const results=await Promise.allSettled([...active.keys()].map(cancel));const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,'视频制作清理失败')}
  return{capture,produce,cancel,close}
}
