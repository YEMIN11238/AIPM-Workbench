/** Native host behavior is checked without granting OS permissions or touching user apps. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { ComputerService } from './computer-service.mjs'
function setup(t,{reply=true,timeout=1000}={}){
 const worker=new EventEmitter(),calls=[]
 worker.postMessage=request=>{calls.push(request.args);if(!reply)return;let value;if(request.args.action==='inspect')value={app:request.args.app,snapshotId:'snapshot-'+calls.length,nodes:[{id:1,title:'新建文件'},{id:2,title:'发送'}],windows:[{id:10,bounds:{X:100,Y:100,Width:500,Height:400}}]};else value={done:true};queueMicrotask(()=>worker.emit('message',{id:request.id,result:{value}}))}
 worker.terminate=async()=>{worker.emit('exit',0);return 0}
 const native={request:args=>JSON.stringify({value:JSON.parse(args).action==='status'?{accessibility:0,screenRecording:false}:{requested:true}})}
 const service=new ComputerService({native,worker,requestTimeoutMs:timeout});t.after(()=>service.close());return{service,calls}
}
test('permission check does not prompt, and missing recording permission prevents capture',async t=>{
 const {service,calls}=setup(t)
 assert.deepEqual(service.status(),{accessibility:false,screenRecording:false,available:true});assert.equal(calls.length,0)
 await assert.rejects(service.execute({action:'capture',app:'com.example.editor'}),/屏幕录制/)
 assert.throws(()=>service.requestPermission('other'),/权限类型/)
})
test('app actions use fresh snapshots, sensitive controls ask once, and self approval cannot be automated',async t=>{
 const {service,calls}=setup(t),app='com.example.editor'
 let snapshot=await service.execute({action:'inspect',app})
 const before=calls.length
 await assert.rejects(service.execute({action:'click',app,element:1}),/尚未执行.*snapshotId/)
 assert.equal(calls.length,before)
 await service.execute({action:'click',app,snapshotId:snapshot.snapshotId,element:1})
 await assert.rejects(service.execute({action:'click',app,snapshotId:snapshot.snapshotId,element:1}),/重新读取/)
 snapshot=await service.execute({action:'inspect',app});let approvals=0
 await assert.rejects(service.execute({action:'click',app,snapshotId:snapshot.snapshotId,element:2},{approve:async()=>{approvals++;return false}}),/未获批准/);assert.equal(approvals,1)
 await service.execute({action:'click',app,snapshotId:snapshot.snapshotId,element:2},{approve:async()=>true})
 await assert.rejects(service.execute({action:'click',app:'local.personal.aipm.workbench',element:1,snapshotId:'anything'}),/本人操作/)
})
test('coordinate mouse controls remain inside observed application windows',async t=>{
 const {service}=setup(t),app='com.example.editor';const snapshot=await service.execute({action:'inspect',app})
 await assert.rejects(service.execute({action:'click_at',app,snapshotId:snapshot.snapshotId,x:0,y:0}),/窗口内/)
 await service.execute({action:'click_at',app,snapshotId:snapshot.snapshotId,x:220,y:250})
})
test('worker timeout cancels outstanding operations rather than leaving a hanging UI task',async t=>{
 const {service}=setup(t,{reply:false,timeout:20});await assert.rejects(service.execute({action:'apps'}),/超时/);assert.equal(service.status().available,false)
 await assert.rejects(service.execute({action:'apps'}),/停止/)
})
