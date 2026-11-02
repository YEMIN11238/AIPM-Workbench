/** Separate no-credential worker; only the shipped Remotion template is bundled. */
import {readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(new URL('./video-engine/package.json',import.meta.url));
const {bundle}=require('@remotion/bundler');
const {openBrowser,selectComposition,renderMedia,renderStill,makeCancelSignal,getVideoMetadata}=require('@remotion/renderer');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const progress=(phase,value,message,extra={})=>emit({type:'progress',value:{phase,ratio:value,message,...extra}});
let browser,cancelled=false;const {cancel,cancelSignal}=makeCancelSignal();
process.on('SIGTERM',()=>{cancelled=true;cancel();});
try{
 const {projectPath,outputDir}=JSON.parse(await readFile(process.argv[2],'utf8'));
 const props=JSON.parse(await readFile(join(projectPath,'project.json'),'utf8'));
 progress('bundling',.03,'编译可编辑动画工程');
 const serveUrl=await bundle({entryPoint:join(projectPath,'src/index.jsx'),publicDir:join(projectPath,'public'),outDir:join(outputDir,'.bundle'),onProgress:p=>progress('bundling',.03+p/100*.07,'编译动画 '+Math.round(p)+'%'),enableCaching:false});
 if(cancelled)throw new Error('视频渲染已停止');
 const browserExecutable=join(process.cwd(),'node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell');
 await access(browserExecutable).catch(()=>{throw new Error('本地动画渲染浏览器尚未安装，请在视频引擎目录运行 npx remotion browser ensure');});
 browser=await openBrowser('chrome',{browserExecutable,chromeMode:'headless-shell',chromiumOptions:{headless:true},logLevel:'error'});
 const options={serveUrl,inputProps:props,puppeteerInstance:browser,browserExecutable,chromeMode:'headless-shell',logLevel:'error'};
 const composition=await selectComposition({...options,id:'AIPMIntro'});
 if(cancelled)throw new Error('视频渲染已停止');
 const videoPath=join(outputDir,'AIPM工作台.mp4'),posterPath=join(outputDir,'封面.png');
 let last=-1;
 await renderMedia({...options,composition,codec:'h264',audioCodec:'aac',pixelFormat:'yuv420p',outputLocation:videoPath,cancelSignal,concurrency:2,disableSharedMemoryCapture:true,imageFormat:'png',crf:18,x264Preset:'medium',overwrite:false,onProgress:p=>{const value=Math.floor(p.progress*100);if(value!==last){last=value;progress(p.stitchStage==='muxing'?'encoding':'rendering',.12+p.progress*.82,'渲染 '+value+'%',{renderedFrames:p.renderedFrames,encodedFrames:p.encodedFrames,totalFrames:composition.durationInFrames});}}});
 progress('poster',.95,'生成真实画面封面');
 let posterFrame=Math.floor(composition.durationInFrames*.58);let start=0;for(const scene of props.storyboard.scenes){if(scene.kind==='showcase'){posterFrame=Math.round((start+scene.duration*.55)*props.fps);break;}start+=scene.duration;}
 await renderStill({...options,composition,imageFormat:'png',output:posterPath,frame:posterFrame,overwrite:false});
 const metadata=await getVideoMetadata(videoPath);
 if(metadata.width!==props.width||metadata.height!==props.height||Math.abs(metadata.durationInSeconds-props.duration)>.1||Math.abs(metadata.fps-props.fps)>.01)throw new Error('实际视频规格与分镜不一致');
 const result={videoPath,posterPath,projectPath,duration:metadata.durationInSeconds,width:metadata.width,height:metadata.height,fps:metadata.fps,renderer:'Remotion 4.0.538',browser:'Chrome Headless Shell 157.0.8080.0-remotion-v3',capture:'PNG (shared-memory capture disabled)',audio:props.audioEnabled?'本地合成轻音效':'静音',hasAudio:metadata.audioCodec!==null&&props.audioEnabled};
 await writeFile(join(outputDir,'render.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 emit({type:'result',value:result});
}catch(error){emit({type:'error',message:cancelled?'视频渲染已停止':error.message});process.exitCode=1;}
finally{if(browser)await browser.close({silent:true}).catch(error=>{console.error('关闭渲染窗口失败：'+error.message);});}
