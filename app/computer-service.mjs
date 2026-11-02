/** App-scoped macOS controls with asynchronous Accessibility inspection and local OCR. */
import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const actions = new Set(['status','apps','launch','inspect','click','type_text','press_key','scroll','capture','click_at','drag'])
const privateApps = new Set(['local.personal.aipm.workbench','com.apple.systempreferences','com.apple.keychainaccess'])
const sensitiveLabel = /支付|付款|购买|下单|发送|发布|删除|移到废纸篓|授权|允许|同意|转账|submit|pay|purchase|delete|publish|send\b/i
const workerSource = `const {parentPort,workerData}=require('node:worker_threads');const native=require(workerData);parentPort.on('message',r=>{try{const value=r.ocr?native.ocr(Buffer.from(r.bytes)):native.request(JSON.stringify(r.args));parentPort.postMessage({id:r.id,result:JSON.parse(value)})}catch(e){parentPort.postMessage({id:r.id,result:{error:e.message}})}})`

/** Native controls are isolated from model credentials; injectable dependencies support keyless host tests. */
export class ComputerService {
  constructor({ nativePath, desktopCapturer, native, worker, requestTimeoutMs=20000 }) {
    this.native=native || createRequire(import.meta.url)(nativePath)
    this.desktopCapturer=desktopCapturer
    this.calls=new Map(); this.snapshots=new Map(); this.closed=false; this.failed=false
    this.requestTimeoutMs=requestTimeoutMs
    this.worker=worker || new Worker(workerSource,{eval:true,workerData:nativePath})
    this.worker.on('message',record=>{
      const call=this.calls.get(record.id); if(!call)return
      this.calls.delete(record.id); clearTimeout(call.timer)
      record.result.error ? call.reject(new Error(record.result.error)) : call.resolve(record.result.value)
    })
    this.worker.on('error',()=>this.#fail('电脑操作进程异常，请重新打开工作台'))
    this.worker.on('exit',()=>{if(!this.closed)this.#fail('电脑操作进程已退出，请重新打开工作台')})
  }
  #fail(message) {
    this.failed=true; this.snapshots.clear()
    for(const call of this.calls.values()){clearTimeout(call.timer);call.reject(new Error(message))}
    this.calls.clear()
  }
  #call(args,bytes) {
    if(this.closed||this.failed)throw new Error('电脑操作已停止，请重新打开工作台')
    const id=randomUUID()
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.#fail('电脑操作超时，已停止后续操作；请重新打开工作台后再读取界面')
        void this.worker.terminate()
      },this.requestTimeoutMs)
      this.calls.set(id,{resolve,reject,timer})
      this.worker.postMessage({id,args,ocr:!!bytes,bytes})
    })
  }
  /** Check permissions without displaying a system prompt. */
  status() {
    const result=JSON.parse(this.native.request(JSON.stringify({action:'status'})))
    if(result.error)throw new Error(result.error)
    return {accessibility:Boolean(result.value.accessibility),screenRecording:Boolean(result.value.screenRecording),available:!this.failed&&!this.closed}
  }
  /** Called only by the user's permission button; model tools cannot grant themselves access. */
  requestPermission(kind) {
    if(!['accessibility','screen'].includes(kind))throw new Error('权限类型无效')
    const result=JSON.parse(this.native.request(JSON.stringify({action:'request_'+kind})))
    if(result.error)throw new Error(result.error)
    return result.value
  }
  /** Execute one observed app action. Every mutation invalidates the prior snapshot. */
  async execute(args,{approve,artifactRoot}={}) {
    if(!args||!actions.has(args.action))throw new Error('电脑操作无效')
    if(['status','apps'].includes(args.action))return args.action==='status'?this.status():this.#call(args)
    if(typeof args.app!=='string'||!/^[-a-zA-Z0-9.]+$/.test(args.app))throw new Error('请先查看应用列表，再指定应用')
    if(!['inspect','launch','capture'].includes(args.action)&&privateApps.has(args.app.toLowerCase()))throw new Error('工作台自身确认、系统授权和钥匙串由你本人操作，Agent不能自行批准')
    if(args.action==='inspect') {
      const snapshot=await this.#call(args)
      this.snapshots.clear(); this.snapshots.set(args.app,snapshot)
      return snapshot
    }
    const snapshot=this.snapshots.get(args.app)
    if(args.action==='capture') {
      if(!this.status().screenRecording)throw new Error('需要屏幕录制权限，请点工作台的电脑权限设置')
      if(!snapshot?.windows?.length)throw new Error('请先读取目标应用的当前窗口')
      const sources=await this.desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1920,height:1200},fetchWindowIcons:false})
      const source=sources.find(s=>snapshot.windows.some(w=>s.id.startsWith('window:'+w.id+':')))
      if(!source||source.thumbnail.isEmpty())throw new Error('没有获得目标窗口截图，请把窗口展开并重新读取')
      const target=snapshot.windows.find(w=>source.id.startsWith('window:'+w.id+':'))
      const bytes=source.thumbnail.toPNG(),file=join(artifactRoot,'窗口截图-'+randomUUID()+'.png')
      mkdirSync(artifactRoot,{recursive:true,mode:0o700}); writeFileSync(file,bytes,{mode:0o600})
      const ocr=await this.#call(null,bytes)
      snapshot.capture={bounds:target.bounds,ocr}
      return {file,app:args.app,snapshotId:snapshot.snapshotId,screenBounds:target.bounds,imageSize:source.thumbnail.getSize(),ocr,note:'界面通过辅助功能和本地OCR读取；截图保留给用户查看'}
    }
    if(args.action!=='launch') {
      if(typeof args.snapshotId!=='string'||!args.snapshotId)throw new Error('本次操作尚未执行：缺少 snapshotId。先 inspect，再把返回的 snapshotId 原样传给点击、输入、按键或滚动操作。')
      if(!snapshot||snapshot.snapshotId!==args.snapshotId)throw new Error('界面已变化，请重新读取当前界面')
      const node=snapshot.nodes.find(n=>n.id===args.element)
      let label=[node?.title,node?.description,node?.value].join(' ')
      if(args.action==='click_at'&&snapshot.capture){const {bounds,ocr}=snapshot.capture;const x=(args.x-bounds.X)/bounds.Width,y=(args.y-bounds.Y)/bounds.Height;label += ' '+ocr.filter(line=>x>=line.x-.015&&x<=line.x+(line.width||.1)+.015&&y>=line.y-.015&&y<=line.y+(line.height||.03)+.015).map(line=>line.text).join(' ')}
      if(['click_at','drag'].includes(args.action)) {
        const points=args.action==='drag'?[[args.x,args.y],[args.toX,args.toY]]:[[args.x,args.y]]
        if(points.some(([x,y])=>!Number.isFinite(x)||!Number.isFinite(y)||!snapshot.windows.some(w=>{const b=w.bounds||{};return x>=b.X&&x<=b.X+b.Width&&y>=b.Y&&y<=b.Y+b.Height})))throw new Error('鼠标坐标必须位于已读取的目标应用窗口内')
      }
      const needsApproval=sensitiveLabel.test(label)
      if(needsApproval) {
        if(typeof approve!=='function'||await approve('电脑操作：'+args.action+' '+args.app+' '+(label||'窗口坐标操作'),'请核对该操作的具体位置与对象；它可能涉及对外提交、删除、交易或权限')!==true)throw new Error('本次操作未获批准')
      }
    }
    const result=await this.#call(args)
    if(args.action!=='launch')this.snapshots.clear()
    return result
  }
  /** Cancel pending calls and wait for the native worker to exit. */
  async close() {
    if(this.closed)return
    this.closed=true; this.#fail('工作台已关闭')
    await this.worker.terminate()
  }
}
