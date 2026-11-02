/** Native Pi host: one shared model connection, full module gateway and app permissions. */
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { PiService } from './pi-service.mjs'
import { ComputerService } from './computer-service.mjs'
import { capabilities, modelCallableMethods } from './capabilities.mjs'
import { StarterPreview } from './starter-preview.mjs'
import { companyModelResult } from './company-research-model.mjs'
import { lemoModelResult } from './lemo-model.mjs'
import { motionSkillDirectory, motionSkillInfo, motionSkillRead, prepareMotionWorkspace } from './motion-skill.mjs'

export function registerPi({handle,moduleActions,directory,workspace,getApi,desktopCapturer,dialog,shell,window,publish,getContext,getResearch=()=>null,getVideo=()=>null,getLemo=()=>null,getStudio=()=>null,starter,products,blueprint,geo,store}){
 const videoCatalog=()=>getStudio()?getStudio().list().map(p=>({kind:'video',id:p.id,name:p.title,status:p.status})):[...(getVideo()?.list()||[]).map(p=>({kind:'video',id:p.id,name:p.title,status:p.status})),...(getLemo()?.list()||[]).map(p=>({kind:'lemo',id:p.id,name:p.title,status:p.status||'Lemo工程'}))]
 const computer=new ComputerService({nativePath:join(directory,'assets/native-computer.node'),desktopCapturer})
 const preview=new StarterPreview({capturePage:starter.capturePage})
 const manualRoot=join(directory,'integrations/product-manuals/2026-10-21'),manifest=JSON.parse(readFileSync(join(manualRoot,'SOURCE.json'),'utf8'))
 const manuals=Object.keys(manifest.files).map(name=>({name,path:join(manualRoot,name)}))
 const moduleCall=async(action,args=[])=>{
  if(action==='capabilities')return{engine:'Pi Agent 1.3.0',model:getApi().model,capabilities,argumentFormat:'args为数组，按各方法位置传参；如workbench({action:"blueprintProductGet",args:["产品id"]})。人工验收/评分/导出审核只能在工作台界面由用户操作。',examples:[{action:'blueprintStart',args:[{mode:'plan',title:'产品名',input:'具体需求'}]},{action:'blueprintProductStart',args:[{action:'init',name:'产品名',idea:'需求'}]},{action:'geoCreate',args:[]},{action:'starterCreate',args:[{name:'产品名',idea:'需求'}]}],manuals}
  if(!modelCallableMethods.has(action)||!moduleActions.has(action))throw new Error('此操作需在工作台界面执行，不能由模型代替人工确认')
  if(!Array.isArray(args)||args.length>8)throw new Error('工具参数须使用位置参数数组')
  const result=await moduleActions.get(action)(...args)
  const projected=companyModelResult(action,action==='companyReadLibrary'?{...result,path:join(directory,'skills/hjh-company-research',result.name)}:result)
  return lemoModelResult(action,projected,{service:getLemo(),args})
 }
 const service=new PiService({root:join(workspace,'Pi对话'),getApi,computer,preview,moduleCall,getContext,submitVideo:(chatId,args)=>{const studio=getStudio();if(!studio)throw new Error('视频工作室尚未就绪');return studio.submitForChat(chatId,args)},onUpdate:publish,manuals,skillPaths:[join(directory,'skills'),motionSkillDirectory]})
 handle('motionSkillInfo',()=>motionSkillInfo())
 handle('motionSkillRead',name=>motionSkillRead(name))
 handle('motionPrepare',options=>{const project=prepareMotionWorkspace({...options,root:join(workspace,'动效工程')});const chat=service.create({title:('动效 · '+project.title).slice(0,100),cwd:project.cwd});return{...project,chatId:chat.id}})
 for(const[name,method]of Object.entries({piList:'list',piGet:'get',piCreate:'create',piSend:'send',piReply:'reply'}))handle(name,(...args)=>service[method](...args))
 handle('piCancel',async id=>{const research=getResearch(),projectId=research?.projectIdForChat(id);return projectId?(await research.cancel(projectId)).chat:service.cancel(id)})
 handle('piStatus',()=>({engine:'Pi Agent',version:'1.3.0',model:getApi().model,configured:!!getApi().apiKey,permissions:computer.status(),execution:{...service.executionLimits,deadlineMs:service.deadlineMs},capabilities,manuals}))
 handle('piPickFolder',async()=>{const r=await dialog.showOpenDialog(window(),{title:'选择Pi可以操作的项目目录',properties:['openDirectory','createDirectory']});return r.canceled?null:r.filePaths[0]})
 handle('piOpenFolder',async id=>{const error=await shell.openPath(service.folder(id));if(error)throw new Error(error)})
 handle('piArtifact',async(id,path)=>{const p=service.get(id);if(!p.artifacts.some(a=>a.path===path))throw new Error('此文件不是当前对话的产物');const error=await shell.openPath(path);if(error)throw new Error(error)})
 handle('piPermissions',()=>computer.status())
 handle('piManualRead',name=>{const manual=manuals.find(item=>item.name===name);if(!manual)throw new Error('手册名称无效');return{name:manual.name,content:readFileSync(manual.path,'utf8')}})
 handle('piRequestPermission',async kind=>{if(!['accessibility','screen'].includes(kind))throw new Error('权限类型无效');computer.requestPermission(kind);await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?'+(kind==='accessibility'?'Privacy_Accessibility':'Privacy_ScreenCapture'));return computer.status()})
 handle('piCatalog',async()=>({capabilities,manuals,projects:[...(await store.list()).map(p=>({kind:'discovery',id:p.id,name:p.name,status:'产品梳理'})),...products.list().map(p=>({kind:'blueprint',id:p.id,name:p.name,status:'产品闭环'})),...blueprint.list().map(p=>({kind:'task',id:p.id,name:p.title,status:p.status})),...starter.service.list().map(p=>({kind:'starter',id:p.id,name:p.name,status:p.status})),...geo.list().map(p=>({kind:'geo',id:p.id,name:p.profile?.brand||p.name||'GEO内容项目',status:p.status})),...(getResearch()?.list()||[]).map(p=>({kind:'company',id:p.id,name:p.subject,status:p.status})),...videoCatalog()]}))
 return{service,computer,async close(){await service.close();await computer.close()}}
}
