import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { CompanionService, defaultSettings, runtimeEnvironment } from './service.mjs'
import { CompanionConsoleView } from './view.mjs'
const safeStorage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text.split('').reverse().join('')), decryptString: data => data.toString().split('').reverse().join('') }
function fixture() {
 const root=mkdtempSync(join(tmpdir(),'qq-upstream-')), bridgeRoot=join(root,'upstream'),launches=[],children=new Map(),network=[]
 mkdirSync(join(bridgeRoot,'src'),{recursive:true});writeFileSync(join(bridgeRoot,'src/bridge.js'),'')
 writeFileSync(join(bridgeRoot,'config.example.json'),JSON.stringify({dsh:{},snowluma:{},slang:{},social:{},socialV2:{proactive:{}}}))
 writeFileSync(join(root,'settings.json'),JSON.stringify({...defaultSettings(),botQQ:'12345678',owner:{qq:'87654321',bilibili:'',douyin:''}}))
 let pid=100000
 const spawnProcess=(command,args,options)=>{const c=new EventEmitter();c.pid=++pid;children.set(c.pid,c);launches.push({command,args,options});return c}
 const fetcher=async(url,options={})=>{network.push({url,options});return{ok:!url.endsWith('19387/'),status:url.endsWith('19387/')?401:200,json:async()=>url.endsWith('/api/console/ticket')?{ok:true,ticket:'one-time-ticket-123456789'}:{mode:'reserved2',dshReady:true,snowluma:{connected:true,accountOnline:false},secret:'must-not-return-upstream-object'}}}
 const service=new CompanionService({root,bridgeRoot,directory:join(root,'source/apps/aipm-desktop'),safeStorage,spawnProcess,fetcher,killProcess:pid=>{queueMicrotask(()=>children.get(-pid).emit('close',null,'SIGTERM'));return true}})
 return{root,service,launches,network,async close(){await service.close();rmSync(root,{recursive:true,force:true})}}
}

test('tutorial engine launches existing DSH and QQ Bridge, isolates key and uses upstream one-time console tickets',async()=>{
 const f=fixture()
 try{
  await f.service.saveModelKey('only-companion-key');assert.equal(f.launches.length,0)
  await f.service.start();await f.service.start()
  assert.equal(f.launches.length,2)
  const [dsh,bridge]=f.launches
  assert.ok(dsh.args.includes('--profile'));assert.ok(dsh.args.includes('web'));assert.equal(dsh.options.env.DEEPSEEK_API_KEY,'only-companion-key')
  assert.equal(dsh.options.env.DSH_HOME,join(f.root,'dsh-home'));assert.equal(dsh.options.cwd,join(f.root,'workspace'))
  assert.equal(bridge.args[0],join(f.root,'upstream/src/bridge.js'));assert.equal(bridge.options.env.DEEPSEEK_API_KEY,undefined)
  const config=JSON.parse(readFileSync(join(f.root,'upstream/config.json'),'utf8'))
  assert.deepEqual(config.allow,{private:[87654321],groups:[]});assert.equal(config.allowAllWhenEmpty,false);assert.equal(config.dsh.modelScope,'session')
  assert.equal(config.role.injectPerMessage,true);assert.equal(config.socialV2.proactive.enabled,false)
  assert.equal(JSON.stringify(config).includes('only-companion-key'),false)
  assert.match(await f.service.consoleUrl(),/^http:\/\/127.0.0.1:3101\/auth\/ticket\?t=one-time-ticket-/)
  const snapshot=await f.service.snapshot();assert.equal(snapshot.backend.running,true);assert.equal(snapshot.engine.version,'0.3.3');assert.equal(snapshot.qq.connected,false)
  assert.equal(JSON.stringify(snapshot).includes('only-companion-key'),false);assert.equal(JSON.stringify(snapshot).includes('must-not-return-upstream-object'),false)
  assert.equal(f.network.some(n=>n.url.includes('api.deepseek.com')),false)
  assert.equal(existsSync(join(f.root,'memory.sqlite')),false)
  await f.service.stop();assert.equal(f.service.children.size,0)
 }finally{await f.close()}
})

test('missing independent key blocks launch; legacy encrypted QQ secrets and key survive reopening without workbench fallback',async()=>{
 const f=fixture()
 try{
  await assert.rejects(f.service.start(),/自己的 API Key/);assert.equal(f.launches.length,0)
  await f.service.saveModelKey('own-model-secret');await f.service.saveModelKey('')
  assert.equal(JSON.stringify(await f.service.snapshot()).includes('own-model-secret'),false)
  assert.equal(readFileSync(join(f.root,'credentials.bin'),'utf8').includes('own-model-secret'),false)
  const reopened=new CompanionService({root:f.root,bridgeRoot:join(f.root,'upstream'),safeStorage})
  assert.equal((await reopened.snapshot()).model.configured,true);assert.equal(reopened.secrets.modelApiKey,'own-model-secret');await reopened.close()
  f.service.safeStorage={...safeStorage,isEncryptionAvailable:()=>false}
  await assert.rejects(f.service.saveModelKey('failed-save'),/系统加密不可用/);assert.equal(f.service.secrets.modelApiKey,'own-model-secret')
  f.service.safeStorage=safeStorage
 }finally{await f.close()}
})

test('runtime environment never inherits unrelated model keys, tokens or Electron node override',()=>{
 const env=runtimeEnvironment({PATH:'/bin',HOME:'/home/user',DEEPSEEK_API_KEY:'workbench-key',OPENAI_API_KEY:'other-key',AUTH_TOKEN:'private',ELECTRON_RUN_AS_NODE:'1'},'/isolated','/source')
 assert.deepEqual(Object.keys(env).sort(),['DSH_HOME','HOME','PATH','TSX_TSCONFIG_PATH'].sort())
 assert.equal(runtimeEnvironment({},'/isolated','/source','companion').DEEPSEEK_API_KEY,'companion')
})

test('native console hides a delayed open and keeps original HTTP page outside workbench IPC',async()=>{
 let resolveUrl
 const getUrl=()=>new Promise(resolve=>{resolveUrl=resolve})
 const host={getContentBounds:()=>({width:1200,height:800}),isDestroyed:()=>false,contentView:{addChildView(){},removeChildView(){}}}
 let created=0
 class View{constructor(options){created++;this.options=options;this.webContents={setWindowOpenHandler(){},on(){},loadURL:async()=>{},isDestroyed:()=>false,close(){}}}setBounds(value){this.bounds=value}}
 const view=new CompanionConsoleView({WebContentsView:View,window:()=>host,getUrl})
 const pending=view.show({x:240,y:150,width:900,height:600});view.hide();resolveUrl('http://127.0.0.1:3101/auth/ticket?t=one-time-ticket-123456789');assert.equal(await pending,false);assert.equal(created,0)
 assert.throws(()=>view.bounds({x:NaN,y:1,width:1,height:1}),/无效/)
 assert.deepEqual(view.bounds({x:240,y:150,width:4000,height:4000}),{x:240,y:150,width:960,height:650})
 view.close()
})
