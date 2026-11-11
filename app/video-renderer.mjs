/** Trusted, data-driven Remotion exports with isolated local assets and owned process groups. */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,cp,realpath,lstat,symlink,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,dirname,resolve,isAbsolute,extname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const engine=fileURLToPath(new URL('./video-engine/',import.meta.url));
const worker=fileURLToPath(new URL('./video-render-worker.mjs',import.meta.url));
const kinds=new Set(['hero','workflow','showcase','outro']);
const hex=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
const abortError=()=>Object.assign(new Error('视频渲染已停止'),{name:'AbortError',code:'ABORT_ERR'});
function string(value,max,fallback=''){if(value===undefined||value===null)return fallback;if(typeof value!=='string'||value.length>max||value.includes('\0'))throw new Error('视频分镜文字过长或无效');return value;}
/** Validate renderer input as plain scene data; executable model output is never accepted. */
export function normalizeVideoProject(project){
 if(!project||typeof project!=='object')throw new Error('视频项目无效');
 const board=project.storyboard;
 if(!board||typeof board!=='object'||!Array.isArray(board.scenes)||!board.scenes.length||board.scenes.length>12)throw new Error('视频须有1至12个分镜');
 const fps=Number(project.fps||30),width=Number(project.width||1920),height=Number(project.height||1080),duration=Number(project.duration);
 if(fps!==30||!Number.isSafeInteger(width)||width<320||width>3840||width%2!==0||!Number.isSafeInteger(height)||height<180||height>2160||height%2!==0||!Number.isFinite(duration)||duration<1||duration>60)throw new Error('视频规格无效：30fps、1至60秒、宽320至3840、高180至2160且为偶数');
 const ids=new Set();
 const scenes=board.scenes.map((s,index)=>{
  if(!s||typeof s!=='object'||!kinds.has(s.kind)||!Number.isFinite(s.duration)||s.duration<.5||s.duration>30)throw new Error('分镜类型或时长无效');
  const id=string(s.id,80,'scene-'+(index+1));if(ids.has(id))throw new Error('分镜编号不能重复');ids.add(id);
  const accent=s.accent;if(accent!==undefined&&!hex(accent))throw new Error('分镜颜色须为六位十六进制色值');
  const title=string(s.title,100);if(!title.trim())throw new Error('分镜标题不能为空');
  return {id,kind:s.kind,duration:s.duration,title,subtitle:string(s.subtitle,180),body:string(s.body,600),eyebrow:string(s.eyebrow,80),...(accent?{accent}:{}),...(s.assetId?{assetId:string(s.assetId,120)}:{}),...(Array.isArray(s.bullets)?{bullets:s.bullets.slice(0,3).map(v=>string(v,100))}:{})};
 });
 if(Math.abs(scenes.reduce((n,s)=>n+s.duration,0)-duration)>.011)throw new Error('分镜总时长须等于项目时长');
 const defaults={background:'#080e1b',accent:'#b7dcff',text:'#f6f8ff'};const palette={...defaults};
 for(const name of Object.keys(defaults)){const value=board.palette?.[name];if(value!==undefined){if(!hex(value))throw new Error('视频配色须为六位十六进制色值');palette[name]=value;}}
 return {title:string(project.title,160,board.title||'ORVYN'),width,height,fps,duration,style:'glass',audioEnabled:project.audioEnabled!==false,assets:[],storyboard:{title:string(board.title,160,project.title||'ORVYN'),voiceover:string(board.voiceover,2000),palette,scenes}};
}
async function insideFile(file,root){
 if(!isAbsolute(file))throw new Error('视频素材须为项目内的绝对路径');
 const base=await realpath(root),candidate=resolve(file),parts=relative(base,candidate).split('/');
 if(parts[0]==='..'||candidate===base||!candidate.startsWith(base+'/'))throw new Error('视频素材超出当前项目');
 let cursor=base;for(const part of parts){cursor=join(cursor,part);if((await lstat(cursor)).isSymbolicLink())throw new Error('视频素材不能经过符号链接');}
 const info=await lstat(candidate);if(!info.isFile()||info.size>30*1024*1024)throw new Error('视频素材须为30MB以内的图片文件');
 const extension=extname(candidate).toLowerCase();if(!['.png','.jpg','.jpeg','.webp'].includes(extension))throw new Error('只支持PNG、JPEG或WebP素材');
 const bytes=await readFile(candidate);const actualExtension=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'.png':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'.webp':bytes[0]===255&&bytes[1]===216?'.jpg':null;
 if(!actualExtension)throw new Error('图片内容不是支持的格式');return {bytes,extension:actualExtension};
}
function soundDesign(duration,scenes){
 const rate=48000,count=Math.ceil(duration*rate),data=Buffer.alloc(count*4),events=[.18];let t=0;for(const s of scenes){t+=s.duration;if(t<duration)events.push(t-.07);}
 for(let i=0;i<count;i++){const now=i/rate;let value=0;for(let e=0;e<events.length;e++){const d=now-events[e];if(d>=0&&d<.8){const env=Math.exp(-d*8)*Math.min(1,d/.012);value+=(Math.sin(d*2*Math.PI*(e%2?784:659))*.09+Math.sin(d*2*Math.PI*1318)*.022)*env;}}
 const fade=Math.min(1,now/.05,(duration-now)/.2),sample=Math.round(Math.max(-1,Math.min(1,value*fade))*32767);data.writeInt16LE(sample,i*4);data.writeInt16LE(sample,i*4+2);}
 const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+data.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(2,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*4,28);header.writeUInt16LE(4,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);return Buffer.concat([header,data]);
}
function environment(){const value={};for(const name of ['PATH','TMPDIR','TEMP','TMP','LANG','LC_ALL','SYSTEMROOT','WINDIR'])if(process.env[name])value[name]=process.env[name];return value;}
function notify(callback,value){try{callback?.(value);}catch(error){console.error('视频进度接收失败：'+error.message);}}
/**
 * Render validated storyboard data using the bundled, editable Remotion template.
 * @param {{project:object,outputDir:string,signal?:AbortSignal,onProgress?:Function}} options Project-owned images and render destination.
 * @returns {Promise<{videoPath:string,posterPath:string,projectPath:string,duration:number,width:number,height:number,fps:number}>} Local video, poster, editable project and verified media properties.
 */
export async function renderVideo({project,outputDir,signal,onProgress}){
 signal?.throwIfAborted();const props=normalizeVideoProject(project);
 if(!isAbsolute(outputDir))throw new Error('视频输出目录须为绝对路径');
 await mkdir(outputDir,{recursive:true,mode:0o700});if((await lstat(outputDir)).isSymbolicLink())throw new Error('视频输出目录不能为链接');
 const output=await realpath(outputDir),projectPath=join(output,'project');
 await mkdir(projectPath,{mode:0o700});
 notify(onProgress,{phase:'preparing',ratio:.01,message:'准备可编辑工程与本地素材'});
 for(const file of ['package.json','package-lock.json','src','credits','DESIGN.md'])await cp(join(engine,file),join(projectPath,file),{recursive:true,errorOnExist:true,force:false});
 await mkdir(join(projectPath,'public/assets'),{recursive:true,mode:0o700});
 const assets=project.assets||[];if(!Array.isArray(assets)||assets.length>30)throw new Error('素材数量无效');
 if(assets.length&&!project.projectDir)throw new Error('视频项目缺少素材所属目录');
 const assetIds=new Set();
 for(const asset of assets){
  signal?.throwIfAborted();if(!asset||asset.type!=='image'||typeof asset.id!=='string'||assetIds.has(asset.id))throw new Error('视频图片素材无效或编号重复');assetIds.add(asset.id);
  const {bytes,extension}=await insideFile(asset.path,join(project.projectDir,'assets'));const filename=createHash('sha256').update(bytes).digest('hex').slice(0,24)+extension;
  await writeFile(join(projectPath,'public/assets',filename),bytes,{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  props.assets.push({id:asset.id,type:'image',src:'assets/'+filename});
 }
 for(const scene of props.storyboard.scenes)if(scene.assetId&&!assetIds.has(scene.assetId))throw new Error('分镜引用了不存在的素材');
 await writeFile(join(projectPath,'public/sound-design.wav'),soundDesign(props.duration,props.storyboard.scenes),{flag:'wx',mode:0o600});
 await writeFile(join(projectPath,'project.json'),JSON.stringify(props,null,2)+'\n',{flag:'wx',mode:0o600});
 await writeFile(join(projectPath,'使用说明.txt'),'此工程由可信 Remotion 模板及可编辑分镜数据构成。\n编辑 project.json 的 scenes 修改每个镜头的文字、时长、颜色与素材；src/Intro.jsx 控制动效。\n本机依赖已连接，可在本目录运行 npm run studio 或 npm run render。移到别的电脑后，先 npm ci。\n画面素材是已授权导入的本地截图，不代表新增实时操作；音效为本机程序合成，无配音或网络音乐。\n',{flag:'wx',mode:0o600});
 await symlink(join(engine,'node_modules'),join(projectPath,'node_modules'),'dir');
 signal?.throwIfAborted();
 const requestPath=join(output,'.render-'+randomUUID()+'.json');await writeFile(requestPath,JSON.stringify({projectPath,outputDir:output}),{flag:'wx',mode:0o600});
 return await new Promise((resolveResult,reject)=>{
  const child=spawn('/Users/example/.local/node/bin/node',[worker,requestPath],{cwd:engine,env:environment(),detached:true,stdio:['ignore','pipe','pipe']});
  let buffer='',diagnostics='',result,workerError,aborted=false,force;
  const kill=signalName=>{try{process.kill(-child.pid,signalName);}catch(error){if(error.code!=='ESRCH')console.error('视频进程清理失败：'+error.message);}};
  const abort=()=>{aborted=true;kill('SIGTERM');force=setTimeout(()=>kill('SIGKILL'),1800);};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>1024*1024){workerError=new Error('渲染器消息过大');kill('SIGKILL');return;}let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const event=JSON.parse(line);if(event.type==='progress')notify(onProgress,event.value);else if(event.type==='result')result=event.value;else if(event.type==='error')workerError=new Error(event.message);}catch(error){diagnostics=(diagnostics+'\n'+line).slice(-5000);}}});
  child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-5000);});child.once('error',error=>{workerError=error;});
  child.once('close',async(exitCode,processSignal)=>{clearTimeout(force);signal?.removeEventListener('abort',abort);if(aborted)kill('SIGKILL');await rm(requestPath,{force:true}).catch(error=>{diagnostics+='\n清理渲染请求失败：'+error.message;});
   if(aborted||signal?.aborted){reject(abortError());return;}
   if(exitCode!==0||workerError||!result){reject(Object.assign(workerError||new Error('视频未完成：'+diagnostics),{exitCode,signal:processSignal}));return;}
   notify(onProgress,{phase:'complete',ratio:1,message:'视频与可编辑工程已生成'});resolveResult(result);
  });
 });
}
