import React from 'react';
import {AbsoluteFill, Audio, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'};
const ease=t=>1-Math.pow(1-Math.max(0,Math.min(1,t)),3);
const textSize=(text,large=112)=>text.length<18?large:text.length<30?82:text.length<50?62:44;
const font="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', sans-serif";
function Arrow({size=30}){return <svg width={size} height={size} viewBox="0 0 32 32" fill="none"><path d="M6 16h19M17 7l9 9-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
function Mark({size=88}){return <div style={{width:size,height:size,borderRadius:size*.27,display:'flex',alignItems:'center',justifyContent:'center',border:'1.5px solid rgba(255,255,255,.7)',background:'linear-gradient(145deg,rgba(255,255,255,.22),rgba(255,255,255,.04))',boxShadow:'inset 0 2px 1px rgba(255,255,255,.3),0 16px 50px rgba(0,0,0,.22)',fontSize:size*.56,fontWeight:600,letterSpacing:'-.07em'}}>P</div>}
const glass={background:'linear-gradient(130deg,rgba(255,255,255,.16),rgba(255,255,255,.045))',border:'1px solid rgba(255,255,255,.22)',backdropFilter:'blur(32px)',boxShadow:'inset 0 1px 0 rgba(255,255,255,.25),0 30px 90px rgba(0,0,0,.25)'};
function Screen({asset,style={},frame=0,accent}){return <div style={{position:'relative',borderRadius:24,overflow:'hidden',padding:6,background:'rgba(255,255,255,.12)',border:'1px solid rgba(255,255,255,.27)',boxShadow:'0 45px 100px rgba(0,0,0,.45),inset 0 1px 1px rgba(255,255,255,.3)',...style}}>
  <div style={{position:'relative',width:'100%',height:'100%',borderRadius:18,overflow:'hidden',background:'#161a28'}}>{asset?<Img src={staticFile(asset.src)} style={{width:'100%',height:'100%',objectFit:'contain',background:'#171a25'}}/>:<div style={{padding:80,color:'#dbe5ff',height:'100%',...glass}}><div style={{fontSize:30,color:accent}}>REMOTION LOCAL PREVIEW</div><div style={{fontSize:72,marginTop:70}}>素材待导入</div><div style={{fontSize:28,marginTop:24,opacity:.6}}>本地渲染验证 · 非产品实拍画面</div></div>}
  <div style={{position:'absolute',inset:0,background:`linear-gradient(112deg,transparent ${interpolate(frame,[0,90],[-60,130],clamp)}%,rgba(255,255,255,.12) ${interpolate(frame,[0,90],[-45,145],clamp)}%,transparent ${interpolate(frame,[0,90],[-30,160],clamp)}%)`,pointerEvents:'none'}}/>
  </div></div>}
function Backdrop({palette,frame}){return <AbsoluteFill style={{background:palette.background,color:palette.text,overflow:'hidden'}}>
  <div style={{position:'absolute',width:1500,height:1200,left:-320+Math.sin(frame/130)*120,top:-460,borderRadius:'50%',background:`radial-gradient(ellipse,${palette.accent}38 0%,transparent 66%)`,filter:'blur(55px)'}}/>
  <div style={{position:'absolute',width:1400,height:1100,right:-500,top:180+Math.cos(frame/150)*100,borderRadius:'50%',background:'radial-gradient(ellipse,#8b5cf62b 0%,transparent 65%)',filter:'blur(60px)'}}/>
  <div style={{position:'absolute',inset:0,background:'radial-gradient(ellipse at 52% 30%,transparent 20%,rgba(0,0,0,.44) 100%)'}}/>
  <div style={{position:'absolute',height:1,top:102, left:100,right:100,background:'linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)'}}/>
</AbsoluteFill>}
function Scene({scene,index,count,start,frames,assets,palette,totalFrames}){
  const frame=useCurrentFrame(),{fps}=useVideoConfig(),local=frame-start;
  const enter=spring({frame:local+6,fps,config:{damping:22,stiffness:110,mass:1.05}});
  const incoming=interpolate(local,index===0?[0,12]:[-8,8],[0,1],clamp),outgoing=index===count-1?1:interpolate(local,[frames-8,frames+8],[1,0],clamp);
  const alpha=incoming*outgoing,kind=scene.kind,accent=scene.accent||palette.accent,asset=assets.find(a=>a.id===scene.assetId)||assets[index%Math.max(1,assets.length)];
  const reveal={opacity:interpolate(local,[3,16],[0,1],clamp),transform:`translateY(${(1-enter)*48}px)`,filter:`blur(${Math.max(0,(1-enter)*9)}px)`};
  const title=scene.title,subtitle=scene.subtitle||'',body=scene.body||'';
  const bullets=scene.bullets?.length?scene.bullets.slice(0,3):body.includes('/')?body.split('/').map(s=>s.trim()).filter(Boolean).slice(0,3):body?[body]:[];
  if(local < -8 || local > frames+8)return null;
  return <AbsoluteFill style={{opacity:alpha,overflow:'hidden',perspective:1800}}>
    <div style={{position:'absolute',top:53,left:104,fontSize:22,letterSpacing:4,color:'#dce5f7',opacity:.78,display:'flex',gap:14,alignItems:'center'}}><span style={{fontWeight:650,letterSpacing:1}}>AIPM</span><span style={{opacity:.45}}> / </span><span style={{fontSize:18,letterSpacing:3}}>{scene.eyebrow||['WORK WITH IDEAS','FROM WORDS TO WORK','ONE WORKSPACE','MAKE IT REAL'][index%4]}</span></div>
    <div style={{position:'absolute',right:104,top:54,fontSize:17,letterSpacing:2,opacity:.42}}>0{index+1} / 0{count}</div>
    {kind==='hero'&&<>
      <Screen asset={asset} accent={accent} frame={local} style={{position:'absolute',width:1080,height:715,left:1030-enter*130,top:215,transform:`translateY(${(1-enter)*130}px) rotateY(${-14+enter*5}deg) rotateZ(-3deg) scale(${1.05+local/2200})`,opacity:interpolate(local,[10,26],[0,.86],clamp)}}/>
      <div style={{position:'absolute',left:136,top:235,width:1010,...reveal}}><Mark/><div style={{fontSize:textSize(title,120),fontWeight:600,letterSpacing:'-.055em',lineHeight:1.12,marginTop:34,textShadow:'0 8px 40px rgba(0,0,0,.3)'}}>{title}</div><div style={{fontSize:36,color:'#dce6fc',lineHeight:1.5,marginTop:30,maxWidth:820}}>{subtitle}</div><div style={{display:'flex',gap:16,alignItems:'center',fontSize:22,color:accent,marginTop:46,opacity:interpolate(local,[15,30],[0,1],clamp)}}><span style={{width:42,height:1,background:accent}}/>{body.slice(0,80)||'从想法，走到可见的成果。'}</div></div>
    </>}
    {kind==='workflow'&&<>
      <Screen asset={asset} accent={accent} frame={local} style={{position:'absolute',width:1280,height:847,left:85,top:154,transform:`translateX(${(1-enter)*-100}px) rotateY(${3.5-enter*2}deg) scale(${1+local/4000})`,opacity:.97}}/>
      <div style={{position:'absolute',right:105,top:300,width:670,padding:43,borderRadius:28,...glass,transform:`translateY(${(1-enter)*100}px)`,opacity:interpolate(local,[5,22],[0,1],clamp)}}>
        <div style={{display:'flex',gap:12,alignItems:'center',fontSize:18,letterSpacing:3,color:accent}}><div style={{width:7,height:7,borderRadius:7,background:accent}}/>一句话，开始行动</div>
        <h1 style={{fontSize:textSize(title,72),lineHeight:1.18,margin:'25px 0 20px',fontWeight:550,letterSpacing:'-.04em'}}>{title}</h1><p style={{fontSize:28,lineHeight:1.5,color:'#e3eaf8',margin:0}}>{subtitle}</p>
        <div style={{fontSize:22,lineHeight:1.55,marginTop:28,padding:'22px 24px',border:'1px solid rgba(255,255,255,.17)',background:'rgba(5,10,20,.4)',borderRadius:16,color:'#c1cce0',minHeight:110}}><span style={{opacity:.5,marginRight:12}}>›</span>{body.slice(0,Math.min(body.length,Math.max(0,Math.floor(local*2))))}<span style={{opacity:Math.floor(local/10)%2?0:1,color:accent}}>│</span></div>
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:20,color:accent}}><Arrow/></div>
      </div>
    </>}
    {kind==='showcase'&&<>
      <div style={{position:'absolute',left:120,top:250,width:400,...reveal}}><h1 style={{fontSize:title.length>18?48:68,fontWeight:600,letterSpacing:'-.045em',lineHeight:1.22,margin:0}}>{title}</h1><p style={{fontSize:28,lineHeight:1.6,margin:'28px 0 0',color:'#c2cfe5'}}>{subtitle}</p></div>
      <Screen asset={asset} accent={accent} frame={local} style={{position:'absolute',left:605-enter*45,top:153-enter*10,width:1325,height:878,transform:`translateY(${(1-enter)*100}px) scale(${.985+ease(Math.max(0,local)/(frames||1))*.02})`}}/>
      <div style={{position:'absolute',left:120,width:390,bottom:135,display:'flex',gap:14,flexDirection:'column',alignItems:'flex-start'}}>{bullets.map((label,i)=>{const p=spring({frame:local-10-i*7,fps,config:{damping:18}});return <div key={i} style={{...glass,boxSizing:'border-box',maxWidth:390,padding:'14px 24px',borderRadius:label.length>24?18:50,fontSize:label.length>60?14:label.length>30?18:24,lineHeight:1.45,overflowWrap:'anywhere',opacity:p,transform:`translateX(${(1-p)*-45}px)`}}><span style={{color:accent,marginRight:12}}>0{i+1}</span>{label}</div>})}</div>
    </>}
    {kind==='outro'&&<>
      <div style={{position:'absolute',left:160,right:160,top:245,textAlign:'center',...reveal}}><div style={{display:'flex',justifyContent:'center'}}><Mark size={98}/></div><h1 style={{fontSize:textSize(title,110),fontWeight:580,letterSpacing:'-.055em',lineHeight:1.14,margin:'30px 0 20px'}}>{title}</h1><div style={{fontSize:36,lineHeight:1.4,color:'#d9e5fa'}}>{subtitle}</div><div style={{marginTop:44,display:'inline-flex',gap:40,alignItems:'center',...glass,borderRadius:60,padding:'18px 32px',fontSize:25,color:accent,transform:`translateY(${(1-enter)*40}px)`}}>{body.slice(0,80)||'把想法，变成作品。'}<Arrow size={26}/></div></div>
    </>}
    <div style={{position:'absolute',left:104,right:104,bottom:15,height:2,background:'rgba(255,255,255,.1)'}}><div style={{height:2,width:`${Math.min(100,frame/totalFrames*100)}%`,background:`linear-gradient(90deg,${accent}40,${accent})`}}/></div>
  </AbsoluteFill>
}
export function Intro(project){const frame=useCurrentFrame();const {fps,durationInFrames,width,height}=useVideoConfig();let cursor=0;const scenes=project.storyboard.scenes.map((s,index)=>{const start=cursor;const frames=index===project.storyboard.scenes.length-1?durationInFrames-cursor:Math.round(s.duration*fps);cursor+=frames;return {...s,start,frames}});const palette=project.storyboard.palette;const scale=Math.min(width/1920,height/1080);
 return <AbsoluteFill style={{fontFamily:font,color:palette.text,fontWeight:400,background:palette.background}}><div style={{position:'absolute',width:1920,height:1080,left:(width-1920*scale)/2,top:(height-1080*scale)/2,transform:`scale(${scale})`,transformOrigin:'top left',overflow:'hidden'}}><Backdrop palette={palette} frame={frame}/>{scenes.map((s,i)=><Scene key={s.id} scene={s} index={i} count={scenes.length} start={s.start} frames={s.frames} assets={project.assets||[]} palette={palette} totalFrames={durationInFrames}/>)}</div>{project.audioEnabled!==false&&<Audio src={staticFile('sound-design.wav')} volume={.7}/>}</AbsoluteFill>;
}
